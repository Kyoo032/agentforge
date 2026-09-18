#!/usr/bin/env sh
# Pull, rebuild, restart, wait for health, record the sha.
#
#   sh webapp-deploy/scripts/deploy.sh [--no-pull]
#
# Secrets (security spec S2/S6): with USE_SSM=1 the wrap key and the backup passphrase
# come from Tencent Cloud Secrets Manager, fetched with the CVM's instance role. They
# are exported for THIS process only and handed to compose through the interpolation
# in compose.yml. They are never written to .env, into the image, or into git.
set -eu
. "$(dirname "$0")/_common.sh"

require_env_file

PULL=1
for arg in "$@"; do
	case "$arg" in
	--no-pull) PULL=0 ;;
	*)
		echo "unknown argument: $arg" >&2
		exit 2
		;;
	esac
done

# --- secrets ---------------------------------------------------------------

USE_SSM="$(setting USE_SSM 0)"
SSM_REGION="$(setting TENCENT_REGION ap-jakarta)"
SSM_STAGE="$(setting SSM_VERSION_STAGE SSMCurrent)"
# Most tccli builds spell the action in CamelCase (GetSecretValue); the dashed form
# below works on current ones. Override with SSM_ACTION= if yours disagrees.
SSM_ACTION="${SSM_ACTION:-get-secret-value}"

# Print the plaintext of one secret. Nothing is echoed to the log on the way.
ssm_read() {
	_secret_name="$1"
	tccli ssm "$SSM_ACTION" \
		--region "$SSM_REGION" \
		--SecretName "$_secret_name" \
		--VersionStage "$SSM_STAGE" |
		python3 -c 'import json,sys; print(json.load(sys.stdin).get("SecretString",""), end="")'
}

if [ "$USE_SSM" = "1" ]; then
	command -v tccli >/dev/null 2>&1 || {
		echo "error: USE_SSM=1 but tccli is not installed on this host" >&2
		exit 1
	}
	command -v python3 >/dev/null 2>&1 || {
		echo "error: USE_SSM=1 needs python3 to read the tccli JSON" >&2
		exit 1
	}

	WRAP_SECRET="$(setting SSM_SECRET_AGENTFORGE_SECRETS_KEY)"
	BACKUP_SECRET="$(setting SSM_SECRET_BACKUP_KEY)"
	[ -n "$WRAP_SECRET" ] || {
		echo "error: SSM_SECRET_AGENTFORGE_SECRETS_KEY is not set" >&2
		exit 1
	}

	echo "==> fetching secrets from Secrets Manager ($SSM_REGION, instance role)"
	AGENTFORGE_SECRETS_KEY="$(ssm_read "$WRAP_SECRET")"
	[ -n "$AGENTFORGE_SECRETS_KEY" ] || {
		echo "error: $WRAP_SECRET came back empty" >&2
		exit 1
	}
	export AGENTFORGE_SECRETS_KEY

	if [ -n "$BACKUP_SECRET" ]; then
		BACKUP_KEY="$(ssm_read "$BACKUP_SECRET")"
		export BACKUP_KEY
	fi
	echo "==> secrets loaded into this process only (not written to disk)"

	if grep -Eq '^[[:space:]]*AGENTFORGE_SECRETS_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then
		echo "warning: AGENTFORGE_SECRETS_KEY still has a value in .env; spec S2 wants it empty on the server" >&2
	fi
fi

# --- deploy ----------------------------------------------------------------

if [ "$PULL" -eq 1 ]; then
	echo "==> git pull --ff-only"
	git -C "$REPO_ROOT" pull --ff-only
fi

SHA="$(current_sha)"
echo "==> deploying $SHA"

echo "==> build"
dc build app

echo "==> up -d"
dc up -d

echo "==> waiting for the app healthcheck (up to 5 minutes)"
CID="$(app_container)"
if [ -z "$CID" ]; then
	echo "error: the app container did not start" >&2
	dc logs --tail 50 app >&2
	exit 1
fi

i=0
while [ "$i" -lt 60 ]; do
	STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID")"
	case "$STATUS" in
	healthy)
		echo "==> healthy"
		break
		;;
	unhealthy)
		echo "error: container reported unhealthy" >&2
		dc logs --tail 80 app >&2
		exit 1
		;;
	esac
	i=$((i + 1))
	sleep 5
done

if [ "${STATUS:-}" != "healthy" ]; then
	echo "error: healthcheck did not go green in time (last status: ${STATUS:-unknown})" >&2
	dc logs --tail 80 app >&2
	exit 1
fi

# --- record ----------------------------------------------------------------
# Spec H4: the running sha is recorded per deploy.

WHO="$(setting DEPLOY_WHO "$(id -un 2>/dev/null || echo unknown)")"
NOTES="${DEPLOY_NOTES:-}"
ROW="| $(date -u '+%Y-%m-%d %H:%M') | $SHA | prod | $WHO | $NOTES |"
printf '%s\n' "$ROW" >>"$DEPLOY_DIR/DEPLOY-LOG.md"

echo
echo "deployed sha: $SHA"
echo "appended to webapp-deploy/DEPLOY-LOG.md:"
echo "$ROW"
echo
echo "copy the same row into the deploy log in docs/internal/web-pivot-2026-09-18.md"
echo "(the decision record is the one of record)."
