const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { createBroadcaster } = require("../src/realtime");
const { createTelegramService } = require("../src/telegram");
const { createWhatsAppService } = require("../src/whatsapp");
const { createTranslateService } = require("../src/translate");
const { createAIService, isAfterHours, isKeylessEndpoint, isPublicKeylessEndpoint, retryDelayMs } = require("../src/ai");
const { autoAssignConversation, saveSettings } = require("../src/assignment");
const { getStats } = require("../src/store");
const { createApp } = require("../src/app");
const { createLogger } = require("../src/util");

function startMockTelegram() {
  const sent = [];
  const mediaSent = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");
    const botMatch = url.pathname.match(/^\/bot([^/]+)\/getMe$/);

    if (botMatch) {
      if (botMatch[1] === "BAD") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, description: "Unauthorized" }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        result: {
          id: 123456,
          is_bot: true,
          first_name: "Test Bot",
          username: "test_bot"
        }
      }));
      return;
    }

    if (/^\/bot[^/]+\/getUpdates$/.test(url.pathname)) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: [] }));
      return;
    }

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

function startMockTranslate() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");
    const payload = body ? JSON.parse(body) : {};
    calls.push({ path: url.pathname, payload, query: Object.fromEntries(url.searchParams) });

    if (url.pathname.endsWith("/translate_a/single")) {
      const text = String(url.searchParams.get("q") || "");
      const target = String(url.searchParams.get("tl") || "en");
      const language = /[\u4e00-\u9fff]/.test(text) ? "zh-CN"
        : text.toLowerCase().includes("bonjour") ? "fr" : "en";
      let translatedText = text;
      if (target === "zh-CN") translatedText = "你好";
      else if (target === "en") translatedText = "Hello";
      else if (target === "ja") translatedText = "こんにちは";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([[[translatedText, text, null, null, 10]], null, language]));
      return;
    }

    if (url.pathname.endsWith("/translate_a/t")) {
      const text = String(url.searchParams.get("q") || "");
      const target = String(url.searchParams.get("tl") || "en");
      const language = /[\u4e00-\u9fff]/.test(text) ? "zh-CN"
        : text.toLowerCase().includes("bonjour") ? "fr" : "en";
      let translatedText = text;
      if (target === "zh-CN") translatedText = "你好";
      else if (target === "en") translatedText = "Hello";
      else if (target === "ja") translatedText = "こんにちは";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([[translatedText, language]]));
      return;
    }

    if (url.pathname.endsWith("/get")) {
      const text = String(url.searchParams.get("q") || "");
      const pair = String(url.searchParams.get("langpair") || "Autodetect|en").split("|");
      const target = pair[1] || "en";
      const language = /[\u4e00-\u9fff]/.test(text) ? "zh-CN"
        : text.toLowerCase().includes("bonjour") ? "fr" : "en";
      let translatedText = text;
      if (target === "zh-CN") translatedText = "你好";
      else if (target === "en") translatedText = "Hello";
      else if (target === "ja") translatedText = "こんにちは";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        responseData: { translatedText, detectedLanguage: language },
        responseStatus: 200,
        quotaFinished: false
      }));
      return;
    }

    if (url.pathname.endsWith("/language/translate/v2/detect")) {
      const text = String(payload.q || "");
      const language = /[\u4e00-\u9fff]/.test(text) ? "zh-CN"
        : text.toLowerCase().includes("bonjour") ? "fr" : "en";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { detections: [[{ language, confidence: 0.99 }]] } }));
      return;
    }

    if (url.pathname.endsWith("/language/translate/v2")) {
      const text = String(payload.q || "");
      const target = String(payload.target || "en");
      let translatedText = text;
      if (target === "zh-CN") translatedText = "你好";
      else if (target === "en") translatedText = "Hello";
      else if (target === "ja") translatedText = "こんにちは";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: { translations: [{ translatedText, detectedSourceLanguage: /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en" }] }
      }));
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
        calls
      });
    });
  });
}

