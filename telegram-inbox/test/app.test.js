const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { createBroadcaster } = require("../src/realtime");
const { createTelegramService } = require("../src/telegram");
const { createApp } = require("../src/app");
const { createLogger } = require("../src/util");

function startMockTelegram() {
  const sent = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/botTEST/sendMessage") {
      const payload = JSON.parse(body || "{}");
      sent.push(payload);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        result: { message_id: 9000 + sent.length, date: Math.floor(Date.now() / 1000) }
      }));
      return;
    }

    if (url.pathname === "/botTEST/getFile") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }));
      return;
    }

    if (url.pathname === "/file/botTEST/photos/file_1.jpg") {
      res.setHeader("content-type", "image/jpeg");
      res.end(Buffer.from("fake-image-bytes"));
      return;
    }

    if (url.pathname === "/botTEST/getUpdates") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: [] }));
      return;
    }

    res.statusCode = 404;
    res.end("{}");
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
        sent
      });
    });
  });
}

function apiRequest(base, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  return fetch(base + pathname, {
    method: options.method || "GET",
    headers,
    body
  }).then(async response => {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { response, data };
  });
}

async function login(base, username, password) {
  const { response, data } = await apiRequest(base, "/api/auth/login", {
    method: "POST",
    body: { username, password }
  });
  assert.equal(response.status, 200, JSON.stringify(data));
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  return cookies[0].split(";")[0];
}

