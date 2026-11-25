const path = require("node:path");
const { getSetting, setSetting, withTransaction } = require("./db");
const { getConversationById } = require("./store");
const {
  displayNameFromTelegram,
  messagePreview,
  nowIso,
  safeJsonParse,
  sha256,
  sleep,
  toConversationSummary,
  toPublicMessage
} = require("./util");

class TelegramError extends Error {
  constructor(message, code = "TELEGRAM_ERROR", retryAfter = 0) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

class TelegramClient {
  constructor({ token, apiBase, logger }) {
    this.token = token;
    this.apiBase = apiBase;
    this.logger = logger;
  }

  get configured() {
    return Boolean(this.token);
  }

  async request(method, payload, options = {}) {
    if (!this.configured) throw new TelegramError("未配置 Telegram Bot Token", "NOT_CONFIGURED");

    const timeoutMs = options.timeoutMs || 30000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response;
    try {
      response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload || {}),
        signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new TelegramError("无法连接 Telegram API，请检查服务器网络", "NETWORK_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new TelegramError(`Telegram API 返回异常（HTTP ${response.status}）`, "BAD_RESPONSE");
    }

    if (!response.ok || !data.ok) {
      const description = String(data.description || `HTTP ${response.status}`).slice(0, 300);
      throw new TelegramError(
        `Telegram API 错误：${description}`,
        "API_ERROR",
        Number(data.parameters?.retry_after || 0)
      );
    }

    return data.result;
  }

  async requestMultipart(method, formData, options = {}) {
    if (!this.configured) throw new TelegramError("未配置 Telegram Bot Token", "NOT_CONFIGURED");

    const timeoutMs = options.timeoutMs || 60000;
    let response;
    try {
      response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new TelegramError("无法连接 Telegram API，请检查服务器网络", "NETWORK_ERROR");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new TelegramError(`Telegram API 返回异常（HTTP ${response.status}）`, "BAD_RESPONSE");
    }
    if (!response.ok || !data.ok) {
      const description = String(data.description || `HTTP ${response.status}`).slice(0, 300);
      throw new TelegramError(
        `Telegram API 错误：${description}`,
        "API_ERROR",
        Number(data.parameters?.retry_after || 0)
      );
    }
    return data.result;
  }

  getMe(options = {}) {
    return this.request("getMe", {}, options);
  }

  getUpdates(offset, timeout, signal) {
    return this.request(
      "getUpdates",
      {
        offset,
        timeout,
        allowed_updates: ["message", "edited_message"]
      },
      { signal, timeoutMs: (timeout + 15) * 1000 }
    );
  }

  sendMessage(chatId, text) {
    return this.request("sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true }
    });
  }

  sendMedia(chatId, buffer, fileName, mimeType, caption) {
    const asPhoto = /^image\/(jpeg|png|webp)$/i.test(mimeType);
    const method = asPhoto ? "sendPhoto" : "sendDocument";
    const field = asPhoto ? "photo" : "document";
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(field, new Blob([buffer], { type: mimeType || "application/octet-stream" }), fileName);
    if (caption) form.append("caption", caption);
    return this.requestMultipart(method, form);
  }

  getFile(fileId) {
    return this.request("getFile", { file_id: fileId });
  }

  async downloadFile(filePath) {
    const url = `${this.apiBase}/file/bot${this.token}/${String(filePath).replace(/^\/+/, "")}`;
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch {
      throw new TelegramError("下载 Telegram 文件失败", "NETWORK_ERROR");
    }
    if (!response.ok) {
      throw new TelegramError(`下载 Telegram 文件失败（HTTP ${response.status}）`, "FILE_ERROR");
    }
    return response;
  }

  deleteWebhook() {
    return this.request("deleteWebhook", { drop_pending_updates: false });
  }
}

function chatTitle(chat, from) {
  if (chat.title) return chat.title;
  const name = displayNameFromTelegram(from || chat);
  if (name) return name;
  if (chat.username) return "@" + chat.username;
  return String(chat.id);
}