function startMockAI({ requireKey = true } = {}) {
  const calls = [];
  const authHeaders = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    if (requireKey && req.headers.authorization !== "Bearer test-ai-key") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }
    const payload = JSON.parse(body || "{}");
    calls.push(payload);
    authHeaders.push(req.headers.authorization || null);
    const last = String(payload.messages?.at(-1)?.content || "");
    let content = "您好，已经收到您的问题，我们会尽快为您处理。";
    if (last.includes("退款")) content = "可以帮您核实退款进度，请提供订单号。";
    if (last.includes("只回复：OK")) content = "OK";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}/v1`,
        calls,
        authHeaders
      });
    });
  });
}

function waitFor(check, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        if (check()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error("等待条件超时"));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 20);
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
    if (req.method === "GET" && /^\/[^/]+$/.test(url.pathname)) {
      const phoneId = url.pathname.slice(1);
      res.setHeader("content-type", "application/json");
      if (phoneId === "BADPHONE") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "Unsupported get request" } }));
        return;
      }
      res.end(JSON.stringify({
        id: phoneId,
        display_phone_number: "+86 138 0000 0000",
        verified_name: "测试 WhatsApp"
      }));
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
  broadcaster.broadcast = (event, targetUserId = null) => {
    broadcastEvents.push(event);
    broadcast(event, targetUserId);
  };
  const telegram = createTelegramService({ db, config, logger, broadcaster });
  const app = createApp({ db, config, telegram, broadcaster, logger });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await telegram.stop();
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

    const unread = await apiRequest(
      base,
      `/api/conversations/${conversationId}/unread`,
      { method: "POST", cookie: adminCookie }
    );
    assert.equal(unread.response.status, 200);
    assert.equal(unread.data.unreadCount, 1);
    const unreadList = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: adminCookie
    });
    assert.equal(unreadList.data.items[0].unreadCount, 1);
    const unreadStats = await apiRequest(base, "/api/stats?days=1", { cookie: adminCookie });
    assert.equal(unreadStats.data.stats.totals.unread, 1);

    const readAgain = await apiRequest(
      base,
      `/api/conversations/${conversationId}/read`,
      { method: "POST", cookie: adminCookie }
    );
    assert.equal(readAgain.response.status, 200);
  });

  let agent1Cookie;
  let agent2Id;
  let viewerCookie;
  let viewerId;

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

  await t.test("admin can create a read-only viewer account", async () => {
    const created = await apiRequest(base, "/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: { username: "viewer", displayName: "统计员", password: "viewer-pass-1", role: "viewer" }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.user.role, "viewer");
    viewerId = created.data.user.id;
    viewerCookie = await login(base, "viewer", "viewer-pass-1");
  });

  await t.test("only admins can assign conversations and agents see only their own", async () => {
    const me = await apiRequest(base, "/api/auth/me", { cookie: agent1Cookie });
    assert.equal(me.response.status, 200);

    const hiddenBefore = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent1Cookie
    });
    assert.equal(hiddenBefore.response.status, 200);
    assert.equal(hiddenBefore.data.total, 0);
    assert.equal(hiddenBefore.data.counts.all, 0);
    assert.equal(hiddenBefore.data.counts.unassigned, 0);

    const detailBefore = await apiRequest(base, `/api/conversations/${conversationId}`, {
      cookie: agent1Cookie
    });
    assert.equal(detailBefore.response.status, 404);

    const selfAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(selfAssign.response.status, 404);

    const adminAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(adminAssign.response.status, 200);
    assert.equal(adminAssign.data.conversation.assigneeId, me.data.user.id);
    assert.ok(adminAssign.data.conversation.assignedAt);

    const visible = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent1Cookie
    });
    assert.equal(visible.response.status, 200);
    assert.equal(visible.data.total, 1);
    assert.equal(visible.data.items[0].assigneeId, me.data.user.id);
    assert.equal(visible.data.counts.mine, 1);
    assert.equal(visible.data.counts.unassigned, 0);

    const otherAssign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { assigneeId: agent2Id }
    });
    assert.equal(otherAssign.response.status, 403);

    const adminAssign2 = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: agent2Id }
    });
    assert.equal(adminAssign2.response.status, 200);
    assert.equal(adminAssign2.data.conversation.assigneeId, agent2Id);

    const hiddenAfter = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent1Cookie
    });
    assert.equal(hiddenAfter.response.status, 200);
    assert.equal(hiddenAfter.data.total, 0);
    assert.equal(hiddenAfter.data.items.length, 0);

    for (const [method, path] of [
      ["GET", `/api/conversations/${conversationId}`],
      ["GET", `/api/conversations/${conversationId}/messages`],
      ["POST", `/api/conversations/${conversationId}/messages`],
      ["POST", `/api/conversations/${conversationId}/read`],
      ["PATCH", `/api/conversations/${conversationId}`]
    ]) {
      const body = method === "POST" && path.endsWith("/messages")
        ? { text: "不应该发送成功" }
        : method === "PATCH" ? { status: "closed" } : undefined;
      const denied = await apiRequest(base, path, { method, cookie: agent1Cookie, body });
      assert.equal(denied.response.status, 404, `${method} ${path}`);
    }

    const agent2Cookie = await login(base, "agent2", "agent-pass-2");
    const agent2List = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent2Cookie
    });
    assert.equal(agent2List.response.status, 200);
    assert.equal(agent2List.data.total, 1);
    assert.equal(agent2List.data.items[0].assigneeId, agent2Id);
    assert.equal(agent2List.data.counts.mine, 1);

    const reassign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(reassign.response.status, 200);
    assert.equal(reassign.data.conversation.assigneeId, me.data.user.id);
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
    assert.equal(result.data.stats.totals.assigned, 1);
    assert.equal(result.data.stats.totals.newAssigned, 1);
    const agent = result.data.stats.agents.find(item => item.username === "agent1");
    assert.ok(agent);
    assert.equal(agent.newConversations, 1);
    assert.equal(agent.newAssigned, 1);
    assert.equal(agent.assigned, 1);
    assert.equal(agent.outbound, 1);
    assert.equal(result.data.stats.agents.some(item => item.username === "viewer"), false);

    const csv = await fetch(base + "/api/stats/export.csv?days=7", {
      headers: { cookie: adminCookie }
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") || "", /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /客服/);
    assert.match(csvText, /平均首响/);
  });

  await t.test("viewer role can only read statistics", async () => {
    const stats = await apiRequest(base, "/api/stats?days=7", { cookie: viewerCookie });
    assert.equal(stats.response.status, 200);
    assert.equal(stats.data.stats.totals.conversations, 1);

    const viewerCsv = await fetch(base + "/api/stats/export.csv?days=7", {
      headers: { cookie: viewerCookie }
    });
    assert.equal(viewerCsv.status, 200);
    assert.match(await viewerCsv.text(), /客服/);

    for (const path of [
      "/api/conversations?scope=all&status=all",
      "/api/users",
      "/api/canned-replies",
      "/api/events"
    ]) {
      const denied = await apiRequest(base, path, { cookie: viewerCookie });
      assert.equal(denied.response.status, 403, path);
    }

    const assign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: viewerCookie,
      body: { assigneeId: viewerId }
    });
    assert.equal(assign.response.status, 403);

    const viewerAsAssignee = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: viewerId }
    });
    assert.equal(viewerAsAssignee.response.status, 400);
  });

  await t.test("deactivating an agent releases assigned conversations", async () => {
    const assign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: agent2Id }
    });
    assert.equal(assign.response.status, 200);

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

  await t.test("unassigned conversations stay hidden until an admin assigns them", async () => {
    const list = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent1Cookie
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.data.total, 0);
    assert.equal(list.data.items.length, 0);
    assert.equal(list.data.counts.unassigned, 0);

    const detail = await apiRequest(base, `/api/conversations/${conversationId}`, {
      cookie: agent1Cookie
    });
    assert.equal(detail.response.status, 404);

    const me = await apiRequest(base, "/api/auth/me", { cookie: agent1Cookie });
    const claim = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: agent1Cookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(claim.response.status, 404);

    const assign = await apiRequest(base, `/api/conversations/${conversationId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { assigneeId: me.data.user.id }
    });
    assert.equal(assign.response.status, 200);

    const visible = await apiRequest(base, "/api/conversations?scope=all&status=all", {
      cookie: agent1Cookie
    });
    assert.equal(visible.data.total, 1);
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

  await t.test("admin can configure and clear Telegram token without exposing it", async () => {
    const forbidden = await apiRequest(base, "/api/admin/telegram", {
      cookie: agent1Cookie
    });
    assert.equal(forbidden.response.status, 403);

    const before = await apiRequest(base, "/api/admin/telegram", { cookie: adminCookie });
    assert.equal(before.response.status, 200);
    assert.equal(before.data.telegram.configured, true);
    assert.equal(before.data.telegram.source, "environment");
    assert.equal(before.data.telegram.bot.username, "test_bot");

    const invalid = await apiRequest(base, "/api/admin/telegram", {
      method: "POST",
      cookie: adminCookie,
      body: { token: "BAD" }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(telegram.configured, true);

    const saved = await apiRequest(base, "/api/admin/telegram", {
      method: "POST",
      cookie: adminCookie,
      body: { token: "NEWTOKEN" }
    });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.telegram.configured, true);
    assert.equal(saved.data.telegram.source, "database");
    assert.equal(saved.data.telegram.bot.username, "test_bot");
    assert.equal(JSON.stringify(saved.data).includes("NEWTOKEN"), false);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get().value, "NEWTOKEN");

    const afterSave = await apiRequest(base, "/api/health");
    assert.equal(afterSave.data.telegramConfigured, true);

    const cleared = await apiRequest(base, "/api/admin/telegram", {
      method: "DELETE",
      cookie: adminCookie
    });
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.data.telegram.configured, false);
    assert.equal(telegram.configured, false);
    assert.equal(telegram.running, false);

    const afterClear = await apiRequest(base, "/api/health");
    assert.equal(afterClear.data.telegramConfigured, false);

    const restored = await apiRequest(base, "/api/admin/telegram", {
      method: "POST",
      cookie: adminCookie,
      body: { token: "TEST" }
    });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.data.telegram.configured, true);
    assert.equal(telegram.configured, true);
  });
});

