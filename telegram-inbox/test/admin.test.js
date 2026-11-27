const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { createApp } = require("../src/app");
const { createLogger } = require("../src/util");
const { totpCode } = require("../src/security");

function apiRequest(base, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.cookie) headers.cookie = options.cookie;
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
    return { response, data, text };
  });
}

async function login(base, username, password, totp) {
  const { response, data } = await apiRequest(base, "/api/auth/login", {
    method: "POST",
    body: { username, password, totpCode: totp || "" }
  });
  const cookies = response.headers.getSetCookie();
  return { response, data, cookie: cookies[0]?.split(";")[0] || "" };
}

test("admin console, audit, backup and security APIs", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-inbox-admin-test-"));
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
    sessionDays: 7,
    trustProxy: false,
    cookieSecure: false,
    publicOrigin: "",
    logLevel: "error"
  };
  const logger = createLogger("error");
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  const app = createApp({ db, config, logger });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const adminLogin = await login(base, "admin", "admin-pass-123");
  assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.data));
  const adminCookie = adminLogin.cookie;

  const agentCreated = await apiRequest(base, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username: "agent1", displayName: "客服一", password: "agent-pass-1", role: "agent" }
  });
  assert.equal(agentCreated.response.status, 201, JSON.stringify(agentCreated.data));
  const agentId = agentCreated.data.user.id;
  const agentLogin = await login(base, "agent1", "agent-pass-1");
  const agentCookie = agentLogin.cookie;

  const viewerCreated = await apiRequest(base, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username: "viewer1", displayName: "统计员", password: "viewer-pass-1", role: "viewer" }
  });
  assert.equal(viewerCreated.response.status, 201, JSON.stringify(viewerCreated.data));
  const viewerCookie = (await login(base, "viewer1", "viewer-pass-1")).cookie;

  const now = new Date().toISOString();
  const old = "2020-01-01T00:00:00.000Z";
  const insertConversation = db.prepare(
    `INSERT INTO conversations
       (telegram_chat_id, channel, title, username, status, assignee_id, assigned_at,
        last_message_at, created_at, updated_at)
     VALUES (?, 'telegram', ?, ?, 'open', ?, ?, ?, ?, ?)`
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (conversation_id, direction, sender_name, body, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const firstConversation = Number(insertConversation.run(
    "admin-daily-1", "客户甲", "customer_a", agentId, now, now, now, now
  ).lastInsertRowid);
  for (let index = 0; index < 4; index += 1) {
    insertMessage.run(firstConversation, index % 2 ? "out" : "in", "客服一", `消息 ${index}`, now);
  }
  const duplicateForAgent = Number(insertConversation.run(
    "admin-daily-2", "客户乙", "customer_shared", agentId, now, now, now, now
  ).lastInsertRowid);
  insertMessage.run(duplicateForAgent, "in", "客户乙", "你好", now);
  const oneSided = Number(insertConversation.run(
    "admin-daily-4", "客户丙", "customer_one_sided", agentId, now, now, now, now
  ).lastInsertRowid);
  for (let index = 0; index < 4; index += 1) {
    insertMessage.run(oneSided, "in", "客户丙", `只发不收 ${index}`, now);
  }
  const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  insertConversation.run(
    "admin-daily-3", "客户乙", "customer_shared", adminId, now, now, now, now
  );
  insertConversation.run(
    "admin-old-1", "旧客户", "old_customer", null, old, old, old, old
  );
  insertMessage.run(duplicateForAgent, "in", "旧客户", "旧消息", old);

  await t.test("admin system status includes service, database and channel state", async () => {
    const { response, data } = await apiRequest(base, "/api/admin/system", { cookie: adminCookie });
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.system.nodeVersion, process.version);
    assert.ok(data.system.uptimeSeconds >= 0);
    assert.ok(data.system.database.size > 0);
    assert.equal(typeof data.system.accounts.total, "number");
  });

  await t.test("non-admin cannot use admin endpoints", async () => {
    const agentResult = await apiRequest(base, "/api/admin/system", { cookie: agentCookie });
    assert.equal(agentResult.response.status, 403);
    const viewerResult = await apiRequest(base, "/api/admin/audit", { cookie: viewerCookie });
    assert.equal(viewerResult.response.status, 403);
  });

  await t.test("all authenticated users can read daily team stats and duplicate contacts", async () => {
    const result = await apiRequest(base, "/api/stats/team-daily?days=1", { cookie: viewerCookie });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.stats.rangeDays, 1);
    const agent = result.data.stats.totals.find(item => item.id === agentId);
    assert.equal(agent.newContacts, 3);
    assert.equal(agent.effectiveContacts, 3);
    assert.equal(result.data.stats.team.totalEffectiveContacts, 3);
    assert.ok(result.data.stats.duplicates.some(item =>
      item.contact === "@customer_shared" && item.employeeIds.includes(agentId)
    ));
  });

  await t.test("agent stats are scoped to their own conversations", async () => {
    const stats = await apiRequest(base, "/api/stats?days=1", { cookie: agentCookie });
    assert.equal(stats.response.status, 200, JSON.stringify(stats.data));
    assert.equal(stats.data.stats.agents.length, 1);
    assert.equal(stats.data.stats.agents[0].id, agentId);
    assert.equal(stats.data.stats.totals.conversations, 3);
    assert.equal(stats.data.stats.totals.unassigned, 0);

    const team = await apiRequest(base, "/api/stats/team-daily?days=1", { cookie: agentCookie });
    assert.equal(team.response.status, 200, JSON.stringify(team.data));
    assert.equal(team.data.stats.users.length, 1);
    assert.equal(team.data.stats.users[0].id, agentId);
    assert.equal(team.data.stats.team.totalEmployees, 1);
    assert.equal(team.data.stats.team.totalNewContacts, 3);
    assert.equal(team.data.stats.duplicates.length, 0);

    const users = await apiRequest(base, "/api/users", { cookie: agentCookie });
    assert.equal(users.response.status, 403);

    const adminStats = await apiRequest(base, "/api/stats?days=1", { cookie: adminCookie });
    assert.equal(adminStats.data.stats.agents.length, 2);
    const adminTeam = await apiRequest(base, "/api/stats/team-daily?days=1", { cookie: adminCookie });
    assert.equal(adminTeam.data.stats.users.length, 2);
  });

  await t.test("messages can be recalled or deleted and are hidden from the inbox", async () => {
    const outbound = Number(db.prepare(
      `INSERT INTO messages
         (conversation_id, direction, sender_id, sender_name, body, created_at)
       VALUES (?, 'out', ?, '管理员', '这条可以撤回', ?)`
    ).run(firstConversation, adminId, now).lastInsertRowid);
    const inbound = Number(db.prepare(
      `INSERT INTO messages
         (conversation_id, direction, sender_name, body, created_at)
       VALUES (?, 'in', '客户甲', '这条可以删除', ?)`
    ).run(firstConversation, now).lastInsertRowid);

    const before = await apiRequest(base, `/api/conversations/${firstConversation}/messages`, {
      cookie: adminCookie
    });
    assert.ok(before.data.messages.some(item => item.id === outbound));

    const forbidden = await apiRequest(base, `/api/messages/${outbound}`, {
      method: "DELETE",
      cookie: agentCookie,
      body: { remote: false }
    });
    assert.equal(forbidden.response.status, 403, JSON.stringify(forbidden.data));
    const hidden = await apiRequest(base, `/api/messages/${outbound}`, {
      method: "DELETE",
      cookie: viewerCookie,
      body: { remote: false }
    });
    assert.equal(hidden.response.status, 403, JSON.stringify(hidden.data));

    const recalled = await apiRequest(base, `/api/messages/${outbound}`, {
      method: "DELETE",
      cookie: adminCookie,
      body: { remote: true }
    });
    assert.equal(recalled.response.status, 200, JSON.stringify(recalled.data));
    assert.equal(recalled.data.remote, false);
    assert.ok(recalled.data.warning);
    assert.ok(db.prepare("SELECT deleted_at FROM messages WHERE id = ?").get(outbound).deleted_at);

    const deleted = await apiRequest(base, `/api/messages/${inbound}`, {
      method: "DELETE",
      cookie: adminCookie,
      body: { remote: true }
    });
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.data));

    const after = await apiRequest(base, `/api/conversations/${firstConversation}/messages`, {
      cookie: adminCookie
    });
    assert.ok(!after.data.messages.some(item => item.id === outbound));
    assert.ok(!after.data.messages.some(item => item.id === inbound));

    const again = await apiRequest(base, `/api/messages/${outbound}`, {
      method: "DELETE",
      cookie: adminCookie,
      body: {}
    });
    assert.equal(again.response.status, 409);

    const statsAfter = await apiRequest(base, "/api/stats?days=1", { cookie: adminCookie });
    assert.equal(statsAfter.data.stats.totals.messagesOut, 2);

    const audit = await apiRequest(base, "/api/admin/audit?limit=200", { cookie: adminCookie });
    const actions = new Set(audit.data.audit.items.map(item => item.action));
    assert.ok(actions.has("message.recalled"));
    assert.ok(actions.has("message.deleted"));
  });

  await t.test("admin can force an employee offline", async () => {
    const result = await apiRequest(base, `/api/users/${agentId}/logout`, {
      method: "POST",
      cookie: adminCookie
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const me = await apiRequest(base, "/api/auth/me", { cookie: agentCookie });
    assert.equal(me.response.status, 401);
  });

  await t.test("admin can create and download a backup and export conversations", async () => {
    const created = await apiRequest(base, "/api/admin/backups", {
      method: "POST",
      cookie: adminCookie
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    assert.match(created.data.backup.name, /^inbox-\d{8}-\d{6}-\d{3}\.db$/);

    const listed = await apiRequest(base, "/api/admin/backups", { cookie: adminCookie });
    assert.equal(listed.response.status, 200);
    assert.ok(listed.data.backups.some(item => item.name === created.data.backup.name));

    const download = await fetch(
      base + `/api/admin/backups/${encodeURIComponent(created.data.backup.name)}/download`,
      { headers: { cookie: adminCookie } }
    );
    assert.equal(download.status, 200);
    assert.ok((await download.arrayBuffer()).byteLength > 0);

    const csv = await apiRequest(base, "/api/admin/export/conversations.csv", { cookie: adminCookie });
    assert.equal(csv.response.status, 200);
    assert.match(csv.text, /会话ID/);
    assert.match(csv.text, /customer_shared/);
  });

  await t.test("admin can preview and clean old messages", async () => {
    const preview = await apiRequest(base, "/api/admin/data/cleanup", {
      method: "POST",
      cookie: adminCookie,
      body: { days: 30, dryRun: true }
    });
    assert.equal(preview.response.status, 200, JSON.stringify(preview.data));
    assert.ok(preview.data.cleanup.wouldDelete >= 1);
    assert.equal(preview.data.cleanup.deleted, 0);

    const actual = await apiRequest(base, "/api/admin/data/cleanup", {
      method: "POST",
      cookie: adminCookie,
      body: { days: 30, dryRun: false, confirm: "CLEANUP" }
    });
    assert.equal(actual.response.status, 200, JSON.stringify(actual.data));
    assert.ok(actual.data.cleanup.deleted >= 1);
  });

  await t.test("admin IP allowlist accepts the current IP and rejects a lockout", async () => {
    const current = await apiRequest(base, "/api/admin/security", { cookie: adminCookie });
    assert.equal(current.response.status, 200, JSON.stringify(current.data));
    const currentIp = current.data.security.currentIp;

    const saved = await apiRequest(base, "/api/admin/security/ip-allowlist", {
      method: "POST",
      cookie: adminCookie,
      body: { allowlist: currentIp }
    });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.data));

    const allowed = await apiRequest(base, "/api/admin/system", { cookie: adminCookie });
    assert.equal(allowed.response.status, 200);

    const lockout = await apiRequest(base, "/api/admin/security/ip-allowlist", {
      method: "POST",
      cookie: adminCookie,
      body: { allowlist: "192.0.2.1" }
    });
    assert.equal(lockout.response.status, 400, JSON.stringify(lockout.data));

    const cleared = await apiRequest(base, "/api/admin/security/ip-allowlist", {
      method: "POST",
      cookie: adminCookie,
      body: { allowlist: "" }
    });
    assert.equal(cleared.response.status, 200, JSON.stringify(cleared.data));
  });

  await t.test("admin can enable, require and disable TOTP", async () => {
    const setup = await apiRequest(base, "/api/admin/security/totp/setup", {
      method: "POST",
      cookie: adminCookie,
      body: {}
    });
    assert.equal(setup.response.status, 200, JSON.stringify(setup.data));
    const secret = setup.data.secret;
    assert.ok(secret);

    const enabled = await apiRequest(base, "/api/admin/security/totp/enable", {
      method: "POST",
      cookie: adminCookie,
      body: { code: totpCode(secret) }
    });
    assert.equal(enabled.response.status, 200, JSON.stringify(enabled.data));

    const withoutCode = await login(base, "admin", "admin-pass-123");
    assert.equal(withoutCode.response.status, 401);
    assert.equal(withoutCode.data.totpRequired, true);

    const withCode = await login(base, "admin", "admin-pass-123", totpCode(secret));
    assert.equal(withCode.response.status, 200, JSON.stringify(withCode.data));

    const disabled = await apiRequest(base, "/api/admin/security/totp/disable", {
      method: "POST",
      cookie: adminCookie,
      body: { password: "admin-pass-123", code: totpCode(secret) }
    });
    assert.equal(disabled.response.status, 200, JSON.stringify(disabled.data));

    const afterDisable = await login(base, "admin", "admin-pass-123");
    assert.equal(afterDisable.response.status, 200, JSON.stringify(afterDisable.data));
  });

  await t.test("audit log records admin and data operations", async () => {
    const { response, data } = await apiRequest(base, "/api/admin/audit?limit=200", {
      cookie: adminCookie
    });
    assert.equal(response.status, 200, JSON.stringify(data));
    const actions = new Set(data.audit.items.map(item => item.action));
    for (const action of [
      "auth.login",
      "user.created",
      "user.force_logout",
      "data.backup_created",
      "data.conversations_exported",
      "data.messages_cleaned",
      "security.ip_allowlist_updated",
      "security.totp_enabled"
    ]) {
      assert.ok(actions.has(action), `missing audit action ${action}`);
    }
  });
});
