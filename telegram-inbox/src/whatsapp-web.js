const crypto = require("node:crypto");
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
const INBOUND_MEDIA_TIMEOUT_MS = 15000;
const MAX_INBOUND_MEDIA_BYTES = 20 * 1024 * 1024;

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
  // Baileys can leave creds.registered false after a successful QR pairing.
  // A stored identity is the reliable signal that the session can be reused.
  return Boolean(creds && creds.me && creds.me.id);
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

function mediaKind(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}

function mediaExtension(fileName, mimeType) {
  const fromName = path.extname(String(fileName || "")).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const type = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "application/pdf": ".pdf"
  }[type] || ".bin";
}

function withTimeout(task, ms, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function timestampOf(message) {
  const raw = message?.messageTimestamp;
  const seconds = typeof raw === "object" && typeof raw?.toNumber === "function"
    ? raw.toNumber()
    : Number(raw);
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
  return new Date(value).toISOString();
}

function unwrapMessageContent(payload) {
  let current = payload;
  for (let depth = 0; depth < 6; depth += 1) {
    const next = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || {};
}

function contentOf(message) {
  const payload = unwrapMessageContent(message?.message || {});
  const media = payload.imageMessage
    ? { type: "photo", value: payload.imageMessage, media: "image", mimeType: "image/jpeg", placeholder: "[图片]" }
    : payload.videoMessage
      ? { type: "video", value: payload.videoMessage, media: "video", mimeType: "video/mp4", placeholder: "[视频]" }
      : payload.audioMessage
        ? { type: "audio", value: payload.audioMessage, media: "audio", mimeType: "audio/ogg", placeholder: "[语音]" }
        : payload.documentMessage
          ? { type: "document", value: payload.documentMessage, media: "document", mimeType: "application/octet-stream", placeholder: "[文件]" }
          : payload.stickerMessage
            ? { type: "sticker", value: payload.stickerMessage, media: "sticker", mimeType: "image/webp", placeholder: "[贴纸]" }
            : null;

  if (media) {
    const caption = String(media.value.caption || "").trim();
    const fileName = String(media.value.fileName || "").trim();
    const placeholder = media.type === "document" && fileName ? `[文件] ${fileName}` : media.placeholder;
    const rawLength = media.value.fileLength;
    const fileLength = typeof rawLength === "object" && typeof rawLength?.toNumber === "function"
      ? rawLength.toNumber()
      : Number(rawLength);
    return {
      type: media.type,
      body: caption || placeholder,
      meta: {
        media: media.media,
        mimeType: media.value.mimetype || media.mimeType,
        fileName: fileName || null,
        fileLength: Number.isFinite(fileLength) && fileLength > 0 ? fileLength : null,
        ...(media.type === "audio" ? { ptt: Boolean(media.value.ptt) } : {})
      }
    };
  }

  const text = String(
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.buttonsResponseMessage?.selectedButtonId ||
    payload.listResponseMessage?.title ||
    ""
  ).trim();
  if (text) return { type: "text", body: text, meta: {} };
  if (payload.locationMessage || payload.liveLocationMessage) {
    return { type: "location", body: "[位置]", meta: {} };
  }
  if (payload.contactMessage || payload.contactsArrayMessage) {
    return { type: "contact", body: "[联系人]", meta: {} };
  }
  return { type: "unknown", body: "[暂不支持的消息类型]", meta: {} };
}

function publicMe(user, fallback) {
  const source = user || {};
  const stored = fallback || {};
  const id = source.id || stored.id || "";
  return {
    id,
    name: source.name || source.verifiedName || stored.name || stored.verifiedName || "",
    phone: source.phone || stored.phone || jidNumber(id)
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
  qrEncoder,
  mediaDownloader = null,
  account = null
}) {
  const enabled = Boolean(config.whatsappWebEnabled);
  const accountId = account?.id || null;
  const ownerId = account?.owner_id ?? account?.ownerId ?? null;
  const sessionPath = account?.session_path || account?.sessionPath || config.whatsappWebSessionPath;
  const scopeLabel = account?.label ? `WhatsApp 个人号（${account.label}）` : "WhatsApp 个人号";

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
      me = publicMe(socket?.user, readCreds(sessionPath)?.me);
      logger?.info(`${scopeLabel}：已连接${me?.name ? " " + me.name : ""}`);
      return;
    }

    if (update.connection === "close") {
      running = false;
      loginInProgress = false;
      qrDataUrl = null;
      socket = null;
      me = null;
      if (stopping) {
        lastError = null;
        return;
      }
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

  const DELIVERY_RANK = { sent: 1, delivered: 2, read: 4 };

  function deliveryStatusFromUpdate(status) {
    const value = Number(status);
    if (value >= 4) return "read";
    if (value >= 2) return "delivered";
    return null;
  }

  function updateDeliveryStatus(key, update) {
    if (!key?.fromMe || !key.id) return false;
    const next = deliveryStatusFromUpdate(update?.status);
    if (!next) return false;
    const row = db.prepare(
      "SELECT * FROM messages WHERE telegram_message_id = ? AND direction = 'out'"
    ).get(String(key.id));
    if (!row) return false;
    if ((DELIVERY_RANK[row.delivery_status] || 0) >= DELIVERY_RANK[next]) return false;
    const timestamp = Number(update?.messageTimestamp)
      ? new Date(Number(update.messageTimestamp) * 1000).toISOString()
      : nowIso();
    db.prepare(
      "UPDATE messages SET delivery_status = ?, delivery_updated_at = ? WHERE id = ?"
    ).run(next, timestamp, row.id);
    const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(row.id);
    const conversationRow = getConversationById(db, row.conversation_id);
    emit({
      type: "message.status",
      conversation: toConversationSummary(conversationRow),
      message: toPublicMessage(updated)
    });
    return true;
  }

  async function handleMessagesUpdate(event) {
    const updates = Array.isArray(event) ? event : Array.isArray(event?.updates) ? event.updates : [];
    for (const item of updates) {
      try {
        updateDeliveryStatus(item?.key, item?.update || {});
      } catch (error) {
        logger?.warn("WhatsApp 个人号更新回执失败", error?.message || String(error));
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
      socket.ev.on("messages.update", event => {
        handleMessagesUpdate(event).catch(error => {
          logger?.warn("WhatsApp 个人号回执事件处理失败", error?.message || String(error));
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
    const chatKey = accountId ? `waweb:${accountId}:${jid}` : "waweb:" + jid;

    let translation = null;
    if (translate?.configured?.() && content.type === "text") {
      try {
        translation = await translate.translateInbound(content.body);
      } catch (error) {
        logger?.warn("WhatsApp 个人号入站翻译失败", error.message);
      }
    }

    const storedMedia = await downloadInboundMedia(message, content);

    const result = withTransaction(db, () => {
      let conversation = db.prepare(
        "SELECT * FROM conversations WHERE telegram_chat_id = ?"
      ).get(chatKey);
      let created = false;

      if (!conversation) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO conversations
             (telegram_chat_id, channel, account_id, chat_type, title, username, status,
              assignee_id, assigned_at, last_message_at, last_message_preview, last_message_direction,
              unread_count, created_at, updated_at)
           VALUES (?, ?, ?, 'private', ?, NULL, 'open', ?, ?, ?, ?, 'in', 0, ?, ?)`
        ).run(
          chatKey,
          CHANNEL,
          accountId,
          title,
          ownerId,
          ownerId ? now : null,
          createdAt,
          messagePreview(content.body),
          now,
          now
        );
        conversation = db.prepare(
          "SELECT * FROM conversations WHERE telegram_chat_id = ?"
        ).get(chatKey);
        if (!accountId) autoAssignConversation(db, conversation.id, config);
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
        ...content.meta,
        ...(storedMedia ? {
          localFile: storedMedia.localFile,
          fileName: storedMedia.fileName || content.meta.fileName,
          mimeType: storedMedia.mimeType,
          fileSize: storedMedia.fileSize
        } : {})
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

    const rawChatId = String(conversation.telegram_chat_id || "");
    const jid = (accountId ? rawChatId.replace(`waweb:${accountId}:`, "") : rawChatId.replace(/^waweb:/, ""));
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

  function saveMediaFile(subdir, buffer, fileName, mimeType) {
    const dir = path.join(config.dataDir, subdir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const localFile = `${Date.now()}-${crypto.randomUUID()}${mediaExtension(fileName, mimeType)}`;
    const fullPath = path.join(dir, localFile);
    fs.writeFileSync(fullPath, buffer, { mode: 0o600 });
    return { localFile, fullPath, fileName, mimeType, fileSize: buffer.length };
  }

  function saveOutboundMedia(file) {
    return saveMediaFile("outbound-media", file.buffer, file.fileName, file.mimeType);
  }

  async function downloadInboundMedia(message, content) {
    if (!content?.meta?.media) return null;
    let buffer;
    try {
      if (mediaDownloader) {
        buffer = await withTimeout(
          () => mediaDownloader(message),
          INBOUND_MEDIA_TIMEOUT_MS,
          "WhatsApp 媒体下载超时"
        );
      } else {
        const baileys = await loadBaileys();
        if (typeof baileys.downloadMediaMessage !== "function") return null;
        const context = socket?.updateMediaMessage
          ? { logger: silentLogger(), reuploadRequest: socket.updateMediaMessage.bind(socket) }
          : undefined;
        buffer = await withTimeout(
          () => baileys.downloadMediaMessage(message, "buffer", {}, context),
          INBOUND_MEDIA_TIMEOUT_MS,
          "WhatsApp 媒体下载超时"
        );
      }
    } catch (error) {
      logger?.warn("WhatsApp 个人号下载媒体失败", error.message);
      return null;
    }

    if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
    if (buffer.length > MAX_INBOUND_MEDIA_BYTES) {
      logger?.warn(`WhatsApp 个人号媒体超过 ${MAX_INBOUND_MEDIA_BYTES} 字节，已跳过下载`);
      return null;
    }
    const mimeType = content.meta.mimeType || "application/octet-stream";
    const fileName = content.meta.fileName ||
      `inbound-${Date.now()}${mediaExtension("", mimeType)}`;
    return saveMediaFile("inbound-media", buffer, fileName, mimeType);
  }

  async function sendMedia(conversation, file, user, options = {}) {
    if (!running || !socket) {
      throw new WhatsAppWebError(
        "WhatsApp 个人号未连接，请管理员在「渠道」中扫码登录",
        "NOT_CONFIGURED"
      );
    }

    const rawChatId = String(conversation.telegram_chat_id || "");
    const jid = (accountId ? rawChatId.replace(`waweb:${accountId}:`, "") : rawChatId.replace(/^waweb:/, ""));
    if (!isPrivateJid(jid)) {
      throw new WhatsAppWebError("暂不支持向该 WhatsApp 会话发送附件", "INVALID_INPUT");
    }
    if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) {
      throw new WhatsAppWebError("附件内容为空", "INVALID_INPUT");
    }

    const mimeType = (String(file.mimeType || "application/octet-stream").replace(/[\r\n]/g, "").trim() ||
      "application/octet-stream").slice(0, 120);
    const fileName = (String(file.fileName || "file").replace(/[\r\n]/g, " ").trim() || "file").slice(0, 180);
    const caption = String(file.caption || "").trim().slice(0, 1024);
    const kind = mediaKind(mimeType);
    const stored = saveOutboundMedia({ buffer: file.buffer, fileName, mimeType });

    const content = kind === "image"
      ? { image: file.buffer, mimetype: mimeType }
      : kind === "video"
        ? { video: file.buffer, mimetype: mimeType }
        : kind === "audio"
          ? { audio: file.buffer, mimetype: mimeType, ptt: false }
          : { document: file.buffer, fileName, mimetype: mimeType };
    if (caption) content.caption = caption;

    let sent;
    try {
      sent = await socket.sendMessage(jid, content);
    } catch (error) {
      try { fs.rmSync(stored.fullPath, { force: true }); } catch {}
      throw error;
    }

    const messageId = String(sent?.key?.id || `waweb-out-${Date.now()}`);
    const createdAt = timestampOf(sent);
    const now = nowIso();
    const messageType = kind === "image" ? "photo"
      : kind === "video" ? "video"
        : kind === "audio" ? "audio" : "document";
    const body = caption || (kind === "document" ? `[文件] ${fileName}` : `[${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}]`);
    const meta = {
      via: "whatsapp_web",
      jid,
      media: kind,
      fileName,
      mimeType,
      fileSize: file.buffer.length,
      caption,
      localFile: stored.localFile,
      ...(options.meta || {})
    };

    const rowId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, delivery_status, delivery_updated_at, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, ?, ?, 'sent', ?, ?)`
      ).run(
        conversation.id,
        messageId,
        user.id,
        user.displayName || user.display_name || user.username || "客服",
        body,
        messageType,
        JSON.stringify(meta),
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
      ).run(createdAt, messagePreview(body), now, now, conversation.id);

      return Number(insert.lastInsertRowid);
    });

    const conversationRow = getConversationById(db, conversation.id);
    const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(rowId);
    const message = toPublicMessage(messageRow);
    const summary = toConversationSummary(conversationRow);
    emit({ type: "message.created", conversation: summary, message });
    return { message, conversation: summary };
  }

  async function deleteMessage(conversation, message) {
    if (!running || !socket) {
      throw new WhatsAppWebError(
        "WhatsApp 个人号未连接，请管理员在「渠道」中扫码登录",
        "NOT_CONFIGURED"
      );
    }
    const rawChatId = String(conversation.telegram_chat_id || "");
    const jid = (accountId ? rawChatId.replace(`waweb:${accountId}:`, "") : rawChatId.replace(/^waweb:/, ""));
    if (!isPrivateJid(jid)) {
      throw new WhatsAppWebError("暂不支持撤回该 WhatsApp 会话的消息", "INVALID_INPUT");
    }
    if (!message?.telegram_message_id) {
      throw new WhatsAppWebError("这条消息缺少 WhatsApp 消息 ID，无法撤回", "INVALID_INPUT");
    }
    await socket.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: message.direction === "out",
        id: String(message.telegram_message_id)
      }
    });
    return { remote: true };
  }

  function status() {
    return {
      enabled,
      accountId,
      ownerId,
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
    sendMedia,
    deleteMessage,
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
