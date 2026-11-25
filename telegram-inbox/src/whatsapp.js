const crypto = require("node:crypto");
const { withTransaction } = require("./db");
const { getConversationById } = require("./store");
const { messagePreview, nowIso, toConversationSummary, toPublicMessage } = require("./util");

class WhatsAppError extends Error {
  constructor(message, code = "WHATSAPP_ERROR") {
    super(message);
    this.name = "WhatsAppError";
    this.code = code;
  }
}

class WhatsAppClient {
  constructor({ token, phoneNumberId, apiBase }) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.apiBase = apiBase;
  }

  get configured() {
    return Boolean(this.token && this.phoneNumberId);
  }

  async sendText(to, text) {
    if (!this.configured) {
      throw new WhatsAppError("未配置 WhatsApp Cloud API 凭据", "NOT_CONFIGURED");
    }

    let response;
    try {
      response = await fetch(`${this.apiBase}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: text }
        }),
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new WhatsAppError("无法连接 WhatsApp Cloud API，请检查服务器网络", "NETWORK_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new WhatsAppError(`WhatsApp API 返回异常（HTTP ${response.status}）`, "BAD_RESPONSE");
    }
    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      throw new WhatsAppError(`WhatsApp API 错误：${String(detail).slice(0, 300)}`, "API_ERROR");
    }
    return data.messages?.[0] || null;
  }
}

function extractWhatsAppContent(message) {
  const type = message.type || "unknown";
  const payload = message[type] || {};

  if (type === "text") {
    return { type: "text", body: payload.body || "", meta: { via: "whatsapp" } };
  }
  if (type === "image") {
    return {
      type: "photo",
      body: payload.caption || "[图片]",
      meta: { via: "whatsapp", waMediaId: payload.id || null, mimeType: payload.mime_type || "image/jpeg", caption: payload.caption || "" }
    };
  }
  if (type === "document") {
    const fileName = payload.filename || "whatsapp-file";
    return {
      type: "document",
      body: payload.caption || `[文件] ${fileName}`,
      meta: {
        via: "whatsapp",
        waMediaId: payload.id || null,
        fileName,
        mimeType: payload.mime_type || "application/octet-stream",
        caption: payload.caption || ""
      }
    };
  }
  if (type === "audio") {
    return {
      type: "audio",
      body: "[语音]",
      meta: { via: "whatsapp", waMediaId: payload.id || null, mimeType: payload.mime_type || "audio/ogg" }
    };
  }
  if (type === "video") {
    return {
      type: "video",
      body: payload.caption || "[视频]",
      meta: { via: "whatsapp", waMediaId: payload.id || null, mimeType: payload.mime_type || "video/mp4" }
    };
  }
  if (type === "sticker") {
    return {
      type: "sticker",
      body: "[贴纸]",
      meta: { via: "whatsapp", waMediaId: payload.id || null, mimeType: payload.mime_type || "image/webp" }
    };
  }
  if (type === "location") {
    return {
      type: "location",
      body: `[位置] ${payload.latitude}, ${payload.longitude}`,
      meta: { via: "whatsapp", latitude: payload.latitude, longitude: payload.longitude }
    };
  }
  if (type === "contacts") {
    const contact = Array.isArray(payload) ? payload[0] : null;
    const name = contact?.name?.formatted_name || contact?.name?.first_name || "联系人";
    return { type: "contact", body: `[联系人] ${name}`, meta: { via: "whatsapp" } };
  }
  if (type === "button") {
    return { type: "text", body: payload.text || "[按钮回复]", meta: { via: "whatsapp" } };
  }
  if (type === "interactive") {
    const reply = payload.button_reply || payload.list_reply;
    return { type: "text", body: reply?.title || "[互动回复]", meta: { via: "whatsapp" } };
  }

  return { type: "unknown", body: "[WhatsApp 消息]", meta: { via: "whatsapp" } };
}

function createWhatsAppService({ db, config, logger, broadcaster }) {
  const client = new WhatsAppClient({
    token: config.whatsappToken,
    phoneNumberId: config.whatsappPhoneNumberId,
    apiBase: config.whatsappApiBase
  });

  function emit(event) {
    if (typeof broadcaster === "function") broadcaster(event);
    else if (broadcaster && typeof broadcaster.broadcast === "function") broadcaster.broadcast(event);
  }

  function ingestMessage(message, contact) {
    if (!message?.from || !message?.id) return null;

    const from = String(message.from);
    const externalId = "wa:" + from;
    const contactName = String(contact?.profile?.name || "").trim() || "+" + from;
    const content = extractWhatsAppContent(message);
    const createdAt = new Date(
      Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const waMessageId = "wa:" + String(message.id);

    const result = withTransaction(db, () => {
      let conversation = db.prepare(
        "SELECT * FROM conversations WHERE telegram_chat_id = ?"
      ).get(externalId);
      let created = false;

      if (!conversation) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO conversations
             (telegram_chat_id, channel, chat_type, title, username, status, assignee_id,
              last_message_at, last_message_preview, last_message_direction,
              unread_count, created_at, updated_at)
           VALUES (?, 'whatsapp', 'private', ?, NULL, 'open', NULL, ?, ?, 'in', 0, ?, ?)`
        ).run(externalId, contactName, createdAt, messagePreview(content.body), now, now);
        conversation = db.prepare(
          "SELECT * FROM conversations WHERE telegram_chat_id = ?"
        ).get(externalId);
        created = true;
      } else {
        db.prepare(
          `UPDATE conversations
           SET channel = 'whatsapp', title = ?, updated_at = ?
           WHERE id = ?`
        ).run(contactName, nowIso(), conversation.id);
      }

      const insert = db.prepare(
        `INSERT OR IGNORE INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, created_at)
         VALUES (?, ?, 'in', NULL, ?, ?, ?, ?, ?)`
      ).run(
        conversation.id,
        waMessageId,
        contactName,
        content.body,
        content.type,
        JSON.stringify(content.meta),
        createdAt
      );
      const changed = Number(insert.changes) > 0;

      if (changed) {
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
      "SELECT * FROM messages WHERE conversation_id = ? AND telegram_message_id = ? AND direction = 'in'"
    ).get(result.conversationId, waMessageId);
    const conversation = toConversationSummary(conversationRow);
    const publicMessage = toPublicMessage(messageRow);

    if (result.created) emit({ type: "conversation.created", conversation });
    emit({ type: "message.created", conversation, message: publicMessage });
    return { ...result, conversation, message: publicMessage };
  }

  function ingestWebhook(payload) {
    let count = 0;
    for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = change?.value;
        if (!value) continue;
        if (
          config.whatsappPhoneNumberId &&
          value.metadata?.phone_number_id &&
          String(value.metadata.phone_number_id) !== config.whatsappPhoneNumberId
        ) {
          continue;
        }
        const contacts = new Map(
          (Array.isArray(value.contacts) ? value.contacts : []).map(item => [String(item.wa_id), item])
        );
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          try {
            ingestMessage(message, contacts.get(String(message.from)));
            count += 1;
          } catch (error) {
            logger?.error("处理 WhatsApp 消息失败", error.message);
          }
        }
      }
    }
    return count;
  }

  async function sendReply(conversation, text, user) {
    if (!client.configured) {
      throw new WhatsAppError("未配置 WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID，暂时无法发送消息", "NOT_CONFIGURED");
    }
    const to = String(conversation.telegram_chat_id).replace(/^wa:/, "");
    const sent = await client.sendText(to, text);
    const waMessageId = "wa:" + String(sent?.id || crypto.randomUUID());
    const createdAt = nowIso();
    const now = nowIso();

    const messageId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, 'text', ?, ?)`
      ).run(
        conversation.id,
        waMessageId,
        user.id,
        user.displayName,
        text,
        JSON.stringify({ via: "whatsapp" }),
        createdAt
      );

      db.prepare(
        `UPDATE conversations
         SET last_message_at = ?,
             last_message_preview = ?,
             last_message_direction = 'out',
             updated_at = ?
         WHERE id = ?`
      ).run(createdAt, messagePreview(text), now, conversation.id);

      return Number(insert.lastInsertRowid);
    });

    const conversationRow = getConversationById(db, conversation.id);
    const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    const message = toPublicMessage(messageRow);
    const summary = toConversationSummary(conversationRow);
    emit({ type: "message.created", conversation: summary, message });
    return { message, conversation: summary };
  }

  function verifyWebhook(mode, token, challenge) {
    if (mode !== "subscribe" || !config.whatsappVerifyToken) return null;
    if (String(token || "") !== config.whatsappVerifyToken) return null;
    return String(challenge || "");
  }

  function verifySignature(rawBody, signature) {
    if (!config.whatsappAppSecret) return false;
    if (!rawBody || !signature) return false;
    const expected = "sha256=" + crypto
      .createHmac("sha256", config.whatsappAppSecret)
      .update(rawBody)
      .digest("hex");
    const left = Buffer.from(expected);
    const right = Buffer.from(String(signature));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  return {
    client,
    configured: client.configured,
    ingestWebhook,
    ingestMessage,
    sendReply,
    verifyWebhook,
    verifySignature
  };
}

module.exports = {
  WhatsAppClient,
  WhatsAppError,
  createWhatsAppService,
  extractWhatsAppContent
};
