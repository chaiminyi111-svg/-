const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase, bootstrapAdmin } = require("../src/db");
const { getConversationById } = require("../src/store");
const { createLogger } = require("../src/util");
const {
  contentOf,
  createWhatsAppWebService,
  isPrivateJid,
  jidNumber
} = require("../src/whatsapp-web");

function createFakeClient() {
  const handlers = new Map();
  const sent = [];
  const client = {
    user: { id: "me@s.whatsapp.net", name: "客服小号", phone: "8613900000000" },
    ev: {
      on(name, handler) {
        handlers.set(name, handler);
      }
    },
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return {
        key: { id: "OUT-" + sent.length },
        messageTimestamp: Math.floor(Date.now() / 1000)
      };
    },
    async end() {},
    async logout() {}
  };
  return { client, handlers, sent };
}

function createTestContext(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waweb-"));
  const db = openDatabase(path.join(dir, "inbox.db"));
  const config = {
    adminUsername: "admin",
    adminPassword: "Test-Pass-123",
    adminDisplayName: "管理员",
    autoAssign: false,
    agentMaxActive: 0,
    whatsappWebEnabled: options.enabled !== false,
    whatsappWebSessionPath: path.join(dir, "session")
  };
  bootstrapAdmin(db, config);
  const admin = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  const fake = createFakeClient();
  const events = [];
  const service = createWhatsAppWebService({
    db,
    config,
    logger: createLogger("error"),
    broadcaster: event => events.push(event),
    translate: null,
    clientFactory: async () => fake.client,
    authLoader: async () => ({ state: {}, saveCreds: async () => {} })
  });
  return {
    dir,
    db,
    config,
    admin,
    fake,
    events,
    service,
    cleanup() {
      try { db.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 60));
}

test("WhatsApp Web helpers parse private JIDs and message types", () => {
  assert.equal(isPrivateJid("8613800000000@s.whatsapp.net"), true);
  assert.equal(isPrivateJid("123456@lid"), true);
  assert.equal(isPrivateJid("120363000000000000@g.us"), false);
  assert.equal(isPrivateJid("status@broadcast"), false);
  assert.equal(jidNumber("8613800000000@s.whatsapp.net"), "8613800000000");
  assert.equal(contentOf({ message: { conversation: "你好" } }).body, "你好");
  assert.equal(contentOf({ message: { imageMessage: {} } }).body, "[图片]");
});

test("WhatsApp Web reuses a stored session when Baileys leaves registered false", async () => {
  const ctx = createTestContext();
  try {
    fs.mkdirSync(ctx.config.whatsappWebSessionPath, { recursive: true });
    fs.writeFileSync(
      path.join(ctx.config.whatsappWebSessionPath, "creds.json"),
      JSON.stringify({
        registered: false,
        me: { id: "8617350578910:2@s.whatsapp.net", name: "Ricky" }
      })
    );
    ctx.fake.client.user = { id: "8617350578910:2@s.whatsapp.net" };

    assert.equal(ctx.service.configured, true);
    await ctx.service.start();
    assert.equal(ctx.service.status().loginInProgress, true);

    ctx.fake.handlers.get("connection.update")({ connection: "open" });
    await flush();

    const connected = ctx.service.status();
    assert.equal(connected.running, true);
    assert.equal(connected.me.name, "Ricky");
    assert.equal(connected.me.phone, "8617350578910");
  } finally {
    ctx.cleanup();
  }
});

test("WhatsApp Web QR login, inbound text, outbound reply and logout", async () => {
  const ctx = createTestContext();
  try {
    const initial = await ctx.service.beginLogin();
    assert.equal(initial.enabled, true);
    assert.equal(initial.loginInProgress, true);

    const onConnection = ctx.fake.handlers.get("connection.update");
    assert.equal(typeof onConnection, "function");
    onConnection({ qr: "2@test-qr-payload" });
    await flush();
    const pending = ctx.service.status();
    assert.match(pending.qr, /^data:image\/png;base64,/);
    assert.equal(pending.running, false);

    onConnection({ connection: "open" });
    await flush();
    const connected = ctx.service.status();
    assert.equal(connected.running, true);
    assert.equal(connected.loginInProgress, false);
    assert.equal(connected.me.name, "客服小号");

    const inbound = {
      key: {
        remoteJid: "8613800000000@s.whatsapp.net",
        fromMe: false,
        id: "IN-1"
      },
      pushName: "张三",
      message: { conversation: "你好，想咨询一下" },
      messageTimestamp: Math.floor(Date.now() / 1000)
    };
    const result = await ctx.service.ingestMessage(inbound);
    assert.equal(result.changed, true);

    const conversation = ctx.db.prepare(
      "SELECT * FROM conversations WHERE telegram_chat_id = ?"
    ).get("waweb:8613800000000@s.whatsapp.net");
    assert.ok(conversation);
    assert.equal(conversation.channel, "whatsapp_web");
    assert.equal(conversation.chat_type, "private");
    assert.equal(conversation.title, "张三");
    assert.equal(conversation.unread_count, 1);

    const stored = ctx.db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? AND direction = 'in'"
    ).get(conversation.id);
    assert.equal(stored.body, "你好，想咨询一下");
    assert.equal(JSON.parse(stored.meta_json).via, "whatsapp_web");

    const duplicate = await ctx.service.ingestMessage(inbound);
    assert.equal(duplicate.duplicate, true);

    const reply = await ctx.service.sendReply(
      getConversationById(ctx.db, conversation.id),
      "你好，请说",
      ctx.admin,
      {}
    );
    assert.equal(reply.message.body, "你好，请说");
    assert.equal(ctx.fake.sent.length, 1);
    assert.equal(ctx.fake.sent[0].jid, "8613800000000@s.whatsapp.net");
    assert.deepEqual(ctx.fake.sent[0].content, { text: "你好，请说" });

    const outbound = ctx.db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? AND direction = 'out'"
    ).get(conversation.id);
    assert.equal(outbound.delivery_status, "sent");
    assert.ok(ctx.events.some(event => event.type === "message.created"));

    const updateHandler = ctx.fake.handlers.get("messages.update");
    assert.equal(typeof updateHandler, "function");
    const receiptKey = {
      remoteJid: "8613800000000@s.whatsapp.net",
      fromMe: true,
      id: outbound.telegram_message_id
    };
    updateHandler([{ key: receiptKey, update: { status: 3, messageTimestamp: Math.floor(Date.now() / 1000) } }]);
    await flush();
    assert.equal(
      ctx.db.prepare("SELECT delivery_status FROM messages WHERE id = ?").get(outbound.id).delivery_status,
      "delivered"
    );
    updateHandler([{ key: receiptKey, update: { status: 4, messageTimestamp: Math.floor(Date.now() / 1000) } }]);
    await flush();
    assert.equal(
      ctx.db.prepare("SELECT delivery_status FROM messages WHERE id = ?").get(outbound.id).delivery_status,
      "read"
    );
    assert.ok(ctx.events.some(event => event.type === "message.status"));

    const recalled = await ctx.service.deleteMessage(
      getConversationById(ctx.db, conversation.id),
      outbound
    );
    assert.equal(recalled.remote, true);
    assert.equal(ctx.fake.sent.at(-1).content.delete.id, outbound.telegram_message_id);

    fs.mkdirSync(ctx.config.whatsappWebSessionPath, { recursive: true });
    fs.writeFileSync(path.join(ctx.config.whatsappWebSessionPath, "creds.json"), "{}");
    const afterLogout = await ctx.service.logout();
    assert.equal(afterLogout.running, false);
    assert.equal(afterLogout.configured, false);
    assert.equal(fs.existsSync(ctx.config.whatsappWebSessionPath), false);
  } finally {
    ctx.cleanup();
  }
});

