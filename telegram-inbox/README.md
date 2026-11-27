# 聚合客服台（Telegram + WhatsApp）

一个可私有化部署的多渠道客服工作台，适合小团队集中接收 Telegram / WhatsApp 消息、分配客服、跟进客户并统一回复。

这是「海外聚合客服」方向的 MVP：当前支持 Telegram、WhatsApp Cloud API 和 WhatsApp 个人号（Web 扫码）三个渠道，后续可以按同样的渠道适配器模式扩展 Instagram、Line 等平台。

## 已实现功能

- Telegram Bot 长轮询收消息，无需公网 webhook
- WhatsApp Cloud API webhook 收消息，支持文本回复；出站消息展示已发送/已送达/已读回执
- WhatsApp 个人号（WhatsApp Web / Baileys，实验渠道）：管理员扫码登录，收私聊文本并回复，session 保存在本地
- 双模式收件箱：**共用收件箱（B 模式）**保留原来的多渠道共享；**个人号模式（A 模式）**让每个员工绑定自己的 WhatsApp / Telegram 个人号，一人一个账号，消息只进入本人收件箱，顶栏可随时切换两种模式
- 消息回执：出站消息下方显示单勾（已发送）和双勾（已送达/对方已读）；Telegram Bot API 不提供已读回执，WhatsApp 支持
- 界面风格：顶栏「外观」提供 6 套主题（夕阳橙默认、熔岩红、森林绿、夜樱粉、深海蓝、暖纸白），保存在当前浏览器
- 统一收件箱：私聊、群聊、未读计数、已读/未读状态、手动标记未读、消息预览、渠道标识
- 翻译服务：自动识别客户语言，外文消息自动翻译为中文；回复时可选择「跟随客户语言」或指定其他语言。支持官方 Cloud Translation API，以及 4 个无需 Key 的备用通道：Google 网页翻译（`translate.googleapis.com` / `translate.google.com`）、Google Chrome 翻译接口、MyMemory，可在「渠道」中随时切换
- AI 自动回复：管理员在「渠道」接入任意 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、智谱等），也可选择 Pollinations 免费接口或本地 Ollama，这两种方式无需 API Key；可设置模型、系统提示词、工作时间和默认模式；支持「只生成建议 / 自动回复 / 仅首次接待 / 非工作时间」四种模式。管理员在「团队」中按员工授权，员工可在「AI 助手」中单独开关并选择模式
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
- 渠道设置：管理员可在网页顶栏「渠道」中配置 Telegram、WhatsApp、Google 翻译和 AI 服务，保存后立即生效，无需改 `.env` 或重启
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
│   ├── whatsapp-web.js    # WhatsApp 个人号（Baileys）扫码、私聊收发
│   ├── telegram-user.js   # Telegram 个人号（MTProto）扫码、私聊收发
│   ├── accounts.js        # 多员工个人号账号绑定、登录与消息路由
│   ├── translate.js       # Google Cloud Translation 识别与翻译
│   ├── ai.js              # OpenAI 兼容 AI 自动回复、建议与模式
│   ├── assignment.js      # 新会话自动分配
│   └── util.js
├── scripts/
│   ├── backup.js          # SQLite 一致性备份
│   └── check-telegram.js  # 校验真实 Bot Token
├── public/                # 中文工作台前端
├── deploy/                # 阿里云/Ubuntu 一键部署、Nginx、systemd、备份
├── test/app.test.js       # 使用 mock Telegram / WhatsApp 的端到端 API 测试
├── test/accounts.test.js  # 个人号账号、模式过滤与发送路由测试
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

## 配置 WhatsApp 个人号（实验）

WhatsApp 个人号通过 Baileys 连接 WhatsApp Web，不需要 Meta 应用和公网 webhook，适合先用测试号验证流程。

> 这是非官方接入方式，存在账号被限制或封禁的风险；生产环境请优先使用上面的 WhatsApp Cloud API。建议只使用测试号，不要让重要业务号码登录。