test("broadcaster filters events by conversation assignee", () => {
  const logger = createLogger("error");
  const broadcaster = createBroadcaster(logger);
  const received = { admin: [], agent1: [], agent2: [] };
  const client = name => ({
    write(payload) { received[name].push(payload); },
    end() {}
  });
  const admin = client("admin");
  const agent1 = client("agent1");
  const agent2 = client("agent2");
  broadcaster.add(admin, { id: 1, role: "admin" });
  broadcaster.add(agent1, { id: 2, role: "agent" });
  broadcaster.add(agent2, { id: 3, role: "agent" });

  broadcaster.broadcast({
    type: "message.created",
    conversation: { id: 10, assigneeId: 2 },
    message: { id: 20 }
  });
  assert.equal(received.admin.length, 1);
  assert.equal(received.agent1.length, 1);
  assert.equal(received.agent2.length, 0);

  for (const key of Object.keys(received)) received[key].length = 0;
  broadcaster.broadcast({
    type: "message.created",
    conversation: { id: 10, assigneeId: null },
    message: { id: 21 }
  });
  assert.equal(received.admin.length, 1);
  assert.equal(received.agent1.length, 0);
  assert.equal(received.agent2.length, 0);

  for (const key of Object.keys(received)) received[key].length = 0;
  broadcaster.broadcastToAgents({ type: "conversation.removed", conversationId: 10 }, 3);
  assert.equal(received.admin.length, 0);
  assert.equal(received.agent1.length, 1);
  assert.equal(received.agent2.length, 0);

  for (const key of Object.keys(received)) received[key].length = 0;
  broadcaster.broadcast({ type: "conversation.removed", conversationId: 10 }, 3);
  assert.equal(received.admin.length, 0);
  assert.equal(received.agent1.length, 0);
  assert.equal(received.agent2.length, 1);

  broadcaster.close();
});