test("Telegram support inbox end-to-end API", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-inbox-test-"));
  const mock = await startMockTelegram();
  const config = {
    root: path.resolve(__dirname, ".."),
    dataDir: tempDir,
    dbPath: path.join(tempDir, "test.db"),
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    adminUsername: "admin",
    adminPassword: "admin-pass-123",
    adminDisplayName: "管理员",
    telegramToken: "TEST",
    telegramApiBase: mock.base,
    telegramPollTimeout: 5,
    telegramDeleteWebhook: false,
    sessionDays: 7,
    trustProxy: false,
    cookieSecure: false,
    publicOrigin: "",
    maxMessageLength: 4096,
    logLevel: "error"
  };

  const logger = createLogger("error");
  const db = openDatabase(config.dbPath);
  const bootstrap = bootstrapAdmin(db, config);
  assert.equal(bootstrap.created, true);
  assert.equal(bootstrap.username, "admin");

  const broadcastEvents = [];
  const broadcaster = createBroadcaster(logger);
  const broadcast = broadcaster.broadcast.bind(broadcaster);
  broadcaster.broadcast = event => {
    broadcastEvents.push(event);
    broadcast(event);
  };
  const telegram = createTelegramService({ db, config, logger, broadcaster });
  const app = createApp({ db, config, telegram, broadcaster, logger });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    broadcaster.close();
    db.close();
    await new Promise(resolve => mock.server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const now = Math.floor(Date.now() / 1000);

  await t.test("health endpoint is public", async () => {
    const { response, data } = await apiRequest(base, "/api/health");
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.telegramConfigured, true);
  });

  await t.test("ingest inbound text creates conversation and unread", async () => {
    const result = await telegram.ingestUpdate({
      update_id: 1,
      message: {
        message_id: 100,
        date: now,
        chat: { id: 555, type: "private", username: "alice" },
        from: { id: 555, first_name: "Alice", username: "alice" },
        text: "你好，我想咨询"
      }
    });
    assert.equal(result.created, true);
    assert.equal(result.conversation.title, "Alice");
    assert.equal(result.conversation.unreadCount, 1);
    assert.ok(broadcastEvents.some(event =>
      event.type === "message.created" && event.message?.body === "你好，我想咨询"
    ));

    const duplicate = await telegram.ingestUpdate({
      update_id: 1,
      message: {
        message_id: 100,
        date: now,
        chat: { id: 555, type: "private", username: "alice" },
        from: { id: 555, first_name: "Alice", username: "alice" },
        text: "你好，我想咨询"
      }
    });
    assert.equal(duplicate.duplicate, true);
  });

  const adminCookie = await login(base, "admin", "admin-pass-123");
  let conversationId;

  await t.test("admin can list conversation and messages", async () => {
    const list = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: adminCookie
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.data.items.length, 1);
    conversationId = list.data.items[0].id;
    assert.equal(list.data.items[0].unreadCount, 1);

    const messages = await apiRequest(
      base,
      `/api/conversations/${conversationId}/messages`,
      { cookie: adminCookie }
    );
    assert.equal(messages.response.status, 200);
    assert.equal(messages.data.messages.length, 1);
    assert.equal(messages.data.messages[0].body, "你好，我想咨询");

    const read = await apiRequest(
      base,
      `/api/conversations/${conversationId}/read`,
      { method: "POST", cookie: adminCookie }
    );
    assert.equal(read.response.status, 200);
  });

  let agent1Cookie;
  let agent2Id;

  await t.test("admin can create agents", async () => {
    const first = await apiRequest(base, "/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: { username: "agent1", displayName: "客服一", password: "agent-pass-1", role: "agent" }
    });
    assert.equal(first.response.status, 201);

    const second = await apiRequest(base, "/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: { username: "agent2", displayName: "客服二", password: "agent-pass-2", role: "agent" }
    });
    assert.equal(second.response.status, 201);
    agent2Id = second.data.user.id;

    agent1Cookie = await login(base, "agent1", "agent-pass-1");
  });

  await t.test("assignment permissions are enforced", async () => {
    const me = await apiRequest(base, "/api/auth/me", { cookie: agent1Cookie });
    assert.equal(me.response.status, 200);

    const selfAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(selfAssign.response.status, 200);
    assert.equal(selfAssign.data.conversation.assigneeId, me.data.user.id);

    const otherAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { assigneeId: agent2Id }
    });
    assert.equal(otherAssign.response.status, 403);

    const adminAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: agent2Id }
    });
    assert.equal(adminAssign.response.status, 200);
    assert.equal(adminAssign.data.conversation.assigneeId, agent2Id);
  });

  await t.test("agent can reply through Telegram API", async () => {
    const result = await apiRequest(base, `/api/conversations/${conversationId}/messages`, {
      method: "POST",
      cookie: agent1Cookie,
      body: { text: "您好，请稍等" }
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.message.direction, "out");
    assert.equal(result.data.message.body, "您好，请稍等");
    assert.equal(mock.sent.length, 1);
    assert.equal(String(mock.sent[0].chat_id), "555");
    assert.equal(mock.sent[0].text, "您好，请稍等");
    assert.ok(broadcastEvents.some(event =>
      event.type === "message.created" && event.message?.direction === "out"
    ));
  });

  await t.test("inbound photo media is proxied with auth", async () => {
    const photo = await telegram.ingestUpdate({
      update_id: 2,
      message: {
        message_id: 101,
        date: now + 1,
        chat: { id: 555, type: "private", username: "alice" },
        from: { id: 555, first_name: "Alice", username: "alice" },
        photo: [{ file_id: "FILE1", width: 100, height: 100, file_size: 16 }],
        caption: "产品图"
      }
    });
    assert.equal(photo.message.type, "photo");

    const media = await fetch(`${base}/api/messages/${photo.message.id}/media`, {
      headers: { cookie: adminCookie }
    });
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await media.arrayBuffer()).toString(), "fake-image-bytes");

    const anonymous = await fetch(`${base}/api/messages/${photo.message.id}/media`);
    assert.equal(anonymous.status, 401);
  });

  await t.test("conversation tags and notes are saved, searched and validated", async () => {
    const saved = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tags: ["高意向", "报价", "高意向"], notes: "客户想了解企业版，预算 2 万" }
    });
    assert.equal(saved.response.status, 200);
    assert.deepEqual(saved.data.conversation.tags, ["高意向", "报价"]);
    assert.equal(saved.data.conversation.notes, "客户想了解企业版，预算 2 万");

    const detail = await apiRequest(base, `/api/conversations/${conversationId}`, {
      cookie: agent1Cookie
    });
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.data.conversation.tags, ["高意向", "报价"]);

    for (const query of ["高意向", "预算 2 万"]) {
      const found = await apiRequest(
        base,
        `/api/conversations?scope=all&status=all&q=${encodeURIComponent(query)}`,
        { cookie: adminCookie }
      );
      assert.equal(found.response.status, 200);
      assert.equal(found.data.total, 1);
      assert.equal(found.data.items[0].id, conversationId);
    }

    const badType = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tags: "高意向" }
    });
    assert.equal(badType.response.status, 400);

    const tooMany = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tags: Array.from({ length: 9 }, (_, index) => `标签${index}`) }
    });
    assert.equal(tooMany.response.status, 400);

    const longTag = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tags: ["x".repeat(21)] }
    });
    assert.equal(longTag.response.status, 400);

    const longNotes = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { notes: "x".repeat(2001) }
    });
    assert.equal(longNotes.response.status, 400);
  });

  await t.test("canned replies CRUD and permissions", async () => {
    const created = await apiRequest(base, "/api/canned-replies", {
      method: "POST",
      cookie: adminCookie,
      body: { title: "报价说明", content: "您好，企业版报价已发您邮箱，请查收。" }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.reply.createdBy, 1);
    assert.equal(created.data.reply.createdByName, "管理员");
    const adminReplyId = created.data.reply.id;

    const agentList = await apiRequest(base, "/api/canned-replies", { cookie: agent1Cookie });
    assert.equal(agentList.response.status, 200);
    assert.ok(agentList.data.items.some(reply => reply.id === adminReplyId));

    const forbiddenEdit = await apiRequest(base, `/api/canned-replies/${adminReplyId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { title: "被改掉" }
    });
    assert.equal(forbiddenEdit.response.status, 403);

    const adminEdit = await apiRequest(base, `/api/canned-replies/${adminReplyId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { content: "您好，企业版报价单已发送，请查收附件。" }
    });
    assert.equal(adminEdit.response.status, 200);
    assert.equal(adminEdit.data.reply.content, "您好，企业版报价单已发送，请查收附件。");

    const ownCreated = await apiRequest(base, "/api/canned-replies", {
      method: "POST",
      cookie: agent1Cookie,
      body: { title: "稍等", content: "收到，我马上帮您确认。" }
    });
    assert.equal(ownCreated.response.status, 201);
    const ownId = ownCreated.data.reply.id;

    const ownEdit = await apiRequest(base, `/api/canned-replies/${ownId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { title: "稍等一下" }
    });
    assert.equal(ownEdit.response.status, 200);
    assert.equal(ownEdit.data.reply.title, "稍等一下");

    const forbiddenDelete = await apiRequest(base, `/api/canned-replies/${adminReplyId}`, {
      method: "DELETE",
      cookie: agent1Cookie
    });
    assert.equal(forbiddenDelete.response.status, 403);

    const adminDelete = await apiRequest(base, `/api/canned-replies/${adminReplyId}`, {
      method: "DELETE",
      cookie: adminCookie
    });
    assert.equal(adminDelete.response.status, 200);

    const invalid = await apiRequest(base, "/api/canned-replies", {
      method: "POST",
      cookie: adminCookie,
      body: { title: "", content: "" }
    });
    assert.equal(invalid.response.status, 400);

    const tooLong = await apiRequest(base, "/api/canned-replies", {
      method: "POST",
      cookie: adminCookie,
      body: { title: "x".repeat(41), content: "ok" }
    });
    assert.equal(tooLong.response.status, 400);
  });

  await t.test("deactivating an agent releases assigned conversations", async () => {
    const deactivate = await apiRequest(base, `/api/users/${agent2Id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { active: false }
    });
    assert.equal(deactivate.response.status, 200);

    const conversation = await apiRequest(base, `/api/conversations/${conversationId}`, {
      cookie: adminCookie
    });
    assert.equal(conversation.response.status, 200);
    assert.equal(conversation.data.conversation.assigneeId, null);
  });

  await t.test("auth, CSRF and role checks", async () => {
    const anonymous = await apiRequest(base, "/api/conversations?scope=all&status=all");
    assert.equal(anonymous.response.status, 401);

    const forbidden = await apiRequest(base, "/api/users", {
      method: "POST",
      cookie: agent1Cookie,
      body: { username: "agent3", displayName: "客服三", password: "agent-pass-3" }
    });
    assert.equal(forbidden.response.status, 403);

    const csrf = await apiRequest(base, "/api/auth/login", {
      method: "POST",
      origin: "https://evil.example",
      body: { username: "admin", password: "admin-pass-123" }
    });
    assert.equal(csrf.response.status, 403);

    const sameOrigin = await apiRequest(base, "/api/auth/login", {
      method: "POST",
      origin: base,
      body: { username: "admin", password: "admin-pass-123" }
    });
    assert.equal(sameOrigin.response.status, 200);
  });

  await t.test("last admin cannot be removed or demoted", async () => {
    const me = await apiRequest(base, "/api/auth/me", { cookie: adminCookie });
    const deactivate = await apiRequest(base, `/api/users/${me.data.user.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { active: false }
    });
    assert.equal(deactivate.response.status, 400);

    const demote = await apiRequest(base, `/api/users/${me.data.user.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "agent" }
    });
    assert.equal(demote.response.status, 400);
  });
});
