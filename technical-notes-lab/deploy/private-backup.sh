#!/bin/sh
set -eu
umask 077

base="$HOME/technical-notes"
cd "$base/releases/b8"
env DATA_DIR="$base/runtime" \
  HTML_DB_PATH="$base/content/notes.sqlite" \
  HTML_ARCHIVE_DIR="$base/content/source-archives" \
  HTML_MEDIA_DIR="$base/content/media" \
  BACKUP_DIR="$base/backups" \
  "$base/node-runtime/node_modules/node/bin/node" scripts/html-scheduled-backup.mjs
