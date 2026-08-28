#!/usr/bin/env bash
# Cursor Cloud Agents: per-boot Postgres + schema. Docker is not available here.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "postgresql-16 is missing. Cloud install must run scripts/cloud-install.sh first." >&2
  exit 1
fi

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  # apt postinst is often blocked by policy-rc.d; start the cluster ourselves.
  sudo pg_ctlcluster 16 main start
fi

for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agentforge') THEN
    CREATE ROLE agentforge LOGIN PASSWORD 'agentforge' SUPERUSER;
  END IF;
END
$$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'agentforge'" | grep -q 1; then
  sudo -u postgres createdb -O agentforge agentforge
fi

export DATABASE_URL="${DATABASE_URL:-postgres://agentforge:agentforge@127.0.0.1:5432/agentforge}"
pnpm db:push
