# 聚合客服台（Telegram + WhatsApp）

一个可私有化部署的多渠道客服工作台，适合小团队集中接收 Telegram / WhatsApp 消息、分配客服、跟进客户并统一回复。

这是「海外聚合客服」方向的 MVP：当前支持 Telegram 和 WhatsApp Cloud API 两个渠道，后续可以按同样的渠道适配器模式扩展 Instagram、Line 等平台。

## 已实现功能

- Telegram Bot 长轮询收消息，无需公网 webhook
- WhatsApp Cloud API webhook 收消息，支持文本回复；出站消息展示已发送/已送达/已读回执
- 统一收件箱：私聊、群聊、未读计数、已读/未读状态、手动标记未读、消息预览、渠道标识
- 翻译服务：自动识别客户语言，外文消息自动翻译为中文；回复时可选择「跟随客户语言」或指定其他语言。支持官方 Cloud Translation API，以及 4 个无需 Key 的备用通道：Google 网页翻译（`translate.googleapis.com` / `translate.google.com`）、Google Chrome 翻译接口、MyMemory，可在「渠道」中随时切换
- 客服分配：管理员可分配给任意客服；支持自动分配（当前接待最少/轮询）和每人接待上限
- 会话可见范围：管理员可查看全部；普通客服只能查看自己名下和未分配的会话，不能查看其他客服的会话
- 会话状态：待处理、跟进中、已关闭
- 文本回复：通过 Telegram Bot API / WhatsApp Cloud API 发送并落库
- 出站附件：支持发送图片和文件（最大 20MB），附件说明作为 caption
- 快捷回复：团队共享常用话术，一键插入输入框
- 客户资料：给会话打标签、记录内部备注，支持按标签/备注搜索
- 入站媒体（Telegram）：图片、文件、语音、音频、视频、贴纸展示与下载代理
- 统计看板：最近 7/14/30 天会话、消息趋势、客服工作量、平均首响、平均解决时长、SLA 超时，支持导出 CSV
- 团队管理：管理员创建客服、调整角色、停用/启用、重置密码
- 渠道设置：管理员可在网页顶栏「渠道」中配置 Telegram、WhatsApp 和 Google 翻译凭据，保存前自动验证，立即生效，无需改 `.env` 或重启
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
- WhatsApp Cloud API（Meta Graph API）

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
│   ├── store.js           # 会话/消息查询、统计
│   ├── telegram.js        # Telegram Bot 长轮询、收发消息、媒体
│   ├── whatsapp.js        # WhatsApp Cloud API webhook、文本收发
│   ├── translate.js       # Google Cloud Translation 识别与翻译
│   ├── assignment.js      # 新会话自动分配
│   └── util.js
├── scripts/
│   ├── backup.js          # SQLite 一致性备份
│   └── check-telegram.js  # 校验真实 Bot Token
├── public/                # 中文工作台前端
├── test/app.test.js       # 使用 mock Telegram / WhatsApp 的端到端 API 测试
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

编辑 `.env`，至少设置管理员密码，并按需配置一个或两个渠道：

```dotenv
ADMIN_PASSWORD=换成你自己的强密码
# 渠道一：Telegram
TELEGRAM_BOT_TOKEN=从BotFather拿到的Token
# 渠道二：WhatsApp（可选）
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
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

## 配置 WhatsApp Cloud API

1. 在 Meta for Developers 创建 Business 应用，添加 WhatsApp 产品。
2. 在 WhatsApp → API Setup 里拿到 **Phone number ID** 和访问 Token。
3. 用管理员账号登录工作台，点击顶栏「渠道」，在 WhatsApp 区域填写访问 Token、Phone Number ID、Verify Token 和 App Secret。保存前会调用 Graph API 校验 Token 和 Phone Number ID，成功后立即生效，无需重启。
4. 把服务暴露到公网 HTTPS，然后在 Meta 后台配置 Webhook：
   - Callback URL：`https://你的域名/webhook/whatsapp`（页面里会显示完整地址）
   - Verify token：与页面里填写的 Verify Token 一致
   - 订阅字段：`messages`
