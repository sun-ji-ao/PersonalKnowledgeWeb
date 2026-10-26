#!/bin/sh
set -eu
umask 077

base="$HOME/technical-notes"
release="$base/releases/b8"
runtime="$base/runtime"
pidfile="$runtime/private-preview.pid"
node="$base/node-runtime/node_modules/node/bin/node"

running() {
  [ -f "$pidfile" ] || return 1
  pid=$(cat "$pidfile")
  case "$pid" in *[!0-9]*|'') return 1 ;; esac
  [ -d "/proc/$pid" ] || return 1
  [ "$(readlink "/proc/$pid/cwd")" = "$release" ] || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q 'server.mjs'
}

case "${1:-}" in
  start)
    mkdir -p "$runtime"
    if running; then echo "already running: $(cat "$pidfile")"; exit 0; fi
    cd "$release"
    env HTML_EDITOR=1 DEPLOYMENT_MODE=preview PUBLIC_ORIGIN=http://127.0.0.1:4310 \
      SEED_DEMO=0 PORT=4310 DATA_DIR="$runtime" \
      HTML_DB_PATH="$base/content/notes.sqlite" \
      HTML_ARCHIVE_DIR="$base/content/source-archives" \
      HTML_MEDIA_DIR="$base/content/media" \
      nohup "$node" server.mjs > "$runtime/private-preview.log" 2>&1 < /dev/null &
    echo $! > "$pidfile"
    sleep 2
    if ! running || ! curl --fail --silent http://127.0.0.1:4310/_health; then
      cat "$runtime/private-preview.log"
      exit 1
    fi
    echo
    ;;
  status)
    if running; then
      echo "running: $(cat "$pidfile")"
      curl --fail --silent http://127.0.0.1:4310/_health
      echo
    else echo 'stopped'; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$pidfile")"; rm -f "$pidfile"; echo 'stopped';
    else echo 'not running'; exit 1; fi
    ;;
  *) echo 'Usage: private-preview.sh start|status|stop' >&2; exit 2 ;;
esac
