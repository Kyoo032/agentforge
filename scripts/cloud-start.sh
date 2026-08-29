#!/usr/bin/env bash
# Cursor Cloud Agents: per-boot SQLite schema. Docker is not available here.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data
unset DATABASE_URL
export AGENTFORGE_DATA_DIR="${AGENTFORGE_DATA_DIR:-$(pwd)/data}"
pnpm db:push