function extractContent(message) {
  if (message.text) {
    return { type: "text", body: message.text, meta: {} };
  }

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    return {
      type: "photo",
      body: message.caption || "[图片]",
      meta: {
        fileId: photo.file_id,
        width: photo.width,
        height: photo.height,
        fileSize: photo.file_size || 0,
        caption: message.caption || ""
      }
    };
  }

  if (message.document) {
    return {
      type: "document",
      body: message.caption || `[文件] ${message.document.file_name || ""}`.trim(),
      meta: {
        fileId: message.document.file_id,
        fileName: message.document.file_name || "telegram-file",
        mimeType: message.document.mime_type || "application/octet-stream",
        fileSize: message.document.file_size || 0,
        caption: message.caption || ""
      }
    };
  }

  if (message.voice) {
    return {
      type: "voice",
      body: message.caption || "[语音]",
      meta: {
        fileId: message.voice.file_id,
        mimeType: message.voice.mime_type || "audio/ogg",
        fileSize: message.voice.file_size || 0,
        duration: message.voice.duration || 0
      }
    };
  }

  if (message.audio) {
    return {
      type: "audio",
      body: message.caption || `[音频] ${message.audio.title || message.audio.file_name || ""}`.trim(),
      meta: {
        fileId: message.audio.file_id,
        fileName: message.audio.file_name || "telegram-audio",
        mimeType: message.audio.mime_type || "audio/mpeg",
        fileSize: message.audio.file_size || 0,
        duration: message.audio.duration || 0
      }
    };
  }

  if (message.video) {
    return {
      type: "video",
      body: message.caption || "[视频]",
      meta: {
        fileId: message.video.file_id,
        fileName: message.video.file_name || "telegram-video.mp4",
        mimeType: message.video.mime_type || "video/mp4",
        fileSize: message.video.file_size || 0,
        duration: message.video.duration || 0,
        width: message.video.width || 0,
        height: message.video.height || 0
      }
    };
  }

  if (message.video_note) {
    return {
      type: "video_note",
      body: "[视频消息]",
      meta: {
        fileId: message.video_note.file_id,
        mimeType: "video/mp4",
        fileSize: message.video_note.file_size || 0,
        duration: message.video_note.duration || 0
      }
    };
  }

  if (message.sticker) {
    return {
      type: "sticker",
      body: message.sticker.emoji || "[贴纸]",
      meta: {
        fileId: message.sticker.file_id,
        emoji: message.sticker.emoji || "",
        mimeType: message.sticker.is_animated ? "application/x-tgsticker" : "image/webp"
      }
    };
  }

  if (message.location) {
    return {
      type: "location",
      body: `[位置] ${message.location.latitude}, ${message.location.longitude}`,
      meta: { latitude: message.location.latitude, longitude: message.location.longitude }
    };
  }

  if (message.contact) {
    return {
      type: "contact",
      body: `[联系人] ${[message.contact.first_name, message.contact.last_name].filter(Boolean).join(" ")} ${message.contact.phone_number || ""}`.trim(),
      meta: {
        phoneNumber: message.contact.phone_number || "",
        userId: message.contact.user_id || null
      }
    };
  }

  if (message.poll) {
    return {
      type: "poll",
      body: `[投票] ${message.poll.question || ""}`.trim(),
      meta: { question: message.poll.question || "" }
    };
  }

  return { type: "unknown", body: "[暂不支持的消息类型]", meta: {} };
}

