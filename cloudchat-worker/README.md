# CloudChat 后端 Worker（部署产物）

本目录保存线上 `cloudchat` Worker 的部署文件 `index.js`，用于版本管理与回滚。

- 线上地址：https://chat.biegege.cc.cd（由 `cloudchat-edge` 转发）
- 上游地址：https://cloudchat.flat-water-8982.workers.dev
- 部署账号：`办公工具`（`49650577f4aafa8e1b1189f67a23bc78`）
- Worker 名称：`cloudchat`

> `index.js` 是 2026-11-25 延迟优化后的部署产物；原始 TypeScript 源码不在本仓库。

## 2026-11-25 延迟优化

原来的消息发送链路，每条消息要串行访问 D1 5 次：发送者成员校验、每个在线连接各 1 次成员校验、插入消息、读取发送者昵称。现在改为：

1. WebSocket 建立时把 `display_name` 写入 attachment，发送消息不再查昵称。
2. 删除发送前的重复成员校验，改由 `INSERT ... WHERE EXISTS` 在写入时原子校验。
3. 广播不再逐个连接查询成员表；成员被移除时由 `/_internal/revoke-member` 主动断开连接。
4. 前端发送后先本地渲染（pending 气泡），收到 WebSocket 回显后替换。

### 实测

同一对测试账号、同一会话、连续 10 条消息，发送端回显 RTT：

| 版本 | 中位数 |
| --- | --- |
| 优化前 | 381.6 ms |
| 优化后 | 116.3 ms / 114.5 ms |

测试环境为美国西部到 D1 `WNAM`，国内网络下优化幅度会更明显。

## 绑定

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Assets | `ASSETS` | 前端静态资源 |
| Durable Object | `CHAT_ROOM` → `ChatRoom` | 会话 WebSocket |
| Durable Object | `CALL_ROOM` → `CallRoom` | 通话信令 |
| D1 | `DB` | 业务数据库 |
| R2 | `CHAT_IMAGES` → `cloudchat-images` | 图片、语音、文件 |
| Secret | `BOOTSTRAP_SECRET` | 初始化密钥，不在仓库中 |

## 部署

在 wrangler 项目中把 `main` 指向本目录的 `index.js`，绑定与上表一致，然后：

```bash
wrangler deploy
```

更新前端 Assets 时不要用旧版脚本覆盖本目录的 `index.js`。

## 回滚

- 优化前版本：`c2799ab0-3d8a-4a8c-ae55-b00e47ac1680`（deployment `c946d360-edd1-4652-8f52-5138f3f75131`）
- 仅后端优化：`c8aa03213cb5412a8385aa90ca99ae8f`
- 前端 + 后端优化：`d7d076bcb1614c3f8049d1b214d6f567`
- 前端取消通话/新增拍照：`7a6982f039e344529bd1d4916843a3bc`（脚本未变）
- 引用回复（`reply_to`）：`940e1d41aa434a4b87864f04ec46edc9`
- 回复按钮布局优化（脚本未变）：`f53d2c4eaaf44f9b99071d1a83bca7f2`

Cloudflare 控制台 → Workers & Pages → `cloudchat` → 部署 → 选择版本回滚。
