#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-telegram-inbox}"
APP_USER="${APP_USER:-inbox}"
NODE_MAJOR="${NODE_MAJOR:-24}"
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-}"
LE_EMAIL="${LE_EMAIL:-}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

ask() {
  local __var="$1" __label="$2" __default="${3:-}" __value
  if [[ -n "${!__var:-}" ]]; then return; fi
  read -rp "$__label${__default:+ [$__default]}: " __value
  printf -v "$__var" '%s' "${__value:-$__default}"
}

ask_secret() {
  local __var="$1" __label="$2" __value
  if [[ -n "${!__var:-}" ]]; then return; fi
  read -rsp "$__label: " __value
  echo
  printf -v "$__var" '%s' "$__value"
}

env_quote() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

[[ ${EUID} -eq 0 ]] || die "请使用 root 运行：sudo bash deploy/setup.sh"
[[ -f "$APP_DIR/server.js" ]] || die "未找到 $APP_DIR/server.js；请设置 APP_DIR 指向 telegram-inbox 目录"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT 必须是数字"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || die "NODE_MAJOR 必须是数字"
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  die "DOMAIN 只能包含字母、数字、点和横线"
fi

log "安装系统依赖"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg git nginx build-essential python3
  PM=apt
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl ca-certificates git nginx gcc-c++ make python3
  PM=dnf
else
  die "仅支持 apt 或 dnf 系统"
fi

CURRENT_NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
fi
if (( CURRENT_NODE_MAJOR < NODE_MAJOR )); then
  log "安装 Node.js ${NODE_MAJOR}"
  if [[ "$PM" == "apt" ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  fi
fi
command -v node >/dev/null 2>&1 || die "Node.js 安装失败"
log "Node $(node -v)，npm $(npm -v)"

log "配置环境变量"
if [[ -z "$DOMAIN" ]]; then
  ask DOMAIN "域名（没有就留空，直接用 IP 访问）" ""
fi
if [[ -n "$DOMAIN" && -z "$LE_EMAIL" ]]; then
  ask LE_EMAIL "Let's Encrypt 邮箱（可留空，留空则暂不申请 HTTPS）" ""
fi
ask ADMIN_USERNAME "管理员账号" "admin"
ask ADMIN_DISPLAY_NAME "管理员显示名" "管理员"
ask_secret ADMIN_PASSWORD "管理员密码（留空则自动生成，启动日志中查看）"
ask TELEGRAM_BOT_TOKEN "Telegram Bot Token（可留空，之后在网页「渠道」配置）" ""
ask ENABLE_WHATSAPP "启用 WhatsApp 个人号扫码？(Y/n)" "Y"
ask TELEGRAM_USER_API_ID "Telegram 个人号 api_id（没有就留空）" ""
ask_secret TELEGRAM_USER_API_HASH "Telegram 个人号 api_hash（没有就留空）"

WHATSAPP_WEB_ENABLED=false
case "${ENABLE_WHATSAPP,,}" in
  y|yes|true|1) WHATSAPP_WEB_ENABLED=true ;;
esac

TELEGRAM_USER_ENABLED=false
if [[ -n "$TELEGRAM_USER_API_ID" || -n "$TELEGRAM_USER_API_HASH" ]]; then
  if [[ "$TELEGRAM_USER_API_ID" =~ ^[0-9]+$ && -n "$TELEGRAM_USER_API_HASH" ]]; then
    TELEGRAM_USER_ENABLED=true
  else
    warn "Telegram 个人号 api_id/api_hash 不完整，已先关闭；之后可编辑 .env 再重启"
  fi
fi

PUBLIC_ORIGIN_VALUE=""
if [[ -n "$DOMAIN" ]]; then
  PUBLIC_ORIGIN_VALUE="https://${DOMAIN}"
fi

ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  log "检测到已有 .env，保留现有配置"
else
  log "写入 $ENV_FILE"
  (umask 077; cat > "$ENV_FILE" <<EOF
PORT=${PORT}
HOST=0.0.0.0
DATA_DIR="$(env_quote "$APP_DIR/data")"
NODE_ENV=production

ADMIN_USERNAME="$(env_quote "$ADMIN_USERNAME")"
ADMIN_PASSWORD="$(env_quote "$ADMIN_PASSWORD")"
ADMIN_DISPLAY_NAME="$(env_quote "$ADMIN_DISPLAY_NAME")"

TRUST_PROXY=true
COOKIE_SECURE=auto
PUBLIC_ORIGIN="$(env_quote "$PUBLIC_ORIGIN_VALUE")"

TELEGRAM_BOT_TOKEN="$(env_quote "$TELEGRAM_BOT_TOKEN")"

WHATSAPP_WEB_ENABLED=${WHATSAPP_WEB_ENABLED}
WHATSAPP_WEB_SESSION_PATH="$(env_quote "$APP_DIR/data/whatsapp-web")"

PERSONAL_ACCOUNTS_ENABLED=true
ACCOUNTS_DIR="$(env_quote "$APP_DIR/data/accounts")"

TELEGRAM_USER_ENABLED=${TELEGRAM_USER_ENABLED}
TELEGRAM_USER_API_ID="$(env_quote "$TELEGRAM_USER_API_ID")"
TELEGRAM_USER_API_HASH="$(env_quote "$TELEGRAM_USER_API_HASH")"
TELEGRAM_USER_SESSION_PATH="$(env_quote "$APP_DIR/data/telegram-user")"
EOF
  )
  chmod 600 "$ENV_FILE"
fi

log "创建运行用户和数据目录"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /bin/false "$APP_USER"
fi
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

log "安装 Node 依赖"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
chmod -R a+rX node_modules

NODE_BIN="$(command -v node)"
log "写入 systemd 服务：$SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Telegram Support Inbox
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=HOME=${APP_DIR}
ExecStart=${NODE_BIN} server.js
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${APP_DIR}/data
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

log "配置 Nginx"
if [[ -d /etc/nginx/sites-available ]]; then
  NGINX_CONF="/etc/nginx/sites-available/${SERVICE_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
else
  NGINX_CONF="/etc/nginx/conf.d/${SERVICE_NAME}.conf"
fi

cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};
    client_max_body_size 30m;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               application/xml application/rss+xml image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
EOF

nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  log "放行本机 ufw 端口"
  ufw allow 22/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

if [[ -n "$DOMAIN" && -n "$LE_EMAIL" ]]; then
  log "申请 HTTPS 证书"
  if [[ "$PM" == "apt" ]]; then
    apt-get install -y certbot python3-certbot-nginx
  else
    dnf install -y certbot python3-certbot-nginx || true
  fi
  if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect; then
    warn "HTTPS 申请失败；请确认域名已解析到本机公网 IP，再手动运行 certbot"
  fi
fi

log "等待服务启动"
HEALTHY=false
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" == "true" ]]; then
  log "部署完成"
else
  warn "服务未通过健康检查，最近日志："
  journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
fi

echo
echo "访问地址："
if [[ -n "$DOMAIN" ]]; then
  echo "  http://${DOMAIN}"
  echo "  https://${DOMAIN}（证书申请成功后）"
else
  echo "  http://<服务器公网IP>"
fi
echo
echo "请在阿里云控制台的「防火墙/安全组」中放行 22、80、443 端口。"
echo "查看日志：journalctl -u ${SERVICE_NAME} -f"
echo "重启服务：systemctl restart ${SERVICE_NAME}"
echo "更新代码：git pull && npm ci --omit=dev && systemctl restart ${SERVICE_NAME}"
echo
