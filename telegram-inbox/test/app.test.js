const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { createBroadcaster } = require("../src/realtime");
const { createTelegramService } = require("../src/telegram");
const { createWhatsAppService } = require("../src/whatsapp");
const { createApp } = require("../src/app");
const { createLogger } = require("../src/util");

function startMockTelegram() {
  const sent = [];
  const mediaSent = [];
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

    if (url.pathname === "/botTEST/sendPhoto" || url.pathname === "/botTEST/sendDocument") {
      mediaSent.push({
        method: url.pathname.split("/").pop(),
        contentType: req.headers["content-type"] || "",
        bodyLength: body.length
      });
      res.setHeader("content-type", "application/json");
      if (url.pathname.endsWith("sendPhoto")) {
        res.end(JSON.stringify({
          ok: true,
          result: {
            message_id: 9500 + mediaSent.length,
            date: Math.floor(Date.now() / 1000),
            photo: [{ file_id: "OUT_PHOTO", width: 100, height: 100 }]
          }
        }));
      } else {
        res.end(JSON.stringify({
          ok: true,
          result: {
            message_id: 9500 + mediaSent.length,
            date: Math.floor(Date.now() / 1000),
            document: { file_id: "OUT_DOC", file_name: "outbound.pdf", mime_type: "application/pdf" }
          }
        }));
      }
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
        sent,
        mediaSent
      });
    });
  });
}

function startMockWhatsApp() {
  const sent = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/PHONE/messages") {
      const payload = JSON.parse(body || "{}");
      sent.push(payload);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messages: [{ id: "wamid.OUT_" + sent.length }] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, sent });
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

  await t.test("outbound document and photo are sent and stored", async () => {
    const documentUpload = await fetch(`${base}/api/conversations/${conversationId}/media`, {
      method: "POST",
      headers: {
        cookie: adminCookie,
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("报价单.pdf"),
        "x-file-type": "application/pdf",
        "x-caption": encodeURIComponent("这是报价单")
      },
      body: Buffer.from("fake-pdf")
    });
    assert.equal(documentUpload.status, 201);
    const documentData = await documentUpload.json();
    assert.equal(documentData.message.type, "document");
    assert.equal(documentData.message.meta.fileName, "报价单.pdf");
    assert.equal(documentData.message.body, "这是报价单");
    assert.equal(mock.mediaSent[0].method, "sendDocument");
    assert.match(mock.mediaSent[0].contentType, /multipart\/form-data/);

    const photoUpload = await fetch(`${base}/api/conversations/${conversationId}/media`, {
      method: "POST",
      headers: {
        cookie: adminCookie,
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("photo.jpg"),
        "x-file-type": "image/jpeg"
      },
      body: Buffer.from("fake-jpg")
    });
    assert.equal(photoUpload.status, 201);
    const photoData = await photoUpload.json();
    assert.equal(photoData.message.type, "photo");
    assert.equal(mock.mediaSent[1].method, "sendPhoto");

    const proxied = await fetch(`${base}/api/messages/${photoData.message.id}/media`, {
      headers: { cookie: adminCookie }
    });
    assert.equal(proxied.status, 200);
    assert.equal(proxied.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await proxied.arrayBuffer()).toString(), "fake-image-bytes");
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

  await t.test("stats returns range, message totals and agent workload", async () => {
    const result = await apiRequest(base, "/api/stats?days=7", { cookie: adminCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.stats.rangeDays, 7);
    assert.equal(result.data.stats.daily.length, 7);
    assert.equal(result.data.stats.totals.conversations, 1);
    assert.equal(result.data.stats.totals.messagesIn, 2);
    assert.equal(result.data.stats.totals.messagesOut, 3);
    assert.equal(result.data.stats.totals.newConversations, 1);
    const agent = result.data.stats.agents.find(item => item.username === "agent1");
    assert.ok(agent);
    assert.equal(agent.outbound, 1);
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

test("WhatsApp Cloud API adapter", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-inbox-test-"));
  const mock = await startMockWhatsApp();
  const config = {
    root: path.resolve(__dirname, ".."),
    dataDir: tempDir,
    dbPath: path.join(tempDir, "test.db"),
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    adminUsername: "admin",
    adminPassword: "wa-admin-pass",
    adminDisplayName: "管理员",
    telegramToken: "",
    telegramApiBase: "http://127.0.0.1:1",
    telegramPollTimeout: 5,
    telegramDeleteWebhook: false,
    whatsappToken: "WA_TEST",
    whatsappPhoneNumberId: "PHONE",
    whatsappVerifyToken: "verify-me",
    whatsappAppSecret: "app-secret",
    whatsappApiBase: mock.base,
    sessionDays: 7,
    trustProxy: false,
    cookieSecure: false,
    publicOrigin: "",
    maxMessageLength: 4096,
    logLevel: "error"
  };

  const logger = createLogger("error");
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  const broadcaster = createBroadcaster(logger);
  const telegram = createTelegramService({ db, config, logger, broadcaster });
  const whatsapp = createWhatsAppService({ db, config, logger, broadcaster });
  const app = createApp({ db, config, telegram, whatsapp, broadcaster, logger });
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

  const health = await apiRequest(base, "/api/health");
  assert.equal(health.data.whatsappConfigured, true);

  const verify = await apiRequest(
    base,
    "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-123"
  );
  assert.equal(verify.response.status, 200);
  assert.equal(verify.data.raw, "challenge-123");

  const wrongVerify = await apiRequest(
    base,
    "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x"
  );
  assert.equal(wrongVerify.response.status, 403);

  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "PHONE" },
          contacts: [{ wa_id: "8613800000000", profile: { name: "WA 客户" } }],
          messages: [{
            from: "8613800000000",
            id: "wamid.IN_1",
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: "你好 WhatsApp" }
          }]
        }
      }]
    }]
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = "sha256=" + crypto.createHmac("sha256", config.whatsappAppSecret).update(raw).digest("hex");
  const badWebhook = await fetch(base + "/webhook/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
    body: raw
  });
  assert.equal(badWebhook.status, 403);

  const webhook = await fetch(base + "/webhook/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: raw
  });
  assert.equal(webhook.status, 200);

  const adminCookie = await login(base, "admin", "wa-admin-pass");
  const list = await apiRequest(base, "/api/conversations?scope=all&status=all", { cookie: adminCookie });
  const conversation = list.data.items.find(item => item.channel === "whatsapp");
  assert.ok(conversation);
  assert.equal(conversation.title, "WA 客户");
  assert.equal(conversation.unreadCount, 1);

  const reply = await apiRequest(base, `/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: adminCookie,
    body: { text: "收到，马上处理" }
  });
  assert.equal(reply.response.status, 201, JSON.stringify(reply.data));
  assert.equal(reply.data.message.type, "text");
  assert.equal(mock.sent.length, 1);
  assert.equal(mock.sent[0].to, "8613800000000");
  assert.equal(mock.sent[0].text.body, "收到，马上处理");

  const media = await fetch(base + `/api/conversations/${conversation.id}/media`, {
    method: "POST",
    headers: {
      cookie: adminCookie,
      "content-type": "application/octet-stream",
      "x-file-name": "test.txt"
    },
    body: Buffer.from("hello")
  });
  assert.equal(media.status, 400);
});