1. 在 `.env` 中启用并重启服务：

   ```dotenv
   WHATSAPP_WEB_ENABLED=true
   # 可选，默认 $DATA_DIR/whatsapp-web
   WHATSAPP_WEB_SESSION_PATH=
   ```

2. 用管理员账号登录，打开顶栏「渠道」，在「WhatsApp 个人号（Web 扫码）」区域点击「生成登录二维码」。
3. 手机 WhatsApp → 设置 → 已关联的设备 → 关联设备，扫描页面上的二维码。
4. 连接成功后，客户发来的私聊文本会进入统一收件箱；在会话里回复即可通过个人号发出。
5. 需要更换账号时点击「退出登录」，会清除本地 session 并要求重新扫码。

注意：

- 只处理**私聊文本**；群聊、状态广播、自己发出的消息会被忽略。入站图片/文件显示占位文本，出站附件暂未开放。
- 登录 session 保存在 `WHATSAPP_WEB_SESSION_PATH`，等同于该账号的登录凭证。目录权限会设置为 `700`、文件为 `600`；不要提交到 Git、不要打包分享，备份时按密钥处理。
- 二维码只通过管理员接口返回给当前页面，不写入日志；仍请避免在公开场合投屏或截图。
- 连接断开后会自动重连；登录失效（被手机端退出）需要重新扫码。
- 当前未实现消息历史同步，只接收服务在线期间的新消息。

## 双模式：共用收件箱（B 模式）与个人号模式（A 模式）

两种模式并存，顶栏的「共用收件箱 / 个人号模式」开关可以随时切换，原有功能不受影响。

- **共用收件箱（B 模式）**：Telegram Bot、WhatsApp Cloud API 和旧的 WhatsApp 个人号仍然进入同一个共享收件箱，由管理员分配给客服。
- **个人号模式（A 模式）**：每个员工在「我的个人号」中绑定自己的 WhatsApp / Telegram 个人号。一个员工在每个渠道只能绑定一个账号；客户消息只进入该员工自己的收件箱，管理员可以在个人号模式中查看全部员工的个人号会话。

启用方式：

```dotenv
PERSONAL_ACCOUNTS_ENABLED=true
# 可选，默认 $DATA_DIR/accounts；每个账号使用独立子目录
ACCOUNTS_DIR=

# WhatsApp 个人号（复用 WHATSAPP_WEB_ENABLED）
WHATSAPP_WEB_ENABLED=true

# Telegram 个人号（MTProto）
TELEGRAM_USER_ENABLED=true
TELEGRAM_USER_API_ID=123456
TELEGRAM_USER_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

使用步骤：

1. 员工登录后切换到「个人号模式」，点击「我的个人号」。
2. WhatsApp：点击「绑定并扫码」，用手机 WhatsApp 扫描二维码。
3. Telegram：先到 https://my.telegram.org 创建应用并配置 `TELEGRAM_USER_API_ID` / `TELEGRAM_USER_API_HASH`，然后在页面点击「绑定并扫码」；如果账号开启了两步验证，页面会要求输入密码。
4. 绑定成功后客户消息会出现在「个人号模式」；在会话里回复即可通过该员工的个人号发出。

注意：

- 个人号 session 保存在 `ACCOUNTS_DIR/<渠道>/<员工>-<随机ID>`，等同于登录凭证；目录权限为 `700`、文件为 `600`，不要提交到 Git 或打包分享。
- 个人号会话不能直接删除；需要先退出登录。删除账号前必须先处理已有会话，避免客户消息混入共用收件箱。
- Telegram 个人号使用 MTProto，首次登录需要在服务器上能访问 Telegram；二维码和两步验证密码只通过当前登录会话返回。

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

## 配置 AI 自动回复

1. 管理员打开顶栏「渠道」，滚动到「AI 自动回复」，选择服务商预设或填写任意 OpenAI 兼容接口地址、API Key 和模型，保存后点「测试连接」。没有 API Key 时可选「Pollinations 免费接口（无需 Key）」或「本地 Ollama（无需 Key）」。
2. 打开「团队」，在员工行勾选「允许 AI」，给需要使用的客服授权。
3. 员工登录后点顶栏「AI 助手」，打开自己的 AI 开关并选择回复模式。

模式说明：

- **只生成建议**：AI 生成草稿，显示在聊天窗口下方，客服点「填入输入框」后自行发送。
- **自动回复**：每条新客户消息自动回复。
- **仅首次接待**：只在会话还没有任何出站回复时自动回复一次。
- **非工作时间**：只在设置的工作时间之外自动回复，时区默认 `Asia/Shanghai`。
- **关闭**：不生成建议，也不自动回复。

AI 只处理已分配给客服的私聊会话；群聊需要在「渠道」中单独勾选。API Key 只保存在服务器 SQLite 数据库，页面不会回显；AI 回复会以负责客服的身份发送，并在消息元数据中标记 `via: ai`。

Pollinations 是免费公共接口，消息会发送到第三方服务，可能被记录或用于模型改进，只建议测试使用，不要发送敏感客户信息。需要隐私时请改用本地 Ollama，或在服务器上部署自己的 OpenAI 兼容模型。

Pollinations 免费额度约每 45 秒 1 次请求，消息多时会出现 `HTTP 402`。程序会自动排队并重试，但回复会变慢。需要稳定、并发更高的自动回复，推荐本地 Ollama：

```bash
# 安装 Ollama（Linux）
curl -fsSL https://ollama.com/install.sh | sh
# 下载小模型（约 2GB，4 核 CPU 通常 3-6 秒生成一条）
ollama pull qwen2.5:3b
# 启动服务，监听 127.0.0.1:11434
ollama serve
```

然后在「渠道 → AI 自动回复」选择「本地 Ollama（无需 Key）」，模型填 `qwen2.5:3b`，保存并测试连接。Docker 部署时，把地址改成 `http://host.docker.internal:11434/v1`，并让 Ollama 监听 `0.0.0.0`。

