#!/bin/sh
# Resolve the active application from systemd; data remains outside releases.
set -eu
umask 077
base="$HOME/technical-notes"
mkdir -p "$base/runtime"
exec 9>"$base/runtime/production-backup.lock"
flock -n 9 || exit 0
release=$(systemctl show technical-notes.service --property=WorkingDirectory --value)
case "$release" in
  "$base"/releases/*) ;;
  *) echo 'Invalid website WorkingDirectory' >&2; exit 1 ;;
esac
test -f "$release/scripts/html-scheduled-backup.mjs"
cd "$release"
env DATA_DIR="$base/runtime" \
  HTML_DB_PATH="$base/content/notes.sqlite" \
  HTML_ARCHIVE_DIR="$base/content/source-archives" \
  HTML_MEDIA_DIR="$base/content/media" \
  BACKUP_DIR="$base/backups" \
  "$base/node-runtime/node_modules/node/bin/node" scripts/html-scheduled-backup.mjs
# Updated only after a successful joint backup; monitor its age externally.
date -u +%FT%TZ > "$base/runtime/backup-last-success.txt"
