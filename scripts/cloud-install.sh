#!/usr/bin/env bash
# Cursor Cloud Agents: idempotent bootstrap. No Docker on this image.
set -euo pipefail
cd "$(dirname "$0")/.."

corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm --filter @agentforge/web exec playwright install --with-deps chromium

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y postgresql-16 postgresql-contrib-16 postgresql-client-16
