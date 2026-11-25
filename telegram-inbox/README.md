# Telegram 客服聚合收件箱

一个可私有化部署的 Telegram 客服工作台，适合小团队集中接收私聊/群聊消息、分配客服、跟进客户并统一回复。

这是「海外聚合客服」方向的第一个 MVP：先把 Telegram 单渠道跑通，后续可以按同样的渠道适配器模式扩展 WhatsApp、Instagram、Line 等平台。

## 已实现功能

- Telegram Bot 长轮询收消息，无需公网 webhook
- 统一收件箱：私聊、群聊、未读计数、消息预览
- 客服分配：管理员可分配给任意客服，普通客服可领取/取消分配
- 会话状态：待处理、跟进中、已关闭
- 文本回复：通过 Telegram Bot API 发送并落库
- 快捷回复：团队共享常用话术，一键插入输入框
- 客户资料：给会话打标签、记录内部备注，支持按标签/备注搜索
- 入站媒体：图片、文件、语音、音频、视频、贴纸展示与下载代理
- 团队管理：管理员创建客服、调整角色、停用/启用、重置密码
- 实时更新：SSE 推送新消息和会话变更，断线自动降级轮询
- 本地账号体系：scrypt 密码哈希、HttpOnly 会话 Cookie、登录限流
- 安全基线：CSRF 同源校验、CSP、参数化 SQL、审计日志
- SQLite 单文件存储，支持 Docker / 云服务器 / 内网私有化部署

## 技术栈

- Node.js 24（使用内置 `node:sqlite`，无原生数据库依赖）
- Express 4
- 原生 HTML / CSS / JavaScript，无前端框架、无 CDN
- SQLite（WAL 模式）
- SSE 实时推送
- Telegram Bot API 长轮询

## 目录结构

```text
telegram-inbox/
├── server.js              # 启动入口
├── src/
│   ├── app.js             # HTTP API、鉴权、静态资源、SSE
│   ├── auth.js            # 密码哈希、会话、权限
│   ├── config.js          # 环境变量
│   ├── db.js              # SQLite 表结构、初始化、审计
│   ├── realtime.js        # SSE 广播器
│   ├── store.js           # 会话/消息查询
│   ├── telegram.js        # Bot 长轮询、收发消息、媒体
│   └── util.js
├── public/                # 中文工作台前端
├── test/app.test.js       # 使用 mock Telegram 的端到端 API 测试
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 本地运行

要求：Node.js >= 24。

```bash
cd telegram-inbox
npm install
cp .env.example .env
```

编辑 `.env`，至少设置：

```dotenv
ADMIN_PASSWORD=换成你自己的强密码
TELEGRAM_BOT_TOKEN=从BotFather拿到的Token
```

启动：

```bash
npm start
```

打开 `http://localhost:3000`，用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。

如果首次启动没有设置 `ADMIN_PASSWORD`，服务会生成一个随机密码并打印在启动日志里。登录后请立即在「修改密码」里改掉。

忘记管理员密码时，可以在服务器上重置（会注销该用户所有登录）：

```bash
npm run reset-password -- admin '新的强密码'
# Docker:
docker compose exec telegram-inbox node scripts/reset-password.js admin '新的强密码'
```

## 配置 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`。
2. 发送 `/newbot`，按提示创建机器人。
3. 复制 BotFather 返回的 Token，填入 `.env` 的 `TELEGRAM_BOT_TOKEN`。
4. 重启服务。
5. 用客户账号给机器人发送 `/start`，然后发一条消息；工作台就会出现会话。

群聊场景：

- 把机器人拉进群。
- 默认隐私模式下，机器人只能收到 @机器人 的消息。需要接收全部群消息时，在 BotFather 里用 `/setprivacy` 关闭隐私模式，然后把机器人移出群再重新拉入。
- 群聊会话会显示群名称，回复会发送到群里。

如果这个机器人之前设置过 webhook，`getUpdates` 会返回 409。可以：

```dotenv
TELEGRAM_DELETE_WEBHOOK=true
```

让服务启动时自动删除 webhook，或者在 BotFather / Bot API 里手动删除。

> Telegram Bot API 的限制：机器人不能主动给从未和它对话过的用户发私信。客服只能在用户先发起会话后回复。这是平台规则，不建议用非官方手段绕过。

## Docker 部署

```bash
cp .env.example .env
# 编辑 .env：ADMIN_PASSWORD、TELEGRAM_BOT_TOKEN、PUBLIC_ORIGIN 等
docker compose up -d --build
docker compose logs -f
```