test("WhatsApp Web rejects login when the channel is disabled", async () => {
  const ctx = createTestContext({ enabled: false });
  try {
    await assert.rejects(
      () => ctx.service.beginLogin(),
      error => error.code === "NOT_CONFIGURED"
    );
    assert.equal(ctx.service.status().enabled, false);
  } finally {
    ctx.cleanup();
  }
});

test("WhatsApp Web ignores group, fromMe and broadcast messages", async () => {
  const ctx = createTestContext();
  try {
    await ctx.service.beginLogin();
    ctx.fake.handlers.get("connection.update")({ connection: "open" });
    await flush();

    const base = {
      message: { conversation: "hello" },
      messageTimestamp: Math.floor(Date.now() / 1000)
    };
    assert.equal(await ctx.service.ingestMessage({
      ...base,
      key: { remoteJid: "120363000000000000@g.us", fromMe: false, id: "G1" }
    }), null);
    assert.equal(await ctx.service.ingestMessage({
      ...base,
      key: { remoteJid: "8613800000000@s.whatsapp.net", fromMe: true, id: "M1" }
    }), null);
    assert.equal(await ctx.service.ingestMessage({
      ...base,
      key: { remoteJid: "status@broadcast", fromMe: false, id: "S1" }
    }), null);
    assert.equal(
      ctx.db.prepare("SELECT COUNT(*) AS c FROM conversations").get().c,
      0
    );
  } finally {
    ctx.cleanup();
  }
});
