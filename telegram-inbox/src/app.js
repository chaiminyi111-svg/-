const path = require("node:path");
const { Readable } = require("node:stream");
const express = require("express");

const {
  attachUser,
  requireAuth,
  requireAdmin,
  createSession,
  destroySession,
  destroyUserSessions,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  verifyPassword,
  hashPassword
} = require("./auth");
const { audit } = require("./db");
const {
  getConversationById,
  listConversations,
  getConversationCounts,
  listMessages,
  getMessageById,
  listCannedReplies,
  getCannedReplyById,
  getStats
} = require("./store");
const { nowIso, toPublicUser, toConversationSummary, toCannedReply } = require("./util");

const VERSION = "0.1.0";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function createApp({ db, config, telegram, whatsapp, broadcaster, logger }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);

  const loginAttempts = new Map();

  function loginAllowed(ip) {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const list = (loginAttempts.get(ip) || []).filter(time => now - time < windowMs);
    if (list.length >= 10) return false;
    list.push(now);
    loginAttempts.set(ip, list);
    return true;
  }

  function getUserById(id) {
    return db.prepare(
      "SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?"
    ).get(id);
  }

  function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
  }

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.use(express.json({
    limit: "1mb",
    verify: (req, res, buffer) => {
      if (req.originalUrl.startsWith("/webhook/whatsapp")) req.rawBody = buffer;
    }
  }));
  app.use(attachUser(db));

  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.path.startsWith("/webhook/")) return next();
    const origin = req.get("origin");
    if (!origin) return next();

    let allowed = false;
    try {
      if (config.publicOrigin) {
        allowed = origin === config.publicOrigin;
      } else {
        allowed = new URL(origin).host === req.get("host");
      }
    } catch {}
    if (!allowed) return jsonError(res, 403, "跨站请求被拒绝");
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      service: "telegram-support-inbox",
      version: VERSION,
      telegramConfigured: Boolean(telegram?.configured),
      whatsappConfigured: Boolean(whatsapp?.configured),
      now: nowIso()
    });
  });

  app.get("/webhook/whatsapp", (req, res) => {
    if (!whatsapp?.configured) return jsonError(res, 503, "WhatsApp 渠道未配置");
    const challenge = whatsapp.verifyWebhook(
      req.query["hub.mode"],
      req.query["hub.verify_token"],
      req.query["hub.challenge"]
    );
    if (!challenge) return jsonError(res, 403, "Webhook 校验失败");
    res.type("text/plain").send(challenge);
  });

  app.post("/webhook/whatsapp", asyncRoute(async (req, res) => {
    if (!whatsapp?.configured) return jsonError(res, 503, "WhatsApp 渠道未配置");
    if (!whatsapp.verifySignature(req.rawBody, req.get("x-hub-signature-256"))) {
      return jsonError(res, 403, "Webhook 签名校验失败");
    }
    const count = whatsapp.ingestWebhook(req.body);
    logger?.debug(`收到 WhatsApp webhook，处理 ${count} 条消息`);
    res.json({ received: true });
  }));

  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!loginAllowed(ip)) return jsonError(res, 429, "尝试次数过多，请稍后再试");

    const username = String(req.body?.username || "").trim().slice(0, 64);
    const password = String(req.body?.password || "").slice(0, 256);
    if (!username || !password) return jsonError(res, 400, "请输入用户名和密码");

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return jsonError(res, 401, "用户名或密码错误");
    }

    loginAttempts.delete(ip);
    const session = createSession(db, user.id, config.sessionDays);
    setSessionCookie(req, res, session.token, config.sessionDays, config);
    audit(db, user.id, "auth.login", "user", user.id);
    res.json({ user: toPublicUser(user) });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getSessionToken(req);
    if (token) destroySession(db, token);
    if (req.user) audit(db, req.user.id, "auth.logout", "user", req.user.id);
    clearSessionCookie(req, res, config);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  app.post("/api/auth/password", requireAuth, (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (newPassword.length < 8) return jsonError(res, 400, "新密码至少 8 位");

    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      return jsonError(res, 400, "当前密码不正确");
    }

    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      hashPassword(newPassword),
      nowIso(),
      req.user.id
    );
    destroyUserSessions(db, req.user.id, req.session?.tokenHash || null);
    audit(db, req.user.id, "auth.password_changed", "user", req.user.id);
    res.json({ ok: true });
  });

  app.get("/api/users", requireAuth, (req, res) => {
    const includeInactive = req.user.role === "admin" && req.query.includeInactive === "1";
    const rows = db.prepare(
      `SELECT id, username, display_name, role, active, created_at
       FROM users
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY active DESC, role DESC, display_name ASC`
    ).all();
    res.json({ users: rows.map(toPublicUser) });
  });

  app.post("/api/users", requireAdmin, (req, res) => {
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "agent");

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return jsonError(res, 400, "用户名需为 3-32 位字母、数字、下划线、点或短横线");
    }
    if (!displayName || displayName.length > 40) {
      return jsonError(res, 400, "显示名称需为 1-40 个字符");
    }
    if (password.length < 8) return jsonError(res, 400, "密码至少 8 位");
    if (!["admin", "agent"].includes(role)) return jsonError(res, 400, "角色不合法");

    const now = nowIso();
    try {
      const result = db.prepare(
        `INSERT INTO users (username, display_name, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(username, displayName, hashPassword(password), role, now, now);
      const user = getUserById(Number(result.lastInsertRowid));
      audit(db, req.user.id, "user.created", "user", user.id, JSON.stringify({ username, role }));
      res.status(201).json({ user: toPublicUser(user) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return jsonError(res, 409, "用户名已存在");
      }
      throw error;
    }
  });

  app.patch("/api/users/:id", requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getUserById(id) : null;
    if (!target) return jsonError(res, 404, "用户不存在");

    const nextDisplayName = req.body?.displayName !== undefined
      ? String(req.body.displayName).trim()
      : target.display_name;
    const nextRole = req.body?.role !== undefined ? String(req.body.role) : target.role;
    const nextActive = req.body?.active !== undefined
      ? [true, 1, "1", "true"].includes(req.body.active)
      : Boolean(target.active);

    if (!nextDisplayName || nextDisplayName.length > 40) {
      return jsonError(res, 400, "显示名称需为 1-40 个字符");
    }
    if (!["admin", "agent"].includes(nextRole)) return jsonError(res, 400, "角色不合法");
    if (target.id === req.user.id && !nextActive) {
      return jsonError(res, 400, "不能停用当前登录账号");
    }

    if (target.role === "admin" && target.active && (nextRole !== "admin" || !nextActive)) {
      const activeAdmins = Number(
        db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get().c
      );
      if (activeAdmins <= 1) return jsonError(res, 400, "至少保留一个启用的管理员");
    }

    db.prepare(
      `UPDATE users
       SET display_name = ?, role = ?, active = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextDisplayName, nextRole, nextActive ? 1 : 0, nowIso(), id);

    if (!nextActive) {
      destroyUserSessions(db, id);
      db.prepare("UPDATE conversations SET assignee_id = NULL, updated_at = ? WHERE assignee_id = ?").run(nowIso(), id);
    }
    audit(db, req.user.id, "user.updated", "user", id, JSON.stringify({
      displayName: nextDisplayName,
      role: nextRole,
      active: nextActive
    }));
    res.json({ user: toPublicUser(getUserById(id)) });
  });

  app.post("/api/users/:id/password", requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getUserById(id) : null;
    if (!target) return jsonError(res, 404, "用户不存在");

    const password = String(req.body?.password || "");
    if (password.length < 8) return jsonError(res, 400, "密码至少 8 位");

    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      hashPassword(password),
      nowIso(),
      id
    );
    destroyUserSessions(db, id, target.id === req.user.id ? req.session?.tokenHash || null : null);
    audit(db, req.user.id, "user.password_reset", "user", id);
    res.json({ ok: true });
  });

  app.get("/api/admin/telegram", requireAdmin, asyncRoute(async (req, res) => {
    let bot = null;
    let warning = null;
    if (telegram?.configured) {
      try {
        bot = await telegram.getBotInfo();
      } catch (error) {
        warning = error.message;
      }
    }
    res.json({
      telegram: {
        configured: Boolean(telegram?.configured),
        running: Boolean(telegram?.running),
        source: telegram?.tokenSource || "none",
        bot,
        warning
      }
    });
  }));

  app.post("/api/admin/telegram", requireAdmin, asyncRoute(async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) return jsonError(res, 400, "请输入 Telegram Bot Token");
    if (token.length > 200) return jsonError(res, 400, "Telegram Bot Token 过长");

    let bot;
    try {
      bot = await telegram.validateToken(token);
    } catch (error) {
      const status = error.code === "NETWORK_ERROR" ? 502 : 400;
      return jsonError(res, status, error.message);
    }

    try {
      await telegram.updateToken(token);
    } catch (error) {
      logger?.error("保存 Telegram Token 失败", error.message);
      return jsonError(res, 500, "Token 已验证，但启动接收消息失败，请检查服务日志");
    }

    audit(db, req.user.id, "telegram.token_updated", "channel", "telegram", JSON.stringify({
      botUsername: bot.username || null,
      botId: bot.id
    }));
    res.json({
      ok: true,
      telegram: {
        configured: Boolean(telegram.configured),
        running: Boolean(telegram.running),
        source: telegram.tokenSource || "none",
        bot
      }
    });
  }));

  app.delete("/api/admin/telegram", requireAdmin, asyncRoute(async (req, res) => {
    try {
      await telegram.updateToken("");
    } catch (error) {
      logger?.error("清除 Telegram Token 失败", error.message);
      return jsonError(res, 500, "清除 Telegram Token 失败，请检查服务日志");
    }

    audit(db, req.user.id, "telegram.token_cleared", "channel", "telegram");
    res.json({
      ok: true,
      telegram: {
        configured: false,
        running: false,
        source: "none",
        bot: null
      }
    });
  }));

  app.get("/api/admin/whatsapp", requireAdmin, asyncRoute(async (req, res) => {
    let info = null;
    let warning = null;
    if (whatsapp?.configured) {
      try {
        info = await whatsapp.getInfo();
      } catch (error) {
        warning = error.message;
      }
    }
    res.json({
      whatsapp: {
        configured: Boolean(whatsapp?.configured),
        source: whatsapp?.source || "none",
        phoneNumberId: whatsapp?.phoneNumberId || "",
        hasVerifyToken: Boolean(whatsapp?.hasVerifyToken),
        hasAppSecret: Boolean(whatsapp?.hasAppSecret),
        info,
        warning
      }
    });
  }));

  app.post("/api/admin/whatsapp", requireAdmin, asyncRoute(async (req, res) => {
    const token = String(req.body?.token || "").trim();
    const phoneNumberId = String(req.body?.phoneNumberId || "").trim();
    const verifyToken = String(req.body?.verifyToken || "").trim();
    const appSecret = String(req.body?.appSecret || "").trim();

    if (!phoneNumberId) return jsonError(res, 400, "请填写 WhatsApp Phone Number ID");

    let info;
    try {
      info = await whatsapp.updateCredentials({ token, phoneNumberId, verifyToken, appSecret });
    } catch (error) {
      const status = error.code === "NETWORK_ERROR" ? 502 : 400;
      return jsonError(res, status, error.message);
    }

    audit(db, req.user.id, "whatsapp.credentials_updated", "channel", "whatsapp", JSON.stringify({
      phoneNumberId: whatsapp.phoneNumberId,
      hasVerifyToken: Boolean(whatsapp.hasVerifyToken),
      hasAppSecret: Boolean(whatsapp.hasAppSecret)
    }));
    res.json({
      ok: true,
      whatsapp: {
        configured: Boolean(whatsapp.configured),
        source: whatsapp.source || "none",
        phoneNumberId: whatsapp.phoneNumberId || "",
        hasVerifyToken: Boolean(whatsapp.hasVerifyToken),
        hasAppSecret: Boolean(whatsapp.hasAppSecret),
        info
      }
    });
  }));

  app.delete("/api/admin/whatsapp", requireAdmin, asyncRoute(async (req, res) => {
    whatsapp.clearCredentials();
    audit(db, req.user.id, "whatsapp.credentials_cleared", "channel", "whatsapp");
    res.json({
      ok: true,
      whatsapp: {
        configured: false,
        source: "none",
        phoneNumberId: "",
        hasVerifyToken: false,
        hasAppSecret: false,
        info: null
      }
    });
  }));

  app.get("/api/conversations", requireAuth, (req, res) => {
    const result = listConversations(db, {
      scope: req.query.scope,
      status: req.query.status,
      q: req.query.q,
      userId: req.user.id,
      limit: req.query.limit,
      offset: req.query.offset
    });
    const counts = getConversationCounts(db);
    counts.mine = Number(
      db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE assignee_id = ?").get(req.user.id).c
    );
    res.json({ ...result, counts });
  });

  app.get("/api/conversations/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");
    res.json({ conversation: toConversationSummary(conversation) });
  });

  app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const result = listMessages(db, id, {
      before: req.query.before,
      limit: req.query.limit
    });
    res.json(result);
  });

  app.post("/api/conversations/:id/messages", requireAuth, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const text = String(req.body?.text || "").trim();
    if (!text) return jsonError(res, 400, "消息不能为空");
    if (text.length > config.maxMessageLength) {
      return jsonError(res, 400, `消息不能超过 ${config.maxMessageLength} 个字符`);
    }
    const channel = conversation.channel || "telegram";
    const service = channel === "whatsapp" ? whatsapp : telegram;
    if (!service?.configured) {
      return jsonError(res, 503, channel === "whatsapp"
        ? "未配置 WhatsApp Cloud API 凭据，暂时无法发送消息"
        : "未配置 TELEGRAM_BOT_TOKEN，暂时无法发送消息");
    }

    try {
      const result = await service.sendReply(conversation, text, req.user);
      audit(db, req.user.id, "message.sent", "conversation", id, JSON.stringify({
        channel,
        length: text.length
      }));
      res.status(201).json(result);
    } catch (error) {
      logger?.warn(`发送 ${channel} 消息失败`, error.message);
      const status = error.code === "NOT_CONFIGURED" ? 503 : 502;
      return jsonError(res, status, error.message || "发送消息失败");
    }
  }));

  app.post("/api/conversations/:id/media", requireAuth, express.raw({
    type: "application/octet-stream",
    limit: "20mb"
  }), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");

    if ((conversation.channel || "telegram") !== "telegram") {
      return jsonError(res, 400, "当前渠道暂不支持出站附件");
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return jsonError(res, 400, "请选择要发送的文件");
    }
    if (req.body.length > 20 * 1024 * 1024) {
      return jsonError(res, 413, "文件不能超过 20MB");
    }
    if (!telegram?.configured) {
      return jsonError(res, 503, "未配置 TELEGRAM_BOT_TOKEN，暂时无法发送附件");
    }

    const decode = value => {
      try {
        return decodeURIComponent(String(value || ""));
      } catch {
        return String(value || "");
      }
    };
    const fileName = (decode(req.get("x-file-name")).trim() || "file").slice(0, 180);
    const mimeType = (String(req.get("x-file-type") || "application/octet-stream").trim() || "application/octet-stream").slice(0, 120);
    const caption = decode(req.get("x-caption")).trim();
    if (caption.length > 1024) return jsonError(res, 400, "附件说明不能超过 1024 个字符");

    try {
      const result = await telegram.sendMedia(conversation, {
        buffer: req.body,
        fileName,
        mimeType,
        caption
      }, req.user);
      audit(db, req.user.id, "message.media_sent", "conversation", id, JSON.stringify({
        fileName,
        mimeType,
        size: req.body.length
      }));
      res.status(201).json(result);
    } catch (error) {
      logger?.warn("发送 Telegram 附件失败", error.message);
      const status = error.code === "NOT_CONFIGURED" ? 503 : 502;
      return jsonError(res, status, error.message || "发送附件失败");
    }
  }));

  app.patch("/api/conversations/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const body = req.body || {};
    const hasAssignee = Object.prototype.hasOwnProperty.call(body, "assigneeId");
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
    const hasTags = Object.prototype.hasOwnProperty.call(body, "tags");
    if (!hasAssignee && !hasStatus && !hasNotes && !hasTags) {
      return jsonError(res, 400, "没有需要更新的字段");
    }

    const sets = [];
    const params = [];
    let assigneeId = null;
    let nextNotes = null;
    let nextTags = null;

    if (hasAssignee) {
      if (body.assigneeId !== null && body.assigneeId !== "") {
        assigneeId = parseId(body.assigneeId);
        if (!assigneeId) return jsonError(res, 400, "客服 ID 不合法");
        const assignee = db.prepare(
          "SELECT id, active FROM users WHERE id = ?"
        ).get(assigneeId);
        if (!assignee || !assignee.active) return jsonError(res, 400, "客服不存在或已停用");
      }

      if (req.user.role !== "admin" && assigneeId !== null && assigneeId !== req.user.id) {
        return jsonError(res, 403, "普通客服只能分配给自己或取消分配");
      }

      sets.push("assignee_id = ?");
      params.push(assigneeId);
    }

    let nextStatus = null;
    if (hasStatus) {
      nextStatus = String(body.status);
      if (!["open", "pending", "closed"].includes(nextStatus)) {
        return jsonError(res, 400, "会话状态不合法");
      }
      sets.push("status = ?");
      params.push(nextStatus);
    }

    if (hasNotes) {
      if (typeof body.notes !== "string") return jsonError(res, 400, "备注必须是文本");
      nextNotes = body.notes.trim();
      if (nextNotes.length > 2000) return jsonError(res, 400, "备注不能超过 2000 个字符");
      sets.push("notes = ?");
      params.push(nextNotes);
    }

    if (hasTags) {
      if (!Array.isArray(body.tags)) return jsonError(res, 400, "标签必须是数组");
      nextTags = [...new Set(body.tags.map(tag => String(tag ?? "").trim()).filter(Boolean))];
      if (nextTags.length > 8) return jsonError(res, 400, "标签最多 8 个");
      if (nextTags.some(tag => tag.length > 20 || /[\r\n]/.test(tag))) {
        return jsonError(res, 400, "每个标签需为 1-20 个字符且不能换行");
      }
      sets.push("tags_json = ?");
      params.push(JSON.stringify(nextTags));
    }

    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    db.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    if (hasAssignee) {
      audit(db, req.user.id, "conversation.assigned", "conversation", id, JSON.stringify({ assigneeId }));
    }
    if (hasStatus) {
      audit(db, req.user.id, "conversation.status", "conversation", id, JSON.stringify({ status: nextStatus }));
    }
    if (hasNotes) {
      audit(db, req.user.id, "conversation.notes", "conversation", id, JSON.stringify({ length: nextNotes.length }));
    }
    if (hasTags) {
      audit(db, req.user.id, "conversation.tags", "conversation", id, JSON.stringify({ tags: nextTags }));
    }

    const summary = toConversationSummary(getConversationById(db, id));
    broadcaster?.broadcast({ type: "conversation.updated", conversation: summary });
    res.json({ conversation: summary });
  });

  app.get("/api/stats", requireAuth, (req, res) => {
    res.json({ stats: getStats(db, req.query.days) });
  });

  app.get("/api/canned-replies", requireAuth, (req, res) => {
    res.json({ items: listCannedReplies(db) });
  });

  app.post("/api/canned-replies", requireAuth, (req, res) => {
    const title = String(req.body?.title || "").trim();
    const content = String(req.body?.content || "").trim();
    if (!title || title.length > 40) return jsonError(res, 400, "标题需为 1-40 个字符");
    if (!content || content.length > 2000) return jsonError(res, 400, "内容需为 1-2000 个字符");

    const now = nowIso();
    const result = db.prepare(
      `INSERT INTO canned_replies (title, content, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(title, content, req.user.id, now, now);
    const row = getCannedReplyById(db, Number(result.lastInsertRowid));
    audit(db, req.user.id, "canned_reply.created", "canned_reply", row.id, JSON.stringify({ title }));
    res.status(201).json({ reply: toCannedReply(row) });
  });

  app.patch("/api/canned-replies/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getCannedReplyById(db, id) : null;
    if (!target) return jsonError(res, 404, "快捷回复不存在");
    if (req.user.role !== "admin" && target.created_by !== req.user.id) {
      return jsonError(res, 403, "只能修改自己创建的快捷回复");
    }

    const nextTitle = req.body?.title !== undefined ? String(req.body.title).trim() : target.title;
    const nextContent = req.body?.content !== undefined ? String(req.body.content).trim() : target.content;
    if (!nextTitle || nextTitle.length > 40) return jsonError(res, 400, "标题需为 1-40 个字符");
    if (!nextContent || nextContent.length > 2000) return jsonError(res, 400, "内容需为 1-2000 个字符");

    db.prepare("UPDATE canned_replies SET title = ?, content = ?, updated_at = ? WHERE id = ?").run(
      nextTitle,
      nextContent,
      nowIso(),
      id
    );
    audit(db, req.user.id, "canned_reply.updated", "canned_reply", id, JSON.stringify({ title: nextTitle }));
    res.json({ reply: toCannedReply(getCannedReplyById(db, id)) });
  });

  app.delete("/api/canned-replies/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getCannedReplyById(db, id) : null;
    if (!target) return jsonError(res, 404, "快捷回复不存在");
    if (req.user.role !== "admin" && target.created_by !== req.user.id) {
      return jsonError(res, 403, "只能删除自己创建的快捷回复");
    }
    db.prepare("DELETE FROM canned_replies WHERE id = ?").run(id);
    audit(db, req.user.id, "canned_reply.deleted", "canned_reply", id, JSON.stringify({ title: target.title }));
    res.json({ ok: true });
  });

  app.post("/api/conversations/:id/read", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return jsonError(res, 404, "会话不存在");

    db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(
      nowIso(),
      id
    );
    broadcaster?.broadcast({ type: "conversation.read", conversationId: id, unreadCount: 0 });
    res.json({ ok: true });
  });

  app.get("/api/messages/:id/media", requireAuth, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const message = id ? getMessageById(db, id) : null;
    if (!message) return jsonError(res, 404, "消息不存在");

    const conversation = getConversationById(db, message.conversation_id);
    if (!conversation) return jsonError(res, 404, "会话不存在");
    if ((conversation.channel || "telegram") !== "telegram") {
      return jsonError(res, 501, "当前渠道暂不支持媒体下载");
    }
    if (!telegram?.configured) return jsonError(res, 503, "未配置 Telegram Bot Token");

    let media;
    try {
      media = await telegram.getMedia(message);
    } catch (error) {
      logger?.warn("获取 Telegram 媒体失败", error.message);
      return jsonError(res, 502, "获取媒体失败");
    }
    if (!media?.response?.body) return jsonError(res, 404, "媒体不存在");

    const safeName = String(media.fileName || "telegram-file").replace(/["\\\r\n]/g, "_");
    const inline = ["photo", "voice", "audio", "video", "video_note", "sticker"].includes(message.message_type);
    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader("Cache-Control", "private, max-age=300");

    Readable.fromWeb(media.response.body)
      .on("error", () => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      })
      .pipe(res);
  }));

  app.get("/api/events", requireAuth, (req, res) => {
    if (!broadcaster) return jsonError(res, 503, "实时通道不可用");

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    broadcaster.add(res);

    req.on("close", () => {
      broadcaster.remove(res);
    });
  });

  const publicDir = path.join(config.root, "public");
  app.use(express.static(publicDir, {
    index: "index.html",
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    }
  }));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return jsonError(res, 404, "接口不存在");
    next();
  });

  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
      return jsonError(res, 400, "请求体不是有效 JSON");
    }
    if (error.type === "entity.too.large") {
      return jsonError(res, 413, "文件不能超过 20MB");
    }
    logger?.error("未处理的 API 错误", error.message);
    res.status(500).json({ error: "服务器内部错误" });
  });

  return app;
}

module.exports = { createApp, VERSION };
