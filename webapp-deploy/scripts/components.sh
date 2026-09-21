#!/usr/bin/env sh
# Components on this server (Phase 7). One box, one copy, installed by the operator.
#
#   sh webapp-deploy/scripts/components.sh            # what the running container has
#   sh webapp-deploy/scripts/components.sh status     # the same thing, spelled out
#   sh webapp-deploy/scripts/components.sh check      # exit 1 if one does not load
#   sh webapp-deploy/scripts/components.sh install    # install whatever is missing
#
# The image already carries every required component — the build fails otherwise, see
# webapp-deploy/Dockerfile — so `install` is for the case between images: the manifest pins a new
# version and you would rather not rebuild and restart yet. It downloads into
# /opt/agentforge/components, which is a volume of its own (compose.yml) and NOT the tenant data
# volume: the app refuses to load a native module out of /data, which is what lets /data be mounted
# noexec (docs/internal/web-security-spec.md H3).
#
# Everything runs INSIDE the app container, through the same pinned manifest and the same hash
# check the desk's first run uses. Nothing here reaches the install HTTP route, which answers 403
# install_disabled on this server for every caller, operator included.
set -eu
. "$(dirname "$0")/_common.sh"

ACTION="${1:-status}"

case "$ACTION" in
	status | check | install) ;;
	*)
		echo "usage: $0 [status|check|install]" >&2
		exit 2
		;;
esac

if [ -z "$(app_container)" ]; then
	echo "error: the app container is not running. Start it with deploy.sh first." >&2
	exit 1
fi

# -T: no TTY, so this works from cron and from a CI step as well as from a login shell.
#
# The container's working directory is /app/apps/web and `tsx` is @agentforge/web's own dev
# dependency, so ./node_modules/.bin/tsx is the same binary the app itself boots with. The script
# path is relative to that directory; the imports INSIDE it are relative to the script's own file,
# so the working directory does not matter to them.
echo "==> components: $ACTION"
dc exec -T app ./node_modules/.bin/tsx ../../scripts/components.ts "$ACTION"