test("legacy databases migrate to viewer roles and assignment timestamps", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-inbox-legacy-"));
  const dbPath = path.join(tempDir, "legacy.db");
  const now = new Date().toISOString();
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_chat_id TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'telegram',
      chat_type TEXT NOT NULL DEFAULT 'private',
      title TEXT NOT NULL,
      username TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      last_message_at TEXT,
      last_message_preview TEXT,
      last_message_direction TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO users
      (id, username, display_name, password_hash, role, active, created_at, updated_at)
    VALUES (1, 'admin', '管理员', 'x', 'admin', 1, '${now}', '${now}');
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES ('legacy-token', 1, '${new Date(Date.now() + 86400000).toISOString()}', '${now}');
    INSERT INTO conversations
      (id, telegram_chat_id, title, assignee_id, last_message_at, created_at, updated_at)
    VALUES (1, '555', 'Alice', 1, '${now}', '${now}', '${now}');
  `);
  legacy.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role, active, created_at, updated_at)
       VALUES ('viewer', '统计员', 'x', 'viewer', 1, ?, ?)`
    ).run(now, now);
    assert.equal(db.prepare("SELECT role FROM users WHERE username = 'viewer'").get().role, "viewer");
    assert.equal(
      db.prepare("SELECT assigned_at FROM conversations WHERE id = 1").get().assigned_at,
      now
    );
    assert.match(
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql,
      /viewer/
    );
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
  assert.equal(reply.data.message.deliveryStatus, "sent");
  assert.equal(mock.sent.length, 1);
  assert.equal(mock.sent[0].to, "8613800000000");
  assert.equal(mock.sent[0].text.body, "收到，马上处理");

  const statusPayload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "PHONE" },
          statuses: [{
            id: "wamid.OUT_1",
            status: "read",
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: "8613800000000"
          }]
        }
      }]
    }]
  };
  const statusRaw = Buffer.from(JSON.stringify(statusPayload));
  const statusSignature = "sha256=" + crypto
    .createHmac("sha256", config.whatsappAppSecret)
    .update(statusRaw)
    .digest("hex");
  const statusWebhook = await fetch(base + "/webhook/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": statusSignature },
    body: statusRaw
  });
  assert.equal(statusWebhook.status, 200);

  const messages = await apiRequest(
    base,
    `/api/conversations/${conversation.id}/messages`,
    { cookie: adminCookie }
  );
  const outbound = messages.data.messages.find(item => item.direction === "out");
  assert.equal(outbound.deliveryStatus, "read");
  assert.ok(outbound.deliveryUpdatedAt);

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

  await t.test("admin can configure and clear WhatsApp credentials without exposing secrets", async () => {
    const anonymous = await apiRequest(base, "/api/admin/whatsapp");
    assert.equal(anonymous.response.status, 401);

    const created = await apiRequest(base, "/api/users", {
      method: "POST",
      cookie: adminCookie,
      body: { username: "wa-agent", displayName: "WhatsApp 客服", password: "wa-agent-pass", role: "agent" }
    });
    assert.equal(created.response.status, 201);
    const agentCookie = await login(base, "wa-agent", "wa-agent-pass");
    const forbidden = await apiRequest(base, "/api/admin/whatsapp", { cookie: agentCookie });
    assert.equal(forbidden.response.status, 403);

    const before = await apiRequest(base, "/api/admin/whatsapp", { cookie: adminCookie });
    assert.equal(before.response.status, 200);
    assert.equal(before.data.whatsapp.configured, true);
    assert.equal(before.data.whatsapp.source, "environment");
    assert.equal(before.data.whatsapp.phoneNumberId, "PHONE");
    assert.equal(before.data.whatsapp.hasVerifyToken, true);
    assert.equal(before.data.whatsapp.hasAppSecret, true);
    assert.equal(before.data.whatsapp.info.verifiedName, "测试 WhatsApp");

    const invalid = await apiRequest(base, "/api/admin/whatsapp", {
      method: "POST",
      cookie: adminCookie,
      body: { token: "WA_NEW", phoneNumberId: "BADPHONE" }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(whatsapp.configured, true);

    const saved = await apiRequest(base, "/api/admin/whatsapp", {
      method: "POST",
      cookie: adminCookie,
      body: {
        token: "WA_NEW",
        phoneNumberId: "PHONE",
        verifyToken: "new-verify",
        appSecret: "new-secret"
      }
    });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.whatsapp.configured, true);
    assert.equal(saved.data.whatsapp.source, "database");
    assert.equal(saved.data.whatsapp.hasVerifyToken, true);
    assert.equal(saved.data.whatsapp.hasAppSecret, true);
    assert.equal(saved.data.whatsapp.info.displayPhoneNumber, "+86 138 0000 0000");
    assert.equal(JSON.stringify(saved.data).includes("WA_NEW"), false);
    assert.equal(JSON.stringify(saved.data).includes("new-secret"), false);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_token'").get().value, "WA_NEW");
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_app_secret'").get().value, "new-secret");

    const preserved = await apiRequest(base, "/api/admin/whatsapp", {
      method: "POST",
      cookie: adminCookie,
      body: { phoneNumberId: "PHONE" }
    });
    assert.equal(preserved.response.status, 200);
    assert.equal(preserved.data.whatsapp.hasVerifyToken, true);
    assert.equal(preserved.data.whatsapp.hasAppSecret, true);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_token'").get().value, "WA_NEW");

    const verifyNew = await apiRequest(
      base,
      "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=new-verify&hub.challenge=new-challenge"
    );
    assert.equal(verifyNew.response.status, 200);
    assert.equal(verifyNew.data.raw, "new-challenge");

    const verifyOld = await apiRequest(
      base,
      "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=x"
    );
    assert.equal(verifyOld.response.status, 403);

    const cleared = await apiRequest(base, "/api/admin/whatsapp", {
      method: "DELETE",
      cookie: adminCookie
    });
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.data.whatsapp.configured, false);
    assert.equal(whatsapp.configured, false);

    const afterClear = await apiRequest(base, "/api/health");
    assert.equal(afterClear.data.whatsappConfigured, false);

    const webhookAfterClear = await apiRequest(
      base,
      "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=new-verify&hub.challenge=x"
    );
    assert.equal(webhookAfterClear.response.status, 503);

    const restored = await apiRequest(base, "/api/admin/whatsapp", {
      method: "POST",
      cookie: adminCookie,
      body: {
        token: "WA_TEST",
        phoneNumberId: "PHONE",
        verifyToken: "verify-me",
        appSecret: "app-secret"
      }
    });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.data.whatsapp.configured, true);
    assert.equal(whatsapp.configured, true);
  });
});