默认映射 `3000` 端口，数据保存在宿主机的 `./data` 目录。

升级：

```bash
git pull
docker compose up -d --build
```

## 云服务器 / 私有化 + HTTPS

推荐用 Caddy 或 Nginx 反向代理到 `127.0.0.1:3000`，并配置 HTTPS。Caddy 示例：

```caddyfile
support.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

对应 `.env`：

```dotenv
PUBLIC_ORIGIN=https://support.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
```

- 云部署：一台 1C1G 起步的 VPS 即可跑小团队；建议只开放 80/443，3000 不直接暴露公网。
- 私有化：把同一套 Docker Compose 放到内网服务器，按需开放给团队 VPN/内网。
- 如果不用反向代理、直接通过 HTTP 访问，`COOKIE_SECURE=false`，但生产环境不建议这样做。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录 |
| `DATABASE_PATH` | `$DATA_DIR/inbox.db` | SQLite 文件路径 |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的管理员用户名 |
| `ADMIN_PASSWORD` | 空 | 首次启动管理员密码；为空则随机生成并打印 |
| `ADMIN_DISPLAY_NAME` | `管理员` | 管理员显示名称 |
| `TELEGRAM_BOT_TOKEN` | 空 | BotFather 提供的 Token；为空时只能查看已有数据 |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Telegram API 地址，可指向自建 Bot API 或反向代理 |
| `TELEGRAM_POLL_TIMEOUT` | `25` | 长轮询等待秒数 |
| `TELEGRAM_DELETE_WEBHOOK` | `false` | 启动时是否删除已有 webhook |
| `SESSION_DAYS` | `7` | 登录会话有效天数 |
| `TRUST_PROXY` | `true` | 是否信任反向代理的 `X-Forwarded-*` |
| `COOKIE_SECURE` | `auto` | `auto` / `true` / `false` |
| `PUBLIC_ORIGIN` | 空 | 固定前端访问地址，用于 CSRF 同源校验 |
| `MAX_MESSAGE_LENGTH` | `4096` | 单条回复最大字符数 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## 数据与备份

所有业务数据在 `data/inbox.db`（WAL 模式会额外产生 `inbox.db-wal`、`inbox.db-shm`）。

推荐备份方式：

```bash
# 停服务后复制，最稳妥
docker compose stop
# 数据文件属于容器内 node 用户，权限不足时加 sudo
cp data/inbox.db "data/inbox-$(date +%F).db" 2>/dev/null || sudo cp data/inbox.db "data/inbox-$(date +%F).db"
docker compose start
```

或者在运行中做一致性备份：

```bash
sqlite3 data/inbox.db ".backup 'data/inbox-backup.db'"
```

## 安全建议

- 首次登录后立即修改管理员密码。
- 生产环境必须启用 HTTPS，并设置 `COOKIE_SECURE=true`。
- 不要把 `.env`、`data/` 提交到 Git；项目已用 `.gitignore` 排除。
- Bot Token 等同于机器人控制权，泄露后立即在 BotFather 里 `/revoke`。
- 只给团队成员开账号；离职成员及时停用。
- 定期备份 SQLite；数据量大或需要多实例时，再迁移 PostgreSQL/Redis。
- 本系统面向“用户主动咨询后的客服回复”。批量私信、爬群成员、绕过平台风控等行为有封号和合规风险，不建议使用。

## 已知限制

- 目前只接 Telegram，且只支持文本回复；入站图片/文件/语音/视频可查看。
- 没有出站附件、SLA、统计报表；这些是下一步。
- Telegram Bot API 下载文件通常限制在 20MB 内。
- SQLite 适合单实例小团队；多实例部署需要换 PostgreSQL 并处理 SSE 广播。
- 没有多租户计费；当前是单团队工作台。

## 测试

```bash
npm test
```

测试会启动一个 mock Telegram API，覆盖登录、收消息、分配权限、回复、媒体代理、快捷回复、客户标签/备注、搜索、CSRF、角色校验和最后管理员保护，不需要真实 Bot Token。

## 后续路线

1. 统计看板：消息量、响应时长、客服工作量
2. 出站附件、图片、语音
3. 多机器人 / 多渠道适配器：WhatsApp Business、Instagram、Line、邮件
4. PostgreSQL + Redis + 多实例
5. Webhook 接入、开放 API、Webhook 事件订阅
6. 更细的角色权限与审计查询界面
