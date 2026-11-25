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
| `public/app.js` | 前端逻辑（含本地乐观渲染、拍照与图片上传） |
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
- 取消语音/视频通话入口，移除前端 WebRTC 信令与通话浮层；后端 `/ws/calls` 信令保留但不再使用
- 新增「拍照」：摄像头预览、前后摄像头切换、拍照预览、重拍，确认后上传
- 图片上传逻辑抽取为 `uploadImageBlob()`，图片选择与拍照共用
- 新增引用回复：消息下方「回复」按钮、输入框上方回复栏、气泡内引用块，点击引用可定位原消息
- 新增图片粘贴与拖拽上传：在聊天区域粘贴或拖入图片即可发送，单次最多 4 张
- 后端 `messages` 表新增 `reply_to` 字段，WebSocket 广播与历史消息接口同步返回
- 新增聊天记录搜索：会话内按关键词搜索，支持文本和附件文件名；点击结果定位，不在当前窗口的消息会加载上下文
- 新增长会话按需加载：顶部「加载更早消息」、滚动到顶自动加载、保持滚动位置，并提供「回到最新」
- 新增图片预览增强：按钮/滚轮/双击缩放、拖动查看、左右切换、键盘方向键和触摸滑动
- 新增群公告横幅；群成员管理弹窗内增加只读群公告，管理员仍可编辑
- 新增群文件面板：全部 / 图片 / 文件 / 语音分类，支持查看和下载
- 新增 @提醒增强：@ 成员选择已有，新增 @ 文本高亮、被 @ 消息标记、页面提示和桌面通知优先提醒
- 新增通知设置：桌面通知、提示音、免打扰三个开关，保存在浏览器本地
- 长会话图片使用懒加载，配合分页减少一次性渲染压力

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
- 取消通话并新增拍照后的版本 ID：`7a6982f039e344529bd1d4916843a3bc`
- 新增引用回复/图片粘贴拖拽后的版本 ID：`940e1d41aa434a4b87864f04ec46edc9`
- 回复按钮布局优化后的版本 ID：`f53d2c4eaaf44f9b99071d1a83bca7f2`
- 新增消息搜索/分页/群公告/群文件/@提醒/通知设置后的版本 ID：`5d304457c00f43f585358a17e1d5fc20`
- 群公告刷新与 @ 高亮优化后的版本 ID：`bb7d082ffa844a10bfe3b68a452894ba`
- 完整 @ 名称高亮后的版本 ID：`580262ffd2104f119426c5e1227327a4`
