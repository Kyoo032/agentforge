#!/usr/bin/env sh
# Restore an encrypted backup into the data volume. DESTRUCTIVE: it replaces /data.
#
#   sh webapp-deploy/scripts/restore.sh <archive> [--yes]
#
# <archive> is a .tar.gz.enc written by backup.sh (openssl enc -aes-256-cbc -pbkdf2),
# or a plain .tar.gz from before encryption landed. BACKUP_KEY must be exported, or set
# in .env, for the encrypted form; it is the same passphrase backup.sh used.
#
# The app is stopped first, the volume is emptied, the archive is unpacked, and the
# consistent snapshot from .backup-staging/ is promoted over agentforge.sqlite so the
# stale -wal/-shm from the live copy can never be replayed on top of it.
set -eu
. "$(dirname "$0")/_common.sh"

TARBALL="${1:-}"
CONFIRM="${2:-}"

if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
	echo "usage: sh restore.sh <archive.tar.gz.enc> [--yes]" >&2
	exit 2
fi

ENCRYPTED=0
case "$TARBALL" in
*.enc)
	ENCRYPTED=1
	BACKUP_KEY="$(setting BACKUP_KEY)"
	if [ -z "$BACKUP_KEY" ]; then
		echo "error: $TARBALL is encrypted but BACKUP_KEY is empty." >&2
		echo "       Fetch it from Secrets Manager and export it, then run again." >&2
		exit 1
	fi
	export BACKUP_KEY
	command -v openssl >/dev/null 2>&1 || {
		echo "error: openssl is not installed on this host" >&2
		exit 1
	}
	;;
esac

# Same cipher and KDF parameters backup.sh writes with. Keep the two in step.
decrypt_to_stdout() {
	if [ "$ENCRYPTED" -eq 1 ]; then
		openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$TARBALL"
	else
		cat "$TARBALL"
	fi
}

echo "==> checking the archive opens before anything is deleted"
decrypt_to_stdout | tar -tzf - >/dev/null || {
	echo "error: could not decrypt and read $TARBALL - wrong BACKUP_KEY, or a truncated file" >&2
	exit 1
}

if [ "$CONFIRM" != "--yes" ]; then
	echo "This REPLACES everything in the dpsbuddy-data volume with $TARBALL."
	printf 'Type the word restore to continue: '
	read -r answer
	if [ "$answer" != "restore" ]; then
		echo "aborted"
		exit 1
	fi
fi

echo "==> stopping app and proxy"
dc stop proxy app

echo "==> emptying and unpacking /data"
# cap_drop: ALL in compose.yml takes CHOWN away even from root, and both tar -x and
# the chown below need it. Hand back exactly those three for this one-shot container.
decrypt_to_stdout | dc run --rm --no-deps -T --user root \n	--cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \n	--entrypoint sh app -c '
set -e
rm -rf /data/..?* /data/.[!.]* /data/* 2>/dev/null || true
tar -xzf - -C /data
if [ -f /data/.backup-staging/agentforge.sqlite ]; then
  rm -f /data/agentforge.sqlite-wal /data/agentforge.sqlite-shm
  mv -f /data/.backup-staging/agentforge.sqlite /data/agentforge.sqlite
  echo "promoted the consistent snapshot"
fi
rm -rf /data/.backup-staging
chown -R node:node /data
'

echo "==> starting"
dc up -d

echo "restored from $TARBALL - check the health with: sh webapp-deploy/scripts/logs.sh"
echo "record the drill in webapp-deploy/DEPLOY-LOG.md (placement doc section 5)."