test("Google translation detects language and translates replies", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "translate-inbox-test-"));
  const telegramMock = await startMockTelegram();
  const translateMock = await startMockTranslate();
  const config = {
    root: path.resolve(__dirname, ".."),
    dataDir: tempDir,
    dbPath: path.join(tempDir, "test.db"),
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    adminUsername: "admin",
    adminPassword: "translate-admin-pass",
    adminDisplayName: "管理员",
    telegramToken: "TEST",
    telegramApiBase: telegramMock.base,
    telegramPollTimeout: 5,
    telegramDeleteWebhook: false,
    sessionDays: 7,
    trustProxy: false,
    cookieSecure: false,
    publicOrigin: "",
    maxMessageLength: 4096,
    logLevel: "error",
    googleTranslateApiKey: "",
    googleTranslateApiBase: translateMock.base,
    googleTranslateWebApiBase: translateMock.base,
    googleTranslateWebMainApiBase: translateMock.base,
    googleTranslateChromeApiBase: translateMock.base,
    myMemoryApiBase: translateMock.base,
    translateProvider: "google",
    translateTarget: "zh-CN"
  };

  const logger = createLogger("error");
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  const broadcaster = createBroadcaster(logger);
  const translate = createTranslateService({ db, config, logger });
  const telegram = createTelegramService({ db, config, logger, broadcaster, translate });
  const app = createApp({ db, config, telegram, broadcaster, logger, translate });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await telegram.stop();
    broadcaster.close();
    db.close();
    await new Promise(resolve => telegramMock.server.close(resolve));
    await new Promise(resolve => translateMock.server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const adminCookie = await login(base, "admin", "translate-admin-pass");
  const before = await apiRequest(base, "/api/admin/translate", { cookie: adminCookie });
  assert.equal(before.response.status, 200);
  assert.equal(before.data.translate.configured, false);

  const saved = await apiRequest(base, "/api/admin/translate", {
    method: "POST",
    cookie: adminCookie,
    body: { apiKey: "TEST_TRANSLATE_KEY" }
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.translate.configured, true);
  assert.equal(saved.data.translate.source, "database");
  assert.equal(JSON.stringify(saved.data).includes("TEST_TRANSLATE_KEY"), false);

  const now = Math.floor(Date.now() / 1000);
  await telegram.ingestUpdate({
    message: {
      message_id: 501,
      date: now,
      chat: { id: 99001, type: "private", username: "alice" },
      from: { id: 99001, first_name: "Alice", username: "alice" },
      text: "Hello, how can I help?"
    }
  });

  const list = await apiRequest(base, "/api/conversations?scope=all&status=all", { cookie: adminCookie });
  const conversation = list.data.items.find(item => item.chatId === "99001");
  assert.ok(conversation);
  assert.equal(conversation.detectedLanguage, "en");

  const messages = await apiRequest(base, `/api/conversations/${conversation.id}/messages`, { cookie: adminCookie });
  assert.equal(messages.data.messages.length, 1);
  assert.equal(messages.data.messages[0].language, "en");
  assert.equal(messages.data.messages[0].translatedBody, "你好");
  assert.equal(messages.data.messages[0].translationLanguage, "zh-CN");

  const reply = await apiRequest(base, `/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: adminCookie,
    body: { text: "你好，请问需要什么帮助？", targetLanguage: "en" }
  });
  assert.equal(reply.response.status, 201, JSON.stringify(reply.data));
  assert.equal(telegramMock.sent.at(-1).text, "Hello");
  assert.equal(reply.data.message.body, "Hello");
  assert.equal(reply.data.message.language, "en");
  assert.equal(reply.data.message.meta.translated, true);
  assert.equal(reply.data.message.meta.originalText, "你好，请问需要什么帮助？");

  const follow = await apiRequest(base, `/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    cookie: adminCookie,
    body: { text: "你好", targetLanguage: "auto" }
  });
  assert.equal(follow.response.status, 201, JSON.stringify(follow.data));
  assert.equal(telegramMock.sent.at(-1).text, "Hello");

  const cleared = await apiRequest(base, "/api/admin/translate", {
    method: "DELETE",
    cookie: adminCookie
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.data.translate.configured, false);
  assert.equal(translate.configured(), false);

  const webSaved = await apiRequest(base, "/api/admin/translate", {
    method: "POST",
    cookie: adminCookie,
    body: { provider: "google-web" }
  });
  assert.equal(webSaved.response.status, 200, JSON.stringify(webSaved.data));
  assert.equal(webSaved.data.translate.configured, true);
  assert.equal(webSaved.data.translate.provider, "google-web");
  assert.equal(webSaved.data.translate.keyConfigured, false);
  assert.equal(translate.configured(), true);

  const webInbound = await translate.translateInbound("Hello");
  assert.equal(webInbound.language, "en");
  assert.equal(webInbound.translatedBody, "你好");
  assert.equal(webInbound.translationLanguage, "zh-CN");

  const webOutbound = await translate.prepareOutbound("你好", "en");
  assert.equal(webOutbound.text, "Hello");
  assert.equal(webOutbound.meta.translated, true);

  for (const provider of ["google-web-main", "google-chrome", "mymemory"]) {
    const switched = await apiRequest(base, "/api/admin/translate", {
      method: "POST",
      cookie: adminCookie,
      body: { provider }
    });
    assert.equal(switched.response.status, 200, JSON.stringify(switched.data));
    assert.equal(switched.data.translate.provider, provider);
    assert.equal(switched.data.translate.configured, true);
    assert.equal(switched.data.translate.keyConfigured, false);
    assert.ok(switched.data.translate.providerLabel);

    const inbound = await translate.translateInbound("Hello");
    assert.equal(inbound.language, "en", provider);
    assert.equal(inbound.translatedBody, "你好", provider);
    const outbound = await translate.prepareOutbound("你好", "en");
    assert.equal(outbound.text, "Hello", provider);
    assert.equal(outbound.meta.translated, true, provider);
  }

  const providers = (await apiRequest(base, "/api/admin/translate", { cookie: adminCookie }))
    .data.translate.providers;
  assert.equal(providers.length, 5);
  assert.deepEqual(providers.map(item => item.code), [
    "google", "google-web", "google-web-main", "google-chrome", "mymemory"
  ]);
});


