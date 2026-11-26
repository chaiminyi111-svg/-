const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const bigInt = require("big-integer");
const { Api, TelegramClient } = require("teleproto");
const { StoreSession } = require("teleproto/sessions");
const { NewMessage } = require("teleproto/events");
const { withTransaction } = require("./db");
const { getConversationById } = require("./store");
const { autoAssignConversation } = require("./assignment");
const {
  messagePreview,
  nowIso,
  safeJsonParse,
  toConversationSummary,
  toPublicMessage
} = require("./util");

const CHANNEL = "telegram_user";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

class TelegramUserError extends Error {
  constructor(message, code = "TELEGRAM_USER_ERROR") {
    super(message);
    this.name = "TelegramUserError";
    this.code = code;
  }
}

function sessionExists(sessionPath) {
  try {
    return Boolean(sessionPath) && fs.existsSync(sessionPath);
  } catch {
    return false;
  }
}

function userIdOf(message, event) {
  const peer = message?.peerId;
  const value = event?.chatId ??
    peer?.userId ??
    peer?.chatId ??
    peer?.channelId ??
    message?.chatId ??
    message?.senderId;
  return value === undefined || value === null ? "" : String(value);
}

function displayName(user, fallback) {
  if (!user) return fallback;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return "@" + user.username;
  return fallback;
}

function contentOf(message) {
  const text = typeof message?.message === "string" ? message.message.trim() : "";
  if (text) return { type: "text", body: text, meta: {} };
  if (message?.media) {
    return { type: "media", body: "[非文本消息]", meta: { media: true } };
  }
  return { type: "unknown", body: "[暂不支持的消息类型]", meta: {} };
}

function timestampOf(message) {
  const seconds = Number(message?.date);
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
  return new Date(value).toISOString();
}

function publicMe(user) {
  if (!user) return null;
  return {
    id: user.id ? String(user.id) : "",
    username: user.username || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || ""
  };
}

function latestSenderAccessHash(db, conversationId) {
  const row = db.prepare(
    `SELECT meta_json FROM messages
     WHERE conversation_id = ? AND direction = 'in'
     ORDER BY id DESC LIMIT 1`
  ).get(conversationId);
  const meta = safeJsonParse(row?.meta_json, {});
  return meta.senderAccessHash ? String(meta.senderAccessHash) : "";
}

