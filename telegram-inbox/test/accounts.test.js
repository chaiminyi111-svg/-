const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { hashPassword } = require("../src/auth");
const { createLogger, nowIso } = require("../src/util");
const { createAccountsService } = require("../src/accounts");
const { listConversations, getConversationCounts } = require("../src/store");

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-test-"));
  const config = {
    root: path.resolve(__dirname, ".."),
    dataDir,
    dbPath: path.join(dataDir, "test.db"),
    accountsDir: path.join(dataDir, "accounts"),
    personalAccountsEnabled: true,
    whatsappWebEnabled: true,
    telegramUserEnabled: true,
    telegramUserApiId: 123,
    telegramUserApiHash: "test-hash",
    logLevel: "error"
  };
  const db = openDatabase(config.dbPath);
  bootstrapAdmin(db, config);
  const now = nowIso();
  const insertUser = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'agent', 1, ?, ?)`
  );
  insertUser.run("alice", "Alice", hashPassword("alice-pass-123"), now, now);
  insertUser.run("bob", "Bob", hashPassword("bob-pass-123"), now, now);
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  const alice = db.prepare("SELECT * FROM users WHERE username = 'alice'").get();
  const bob = db.prepare("SELECT * FROM users WHERE username = 'bob'").get();
  const logger = createLogger("error");
  return { dataDir, config, db, logger, admin, alice, bob };
}

function insertConversation(db, { chatId, channel = "telegram", accountId = null, assigneeId = null, title = "客户" }) {
  const now = nowIso();
  const result = db.prepare(
    `INSERT INTO conversations
       (telegram_chat_id, channel, account_id, chat_type, title, status, assignee_id,
        last_message_at, last_message_preview, last_message_direction, unread_count, created_at, updated_at)
     VALUES (?, ?, ?, 'private', ?, 'open', ?, ?, '你好', 'in', 0, ?, ?)`
  ).run(chatId, channel, accountId, title, assigneeId, now, now, now);
  return Number(result.lastInsertRowid);
}

test("personal accounts are scoped to the employee and support mode filtering", async t => {
  const ctx = setup();
  const accounts = createAccountsService({
    db: ctx.db,
    config: ctx.config,
    logger: ctx.logger
  });
  t.after(() => {
    ctx.db.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  const account = await accounts.ensureAccount(ctx.alice, "whatsapp_web", "Alice 的 WhatsApp");
  assert.equal(account.owner_id, ctx.alice.id);
  assert.equal(account.channel, "whatsapp_web");
  assert.match(account.session_path, /accounts[\\/]whatsapp_web[\\/]/);
  assert.ok(fs.existsSync(path.dirname(account.session_path)));

  const same = await accounts.ensureAccount(ctx.alice, "whatsapp_web", "Alice 的 WhatsApp");
  assert.equal(same.id, account.id);

  assert.equal(accounts.list(ctx.alice).length, 1);
  assert.equal(accounts.list(ctx.bob).length, 0);
  assert.equal(accounts.list(ctx.admin, { all: true }).length, 1);
  assert.equal(accounts.get(ctx.bob, account.id), null);

  const sharedId = insertConversation(ctx.db, { chatId: "bot:shared", assigneeId: ctx.alice.id });
  const personalId = insertConversation(ctx.db, {
    chatId: `waweb:${account.id}:8613800000000`,
    channel: "whatsapp_web",
    accountId: account.id,
    assigneeId: ctx.alice.id,
    title: "Alice 的客户"
  });

  const shared = listConversations(ctx.db, {
    mode: "shared", scope: "all", status: "all", userId: ctx.alice.id, isAdmin: false
  });
  assert.deepEqual(shared.items.map(item => item.id), [sharedId]);

  const personal = listConversations(ctx.db, {
    mode: "personal", scope: "all", status: "all", userId: ctx.alice.id, isAdmin: false
  });
  assert.deepEqual(personal.items.map(item => item.id), [personalId]);
  assert.equal(personal.items[0].accountId, account.id);
  assert.equal(personal.items[0].accountOwnerName, "Alice");

  const bobPersonal = listConversations(ctx.db, {
    mode: "personal", scope: "all", status: "all", userId: ctx.bob.id, isAdmin: false
  });
  assert.equal(bobPersonal.items.length, 0);

  const sharedCounts = getConversationCounts(ctx.db, {
    mode: "shared", userId: ctx.alice.id, isAdmin: false
  });
  assert.equal(sharedCounts.all, 1);
  const personalCounts = getConversationCounts(ctx.db, {
    mode: "personal", userId: ctx.alice.id, isAdmin: false
  });
  assert.equal(personalCounts.all, 1);
});

test("account login status and replies are delegated to the account service", async t => {
  const ctx = setup();
  const calls = [];
  const fakeService = {
    running: false,
    configured: false,
    status() {
      return {
        enabled: true,
        accountId: 1,
        ownerId: ctx.alice.id,
        configured: this.running,
        running: this.running,
        loginInProgress: !this.running,
        qr: this.qr || null,
        me: this.running ? { id: "8613800000000", name: "Alice 的手机" } : null,
        error: null
      };
    },
    async beginLogin() {
      calls.push("beginLogin");
      this.qr = "data:image/png;base64,QQ==";
      this.running = true;
      return this.status();
    },
    async sendReply(conversation, text, user) {
      calls.push(["sendReply", conversation.id, text, user.id]);
      return { message: { body: text }, conversation };
    },
    async logout() {
      calls.push("logout");
      this.running = false;
    },
    async start() {},
    async stop() {}
  };

  const accounts = createAccountsService({
    db: ctx.db,
    config: ctx.config,
    logger: ctx.logger,
    whatsappFactory: () => fakeService
  });
  t.after(() => {
    ctx.db.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  const row = await accounts.ensureAccount(ctx.alice, "whatsapp_web", "Alice");
  const before = accounts.get(ctx.alice, row.id);
  assert.equal(before.status.running, false);

  const after = await accounts.beginLogin(ctx.alice, row.id);
  assert.equal(after.status.running, true);
  assert.match(after.status.qr, /^data:image\/png/);
  assert.equal(after.displayName, "Alice 的手机");
  assert.deepEqual(calls, ["beginLogin"]);

  const conversation = { id: 42, account_id: row.id, telegram_chat_id: `waweb:${row.id}:8613800000000` };
  const result = await accounts.sendReply(conversation, "收到", ctx.alice, {});
  assert.equal(result.message.body, "收到");
  assert.deepEqual(calls[1], ["sendReply", 42, "收到", ctx.alice.id]);

  await accounts.logout(ctx.alice, row.id);
  assert.equal(accounts.get(ctx.alice, row.id).status.running, false);
  assert.deepEqual(calls.slice(2), ["logout"]);
});

test("deleting an account with conversations is rejected", async t => {
  const ctx = setup();
  const accounts = createAccountsService({ db: ctx.db, config: ctx.config, logger: ctx.logger });
  t.after(() => {
    ctx.db.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  const row = await accounts.ensureAccount(ctx.alice, "whatsapp_web", "Alice");
  insertConversation(ctx.db, {
    chatId: `waweb:${row.id}:8613800000000`,
    channel: "whatsapp_web",
    accountId: row.id,
    assigneeId: ctx.alice.id
  });

  await assert.rejects(
    () => accounts.remove(ctx.alice, row.id),
    error => error.code === "CONFLICT"
  );
  assert.ok(accounts.get(ctx.alice, row.id));
});
