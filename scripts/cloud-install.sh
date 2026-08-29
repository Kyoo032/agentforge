#!/usr/bin/env bash
# Cursor Cloud Agents: idempotent bootstrap. No Docker on this image.
# Product database is SQLite; Postgres is not required.
set -euo pipefail
cd "$(dirname "$0")/.."

corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm --filter @agentforge/web exec playwright install --with-deps chromium
