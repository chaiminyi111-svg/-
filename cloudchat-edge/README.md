# cloudchat-edge

`cloudchat` Worker 的接入层代理，给「云聊 CloudChat」提供自定义域名。

- 自定义域名：https://chat.biegege.cc.cd
- 上游 Worker：https://cloudchat.flat-water-8982.workers.dev
- 部署账号：`Chaiminyi111@gmail.com's Account`（`fd1283006e8d971d9978f59db0933edd`）
- Worker 名称：`cloudchat-edge`

## 为什么需要这一层

`cloudchat` Worker 在「办公工具」账号，而域名 `biegege.cc.cd` 在另一个账号。Cloudflare 的 Worker 自定义域名要求域名和 Worker 在同一个账号，跨账号会返回：

```
The zone "..." does not exist on your account.
```

所以用这个代理 Worker 承接自定义域名，再把请求转发给上游 Worker。上游代码和数据库都不用动。

## 做了什么

1. 把请求路径和查询参数拼到上游地址
2. 把 `Origin` / `Referer` 改写成上游源，否则上游的来源校验会返回 403
3. 保留 Cookie 和 `Upgrade` 头，WebSocket 可以正常穿过代理
4. POST/PUT 等请求体原样转发

## 部署

```bash
# 在 cloudchat-edge 目录
wrangler deploy worker.js --name cloudchat-edge --compatibility-date 2026-11-19
```

然后在 Cloudflare 控制台给 `cloudchat-edge` 添加自定义域名 `chat.biegege.cc.cd`。

## 回滚

Cloudflare 控制台 → Workers & Pages → `cloudchat-edge` → 部署记录 → 选择上一个版本回滚。
删除自定义域名即可让 `chat.biegege.cc.cd` 停止解析到这个 Worker。