5. 用测试号码给业务号码发一条 WhatsApp 文本，会话会出现在收件箱。

也可以继续在 `.env` 中配置：

```dotenv
WHATSAPP_TOKEN=你的访问Token
WHATSAPP_PHONE_NUMBER_ID=你的PhoneNumberID
WHATSAPP_VERIFY_TOKEN=自己生成的一段随机字符串
WHATSAPP_APP_SECRET=Meta应用密钥
```

网页中保存的凭据存在 SQLite 数据库里，并会覆盖环境变量；页面不会回显 Token、Verify Token 或 App Secret，数据库文件权限为 `600`。需要停用时点击「清除 WhatsApp 配置」。

注意：

- 当前 WhatsApp 只支持**文本**收发；入站图片/文件会显示占位文本，出站附件暂未开放。
- WhatsApp 的送达/已读状态来自 Meta webhook 的 `statuses` 事件；如果客户关闭已读回执，可能只显示已送达。Telegram Bot API 不提供客户已读回执，因此 Telegram 出站消息只显示发送时间。
- 免费翻译通道都不是官方 API，可能限流、失效或翻译质量波动；生产环境建议优先使用官方 Cloud Translation API。MyMemory 单次最多约 500 字符，服务端会自动分段。
- WhatsApp 有 24 小时客服窗口；超过窗口需要用模板消息，本 MVP 暂未实现模板。
- Webhook 必须可被 Meta 访问，通常需要公网 HTTPS；内网部署需要反向代理或内网穿透。
- `WHATSAPP_APP_SECRET` 用于校验 `X-Hub-Signature-256`；生产环境必须配置，否则 Webhook 会拒绝请求。
- WhatsApp 的 Token 和 App Secret 同样不要发到聊天或提交到 Git。

## 配置 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`。
2. 发送 `/newbot`，按提示创建机器人。
3. 复制 BotFather 返回的 Token。不要把 Token 发到聊天、Issue 或提交到 Git。
4. 用管理员账号登录工作台，点击顶栏「渠道」，粘贴 Token 后点击「保存并连接」。服务会先调用 Telegram `getMe` 验证，成功后立即开始接收消息，无需重启。
5. 用客户账号给机器人发送 `/start`，然后发一条消息；工作台就会出现会话。

也可以继续用 `.env` 的 `TELEGRAM_BOT_TOKEN` 配置。网页中保存的 Token 存在 SQLite 数据库里，并会覆盖环境变量；页面不会回显 Token，数据库文件权限为 `600`。需要停用时点击「清除 Token」。

命令行验证（可选）：

```bash
npm run check:telegram
```

