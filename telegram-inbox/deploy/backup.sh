#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/telegram-inbox}"
KEEP_DAYS="${KEEP_DAYS:-14}"

[[ -d "$APP_DIR/data" ]] || { echo "数据目录不存在：$APP_DIR/data" >&2; exit 1; }
[[ -f "$APP_DIR/.env" ]] || { echo "配置文件不存在：$APP_DIR/.env" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/telegram-inbox-$STAMP.tar.gz"
TMP="$TARGET.tmp"

tar -czf "$TMP" -C "$APP_DIR" data .env
mv "$TMP" "$TARGET"
chmod 600 "$TARGET"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'telegram-inbox-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "已备份：$TARGET"
