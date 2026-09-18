#!/usr/bin/env sh
# Shared helpers. Sourced by the other scripts; not meant to be run directly.
set -eu

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"

# docker compose (v2) with a fallback to the legacy binary.
if docker compose version >/dev/null 2>&1; then
	dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
	dc() { docker-compose -f "$COMPOSE_FILE" "$@"; }
else
	echo "error: docker compose is not installed" >&2
	exit 1
fi

require_env_file() {
	if [ ! -f "$ENV_FILE" ]; then
		echo "error: $ENV_FILE is missing. Copy .env.example and fill it in." >&2
		exit 1
	fi
}

# Read one NAME=value out of .env WITHOUT sourcing it (a stray backtick or $( ) in a
# value would otherwise run as code). Prints nothing when the name is absent.
dotenv_get() {
	[ -f "$ENV_FILE" ] || return 0
	sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" | head -n 1 |
		sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" -e 's/[[:space:]]*$//'
}

# Value from the process environment first, then .env, then the given default.
setting() {
	_name="$1"
	_default="${2:-}"
	eval "_v=\${$_name:-}"
	[ -n "$_v" ] || _v="$(dotenv_get "$_name")"
	[ -n "$_v" ] || _v="$_default"
	printf '%s' "$_v"
}

current_sha() {
	git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

app_container() {
	dc ps -q app
}
