#!/usr/bin/env sh
# Build the app image from the repo root. Does not touch the running deployment.
#
#   sh webapp-deploy/scripts/build.sh [extra docker-compose build args]
set -eu
. "$(dirname "$0")/_common.sh"

echo "==> building dpsbuddy-web from $REPO_ROOT (sha $(current_sha))"
dc build "$@" app

echo "==> image"
docker image inspect dpsbuddy-web:local --format '{{.RepoTags}}  {{.Size}} bytes  created {{.Created}}'
