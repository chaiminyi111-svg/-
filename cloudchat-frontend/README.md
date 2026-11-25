# CloudChat 云聊 · 前端静态资源

本目录保存「云聊 CloudChat」线上站点使用的前端文件，对应 Cloudflare Workers Assets 的 `public/` 目录副本，用于版本管理与回滚。

- 主地址：https://chat.biegege.cc.cd
- 备用地址：https://cloudchat.flat-water-8982.workers.dev
- Worker 名称：`cloudchat`
- 接入层：`cloudchat-edge`（见仓库根目录 `cloudchat-edge/`），负责自定义域名转发
- 说明：浏览器端静态文件在本目录；后端 Worker 部署产物见仓库根目录 `cloudchat-worker/`。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `public/index.html` | 页面结构、标题、meta、图标与 manifest 引用 |
| `public/style.css` | 样式（含品牌区与可访问性补充） |
| `public/app.js` | 前端逻辑（含发送后本地乐观渲染） |
| `public/favicon.svg` | 站点图标 |
| `public/icon-192.png` / `public/icon-512.png` | PWA 图标 |
| `public/apple-touch-icon.png` | iOS 主屏图标 |
| `public/manifest.webmanifest` | PWA 配置，可添加到主屏幕 |

## 2026-11-25 更新

- 页面标题改为「云聊 CloudChat · 私人办公通讯」
- 新增 `description`、Open Graph、Twitter Card
- 新增 favicon、iOS 图标、PWA manifest
- 标签页显示未读数，例如 `(3) 云聊 CloudChat`
- 顶部品牌改为中文优先：云聊 + CloudChat 副标
- 增加 canonical 与绝对地址的 `og:url` / `og:image`，指向 `https://chat.biegege.cc.cd`
- `app.js`：发送消息后先本地渲染 pending 气泡，收到 WebSocket 回显后替换；20 秒未收到回显自动移除
- 后端同步减少消息链路上的 D1 查询，详见 `cloudchat-worker/README.md`

## 部署

需要 Cloudflare Workers 写权限（Workers Scripts:Edit、Workers Assets:Edit）。

1. 将 `public/` 下的全部文件作为 Assets 上传，脚本使用 `cloudchat-worker/index.js`。
2. 或者把 `public/` 同步回本地 wrangler 项目的 assets 目录后执行 `wrangler deploy`。

注意：如果本地项目里仍是旧版 `index.html` / `style.css`，直接 `wrangler deploy` 会覆盖线上这次的改动，部署前先同步本目录。

## 回滚

- Cloudflare 控制台 → Workers & Pages → `cloudchat` → 部署/版本 → 选择上一个版本回滚。
- 2026-11-25 品牌与域名改动前的版本 ID：`61374142-b523-4dbc-9c02-4f23f3e72d1a`
- 2026-11-25 延迟优化前的版本 ID：`c2799ab0-3d8a-4a8c-ae55-b00e47ac1680`
- 延迟优化后的版本 ID：`d7d076bcb1614c3f8049d1b214d6f567`
