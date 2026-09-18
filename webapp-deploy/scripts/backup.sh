#!/usr/bin/env sh
# Encrypted backup of the data volume, without stopping the app.
#
#   sh webapp-deploy/scripts/backup.sh [output-dir]
#
# Security spec S6: the tarball is encrypted BEFORE it leaves this host, so a COS
# bucket leak is not a data leak. The passphrase is BACKUP_KEY, which lives in Secrets
# Manager; export it first (deploy.sh does, or see the cron line in README.md).
#
# Steps:
#   1. A consistent SQLite snapshot into /data/.backup-staging/. The image has no
#      sqlite3 CLI, so the snapshot is `VACUUM INTO` through better-sqlite3, which is
#      WAL-safe: it reads a single committed transaction and writes a compacted copy
#      with no -wal/-shm of its own. If a future image adds the sqlite3 binary this
#      script uses `.backup` instead, which does the same thing.
#   2. tar of /data EXCLUDING components/ (re-downloadable, and baked into the image)
#      and logs/ (diagnostics, and spec L1 keeps them out of backups).
#   3. openssl enc -aes-256-cbc -pbkdf2 with BACKUP_KEY from the environment.
#   4. Upload to the COS backup bucket with coscli, or tccli cos, or - if neither is
#      installed - leave it in the local dir and say so loudly.
set -eu
. "$(dirname "$0")/_common.sh"

OUT_DIR="${1:-$DEPLOY_DIR/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
OUT="$OUT_DIR/dpsbuddy-data-$STAMP.tar.gz.enc"

BACKUP_KEY="$(setting BACKUP_KEY)"
if [ -z "$BACKUP_KEY" ]; then
	echo "error: BACKUP_KEY is empty. An unencrypted backup is a spec S6 violation." >&2
	echo "       export it from Secrets Manager, or set it in .env for a local run." >&2
	exit 1
fi
export BACKUP_KEY

command -v openssl >/dev/null 2>&1 || {
	echo "error: openssl is not installed on this host" >&2
	exit 1
}

CID="$(app_container)"
if [ -z "$CID" ]; then
	echo "error: the app container is not running; start it or restore from an older backup" >&2
	exit 1
fi

# --- 1. consistent SQLite snapshot -----------------------------------------

echo "==> consistent SQLite snapshot"
dc exec -T app sh -s <<'INNER'
set -eu
root="${AGENTFORGE_DATA_DIR:-/data}"
src="$root/agentforge.sqlite"
stage="$root/.backup-staging"
rm -rf "$stage"
mkdir -p "$stage"
if [ ! -f "$src" ]; then
	echo "no agentforge.sqlite yet - archiving the data dir only"
	exit 0
fi
if command -v sqlite3 >/dev/null 2>&1; then
	sqlite3 "$src" ".backup '$stage/agentforge.sqlite'"
	echo "snapshot ok (sqlite3 .backup)"
else
	node -e '
const path = require("node:path");
const Database = require("better-sqlite3");
const root = process.env.AGENTFORGE_DATA_DIR || "/data";
// Not { readonly: true }: some SQLite builds refuse VACUUM INTO on a read-only
// connection. WAL mode lets this second connection read while the app writes.
const db = new Database(path.join(root, "agentforge.sqlite"));
db.pragma("busy_timeout = 30000");
db.prepare("VACUUM INTO ?").run(path.join(root, ".backup-staging", "agentforge.sqlite"));
db.close();
console.log("snapshot ok (VACUUM INTO)");
'
fi
INNER

# --- 2 + 3. archive and encrypt --------------------------------------------

echo "==> archiving /data (minus components/ and logs/) and encrypting -> $OUT"
umask 077
dc exec -T app tar -czf - -C /data \
	--exclude=./components --exclude=./logs \
	--exclude=./.master-key . |
	openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_KEY -out "$OUT"

[ -s "$OUT" ] || {
	echo "error: the encrypted archive is empty" >&2
	rm -f "$OUT"
	exit 1
}

echo "==> clearing the staging copy inside the container"
dc exec -T app sh -c 'rm -rf "${AGENTFORGE_DATA_DIR:-/data}/.backup-staging"'

# --- verify -----------------------------------------------------------------
# A backup nobody can open is not a backup. Decrypt and list, into /dev/null.

if [ "$(setting BACKUP_VERIFY 1)" = "1" ]; then
	echo "==> verifying (decrypt + list)"
	openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$OUT" |
		tar -tzf - >/dev/null || {
		echo "error: the encrypted archive did not decrypt and untar cleanly" >&2
		exit 1
	}
fi

# --- 4. upload ---------------------------------------------------------------

BUCKET="$(setting COS_BACKUP_BUCKET)"
PREFIX="$(setting COS_BACKUP_PREFIX hourly/)"
REGION="$(setting TENCENT_REGION ap-jakarta)"
KEY="$PREFIX$(basename "$OUT")"

if [ -z "$BUCKET" ]; then
	echo "warning: COS_BACKUP_BUCKET is unset - the backup stays on this server only." >&2
	echo "         One disk failure loses it. Set the bucket in .env." >&2
elif command -v coscli >/dev/null 2>&1; then
	echo "==> uploading to cos://$BUCKET/$KEY (coscli)"
	coscli cp "$OUT" "cos://$BUCKET/$KEY"
elif command -v tccli >/dev/null 2>&1; then
	# coscli is the tested path; tccli's cos flags have moved between versions, so
	# check the upload landed before trusting this branch.
	echo "==> uploading to cos://$BUCKET/$KEY (tccli cos)"
	tccli cos put-object --region "$REGION" --bucket "$BUCKET" --key "$KEY" --path "$OUT"
else
	echo "warning: neither coscli nor tccli is installed - the backup stays on this" >&2
	echo "         server only, in $OUT_DIR. Install coscli before taking traffic." >&2
fi

# --- local retention ---------------------------------------------------------

RETAIN="$(setting BACKUP_RETAIN_DAYS 7)"
if [ "$RETAIN" -gt 0 ] 2>/dev/null; then
	find "$OUT_DIR" -maxdepth 1 -name 'dpsbuddy-data-*.tar.gz.enc' -mtime "+$RETAIN" -delete 2>/dev/null || true
fi

echo
ls -lh "$OUT"
echo "sha: $(current_sha)"
echo "restore with: sh webapp-deploy/scripts/restore.sh $OUT"