## 阿里云一键部署

如果使用阿里云轻量应用服务器或 ECS，推荐选择 **中国香港 / 新加坡 / 日本** 地域和 Ubuntu 24.04，然后：

```bash
cd /opt/telegram-inbox
sudo bash deploy/setup.sh
```

脚本会自动安装 Node.js、Nginx，创建 `.env`、systemd 服务和反向代理，可选申请 HTTPS 证书。详细步骤见 [deploy/README.md](deploy/README.md)。

> 中国大陆地域通常无法稳定访问 Telegram / WhatsApp，不建议用于本项目的正式部署。

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
| `WHATSAPP_WEB_ENABLED` | `false` | 是否启用 WhatsApp 个人号（实验渠道） |
| `WHATSAPP_WEB_SESSION_PATH` | `$DATA_DIR/whatsapp-web` | WhatsApp 个人号 session 目录，等同于登录凭证 |
| `PERSONAL_ACCOUNTS_ENABLED` | `true` | 是否启用个人号模式（A 模式） |
| `ACCOUNTS_DIR` | `$DATA_DIR/accounts` | 多员工个人号 session 根目录，每个账号使用独立子目录 |
| `TELEGRAM_USER_ENABLED` | `false` | 是否启用 Telegram 个人号（MTProto 扫码） |
| `TELEGRAM_USER_API_ID` | 空 | 在 my.telegram.org 创建应用后获得的 api_id |
| `TELEGRAM_USER_API_HASH` | 空 | 对应的 api_hash |
| `TELEGRAM_USER_SESSION_PATH` | `$DATA_DIR/telegram-user` | 旧版单账号 CLI 登录 session 路径 |
| `GOOGLE_TRANSLATE_API_KEY` | 空 | Google Cloud Translation API Key；也可在「渠道」页面保存 |
| `GOOGLE_TRANSLATE_API_BASE` | `https://translation.googleapis.com` | Google 翻译 API 地址 |
| `TRANSLATE_PROVIDER` | `google` | `google`（官方 API，需要 Key）/ `google-web` / `google-web-main` / `google-chrome` / `mymemory`（无需 Key） |
| `GOOGLE_TRANSLATE_WEB_API_BASE` | `https://translate.googleapis.com` | Google 网页翻译接口地址 |
| `GOOGLE_TRANSLATE_WEB_MAIN_API_BASE` | `https://translate.google.com` | Google 网页翻译备用域名 |
| `GOOGLE_TRANSLATE_CHROME_API_BASE` | `https://clients5.google.com` | Google Chrome 翻译接口地址 |
| `MYMEMORY_API_BASE` | `https://api.mymemory.translated.net` | MyMemory 免费翻译接口地址 |
| `TRANSLATE_TARGET` | `zh-CN` | 入站外文消息默认翻译目标语言 |
| `TRANSLATE_TIMEOUT_MS` | `10000` | 翻译请求超时毫秒数 |
| `AI_ENABLED` | `false` | 是否启用 AI 自动回复总开关；也可在「渠道」页面设置 |
| `AI_API_KEY` / `OPENAI_API_KEY` | 空 | OpenAI 兼容接口 Key；也可在「渠道」页面保存 |
| `AI_BASE_URL` / `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `AI_MODEL` / `OPENAI_MODEL` | `gpt-4o-mini` | 模型名称 |
| `AI_DEFAULT_MODE` | `auto` | `suggest` / `auto` / `first` / `after_hours` / `off` |
| `AI_WORK_START` | `09:00` | 非工作时间模式的上班时间 |
| `AI_WORK_END` | `18:00` | 非工作时间模式的下班时间 |
| `AI_WORK_TIMEZONE` | `Asia/Shanghai` | 工作时间使用的时区 |
| `AI_INCLUDE_GROUPS` | `false` | 群聊是否也自动回复 |
| `AI_DELAY_MS` | `1500` | 收到消息后等待多久再生成回复，用于合并连续消息 |
| `AI_TIMEOUT_MS` | `30000` | AI 接口请求超时毫秒数 |
| `AI_PUBLIC_MIN_INTERVAL_MS` | `45000` | Pollinations 免费接口的最小请求间隔；本地 Ollama 不需要 |
| `AI_MAX_CONTEXT` | `12` | 发送给 AI 的最近消息条数 |
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
- WhatsApp Cloud API 目前只支持文本收发；不支持出站附件，且受 24 小时客服窗口限制。
- WhatsApp 个人号（实验）只处理私聊文本；群聊/状态广播会被忽略，非官方接入有封号风险，且不保证长期可用。
- 出站附件上限 20MB；Telegram Bot API 下载文件通常也限制在 20MB 内。
- 统计看板是基础版，暂未计算平均首响、满意度等指标。
- Snapchat 没有公开的双向客服消息 API（Marketing API 主要面向广告，Snap Kit 面向登录/分享），因此暂不能像 Telegram/WhatsApp 一样直接接入；如果你指的是其他平台，请确认名称。
- SQLite 适合单实例小团队；多实例部署需要换 PostgreSQL 并处理 SSE 广播。
- 没有多租户计费；当前是单团队工作台。

## 测试

```bash
npm test
```

测试会启动 mock Telegram API、mock WhatsApp API、mock Google 翻译 API 和 mock OpenAI 兼容接口，覆盖登录、收消息、分配权限、客服会话可见范围、SSE 推送过滤、文本回复、出站图片/文件、媒体代理、WhatsApp webhook 验签与回复、WhatsApp 个人号扫码/私聊收发/退出（使用假 socket）、管理员渠道凭据保存/清除、Google 翻译识别与出站翻译、多免费翻译通道切换、AI 权限与自动回复/建议/仅首次模式、已读/未读与 WhatsApp 回执、自动分配与接待上限、SLA 统计、CSV 导出、快捷回复、客户标签/备注、搜索、CSRF、角色校验和最后管理员保护，不需要真实平台凭据。

## 后续路线

1. 客户满意度、在线时长、客服排行榜等更细的统计指标
2. 出站语音、视频、贴纸
3. 多渠道适配器：Instagram、Line、邮件；WhatsApp 模板消息
4. PostgreSQL + Redis + 多实例
5. Webhook 接入、开放 API、Webhook 事件订阅
6. 更细的角色权限与审计查询界面
