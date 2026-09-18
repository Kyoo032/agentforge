#!/usr/bin/env sh
# Follow the logs. Default: both services, last 200 lines.
#
#   sh webapp-deploy/scripts/logs.sh            # everything
#   sh webapp-deploy/scripts/logs.sh app        # just the host
#   sh webapp-deploy/scripts/logs.sh proxy 500  # just Caddy, deeper tail
set -eu
. "$(dirname "$0")/_common.sh"

SERVICE="${1:-}"
TAIL="${2:-200}"

echo "==> health: $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$(app_container)" 2>/dev/null || echo 'not running')"

if [ -n "$SERVICE" ]; then
	dc logs -f --tail "$TAIL" "$SERVICE"
else
	dc logs -f --tail "$TAIL"
fi