function createTelegramService({ db, config, logger, broadcaster }) {
  const storedToken = getSetting(db, "telegram_bot_token", null);
  const initialToken = storedToken !== null ? storedToken : config.telegramToken;
  const client = new TelegramClient({
    token: initialToken,
    apiBase: config.telegramApiBase,
    logger
  });

  let tokenSource = storedToken !== null
    ? "database"
    : (config.telegramToken ? "environment" : "none");
  let tokenKey = client.configured
    ? "telegram_offset_" + sha256(client.token).slice(0, 16)
    : "telegram_offset_disabled";
  let offset = Number(getSetting(db, tokenKey, "0")) || 0;
  let running = false;
  let loopPromise = null;
  let abortController = null;
  let updateQueue = Promise.resolve();

  function emit(event) {
    if (typeof broadcaster === "function") broadcaster(event);
    else if (broadcaster && typeof broadcaster.broadcast === "function") broadcaster.broadcast(event);
  }

  async function ingestUpdate(update) {
    const message = update?.message || update?.edited_message;
    if (!message || !message.chat) return null;
    if (message.from?.is_bot) return null;
    if (!["private", "group", "supergroup", "channel"].includes(message.chat.type)) return null;

    const chatId = String(message.chat.id);
    const from = message.from || message.chat;
    const content = extractContent(message);
    const title = chatTitle(message.chat, from);
    const username = message.chat.username ||
      (message.chat.type === "private" ? from.username : null) ||
      null;
    const createdAt = new Date(
      Number(message.date || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const isEdited = Boolean(update.edited_message);

    const result = withTransaction(db, () => {
      let conversation = db.prepare(
        "SELECT * FROM conversations WHERE telegram_chat_id = ?"
      ).get(chatId);
      let created = false;

      if (!conversation) {
        const now = nowIso();
        db.prepare(
          `INSERT INTO conversations
             (telegram_chat_id, channel, chat_type, title, username, status, assignee_id,
              last_message_at, last_message_preview, last_message_direction,
              unread_count, created_at, updated_at)
           VALUES (?, 'telegram', ?, ?, ?, 'open', NULL, ?, ?, 'in', 0, ?, ?)`
        ).run(
          chatId,
          message.chat.type,
          title,
          username,
          createdAt,
          messagePreview(content.body),
          now,
          now
        );
        conversation = db.prepare(
          "SELECT * FROM conversations WHERE telegram_chat_id = ?"
        ).get(chatId);
        created = true;
      } else {
        db.prepare(
          `UPDATE conversations
           SET channel = 'telegram', chat_type = ?, title = ?, username = ?, updated_at = ?
           WHERE id = ?`
        ).run(message.chat.type, title, username, nowIso(), conversation.id);
      }

      const insert = db.prepare(
        `INSERT OR IGNORE INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, created_at)
         VALUES (?, ?, 'in', NULL, ?, ?, ?, ?, ?)`
      ).run(
        conversation.id,
        String(message.message_id),
        displayNameFromTelegram(from),
        content.body,
        content.type,
        JSON.stringify(content.meta),
        createdAt
      );

      let changed = Number(insert.changes) > 0;
      if (!changed && isEdited) {
        const updateResult = db.prepare(
          `UPDATE messages
           SET body = ?, message_type = ?, meta_json = ?
           WHERE conversation_id = ? AND telegram_message_id = ? AND direction = 'in'`
        ).run(
          content.body,
          content.type,
          JSON.stringify(content.meta),
          conversation.id,
          String(message.message_id)
        );
        changed = Number(updateResult.changes) > 0;
      }

      if (changed) {
        if (isEdited) {
          db.prepare(
            `UPDATE conversations
             SET last_message_preview = ?, updated_at = ?
             WHERE id = ?`
          ).run(messagePreview(content.body), nowIso(), conversation.id);
        } else {
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
      }

      return { conversationId: conversation.id, created, changed, isEdited };
    });

    if (!result.changed) return { ...result, duplicate: true };

    const conversationRow = getConversationById(db, result.conversationId);
    const messageRow = db.prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND telegram_message_id = ? AND direction = 'in'`
    ).get(result.conversationId, String(message.message_id));

    const payload = {
      type: result.isEdited ? "message.updated" : "message.created",
      conversation: toConversationSummary(conversationRow),
      message: toPublicMessage(messageRow)
    };

    if (result.created) {
      emit({
        type: "conversation.created",
        conversation: payload.conversation
      });
    }
    emit(payload);
    return { ...result, conversation: payload.conversation, message: payload.message };
  }

  async function sendReply(conversation, text, user) {
    if (!client.configured) {
      throw new TelegramError("未配置 TELEGRAM_BOT_TOKEN，暂时无法发送消息", "NOT_CONFIGURED");
    }

    const sent = await client.sendMessage(conversation.telegram_chat_id, text);
    const createdAt = new Date(
      Number(sent.date || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const now = nowIso();

    const messageId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, 'text', ?, ?)`
      ).run(
        conversation.id,
        String(sent.message_id),
        user.id,
        user.displayName,
        text,
        JSON.stringify({ via: "bot" }),
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

  async function sendMedia(conversation, file, user) {
    if (!client.configured) {
      throw new TelegramError("未配置 TELEGRAM_BOT_TOKEN，暂时无法发送附件", "NOT_CONFIGURED");
    }

    const sent = await client.sendMedia(
      conversation.telegram_chat_id,
      file.buffer,
      file.fileName,
      file.mimeType,
      file.caption
    );
    const isPhoto = Array.isArray(sent.photo) && sent.photo.length > 0;
    const sentFile = isPhoto ? sent.photo[sent.photo.length - 1] : sent.document;
    const messageType = isPhoto ? "photo" : "document";
    const body = file.caption || (isPhoto ? "[图片]" : `[文件] ${file.fileName}`);
    const createdAt = new Date(
      Number(sent.date || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const now = nowIso();
    const meta = {
      via: "bot",
      fileId: sentFile?.file_id || null,
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.buffer.length,
      caption: file.caption || ""
    };

    const messageId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?)`
      ).run(
        conversation.id,
        String(sent.message_id),
        user.id,
        user.displayName,
        body,
        messageType,
        JSON.stringify(meta),
        createdAt
      );

      db.prepare(
        `UPDATE conversations
         SET last_message_at = ?,
             last_message_preview = ?,
             last_message_direction = 'out',
             updated_at = ?
         WHERE id = ?`
      ).run(createdAt, messagePreview(body), now, conversation.id);

      return Number(insert.lastInsertRowid);
    });

    const conversationRow = getConversationById(db, conversation.id);
    const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    const message = toPublicMessage(messageRow);
    const summary = toConversationSummary(conversationRow);
    emit({ type: "message.created", conversation: summary, message });
    return { message, conversation: summary };
  }

  async function getMedia(messageRow) {
    const meta = safeJsonParse(messageRow.meta_json, {});
    if (!meta.fileId) return null;

    const file = await client.getFile(meta.fileId);
    if (!file?.file_path) return null;
    const response = await client.downloadFile(file.file_path);
    const fallbackName = path.basename(file.file_path);
    return {
      response,
      fileName: meta.fileName || fallbackName,
      mimeType: meta.mimeType || response.headers.get("content-type") || "application/octet-stream"
    };
  }

  async function pollLoop() {
    while (running) {
      try {
        const updates = await client.getUpdates(
          offset,
          config.telegramPollTimeout,
          abortController.signal
        );

        for (const update of Array.isArray(updates) ? updates : []) {
          if (!running) break;
          try {
            await ingestUpdate(update);
          } catch (error) {
            logger.error("处理 Telegram 消息失败", error.message);
          }
          const nextOffset = Number(update.update_id);
          if (Number.isFinite(nextOffset)) {
            offset = Math.max(offset, nextOffset + 1);
            setSetting(db, tokenKey, offset);
          }
        }
      } catch (error) {
        if (!running || error.name === "AbortError") break;
        if (error.code === "API_ERROR" && error.retryAfter > 0) {
          logger.warn(`Telegram 限流，${error.retryAfter} 秒后重试`);
          await sleep(error.retryAfter * 1000);
        } else {
          logger.warn("Telegram 轮询失败，3 秒后重试", error.message);
          await sleep(3000);
        }
      }
    }
  }

  async function start() {
    if (!client.configured) {
      logger.warn("未配置 TELEGRAM_BOT_TOKEN，Telegram 接收消息已禁用");
      return false;
    }
    if (running) return true;

    if (config.telegramDeleteWebhook) {
      try {
        await client.deleteWebhook();
        logger.info("已删除 Telegram webhook，改用长轮询");
      } catch (error) {
        logger.warn("删除 Telegram webhook 失败", error.message);
      }
    }

    running = true;
    abortController = new AbortController();
    loopPromise = pollLoop();
    logger.info("Telegram 长轮询已启动");
    return true;
  }

  async function stop() {
    running = false;
    if (abortController) abortController.abort();
    if (loopPromise) {
      try {
        await loopPromise;
      } catch {}
    }
    loopPromise = null;
    abortController = null;
  }

  function normalizeBotInfo(info) {
    if (!info || info.id === undefined || info.id === null) return null;
    return {
      id: String(info.id),
      username: info.username ? String(info.username) : "",
      firstName: info.first_name ? String(info.first_name) : ""
    };
  }

  async function validateToken(nextToken) {
    const token = String(nextToken || "").trim();
    if (!token) throw new TelegramError("请输入 Telegram Bot Token", "NOT_CONFIGURED");
    if (token.length > 200) throw new TelegramError("Telegram Bot Token 过长", "INVALID_TOKEN");

    const probe = new TelegramClient({
      token,
      apiBase: config.telegramApiBase,
      logger
    });
    const info = normalizeBotInfo(await probe.getMe());
    if (!info) throw new TelegramError("Telegram 未返回有效的机器人信息", "BAD_RESPONSE");
    return info;
  }

  async function getBotInfo() {
    if (!client.configured) return null;
    return normalizeBotInfo(await client.getMe({ timeoutMs: 10000 }));
  }

  function updateToken(nextToken) {
    const task = updateQueue.then(async () => {
      const token = String(nextToken || "").trim();
      await stop();
      client.token = token;
      tokenSource = token ? "database" : "none";
      setSetting(db, "telegram_bot_token", token);
      tokenKey = token
        ? "telegram_offset_" + sha256(token).slice(0, 16)
        : "telegram_offset_disabled";
      offset = Number(getSetting(db, tokenKey, "0")) || 0;

      if (!token) {
        logger.info("Telegram Bot Token 已清除，接收消息已停用");
        return { configured: false, running: false };
      }

      try {
        await client.deleteWebhook();
        logger.info("已删除 Telegram webhook，改用长轮询");
      } catch (error) {
        logger.warn("删除 Telegram webhook 失败", error.message);
      }

      const started = await start();
      return { configured: client.configured, running: started };
    });
    updateQueue = task.catch(() => {});
    return task;
  }

  return {
    client,
    get configured() { return client.configured; },
    get tokenSource() { return tokenSource; },
    get running() { return running; },
    validateToken,
    getBotInfo,
    updateToken,
    start,
    stop,
    ingestUpdate,
    sendReply,
    sendMedia,
    getMedia
  };
}

module.exports = {
  TelegramClient,
  TelegramError,
  createTelegramService,
  extractContent,
  chatTitle
};