test("auto assignment respects capacity and stats track SLA", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "assign-test-"));
  const config = {
    root: path.resolve(__dirname, ".."),
    dataDir: tempDir,
    dbPath: path.join(tempDir, "test.db"),
    adminUsername: "admin",
    adminPassword: "admin-pass-123",
    adminDisplayName: "管理员",
    autoAssign: false,
    autoAssignStrategy: "least_active",
    agentMaxActive: 0,
    slaFirstResponseMinutes: 15
  };
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  t.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, active, created_at, updated_at) VALUES (?, ?, 'x', 'agent', 1, ?, ?)"
  );
  const a1 = Number(insertUser.run("a1", "客服一", now, now).lastInsertRowid);
  const a2 = Number(insertUser.run("a2", "客服二", now, now).lastInsertRowid);
  const insertConversation = db.prepare(
    "INSERT INTO conversations (telegram_chat_id, title, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?)"
  );
  const c1 = Number(insertConversation.run("c1", "C1", now, now, now).lastInsertRowid);
  const c2 = Number(insertConversation.run("c2", "C2", new Date(Date.now() - 60 * 60000).toISOString(), now, now).lastInsertRowid);
  const c3 = Number(insertConversation.run("c3", "C3", now, now, now).lastInsertRowid);
  const c4 = Number(insertConversation.run("c4", "C4", now, now, now).lastInsertRowid);

  saveSettings(db, { enabled: true, strategy: "round_robin", maxActive: 0 });
  assert.equal(autoAssignConversation(db, c1, config).id, a1);
  assert.equal(autoAssignConversation(db, c2, config).id, a2);
  assert.equal(autoAssignConversation(db, c3, config).id, a1);
  assert.equal(autoAssignConversation(db, c4, config).id, a2);

  saveSettings(db, { enabled: true, strategy: "round_robin", maxActive: 1 });
  const c5 = Number(insertConversation.run("c5", "C5", now, now, now).lastInsertRowid);
  assert.equal(autoAssignConversation(db, c5, config), null);
  assert.equal(db.prepare("SELECT assignee_id FROM conversations WHERE id = ?").get(c5).assignee_id, null);

  db.prepare("UPDATE conversations SET first_response_at = ?, resolved_at = ? WHERE id = ?").run(
    new Date(Date.now() + 2 * 60000).toISOString(),
    new Date(Date.now() + 10 * 60000).toISOString(),
    c1
  );

  const stats = getStats(db, 7, { slaFirstResponseMinutes: 15 });
  const agent1 = stats.agents.find(item => item.username === "a1");
  const agent2 = stats.agents.find(item => item.username === "a2");
  assert.equal(agent1.avgFirstResponseMinutes, 2);
  assert.equal(agent1.avgResolutionMinutes, 10);
  assert.equal(agent2.slaBreaches, 1);
  assert.equal(stats.totals.avgFirstResponseMinutes, 2);
  assert.equal(stats.totals.avgResolutionMinutes, 10);
  assert.equal(stats.totals.slaBreaches, 1);
});