function createTelegramUserService({
  db,
  config,
  logger,
  broadcaster,
  translate,
  hooks = {},
  clientFactory,
  sessionFactory,
  qrEncoder,
  account = null
}) {
  const enabled = Boolean(config.telegramUserEnabled);
  const apiId = Number(config.telegramUserApiId) || 0;
  const apiHash = String(config.telegramUserApiHash || "").trim();
  const accountId = account?.id || null;
  const ownerId = account?.owner_id ?? account?.ownerId ?? null;
  const sessionPath = account?.session_path || account?.sessionPath || config.telegramUserSessionPath;
  const scopeLabel = account?.label ? `Telegram 个人号（${account.label}）` : "Telegram 个人号";

  let client = null;
  let running = false;
  let loginInProgress = false;
  let qrDataUrl = null;
  let me = null;
  let lastError = null;
  let passwordRequired = false;
  let passwordHint = "";
  let passwordDeferred = null;
  let abortController = null;
  let loginTimer = null;
  let loginPromise = null;
  let eventBuilder = null;
  let eventHandler = null;

  function emit(event) {
    if (typeof broadcaster === "function") broadcaster(event);
    else if (broadcaster && typeof broadcaster.broadcast === "function") broadcaster.broadcast(event);
  }

  function configuredNow() {
    return enabled && apiId > 0 && Boolean(apiHash) && sessionExists(sessionPath);
  }

  function makeClient() {
    if (clientFactory) return clientFactory({ apiId, apiHash, sessionPath });
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
    const session = sessionFactory
      ? sessionFactory({ sessionPath })
      : new StoreSession(sessionPath);
    return new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      autoReconnect: true
    });
  }

  async function encodeQr(value) {
    if (qrEncoder) return qrEncoder(value);
    return QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320
    });
  }

  async function resolveEntity(conversation) {
    const raw = String(conversation.telegram_chat_id || "");
    const peerId = accountId
      ? raw.replace(`mtproto:${accountId}:`, "")
      : raw.replace(/^mtproto:/, "");
    const accessHash = latestSenderAccessHash(db, conversation.id);
    if (peerId && accessHash) {
      return new Api.InputPeerUser({
        userId: bigInt(peerId),
        accessHash: bigInt(accessHash)
      });
    }
    return client.getInputEntity(peerId);
  }

  function attachHandlers() {
    eventBuilder = new NewMessage({ incoming: true });
    eventHandler = event => {
      ingestMessage(event).catch(error => {
        logger?.warn(`${scopeLabel}处理消息失败`, error.message);
      });
    };
    client.addEventHandler(eventHandler, eventBuilder);
  }

  async function ingestMessage(event) {
    const message = event?.message || event;
    if (!message || message.out) return null;
    if (event?.isPrivate === false) return null;
    if (!event?.isPrivate && !message.isPrivate) return null;

    const peerId = userIdOf(message, event);
    if (!peerId) return null;

    let sender = message.sender || null;
    if (!sender && typeof message.getSender === "function") {
      sender = await message.getSender().catch(() => null);
    }
    const content = contentOf(message);
    let translation = null;
    if (translate?.configured?.() && content.type === "text") {
      try {
        translation = await translate.translateInbound(content.body);
      } catch (error) {
        logger?.warn(`${scopeLabel}入站翻译失败`, error.message);
      }
    }

    const chatKey = accountId ? `mtproto:${accountId}:${peerId}` : "mtproto:" + peerId;
    const title = displayName(sender, "@" + peerId);
    const username = sender?.username || null;
    const createdAt = timestampOf(message);
    const messageId = String(message.id ?? "");
    if (!messageId) return null;

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
           VALUES (?, ?, ?, 'private', ?, ?, 'open', ?, ?, ?, ?, 'in', 0, ?, ?)`
        ).run(
          chatKey,
          CHANNEL,
          accountId,
          title,
          username,
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
           SET channel = ?, chat_type = 'private', title = ?, username = ?, updated_at = ?
           WHERE id = ?`
        ).run(CHANNEL, title, username, nowIso(), conversation.id);
      }

      const meta = {
        via: "mtproto",
        peerId,
        senderId: sender?.id ? String(sender.id) : peerId,
        senderAccessHash: sender?.accessHash ? String(sender.accessHash) : "",
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
        displayName(sender, "@" + peerId),
        content.body,
        content.type,
        JSON.stringify(meta),
        translation?.language || null,
        translation?.translatedBody || null,
        translation?.translationLanguage || null,
        createdAt
      );

      let changed = Number(insert.changes) > 0;
      const isEdited = Boolean(message.editDate);
      if (!changed && isEdited) {
        const updateResult = db.prepare(
          `UPDATE messages
           SET body = ?, message_type = ?, meta_json = ?,
               language = ?, translated_body = ?, translation_language = ?
           WHERE conversation_id = ? AND telegram_message_id = ? AND direction = 'in'`
        ).run(
          content.body,
          content.type,
          JSON.stringify(meta),
          translation?.language || null,
          translation?.translatedBody || null,
          translation?.translationLanguage || null,
          conversation.id,
          messageId
        );
        changed = Number(updateResult.changes) > 0;
      }

      if (changed) {
        if (translation?.language) {
          db.prepare("UPDATE conversations SET detected_language = ? WHERE id = ?")
            .run(translation.language, conversation.id);
        }
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
    ).get(result.conversationId, messageId);
    const payload = {
      type: result.isEdited ? "message.updated" : "message.created",
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
        message: payload.message,
        isEdited: result.isEdited
      });
    } catch (error) {
      logger?.warn(`${scopeLabel}入站后置处理失败`, error.message);
    }
    return { ...result, conversation: payload.conversation, message: payload.message };
  }

  async function sendReply(conversation, text, user, options = {}) {
    if (!running || !client) {
      throw new TelegramUserError(
        "Telegram 个人号未登录，请先扫码登录",
        "NOT_CONFIGURED"
      );
    }

    const prepared = translate?.prepareOutbound
      ? await translate.prepareOutbound(text, options.targetLanguage, conversation)
      : { text, language: null, meta: {} };
    const outboundText = prepared.text;
    const entity = await resolveEntity(conversation);
    const sent = await client.sendMessage(entity, { message: outboundText });
    const createdAt = new Date(
      Number(sent.date || Math.floor(Date.now() / 1000)) * 1000
    ).toISOString();
    const now = nowIso();

    const messageId = withTransaction(db, () => {
      const insert = db.prepare(
        `INSERT INTO messages
           (conversation_id, telegram_message_id, direction, sender_id, sender_name,
            body, message_type, meta_json, language, delivery_status, delivery_updated_at, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, 'text', ?, ?, 'sent', ?, ?)`
      ).run(
        conversation.id,
        String(sent.id),
        user.id,
        user.displayName,
        outboundText,
        JSON.stringify({
          via: "mtproto",
          peerId: String(conversation.telegram_chat_id || "")
            .replace(accountId ? `mtproto:${accountId}:` : /^mtproto:/, ""),
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
    const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    const message = toPublicMessage(messageRow);
    const summary = toConversationSummary(conversationRow);
    emit({ type: "message.created", conversation: summary, message });
    return { message, conversation: summary };
  }

  function clearLoginTimer() {
    if (loginTimer) {
      clearTimeout(loginTimer);
      loginTimer = null;
    }
  }

  function resetLoginState() {
    clearLoginTimer();
    loginInProgress = false;
    qrDataUrl = null;
    passwordRequired = false;
    passwordHint = "";
    passwordDeferred = null;
    abortController = null;
  }

  async function start() {
    if (!enabled) return;
    if (!apiId || !apiHash) {
      logger?.warn(`${scopeLabel}已启用，但缺少 TELEGRAM_USER_API_ID / TELEGRAM_USER_API_HASH`);
      return;
    }
    if (!sessionExists(sessionPath)) {
      logger?.info(`${scopeLabel}：未登录，等待扫码`);
      return;
    }
    if (running || loginInProgress) return;

    client = makeClient();
    try {
      await client.connect();
      me = publicMe(await client.getMe());
      attachHandlers();
      running = true;
      lastError = null;
      logger?.info(`${scopeLabel}：已连接 ${me.username ? "@" + me.username : me.id}`);
    } catch (error) {
      lastError = error?.message || String(error);
      logger?.warn(`${scopeLabel}启动失败`, lastError);
      await stop();
    }
  }

  async function beginLogin() {
    if (!enabled) {
      throw new TelegramUserError("Telegram 个人号未启用，请设置 TELEGRAM_USER_ENABLED=true", "NOT_CONFIGURED");
    }
    if (!apiId || !apiHash) {
      throw new TelegramUserError("缺少 TELEGRAM_USER_API_ID / TELEGRAM_USER_API_HASH", "NOT_CONFIGURED");
    }
    if (running) return status();
    if (loginInProgress) return status();

    await stop();
    client = makeClient();
    await client.connect();

    loginInProgress = true;
    running = false;
    lastError = null;
    qrDataUrl = null;
    passwordRequired = false;
    passwordHint = "";
    abortController = new AbortController();
    const controller = abortController;

    loginTimer = setTimeout(() => {
      if (!loginInProgress) return;
      lastError = "二维码登录超时，请重新生成";
      if (passwordDeferred) {
        try { passwordDeferred.reject(new Error(lastError)); } catch {}
        passwordDeferred = null;
      }
      controller.abort();
    }, LOGIN_TIMEOUT_MS);
    loginTimer.unref?.();

    loginPromise = (async () => {
      try {
        const user = await client.signInUserWithQrCode({ apiId, apiHash }, {
          qrCode: async ({ token }) => {
            const value = `tg://login?token=${token.toString("base64url")}`;
            qrDataUrl = await encodeQr(value);
          },
          password: async hint => {
            passwordRequired = true;
            passwordHint = hint || "";
            qrDataUrl = null;
            return await new Promise((resolve, reject) => {
              passwordDeferred = { resolve, reject };
            });
          },
          onError: async error => {
            lastError = error?.message || String(error);
            logger?.warn(`${scopeLabel}扫码登录错误`, lastError);
            return false;
          },
          abortSignal: controller.signal
        });

        me = publicMe(user);
        running = true;
        lastError = null;
        attachHandlers();
        logger?.info(`${scopeLabel}：已连接 ${me.username ? "@" + me.username : me.id}`);
      } catch (error) {
        if (error?.name === "AbortError") {
          if (!lastError) lastError = "登录已取消";
        } else {
          lastError = error?.message || String(error);
          logger?.warn(`${scopeLabel}登录失败`, lastError);
        }
      } finally {
        resetLoginState();
        if (!running) {
          try { await client?.disconnect(); } catch {}
          client = null;
          me = null;
        }
      }
    })();

    return status();
  }

  async function submitPassword(password) {
    if (!passwordRequired || !passwordDeferred) {
      throw new TelegramUserError("当前不需要两步验证密码", "INVALID_INPUT");
    }
    const value = String(password || "");
    if (!value) throw new TelegramUserError("请输入两步验证密码", "INVALID_INPUT");
    const deferred = passwordDeferred;
    passwordDeferred = null;
    passwordRequired = false;
    deferred.resolve(value);
    return status();
  }

  async function logout() {
    if (abortController) {
      try { abortController.abort(); } catch {}
    }
    if (passwordDeferred) {
      try { passwordDeferred.reject(new Error("登录已取消")); } catch {}
      passwordDeferred = null;
    }
    const current = client;
    client = null;
    running = false;
    resetLoginState();
    me = null;
    lastError = null;
    if (current) {
      try { await current.logOut(); } catch {}
      try { await current.disconnect(); } catch {}
    }
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch {}
    return status();
  }

  async function stop() {
    if (abortController) {
      try { abortController.abort(); } catch {}
    }
    if (passwordDeferred) {
      try { passwordDeferred.reject(new Error("登录已取消")); } catch {}
      passwordDeferred = null;
    }
    resetLoginState();
    const current = client;
    client = null;
    running = false;
    me = null;
    if (eventHandler && eventBuilder && current) {
      try { current.removeEventHandler(eventHandler, eventBuilder); } catch {}
    }
    eventHandler = null;
    eventBuilder = null;
    if (current) {
      try { await current.disconnect(); } catch {}
    }
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
      error: lastError,
      passwordRequired,
      passwordHint
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
    submitPassword,
    logout,
    sendReply,
    status,
    ingestMessage
  };
}

module.exports = {
  CHANNEL,
  TelegramUserError,
  createTelegramUserService,
  contentOf,
  displayName,
  publicMe,
  sessionExists,
  userIdOf
};
