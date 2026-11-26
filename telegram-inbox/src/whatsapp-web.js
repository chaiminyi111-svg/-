const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { withTransaction } = require("./db");
const { getConversationById } = require("./store");
const { autoAssignConversation } = require("./assignment");
const {
  messagePreview,
  nowIso,
  toConversationSummary,
  toPublicMessage
} = require("./util");

const CHANNEL = "whatsapp_web";
const RECONNECT_DELAY_MS = 5000;

function silentLogger() {
  const silent = {
    level: "silent",
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() { return silent; }
  };
  return silent;
}

let baileysPromise = null;

function loadBaileys() {
  if (!baileysPromise) baileysPromise = import("baileys");
  return baileysPromise;
}

class WhatsAppWebError extends Error {
  constructor(message, code = "WHATSAPP_WEB_ERROR") {
    super(message);
    this.name = "WhatsAppWebError";
    this.code = code;
  }
}

function readCreds(sessionPath) {
  try {
    const raw = fs.readFileSync(path.join(sessionPath, "creds.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRegistered(creds) {
  return Boolean(creds && creds.registered && creds.me && creds.me.id);
}

function secureSessionDirectory(directory) {
  try {
    fs.chmodSync(directory, 0o700);
  } catch {}
  let entries = [];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      const target = path.join(directory, entry);
      if (fs.statSync(target).isFile()) fs.chmodSync(target, 0o600);
    } catch {}
  }
}

function isPrivateJid(jid) {
  return typeof jid === "string" && (
    jid.endsWith("@s.whatsapp.net") ||
    jid.endsWith("@lid") ||
    jid.endsWith("@c.us")
  );
}

function jidNumber(jid) {
  return String(jid || "").split("@")[0].split(":")[0];
}

function timestampOf(message) {
  const raw = message?.messageTimestamp;
  const seconds = typeof raw === "object" && typeof raw?.toNumber === "function"
    ? raw.toNumber()
    : Number(raw);
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
  return new Date(value).toISOString();
}

function contentOf(message) {
  const payload = message?.message || {};
  const text = String(
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    payload.videoMessage?.caption ||
    payload.documentMessage?.caption ||
    payload.buttonsResponseMessage?.selectedButtonId ||
    payload.listResponseMessage?.title ||
    ""
  ).trim();
  if (text) return { type: "text", body: text, meta: {} };
  if (payload.imageMessage) return { type: "media", body: "[图片]", meta: { media: "image" } };
  if (payload.videoMessage) return { type: "media", body: "[视频]", meta: { media: "video" } };
  if (payload.audioMessage) return { type: "media", body: "[语音]", meta: { media: "audio" } };
  if (payload.documentMessage) return { type: "media", body: "[文件]", meta: { media: "document" } };
  if (payload.stickerMessage) return { type: "media", body: "[贴纸]", meta: { media: "sticker" } };
  if (payload.locationMessage || payload.liveLocationMessage) {
    return { type: "location", body: "[位置]", meta: {} };
  }
  if (payload.contactMessage || payload.contactsArrayMessage) {
    return { type: "contact", body: "[联系人]", meta: {} };
  }
  return { type: "unknown", body: "[暂不支持的消息类型]", meta: {} };
}

function publicMe(user) {
  if (!user) return null;
  return {
    id: user.id || "",
    name: user.name || user.verifiedName || "",
    phone: user.phone || ""
  };
}

function createWhatsAppWebService({
  db,
  config,
  logger,
  broadcaster,
  translate,
  hooks = {},
  clientFactory,
  authLoader,
  qrEncoder
}) {
  const enabled = Boolean(config.whatsappWebEnabled);
  const sessionPath = config.whatsappWebSessionPath;

  let socket = null;
  let connecting = false;
  let running = false;
  let loginInProgress = false;
  let qrDataUrl = null;
  let me = null;
  let lastError = null;
  let loggedOut = false;
  let stopping = false;
  let reconnectTimer = null;

  function emit(event) {
    if (typeof broadcaster === "function") broadcaster(event);
    else if (broadcaster && typeof broadcaster.broadcast === "function") broadcaster.broadcast(event);
  }

  function configuredNow() {
    return enabled && !loggedOut && isRegistered(readCreds(sessionPath));
  }

  async function encodeQr(value) {
    if (qrEncoder) return qrEncoder(value);
    return QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320
    });
  }

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnect();
    if (stopping || !configuredNow()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(error => {
        lastError = error?.message || String(error);
        logger?.warn("WhatsApp 个人号重连失败", lastError);
      });
    }, RECONNECT_DELAY_MS);
    reconnectTimer.unref?.();
  }

  function disconnectReason(update) {
    const error = update?.lastDisconnect?.error;
    return Number(
      error?.output?.statusCode ||
      error?.statusCode ||
      error?.data?.statusCode ||
      0
    );
  }

  async function handleConnectionUpdate(update) {
    if (!update) return;

    if (update.qr) {
      loginInProgress = true;
      running = false;
      lastError = null;
      try {
        const image = await encodeQr(update.qr);
        if (loginInProgress && !running) qrDataUrl = image;
      } catch (error) {
        lastError = "二维码生成失败：" + (error?.message || String(error));
        logger?.warn(lastError);
      }
      return;
    }

    if (update.connection === "open") {
      running = true;
      loginInProgress = false;
      qrDataUrl = null;
      loggedOut = false;
      lastError = null;
      me = publicMe(socket?.user);
      logger?.info(`WhatsApp 个人号：已连接${me?.name ? " " + me.name : ""}`);
      return;
    }

    if (update.connection === "close") {
      running = false;
      loginInProgress = false;
      qrDataUrl = null;
      socket = null;
      const code = disconnectReason(update);
      const reason = update?.lastDisconnect?.error?.message || "";
      const loggedOutNow = code === 401 || code === 403 || /logged out/i.test(reason);
      if (loggedOutNow) {
        loggedOut = true;
        lastError = "WhatsApp 登录已失效，请重新扫码";
        logger?.warn("WhatsApp 个人号：登录已失效");
      } else {
        lastError = reason || "WhatsApp 连接已断开";
        logger?.warn("WhatsApp 个人号连接关闭", lastError);
        scheduleReconnect();
      }
      me = null;
    }
  }

  async function handleMessagesUpsert(event) {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    for (const message of messages) {
      try {
        await ingestMessage(message);
      } catch (error) {
        logger?.warn("WhatsApp 个人号处理消息失败", error?.message || String(error));
      }
    }
  }

  async function connect() {
    if (!enabled) {
      throw new WhatsAppWebError("WhatsApp 个人号未启用，请设置 WHATSAPP_WEB_ENABLED=true", "NOT_CONFIGURED");
    }
    if (socket || connecting) return status();
    connecting = true;
    stopping = false;
    clearReconnect();

    try {
      fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
      secureSessionDirectory(sessionPath);

      let state;
      let saveCreds;
      if (authLoader) {
        ({ state, saveCreds } = await authLoader(sessionPath));
      } else {
        const baileys = await loadBaileys();
        ({ state, saveCreds } = await baileys.useMultiFileAuthState(sessionPath));
      }

      const saveCredentials = async () => {
        await saveCreds();
        secureSessionDirectory(sessionPath);
      };

      if (clientFactory) {
        socket = await clientFactory({ state, saveCreds: saveCredentials, sessionPath });
      } else {
        const baileys = await loadBaileys();
        socket = baileys.makeWASocket({
          auth: state,
          logger: silentLogger(),
          printQRInTerminal: false,
          markOnlineOnConnect: false,
          syncFullHistory: false
        });
      }

      if (!socket?.ev?.on) throw new Error("WhatsApp 客户端初始化失败");

      socket.ev.on("creds.update", () => {
        saveCredentials().catch(error => {
          logger?.warn("WhatsApp 个人号保存 session 失败", error?.message || String(error));
        });
      });
      socket.ev.on("connection.update", update => {
        handleConnectionUpdate(update).catch(error => {
          logger?.warn("WhatsApp 个人号连接事件处理失败", error?.message || String(error));
        });
      });
      socket.ev.on("messages.upsert", event => {
        handleMessagesUpsert(event).catch(error => {
          logger?.warn("WhatsApp 个人号消息事件处理失败", error?.message || String(error));
        });
      });

      loginInProgress = true;
      lastError = null;
      return status();
    } catch (error) {
      lastError = error?.message || String(error);
      socket = null;
      running = false;
      loginInProgress = false;
      qrDataUrl = null;
      throw error;
    } finally {
      connecting = false;
    }
  }

  async function start() {
    if (!enabled) return;
    if (!configuredNow()) {
      logger?.info("WhatsApp 个人号：未登录，等待管理员扫码");
      return;
    }
    await connect();
  }

  async function beginLogin() {
    if (!enabled) {
      throw new WhatsAppWebError("WhatsApp 个人号未启用，请设置 WHATSAPP_WEB_ENABLED=true", "NOT_CONFIGURED");
    }
    if (loggedOut) {
      try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      } catch {}
    }
    loggedOut = false;
    lastError = null;
    return connect();
  }

  async function logout() {
    stopping = true;
    clearReconnect();
    const current = socket;
    socket = null;
    running = false;
    loginInProgress = false;
    qrDataUrl = null;
    me = null;
    lastError = null;
    loggedOut = false;

    if (current) {
      try {
        await current.logout();
      } catch {}
      try {
        await current.end();
      } catch {}
    }

    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch {}
    return status();
  }

  async function stop() {
    stopping = true;
    clearReconnect();
    const current = socket;
    socket = null;
    running = false;
    loginInProgress = false;
    qrDataUrl = null;
    me = null;
    if (current) {
      try {
        await current.end();
      } catch {}
    }
  }

  async function ingestMessage(message) {
    if (!message?.key) return null;
    if (message.key.fromMe) return null;
    const jid = message.key.remoteJid;
    if (!isPrivateJid(jid)) return null;
    if (message.messageStubType) return null;

    const content = contentOf(message);
    if (content.type === "unknown" && !message.message) return null;

    const number = jidNumber(jid);
    const title = String(message.pushName || message.verifiedBizName || number || "WhatsApp 用户");
    const messageId = String(message.key.id || "");
    if (!messageId) return null;
    const createdAt = timestampOf(message);
    const chatKey = "waweb:" + jid;

    let translation = null;
    if (translate?.configured?.() && content.type === "text") {
      try {
        translation = await translate.translateInbound(content.body);
      } catch (error) {
        logger?.warn("WhatsApp 个人号入站翻译失败", error.message);
      }
    }

    const result = withTransaction(db, () => {
      let conversation = db.prepare(
        "SELECT * FROM conversations WHERE telegram_chat_id = ?"
      ).get(chatKey);
      let created = false;

      if (!conversation) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO conversations
             (telegram_chat_id, channel, chat_type, title, username, status, assignee_id,
              last_message_at, last_message_preview, last_message_direction,
              unread_count, created_at, updated_at)
           VALUES (?, ?, 'private', ?, NULL, 'open', NULL, ?, ?, 'in', 0, ?, ?)`
        ).run(
          chatKey,
          CHANNEL,
          title,
          createdAt,
          messagePreview(content.body),
          now,
          now
        );
        conversation = db.prepare(
          "SELECT * FROM conversations WHERE telegram_chat_id = ?"
        ).get(chatKey);
        autoAssignConversation(db, conversation.id, config);
        created = true;
      } else {
        db.prepare(
          `UPDATE conversations
           SET channel = ?, chat_type = 'private', title = ?, updated_at = ?
           WHERE id = ?`
        ).run(CHANNEL, title, nowIso(), conversation.id);
      }

      const meta = {
        via: "whatsapp_web",
        jid,
        number,
        messageId,
        senderJid: message.key.participant || jid,
        ...content.meta
      };
      const insert = db.prepare(
        `INSERT OR IGNORE INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, language, translated_body, translation_language, created_at)
         VALUES (?, ?, 'in', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        conversation.id,
        messageId,
        title,
        content.body,
        content.type,
        JSON.stringify(meta),
        translation?.language || null,
        translation?.translatedBody || null,
        translation?.translationLanguage || null,
        createdAt
      );

      const changed = Number(insert.changes) > 0;
      if (changed) {
        if (translation?.language) {
          db.prepare("UPDATE conversations SET detected_language = ? WHERE id = ?")
            .run(translation.language, conversation.id);
        }
        db.prepare(
          `UPDATE conversations
           SET last_message_at = ?,
               last_message_preview = ?,
               last_message_direction = 'in',
               unread_count = unread_count + 1,
               status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
               updated_at = ?
           WHERE id = ?`
        ).run(createdAt, messagePreview(content.body), nowIso(), conversation.id);
      }

      return { conversationId: conversation.id, created, changed };
    });

    if (!result.changed) return { ...result, duplicate: true };

    const conversationRow = getConversationById(db, result.conversationId);
    const messageRow = db.prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND telegram_message_id = ? AND direction = 'in'`
    ).get(result.conversationId, messageId);
    const payload = {
      type: "message.created",
      conversation: toConversationSummary(conversationRow),
      message: toPublicMessage(messageRow)
    };

    if (result.created) {
      emit({ type: "conversation.created", conversation: payload.conversation });
    }
    emit(payload);
    try {
      await hooks?.onInbound?.({
        conversation: payload.conversation,
        message: payload.message
      });
    } catch (error) {
      logger?.warn("WhatsApp 个人号入站后置处理失败", error.message);
    }
    return { ...result, conversation: payload.conversation, message: payload.message };
  }

  async function sendReply(conversation, text, user, options = {}) {
    if (!running || !socket) {
      throw new WhatsAppWebError(
        "WhatsApp 个人号未连接，请管理员在「渠道」中扫码登录",
        "NOT_CONFIGURED"
      );
    }

    const jid = String(conversation.telegram_chat_id || "").replace(/^waweb:/, "");
    if (!isPrivateJid(jid)) {
      throw new WhatsAppWebError("暂不支持向该 WhatsApp 会话发送消息", "INVALID_INPUT");
    }

    const prepared = translate?.prepareOutbound
      ? await translate.prepareOutbound(text, options.targetLanguage, conversation)
      : { text, language: null, meta: {} };
    const outboundText = prepared.text;
    const sent = await socket.sendMessage(jid, { text: outboundText });
    const messageId = String(sent?.key?.id || `waweb-out-${Date.now()}`);
    const createdAt = new Date(
      Number(sent?.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const now = nowIso();

    const rowId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, language, delivery_status, delivery_updated_at, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, 'text', ?, ?, 'sent', ?, ?)`
      ).run(
        conversation.id,
        messageId,
        user.id,
        user.displayName || user.display_name || user.username || "客服",
        outboundText,
        JSON.stringify({
          via: "whatsapp_web",
          jid,
          ...(options.meta || {}),
          ...prepared.meta
        }),
        prepared.language || null,
        now,
        createdAt
      );

      db.prepare(
        `UPDATE conversations
         SET last_message_at = ?,
             last_message_preview = ?,
             last_message_direction = 'out',
             first_response_at = COALESCE(first_response_at, ?),
             updated_at = ?
         WHERE id = ?`
      ).run(createdAt, messagePreview(outboundText), now, now, conversation.id);

      return Number(insert.lastInsertRowid);
    });

    const conversationRow = getConversationById(db, conversation.id);
    const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(rowId);
    const message = toPublicMessage(messageRow);
    const summary = toConversationSummary(conversationRow);
    emit({ type: "message.created", conversation: summary, message });
    return { message, conversation: summary };
  }

  function status() {
    return {
      enabled,
      configured: running || configuredNow(),
      running,
      loginInProgress,
      qr: loginInProgress ? qrDataUrl : null,
      me,
      error: lastError
    };
  }

  return {
    get configured() {
      return running || configuredNow();
    },
    get running() {
      return running;
    },
    start,
    stop,
    beginLogin,
    logout,
    sendReply,
    ingestMessage,
    status
  };
}

module.exports = {
  CHANNEL,
  WhatsAppWebError,
  contentOf,
  createWhatsAppWebService,
  isPrivateJid,
  jidNumber,
  readCreds,
  secureSessionDirectory
};