test("AI auto reply respects permissions, suggestions and modes", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-inbox-test-"));
  const mockTelegram = await startMockTelegram();
  const mockAI = await startMockAI();
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
    telegramApiBase: mockTelegram.base,
    telegramPollTimeout: 5,
    telegramDeleteWebhook: false,
    sessionDays: 7,
    trustProxy: false,
    cookieSecure: false,
    publicOrigin: "",
    maxMessageLength: 4096,
    logLevel: "error",
    aiEnabled: true,
    aiApiKey: "test-ai-key",
    aiBaseUrl: mockAI.base,
    aiModel: "mock-model",
    aiDefaultMode: "auto",
    aiWorkStart: "09:00",
    aiWorkEnd: "18:00",
    aiWorkTimezone: "Asia/Shanghai",
    aiIncludeGroups: false,
    aiDelayMs: 5,
    aiTimeoutMs: 3000,
    aiMaxContext: 12
  };

  const logger = createLogger("error");
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  const broadcaster = createBroadcaster(logger);
  const hooks = {};
  const telegram = createTelegramService({ db, config, logger, broadcaster, hooks });
  const ai = createAIService({
    db,
    config,
    logger,
    broadcaster,
    sendReply: (conversation, text, user, options) => telegram.sendReply(conversation, text, user, options)
  });
  hooks.onInbound = event => ai.handleInbound(event);
  const app = createApp({ db, config, telegram, broadcaster, logger, ai });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const now = Math.floor(Date.now() / 1000);

  t.after(async () => {
    ai.close();
    await new Promise(resolve => server.close(resolve));
    await telegram.stop();
    broadcaster.close();
    db.close();
    await new Promise(resolve => mockTelegram.server.close(resolve));
    await new Promise(resolve => mockAI.server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const ingest = (chatId, messageId, text) => telegram.ingestUpdate({
    update_id: messageId,
    message: {
      message_id: messageId,
      date: now,
      chat: { id: chatId, type: "private", username: "customer" + chatId },
      from: { id: chatId, first_name: "客户" + chatId, username: "customer" + chatId },
      text
    }
  });

  const adminCookie = await login(base, "admin", "admin-pass-123");
  const created = await apiRequest(base, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "aiagent",
      displayName: "客服一",
      password: "agent-pass-1",
      role: "agent",
      aiAllowed: true
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.user.aiAllowed, true);
  const agentId = created.data.user.id;
  const agentCookie = await login(base, "aiagent", "agent-pass-1");

  const aiSettings = await apiRequest(base, "/api/admin/ai", { cookie: adminCookie });
  assert.equal(aiSettings.response.status, 200);
  assert.equal(aiSettings.data.ai.configured, true);
  assert.equal(aiSettings.data.ai.hasApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(aiSettings.data.ai, "apiKey"), false);

  const connection = await apiRequest(base, "/api/admin/ai/test", {
    method: "POST",
    cookie: adminCookie
  });
  assert.equal(connection.response.status, 200);
  assert.equal(connection.data.test.reply, "OK");

  const first = await ingest(9001, 1, "你好，我想咨询");
  await new Promise(resolve => setTimeout(resolve, 30));
  const conversationId = first.conversation.id;
  const assigned = await apiRequest(base, `/api/conversations/${conversationId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { assigneeId: agentId }
  });
  assert.equal(assigned.response.status, 200);

  const before = await apiRequest(base, "/api/ai/preferences", { cookie: agentCookie });
  assert.equal(before.response.status, 200);
  assert.equal(before.data.ai.configured, true);
  assert.equal(before.data.ai.allowed, true);
  assert.equal(before.data.ai.enabled, false);
  assert.equal(before.data.ai.reason, "off");

  const enabled = await apiRequest(base, "/api/ai/preferences", {
    method: "PATCH",
    cookie: agentCookie,
    body: { enabled: true, mode: "auto" }
  });
  assert.equal(enabled.response.status, 200);
  assert.equal(enabled.data.ai.enabled, true);
  assert.equal(enabled.data.ai.mode, "auto");

  await ingest(9001, 2, "我想申请退款");
  await waitFor(() => mockTelegram.sent.length === 1);
  assert.equal(String(mockTelegram.sent[0].chat_id), "9001");
  assert.match(mockTelegram.sent[0].text, /退款/);

  const thread = await apiRequest(base, `/api/conversations/${conversationId}/messages`, {
    cookie: agentCookie
  });
  const inbound = thread.data.messages.find(message => message.direction === "in" && message.body === "我想申请退款");
  assert.equal(inbound.aiStatus, "replied");
  const outbound = thread.data.messages.find(message => message.direction === "out");
  assert.equal(outbound.senderName, "客服一");
  assert.equal(outbound.meta.via, "ai");
  assert.equal(outbound.meta.ai, true);

  const second = await ingest(9002, 3, "请问在吗");
  await new Promise(resolve => setTimeout(resolve, 30));
  const secondId = second.conversation.id;
  await apiRequest(base, `/api/conversations/${secondId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { assigneeId: agentId }
  });
  const suggestMode = await apiRequest(base, "/api/ai/preferences", {
    method: "PATCH",
    cookie: agentCookie,
    body: { enabled: true, mode: "suggest" }
  });
  assert.equal(suggestMode.response.status, 200);
  const sentBeforeSuggestion = mockTelegram.sent.length;
  await ingest(9002, 4, "退款需要多久");
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(mockTelegram.sent.length, sentBeforeSuggestion);
  const suggestion = await apiRequest(base, `/api/conversations/${secondId}/ai-suggestion`, {
    cookie: agentCookie
  });
  assert.equal(suggestion.response.status, 200);
  assert.ok(suggestion.data.suggestion);
  assert.match(suggestion.data.suggestion.body, /退款/);
  const used = await apiRequest(
    base,
    `/api/conversations/${secondId}/ai-suggestion/${suggestion.data.suggestion.id}`,
    { method: "PATCH", cookie: agentCookie, body: { status: "used" } }
  );
  assert.equal(used.response.status, 200);
  const emptySuggestion = await apiRequest(base, `/api/conversations/${secondId}/ai-suggestion`, {
    cookie: agentCookie
  });
  assert.equal(emptySuggestion.data.suggestion, null);

  const third = await ingest(9003, 5, "第一次咨询");
  await new Promise(resolve => setTimeout(resolve, 30));
  const thirdId = third.conversation.id;
  await apiRequest(base, `/api/conversations/${thirdId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { assigneeId: agentId }
  });
  await apiRequest(base, "/api/ai/preferences", {
    method: "PATCH",
    cookie: agentCookie,
    body: { enabled: true, mode: "first" }
  });
  const sentBeforeFirst = mockTelegram.sent.length;
  await ingest(9003, 6, "第一次咨询，请回复");
  await waitFor(() => mockTelegram.sent.length === sentBeforeFirst + 1);
  await ingest(9003, 7, "第二次咨询，不应自动回复");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mockTelegram.sent.length, sentBeforeFirst + 1);

  const deniedUser = await apiRequest(base, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "noai",
      displayName: "无 AI 客服",
      password: "agent-pass-2",
      role: "agent"
    }
  });
  assert.equal(deniedUser.response.status, 201);
  assert.equal(deniedUser.data.user.aiAllowed, false);
  const deniedCookie = await login(base, "noai", "agent-pass-2");
  const denied = await apiRequest(base, "/api/ai/preferences", {
    method: "PATCH",
    cookie: deniedCookie,
    body: { enabled: true, mode: "auto" }
  });
  assert.equal(denied.response.status, 403);

  assert.equal(isAfterHours(
    { workStart: "09:00", workEnd: "18:00", workTimezone: "Asia/Shanghai" },
    new Date("2026-01-01T00:00:00Z")
  ), true);
  assert.equal(isAfterHours(
    { workStart: "09:00", workEnd: "18:00", workTimezone: "Asia/Shanghai" },
    new Date("2026-01-01T02:00:00Z")
  ), false);
});

test("AI supports keyless OpenAI-compatible endpoints", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-keyless-test-"));
  const mockAI = await startMockAI({ requireKey: false });
  const config = {
    dataDir: tempDir,
    dbPath: path.join(tempDir, "test.db"),
    aiEnabled: true,
    aiApiKey: "",
    aiBaseUrl: mockAI.base,
    aiModel: "mock-model",
    aiDefaultMode: "auto",
    aiWorkStart: "09:00",
    aiWorkEnd: "18:00",
    aiWorkTimezone: "Asia/Shanghai",
    aiIncludeGroups: false,
    aiDelayMs: 5,
    aiTimeoutMs: 3000,
    aiMaxContext: 12
  };
  const db = openDatabase(config.dbPath);
  const ai = createAIService({ db, config, logger: createLogger("error") });

  t.after(async () => {
    ai.close();
    db.close();
    await new Promise(resolve => mockAI.server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const saved = ai.saveSettings({
    baseUrl: mockAI.base,
    apiKey: "",
    model: "mock-model",
    enabled: true
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.keyless, true);
  assert.equal(saved.hasApiKey, false);
  assert.equal(saved.source, "keyless");

  const result = await ai.testConnection();
  assert.equal(result.reply, "OK");
  assert.equal(mockAI.calls.length, 1);
  assert.equal(mockAI.authHeaders[0], null);
});

test("AI free endpoint helpers detect keyless hosts and retry delays", () => {
  assert.equal(isPublicKeylessEndpoint("https://text.pollinations.ai/openai"), true);
  assert.equal(isPublicKeylessEndpoint("https://example.com/v1"), false);
  assert.equal(isKeylessEndpoint("http://127.0.0.1:11434/v1"), true);
  assert.equal(isKeylessEndpoint("https://api.openai.com/v1"), false);

  const response = (headers = {}) => ({ headers: { get: name => headers[name] ?? null } });
  assert.equal(retryDelayMs(response({ "retry-after": "2" }), null), 2000);
  assert.equal(retryDelayMs(response(), { error: { message: "Retry after 45s" } }), 45000);
});