生产环境建议把 Token 放在服务器环境变量或密钥管理服务里，而不是写进代码；`.env` 仅用于本机/单机部署。

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
| `TELEGRAM_BOT_TOKEN` | 空 | BotFather 提供的 Token；也可登录后在「渠道」页面保存，页面配置优先 |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Telegram API 地址，可指向自建 Bot API 或反向代理 |
| `TELEGRAM_POLL_TIMEOUT` | `25` | 长轮询等待秒数 |
| `TELEGRAM_DELETE_WEBHOOK` | `false` | 启动时是否删除已有 webhook |
| `WHATSAPP_TOKEN` | 空 | WhatsApp Cloud API 访问 Token；也可在「渠道」页面保存 |
| `WHATSAPP_PHONE_NUMBER_ID` | 空 | WhatsApp 业务号码 ID；也可在「渠道」页面保存 |
| `WHATSAPP_VERIFY_TOKEN` | 空 | Meta Webhook 校验串；也可在「渠道」页面保存 |
| `WHATSAPP_APP_SECRET` | 空 | Meta 应用密钥，用于 Webhook 验签；也可在「渠道」页面保存 |
| `WHATSAPP_API_BASE` | `https://graph.facebook.com/v20.0` | Meta Graph API 地址 |
| `GOOGLE_TRANSLATE_API_KEY` | 空 | Google Cloud Translation API Key；也可在「渠道」页面保存 |
| `GOOGLE_TRANSLATE_API_BASE` | `https://translation.googleapis.com` | Google 翻译 API 地址 |
| `TRANSLATE_PROVIDER` | `google` | `google`（官方 API，需要 Key）/ `google-web` / `google-web-main` / `google-chrome` / `mymemory`（无需 Key） |
| `GOOGLE_TRANSLATE_WEB_API_BASE` | `https://translate.googleapis.com` | Google 网页翻译接口地址 |
| `GOOGLE_TRANSLATE_WEB_MAIN_API_BASE` | `https://translate.google.com` | Google 网页翻译备用域名 |
| `GOOGLE_TRANSLATE_CHROME_API_BASE` | `https://clients5.google.com` | Google Chrome 翻译接口地址 |
| `MYMEMORY_API_BASE` | `https://api.mymemory.translated.net` | MyMemory 免费翻译接口地址 |
| `TRANSLATE_TARGET` | `zh-CN` | 入站外文消息默认翻译目标语言 |
| `TRANSLATE_TIMEOUT_MS` | `10000` | 翻译请求超时毫秒数 |
| `AUTO_ASSIGN` | `false` | 是否自动分配新会话；也可在「团队」页面开启 |
| `AUTO_ASSIGN_STRATEGY` | `least_active` | `least_active`（当前接待最少）/ `round_robin`（轮询） |
| `AGENT_MAX_ACTIVE` | `0` | 每位客服同时接待上限，0 表示不限制 |
| `SLA_FIRST_RESPONSE_MINUTES` | `15` | 首次响应 SLA 分钟数，用于统计超时 |
| `BACKUP_DIR` | `$DATA_DIR/backups` | 备份目录 |
| `BACKUP_KEEP_DAYS` | `14` | 备份保留天数 |
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
npm run backup
```

脚本会执行 WAL checkpoint 后复制数据库到 `data/backups/`，并按 `BACKUP_KEEP_DAYS` 清理旧备份。

手动备份示例：

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

- Telegram 支持文本、图片、文件发送；入站语音/视频可查看，出站语音/视频暂未开放。
- WhatsApp 目前只支持文本收发；不支持出站附件，且受 24 小时客服窗口限制。
- 出站附件上限 20MB；Telegram Bot API 下载文件通常也限制在 20MB 内。
- 统计看板是基础版，暂未计算平均首响、满意度等指标。
- Snapchat 没有公开的双向客服消息 API（Marketing API 主要面向广告，Snap Kit 面向登录/分享），因此暂不能像 Telegram/WhatsApp 一样直接接入；如果你指的是其他平台，请确认名称。
- SQLite 适合单实例小团队；多实例部署需要换 PostgreSQL 并处理 SSE 广播。
- 没有多租户计费；当前是单团队工作台。

## 测试

```bash
npm test
```

测试会启动 mock Telegram API、mock WhatsApp API 和 mock Google 翻译 API，覆盖登录、收消息、分配权限、客服会话可见范围、SSE 推送过滤、文本回复、出站图片/文件、媒体代理、WhatsApp webhook 验签与回复、管理员渠道凭据保存/清除、Google 翻译识别与出站翻译、多免费翻译通道切换、已读/未读与 WhatsApp 回执、自动分配与接待上限、SLA 统计、CSV 导出、快捷回复、客户标签/备注、搜索、CSRF、角色校验和最后管理员保护，不需要真实平台凭据。

## 后续路线

1. 客户满意度、在线时长、客服排行榜等更细的统计指标
2. 出站语音、视频、贴纸
3. 多渠道适配器：Instagram、Line、邮件；WhatsApp 模板消息
4. PostgreSQL + Redis + 多实例
5. Webhook 接入、开放 API、Webhook 事件订阅
6. 更细的角色权限与审计查询界面
