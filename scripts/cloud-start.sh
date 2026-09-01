#!/usr/bin/env bash
# Cursor Cloud Agents: per-boot data dir only; schema is applied in-process when Next opens SQLite.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data
unset DATABASE_URL
export AGENTFORGE_DATA_DIR="${AGENTFORGE_DATA_DIR:-$(pwd)/data}"
