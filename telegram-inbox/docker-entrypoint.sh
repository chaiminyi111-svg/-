#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true
find "$DATA_DIR" -maxdepth 1 -type f -name '*.db*' -exec chmod 600 {} \; 2>/dev/null || true

exec su-exec node "$@"
