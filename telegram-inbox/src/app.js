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
const { createAdminService } = require("./admin");
const {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  getAdminIpAllowlist,
  setAdminIpAllowlist,
  parseAllowlist,
  isIpAllowed
} = require("./security");
const {
  getConversationById,
  listConversations,
  getConversationCounts,
  listMessages,
  getMessageById,
  softDeleteMessage,
  listCannedReplies,
  getCannedReplyById,
  getStats,
  getTeamDailyStats,
  getLatestAiSuggestion,
  getAiSuggestionById,
  updateAiSuggestionStatus
} = require("./store");
const {
  nowIso,
  toPublicUser,
  toConversationSummary,
  toPublicMessage,
  toCannedReply
} = require("./util");
const { readSettings, saveSettings } = require("./assignment");

const VERSION = "0.1.0";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function renderSupportGoPage({ whatsappUrl, telegramUrl, prefill, configured }) {
  const buttons = [
    whatsappUrl
      ? `<a class="channel whatsapp" href="${escapeHtml(whatsappUrl)}">
          <span class="icon">WA</span>
          <span class="copy"><strong>WhatsApp 客服</strong><small>打开 WhatsApp 后点发送</small></span>
          <span class="arrow">→</span>
        </a>`
      : "",
    telegramUrl
      ? `<a class="channel telegram" href="${escapeHtml(telegramUrl)}">
          <span class="icon">TG</span>
          <span class="copy"><strong>Telegram 客服</strong><small>打开 Telegram 后点开始</small></span>
          <span class="arrow">→</span>
        </a>`
      : ""
  ].join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>联系客服</title>
<style>
  :root { color-scheme: dark; --bg:#0d0b10; --card:#18131e; --line:#2c2533; --text:#f7f2ea; --muted:#a79eaa; --yellow:#fffc00; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:radial-gradient(circle at 50% 0%, #2a1f0b 0, var(--bg) 55%); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  main { width:min(460px,100%); background:linear-gradient(180deg,#211a29,var(--card)); border:1px solid var(--line); border-radius:26px; padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.45); }
  .badge { display:inline-flex; align-items:center; gap:8px; padding:7px 12px; border-radius:999px; background:rgba(255,252,0,.12); color:var(--yellow); font-size:12px; font-weight:700; letter-spacing:.08em; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--yellow); box-shadow:0 0 14px var(--yellow); }
  h1 { margin:18px 0 8px; font-size:28px; line-height:1.2; }
  p { margin:0; color:var(--muted); line-height:1.7; font-size:14px; }
  .prefill { margin-top:16px; padding:12px 14px; border-radius:14px; background:rgba(255,255,255,.05); border:1px solid var(--line); color:#d7cedd; font-size:13px; line-height:1.6; }
  .channels { display:grid; gap:12px; margin-top:22px; }
  .channel { display:flex; align-items:center; gap:14px; padding:15px; border-radius:18px; text-decoration:none; color:var(--text); background:#120f16; border:1px solid var(--line); transition:transform .15s ease,border-color .15s ease; }
  .channel:hover { transform:translateY(-1px); border-color:#4a3e55; }
  .icon { width:46px; height:46px; flex:0 0 46px; display:grid; place-items:center; border-radius:14px; font-weight:800; font-size:13px; letter-spacing:.04em; }
  .whatsapp .icon { background:rgba(37,211,102,.14); color:#25d366; }
  .telegram .icon { background:rgba(42,171,238,.14); color:#2aabee; }
  .copy { display:grid; gap:3px; flex:1; }
  .copy strong { font-size:15px; }
  .copy small { color:var(--muted); font-size:12px; }
  .arrow { color:var(--muted); font-size:20px; }
  .empty { margin-top:22px; padding:18px; border-radius:16px; background:rgba(255,255,255,.04); border:1px dashed var(--line); color:var(--muted); font-size:14px; line-height:1.7; }
  .note { margin-top:18px; text-align:center; font-size:12px; color:#7f7585; }
</style>
</head>
<body>
<main>
  <div class="badge"><span class="dot"></span>ONLINE SUPPORT</div>
  <h1>联系客服</h1>
  <p>选择你常用的聊天方式，我们会尽快回复。</p>
  ${configured ? `<div class="prefill">打开后已帮你填好：${escapeHtml(prefill)}</div>` : ""}
  ${buttons ? `<div class="channels">${buttons}</div>` : `<div class="empty">客服通道正在配置中，请稍后再试，或直接回复 Snapchat 消息。</div>`}
  <div class="note">如果按钮没有反应，请确认手机已安装对应 App。</div>
</main>
</body>
</html>`;
}

function createApp({ db, config, telegram, whatsapp, whatsappWeb, accounts, broadcaster, logger, translate, ai }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);

  const loginAttempts = new Map();
  const admin = createAdminService({ db, config, logger, telegram, whatsapp, whatsappWeb, accounts });

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
      `SELECT u.id, u.username, u.display_name, u.role, u.active,
              u.ai_allowed, u.ai_enabled, u.ai_mode, u.totp_enabled, u.created_at,
              (SELECT COUNT(*) FROM channel_accounts a WHERE a.owner_id = u.id) AS account_count,
              (SELECT COUNT(*) FROM conversations c
                WHERE c.assignee_id = u.id AND c.status != 'closed') AS active_conversation_count
       FROM users u WHERE u.id = ?`
    ).get(id);
  }

  function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
  }

  function accessibleConversation(req, id) {
    const conversation = id ? getConversationById(db, id) : null;
    if (!conversation) return null;
    if (req.user.role === "admin") return conversation;
    if (
      req.user.role === "agent" &&
      (conversation.assignee_id === req.user.id || conversation.account_owner_id === req.user.id)
    ) {
      return conversation;
    }
    return null;
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
    if (req.user?.role !== "admin") return next();
    if (!req.path.startsWith("/api/")) return next();
    if (["/api/health", "/api/auth/me", "/api/auth/logout", "/api/auth/password"].includes(req.path)) {
      return next();
    }
    const allowlist = getAdminIpAllowlist(db);
    if (!allowlist.length) return next();
    let entries;
    try {
      entries = parseAllowlist(allowlist.join(","));
    } catch {
      return jsonError(res, 500, "管理员 IP 白名单配置无效");
    }
    if (entries.length && !isIpAllowed(req.ip, entries)) {
      return jsonError(res, 403, "当前 IP 不在管理员白名单中");
    }
    next();
  });

  const viewerAllowedPaths = new Set([
    "/api/health",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/password",
    "/api/stats",
    "/api/stats/team-daily",
    "/api/stats/export.csv"
  ]);
  app.use((req, res, next) => {
    if (req.user?.role !== "viewer") return next();
    if (!req.path.startsWith("/api/")) return next();
    if (viewerAllowedPaths.has(req.path)) return next();
    return jsonError(res, 403, "统计员账号只能查看统计数据");
  });

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
      whatsappWebEnabled: Boolean(whatsappWeb?.status?.().enabled),
      whatsappWebConfigured: Boolean(whatsappWeb?.configured),
      whatsappWebRunning: Boolean(whatsappWeb?.running),
      personalAccountsEnabled: Boolean(accounts?.enabled),
      telegramUserEnabled: Boolean(config.telegramUserEnabled),
      translationConfigured: Boolean(translate?.configured?.()),
      aiConfigured: Boolean(ai?.configured?.()),
      aiEnabled: Boolean(ai?.status?.().enabled),
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
    const count = await whatsapp.ingestWebhook(req.body);
    logger?.debug(`收到 WhatsApp webhook，处理 ${count} 条消息`);
    res.json({ received: true });
  }));

  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!loginAllowed(ip)) return jsonError(res, 429, "尝试次数过多，请稍后再试");

    const username = String(req.body?.username || "").trim().slice(0, 64);
    const password = String(req.body?.password || "").slice(0, 256);
    const totpCode = String(req.body?.totpCode || "").replace(/\s/g, "").slice(0, 6);
    if (!username || !password) return jsonError(res, 400, "请输入用户名和密码");

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return jsonError(res, 401, "用户名或密码错误");
    }

    if (user.totp_enabled) {
      if (!totpCode) {
        return res.status(401).json({ error: "请输入两步验证码", totpRequired: true });
      }
      if (!verifyTotp(user.totp_secret, totpCode)) {
        return res.status(401).json({ error: "两步验证码错误", totpRequired: true });
      }
    }

    loginAttempts.delete(ip);
    const session = createSession(db, user.id, config.sessionDays);
    setSessionCookie(req, res, session.token, config.sessionDays, config);
    audit(db, user.id, "auth.login", "user", user.id, totpCode ? JSON.stringify({ totp: true }) : null);
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

  app.get("/api/translate/config", requireAuth, (req, res) => {
    res.json({ translate: translate?.status?.() || {
      configured: false,
      source: "none",
      provider: "google",
      defaultTarget: "zh-CN",
      languages: []
    } });
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

  app.get("/api/users", requireAdmin, (req, res) => {
    const includeInactive = req.user.role === "admin" && req.query.includeInactive === "1";
    const rows = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.active,
              u.ai_allowed, u.ai_enabled, u.ai_mode, u.totp_enabled, u.created_at,
              (SELECT COUNT(*) FROM channel_accounts a WHERE a.owner_id = u.id) AS account_count,
              (SELECT COUNT(*) FROM conversations c
                WHERE c.assignee_id = u.id AND c.status != 'closed') AS active_conversation_count
       FROM users u
       ${includeInactive ? "" : "WHERE u.active = 1"}
       ORDER BY u.active DESC, u.role DESC, u.display_name ASC`
    ).all();
    res.json({ users: rows.map(toPublicUser) });
  });

  app.post("/api/users", requireAdmin, (req, res) => {
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "agent");
    const aiAllowed = [true, 1, "1", "true"].includes(req.body?.aiAllowed);
    const effectiveAiAllowed = role === "admin" ? true : role === "viewer" ? false : aiAllowed;

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return jsonError(res, 400, "用户名需为 3-32 位字母、数字、下划线、点或短横线");
    }
    if (!displayName || displayName.length > 40) {
      return jsonError(res, 400, "显示名称需为 1-40 个字符");
    }
    if (password.length < 8) return jsonError(res, 400, "密码至少 8 位");
    if (!["admin", "agent", "viewer"].includes(role)) return jsonError(res, 400, "角色不合法");

    const now = nowIso();
    try {
      const result = db.prepare(
        `INSERT INTO users
           (username, display_name, password_hash, role, active, ai_allowed, ai_enabled, ai_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, 0, 'auto', ?, ?)`
      ).run(username, displayName, hashPassword(password), role, effectiveAiAllowed ? 1 : 0, now, now);
      const user = getUserById(Number(result.lastInsertRowid));
      audit(db, req.user.id, "user.created", "user", user.id, JSON.stringify({ username, role, aiAllowed: effectiveAiAllowed }));
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
    const requestedAiAllowed = req.body?.aiAllowed !== undefined
      ? [true, 1, "1", "true"].includes(req.body.aiAllowed)
      : Boolean(target.ai_allowed);
    const nextAiAllowed = nextRole === "admin" ? true : nextRole === "viewer" ? false : requestedAiAllowed;
    const nextAiEnabled = nextAiAllowed && nextActive && nextRole !== "viewer"
      ? Boolean(target.ai_enabled)
      : false;

    if (!nextDisplayName || nextDisplayName.length > 40) {
      return jsonError(res, 400, "显示名称需为 1-40 个字符");
    }
    if (!["admin", "agent", "viewer"].includes(nextRole)) return jsonError(res, 400, "角色不合法");
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
       SET display_name = ?, role = ?, active = ?, ai_allowed = ?, ai_enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextDisplayName,
      nextRole,
      nextActive ? 1 : 0,
      nextAiAllowed ? 1 : 0,
      nextAiEnabled ? 1 : 0,
      nowIso(),
      id
    );

    if (!nextActive || nextRole === "viewer") {
      if (!nextActive) destroyUserSessions(db, id);
      db.prepare(
        "UPDATE conversations SET assignee_id = NULL, assigned_at = NULL, updated_at = ? WHERE assignee_id = ?"
      ).run(nowIso(), id);
    }
    audit(db, req.user.id, "user.updated", "user", id, JSON.stringify({
      displayName: nextDisplayName,
      role: nextRole,
      active: nextActive,
      aiAllowed: nextAiAllowed
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

  app.post("/api/users/:id/logout", requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getUserById(id) : null;
    if (!target) return jsonError(res, 404, "用户不存在");
    if (target.id === req.user.id) {
      return jsonError(res, 400, "不能强制下线当前登录账号");
    }
    destroyUserSessions(db, id);
    audit(db, req.user.id, "user.force_logout", "user", id);
    res.json({ ok: true });
  });

  app.get("/api/admin/assignment", requireAdmin, (req, res) => {
    res.json({ assignment: readSettings(db, config) });
  });

  app.post("/api/admin/assignment", requireAdmin, (req, res) => {
    const body = req.body || {};
    const settings = saveSettings(db, {
      enabled: Boolean(body.enabled),
      strategy: String(body.strategy || "least_active"),
      maxActive: Number(body.maxActive) || 0
    });
    audit(db, req.user.id, "assignment.settings_updated", "settings", "assignment", JSON.stringify(settings));
    res.json({ assignment: settings });
  });

  app.get("/api/admin/translate", requireAdmin, (req, res) => {
    res.json({ translate: translate?.status?.() || { configured: false, source: "none", provider: "google", languages: [] } });
  });

  app.post("/api/admin/translate", requireAdmin, asyncRoute(async (req, res) => {
    const provider = String(req.body?.provider || "").trim();
    const apiKey = String(req.body?.apiKey || "").trim();
    if (!provider && !apiKey) return jsonError(res, 400, "请输入 Google 翻译 API Key 或选择翻译通道");
    if (!translate) return jsonError(res, 503, "翻译服务不可用");
    if (provider) {
      try {
        translate.saveProvider(provider);
      } catch (error) {
        return jsonError(res, 400, error.message || "不支持的翻译通道");
      }
      audit(db, req.user.id, "translate.provider_updated", "channel", "google_translate", provider);
    }
    if (apiKey) {
      if (!translate.verifyKey) return jsonError(res, 503, "翻译服务不可用");
      try {
        await translate.verifyKey(apiKey);
      } catch (error) {
        const status = error.code === "TRANSLATION_NETWORK" ? 502 : 400;
        return jsonError(res, status, error.message || "Google 翻译 API Key 验证失败");
      }
      translate.saveApiKey(apiKey);
      audit(db, req.user.id, "translate.credentials_updated", "channel", "google_translate");
    }
    res.json({ translate: translate.status() });
  }));

  app.delete("/api/admin/translate", requireAdmin, (req, res) => {
    translate?.clearApiKey?.();
    audit(db, req.user.id, "translate.credentials_cleared", "channel", "google_translate");
    res.json({ translate: translate?.status?.() || { configured: false, source: "none", provider: "google", languages: [] } });
  });

  app.get("/api/admin/ai", requireAdmin, (req, res) => {
    if (!ai) return jsonError(res, 503, "AI 服务不可用");
    res.json({ ai: ai.status() });
  });

  app.post("/api/admin/ai", requireAdmin, (req, res) => {
    if (!ai) return jsonError(res, 503, "AI 服务不可用");
    try {
      const settings = ai.saveSettings(req.body || {});
      audit(db, req.user.id, "ai.settings_updated", "settings", "ai", JSON.stringify({
        enabled: settings.enabled,
        baseUrl: settings.baseUrl,
        model: settings.model,
        defaultMode: settings.defaultMode
      }));
      res.json({ ai: settings });
    } catch (error) {
      return jsonError(res, error.code === "INVALID_INPUT" ? 400 : 400, error.message || "AI 配置保存失败");
    }
  });

  app.post("/api/admin/ai/test", requireAdmin, asyncRoute(async (req, res) => {
    if (!ai) return jsonError(res, 503, "AI 服务不可用");
    try {
      const result = await ai.testConnection();
      audit(db, req.user.id, "ai.connection_tested", "settings", "ai");
      res.json({ test: result });
    } catch (error) {
      const status = error.code === "NOT_CONFIGURED" ? 400 : 502;
      return jsonError(res, status, error.message || "AI 连接测试失败");
    }
  }));

  app.delete("/api/admin/ai", requireAdmin, (req, res) => {
    if (!ai) return jsonError(res, 503, "AI 服务不可用");
    const settings = ai.clearApiKey();
    audit(db, req.user.id, "ai.credentials_cleared", "settings", "ai");
    res.json({ ai: settings });
  });

  app.get("/api/ai/preferences", requireAuth, (req, res) => {
    res.json({
      ai: ai?.preferencesFor?.(req.user.id) || {
        configured: false,
        globalEnabled: false,
        allowed: false,
        enabled: false,
        mode: "auto",
        reason: "not_configured",
        modes: []
      }
    });
  });

  app.patch("/api/ai/preferences", requireAuth, (req, res) => {
    if (!ai) return jsonError(res, 503, "AI 服务不可用");
    try {
      const preferences = ai.savePreferences(req.user.id, req.body || {});
      audit(db, req.user.id, "ai.preferences_updated", "user", req.user.id, JSON.stringify({
        enabled: preferences.enabled,
        mode: preferences.mode
      }));
      broadcaster?.broadcast?.({
        type: "ai.preferences_updated",
        user: toPublicUser(getUserById(req.user.id))
      });
      res.json({ ai: preferences });
    } catch (error) {
      const status = error.code === "FORBIDDEN" ? 403 : 400;
      return jsonError(res, status, error.message || "AI 设置保存失败");
    }
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

  app.get("/api/admin/whatsapp-web", requireAdmin, (req, res) => {
    if (!whatsappWeb) return jsonError(res, 503, "WhatsApp 个人号服务未启动");
    res.json({ whatsappWeb: whatsappWeb.status() });
  });

  app.post("/api/admin/whatsapp-web/login", requireAdmin, asyncRoute(async (req, res) => {
    if (!whatsappWeb) return jsonError(res, 503, "WhatsApp 个人号服务未启动");
    try {
      const result = await whatsappWeb.beginLogin();
      audit(db, req.user.id, "whatsapp_web.login_started", "channel", "whatsapp_web");
      res.json({ ok: true, whatsappWeb: result });
    } catch (error) {
      const status = error.code === "NOT_CONFIGURED" ? 400 : 502;
      return jsonError(res, status, error.message || "启动 WhatsApp 个人号登录失败");
    }
  }));

  app.post("/api/admin/whatsapp-web/logout", requireAdmin, asyncRoute(async (req, res) => {
    if (!whatsappWeb) return jsonError(res, 503, "WhatsApp 个人号服务未启动");
    try {
      const result = await whatsappWeb.logout();
      audit(db, req.user.id, "whatsapp_web.logged_out", "channel", "whatsapp_web");
      res.json({ ok: true, whatsappWeb: result });
    } catch (error) {
      return jsonError(res, 502, error.message || "退出 WhatsApp 个人号失败");
    }
  }));

  app.post("/api/admin/whatsapp-web/reconnect", requireAdmin, asyncRoute(async (req, res) => {
    if (!whatsappWeb) return jsonError(res, 503, "WhatsApp 个人号服务未启动");
    try {
      await whatsappWeb.stop();
      await whatsappWeb.start();
      audit(db, req.user.id, "whatsapp_web.reconnected", "channel", "whatsapp_web");
      res.json({ ok: true, whatsappWeb: whatsappWeb.status() });
    } catch (error) {
      return jsonError(res, 502, error.message || "重连 WhatsApp 个人号失败");
    }
  }));

  app.get("/api/admin/system", requireAdmin, (req, res) => {
    res.json({ system: admin.systemStatus() });
  });

  app.get("/api/admin/audit", requireAdmin, (req, res) => {
    res.json({ audit: admin.listAudit({
      limit: req.query.limit,
      offset: req.query.offset,
      action: req.query.action,
      userId: req.query.userId
    }) });
  });

  app.get("/api/admin/backups", requireAdmin, (req, res) => {
    res.json({ backups: admin.listBackups() });
  });

  app.post("/api/admin/backups", requireAdmin, (req, res) => {
    try {
      const backup = admin.createBackup();
      audit(db, req.user.id, "data.backup_created", "backup", backup.name, JSON.stringify({ size: backup.size }));
      res.status(201).json({ backup });
    } catch (error) {
      logger?.error("创建备份失败", error.message);
      return jsonError(res, 500, "创建备份失败：" + (error.message || "未知错误"));
    }
  });

  app.get("/api/admin/backups/:name/download", requireAdmin, (req, res) => {
    const file = admin.backupPath(req.params.name);
    if (!file) return jsonError(res, 404, "备份不存在");
    audit(db, req.user.id, "data.backup_downloaded", "backup", req.params.name);
    res.download(file, req.params.name);
  });

  app.get("/api/admin/export/conversations.csv", requireAdmin, (req, res) => {
    const csv = admin.exportConversationsCsv();
    audit(db, req.user.id, "data.conversations_exported", "data", "conversations.csv");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="conversations.csv"');
    res.send(csv);
  });

  app.post("/api/admin/data/cleanup", requireAdmin, (req, res) => {
    const dryRun = req.body?.dryRun !== false;
    if (!dryRun && String(req.body?.confirm || "") !== "CLEANUP") {
      return jsonError(res, 400, "实际清理需要确认码 CLEANUP");
    }
    const result = admin.cleanupOldMessages({
      days: req.body?.days,
      dryRun
    });
    if (!dryRun) {
      audit(db, req.user.id, "data.messages_cleaned", "data", "messages", JSON.stringify({
        days: result.days,
        deleted: result.deleted
      }));
    }
    res.json({ cleanup: result });
  });

  app.get("/api/admin/diagnostics", requireAdmin, asyncRoute(async (req, res) => {
    res.json({ diagnostics: await admin.diagnostics() });
  }));

  app.post("/api/admin/diagnostics/telegram/test", requireAdmin, asyncRoute(async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) return jsonError(res, 400, "请输入要测试的 Telegram Bot Token");
    try {
      const bot = await telegram.validateToken(token);
      audit(db, req.user.id, "telegram.token_tested", "channel", "telegram", JSON.stringify({
        botUsername: bot.username || null
      }));
      res.json({ ok: true, bot });
    } catch (error) {
      const status = error.code === "NETWORK_ERROR" ? 502 : 400;
      return jsonError(res, status, error.message);
    }
  }));

  app.get("/api/admin/security", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT totp_enabled, totp_secret FROM users WHERE id = ?").get(req.user.id);
    res.json({
      security: {
        ipAllowlist: getAdminIpAllowlist(db),
        currentIp: req.ip || "",
        totpEnabled: Boolean(row?.totp_enabled),
        totpPending: Boolean(row?.totp_secret && !row?.totp_enabled)
      }
    });
  });

  app.post("/api/admin/security/ip-allowlist", requireAdmin, (req, res) => {
    let entries;
    try {
      entries = parseAllowlist(req.body?.allowlist);
    } catch (error) {
      return jsonError(res, 400, error.message);
    }
    if (entries.length && !isIpAllowed(req.ip, entries)) {
      return jsonError(res, 400, "当前 IP 不在新白名单中，保存后会把你自己锁在外面");
    }
    const saved = setAdminIpAllowlist(db, req.body?.allowlist);
    audit(db, req.user.id, "security.ip_allowlist_updated", "security", "admin_ip_allowlist", JSON.stringify({ entries: saved }));
    res.json({ ok: true, ipAllowlist: saved, currentIp: req.ip || "" });
  });

  app.post("/api/admin/security/totp/setup", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT totp_enabled FROM users WHERE id = ?").get(req.user.id);
    if (row?.totp_enabled) return jsonError(res, 400, "两步验证已开启，请先关闭再重新设置");
    const secret = generateTotpSecret();
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0, updated_at = ? WHERE id = ?")
      .run(secret, nowIso(), req.user.id);
    audit(db, req.user.id, "security.totp_setup_started", "security", "totp");
    res.json({
      secret,
      otpauth: otpauthUrl({ account: req.user.username, secret }),
      issuer: "聚合客服台",
      account: req.user.username
    });
  });

  app.post("/api/admin/security/totp/enable", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?").get(req.user.id);
    if (!row?.totp_secret) return jsonError(res, 400, "请先生成两步验证密钥");
    if (row.totp_enabled) return jsonError(res, 400, "两步验证已经开启");
    if (!verifyTotp(row.totp_secret, req.body?.code)) {
      return jsonError(res, 400, "验证码错误，请用验证器重新输入");
    }
    db.prepare("UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?").run(nowIso(), req.user.id);
    audit(db, req.user.id, "security.totp_enabled", "security", "totp");
    res.json({ ok: true });
  });

  app.post("/api/admin/security/totp/disable", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = ?").get(req.user.id);
    if (!row?.totp_enabled) return jsonError(res, 400, "两步验证未开启");
    if (!verifyPassword(String(req.body?.password || ""), row.password_hash)) {
      return jsonError(res, 400, "当前密码不正确");
    }
    if (!verifyTotp(row.totp_secret, req.body?.code)) {
      return jsonError(res, 400, "验证码错误");
    }
    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = ? WHERE id = ?")
      .run(nowIso(), req.user.id);
    audit(db, req.user.id, "security.totp_disabled", "security", "totp");
    res.json({ ok: true });
  });

  function accountErrorResponse(res, error) {
    const status = error?.code === "NOT_FOUND" ? 404
      : error?.code === "NOT_CONFIGURED" ? 503
        : error?.code === "INVALID_INPUT" ? 400
          : error?.code === "CONFLICT" ? 409
            : 502;
    return jsonError(res, status, error?.message || "个人号操作失败");
  }

  app.get("/api/accounts", requireAuth, (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const all = req.query.all === "1" && req.user.role === "admin";
    res.json({
      enabled: accounts.enabled,
      channels: [
        {
          channel: "whatsapp_web",
          label: "WhatsApp",
          available: accounts.channelAvailable("whatsapp_web"),
          hint: accounts.channelHint("whatsapp_web")
        },
        {
          channel: "telegram_user",
          label: "Telegram",
          available: accounts.channelAvailable("telegram_user"),
          hint: accounts.channelHint("telegram_user")
        }
      ],
      accounts: accounts.list(req.user, { all })
    });
  });

  app.get("/api/accounts/:id", requireAuth, (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    const account = id ? accounts.get(req.user, id) : null;
    if (!account) return jsonError(res, 404, "个人号账号不存在");
    res.json({ account });
  });

  app.post("/api/accounts", requireAuth, (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    try {
      const row = accounts.ensureAccount(
        req.user,
        String(req.body?.channel || ""),
        String(req.body?.label || "")
      );
      const account = accounts.get(req.user, row.id);
      audit(db, req.user.id, "account.created", "channel_account", row.id, row.channel);
      res.status(201).json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  });

  app.post("/api/accounts/:id/login", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      const account = await accounts.beginLogin(req.user, id);
      audit(db, req.user.id, "account.login_started", "channel_account", id, account.channel);
      res.json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.post("/api/accounts/:id/password", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      const account = await accounts.submitPassword(req.user, id, req.body?.password);
      audit(db, req.user.id, "account.password_submitted", "channel_account", id);
      res.json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.post("/api/accounts/:id/logout", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      const account = await accounts.logout(req.user, id);
      audit(db, req.user.id, "account.logged_out", "channel_account", id);
      res.json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.post("/api/accounts/:id/relogin", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      await accounts.logout(req.user, id);
      const account = await accounts.beginLogin(req.user, id);
      audit(db, req.user.id, "account.relogin_started", "channel_account", id, account.channel);
      res.json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.post("/api/accounts/:id/reconnect", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      const account = await accounts.reconnect(req.user, id);
      audit(db, req.user.id, "account.reconnected", "channel_account", id, account.channel);
      res.json({ account });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.delete("/api/accounts/:id", requireAuth, asyncRoute(async (req, res) => {
    if (!accounts) return jsonError(res, 503, "个人号服务未启动");
    const id = parseId(req.params.id);
    if (!id) return jsonError(res, 404, "个人号账号不存在");
    try {
      await accounts.remove(req.user, id);
      audit(db, req.user.id, "account.removed", "channel_account", id);
      res.json({ ok: true });
    } catch (error) {
      return accountErrorResponse(res, error);
    }
  }));

  app.get("/api/conversations", requireAuth, (req, res) => {
    const mode = req.query.mode === "personal" ? "personal" : "shared";
    const result = listConversations(db, {
      scope: req.query.scope,
      status: req.query.status,
      q: req.query.q,
      mode,
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
      limit: req.query.limit,
      offset: req.query.offset
    });
    const counts = getConversationCounts(db, {
      mode,
      userId: req.user.id,
      isAdmin: req.user.role === "admin"
    });
    const mineWhere = ["assignee_id = ?"];
    const mineParams = [req.user.id];
    if (mode === "personal") {
      mineWhere.push("account_id IS NOT NULL");
    } else {
      mineWhere.push("account_id IS NULL");
    }
    counts.mine = Number(
      db.prepare(`SELECT COUNT(*) AS c FROM conversations WHERE ${mineWhere.join(" AND ")}`)
        .get(...mineParams).c
    );
    res.json({ ...result, counts, mode });
  });

  app.get("/api/conversations/:id", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");
    res.json({ conversation: toConversationSummary(conversation) });
  });

  app.get("/api/conversations/:id/ai-suggestion", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");
    res.json({ suggestion: getLatestAiSuggestion(db, id) });
  });

  app.patch("/api/conversations/:id/ai-suggestion/:suggestionId", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");
    const suggestionId = parseId(req.params.suggestionId);
    const suggestion = suggestionId ? getAiSuggestionById(db, suggestionId) : null;
    if (!suggestion || suggestion.conversation_id !== id) {
      return jsonError(res, 404, "AI 建议不存在");
    }
    const status = String(req.body?.status || "");
    if (!["used", "dismissed"].includes(status)) {
      return jsonError(res, 400, "AI 建议状态不合法");
    }
    updateAiSuggestionStatus(db, suggestionId, status);
    audit(db, req.user.id, "ai.suggestion_" + status, "conversation", id, String(suggestionId));
    res.json({ ok: true });
  });

  app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const result = listMessages(db, id, {
      before: req.query.before,
      limit: req.query.limit
    });
    res.json(result);
  });

  app.post("/api/conversations/:id/messages", requireAuth, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const text = String(req.body?.text || "").trim();
    if (!text) return jsonError(res, 400, "消息不能为空");
    if (text.length > config.maxMessageLength) {
      return jsonError(res, 400, `消息不能超过 ${config.maxMessageLength} 个字符`);
    }
    const channel = conversation.channel || "telegram";
    const targetLanguage = String(req.body?.targetLanguage || "auto").slice(0, 20);
    const service = conversation.account_id
      ? accounts
      : channel === "whatsapp" ? whatsapp
        : channel === "whatsapp_web" ? whatsappWeb
          : telegram;
    if (!conversation.account_id && !service?.configured) {
      return jsonError(res, 503, channel === "whatsapp"
        ? "未配置 WhatsApp Cloud API 凭据，暂时无法发送消息"
        : channel === "whatsapp_web"
          ? "WhatsApp 个人号未登录，请管理员在「渠道」中扫码"
          : "未配置 TELEGRAM_BOT_TOKEN，暂时无法发送消息");
    }

    try {
      const result = await service.sendReply(conversation, text, req.user, { targetLanguage });
      audit(db, req.user.id, "message.sent", "conversation", id, JSON.stringify({
        channel,
        length: text.length,
        targetLanguage
      }));
      res.status(201).json(result);
    } catch (error) {
      logger?.warn(`发送 ${channel} 消息失败`, error.message);
      const status = error.code === "NOT_CONFIGURED" ? 503
        : error.code === "TRANSLATION_NOT_CONFIGURED" ? 400
          : error.code === "INVALID_LANGUAGE" ? 400
            : error.code === "INVALID_INPUT" ? 400
              : 502;
      return jsonError(res, status, error.message || "发送消息失败");
    }
  }));

  app.delete("/api/messages/:id", requireAuth, asyncRoute(async (req, res) => {
    const messageId = parseId(req.params.id);
    const message = messageId ? getMessageById(db, messageId) : null;
    if (!message) return jsonError(res, 404, "消息不存在");
    const conversation = accessibleConversation(req, message.conversation_id);
    if (!conversation) return jsonError(res, 404, "消息不存在");
    if (message.deleted_at) return jsonError(res, 409, "消息已经删除");

    if (message.direction === "out" && req.user.role !== "admin" && message.sender_id !== req.user.id) {
      return jsonError(res, 403, "只能撤回自己发送的消息");
    }

    const remoteRequested = req.body?.remote !== false;
    let remote = false;
    let warning = "";
    if (remoteRequested) {
      const channel = conversation.channel || "telegram";
      const service = conversation.account_id
        ? accounts
        : channel === "whatsapp" ? whatsapp
          : channel === "whatsapp_web" ? whatsappWeb
            : channel === "telegram_user" ? accounts
              : telegram;
      try {
        if (!service?.deleteMessage) throw Object.assign(new Error("当前渠道不支持远程撤回"), { code: "NOT_SUPPORTED" });
        const result = conversation.account_id
          ? await accounts.deleteMessage(conversation, message)
          : await service.deleteMessage(conversation, message);
        remote = Boolean(result?.remote);
      } catch (error) {
        warning = error?.message || "远程撤回失败";
        logger?.warn("远程撤回消息失败", warning);
      }
    }

    const updated = softDeleteMessage(db, message.id, {
      deletedBy: req.user.id,
      scope: remote ? "remote" : "local",
      reason: warning || null
    });
    const conversationRow = getConversationById(db, conversation.id);
    const payload = {
      type: "message.deleted",
      conversationId: conversation.id,
      conversation: toConversationSummary(conversationRow),
      messageId: message.id,
      direction: message.direction,
      remote
    };
    if (broadcaster) {
      if (typeof broadcaster === "function") broadcaster(payload);
      else if (typeof broadcaster.broadcast === "function") broadcaster.broadcast(payload);
    }
    audit(
      db,
      req.user.id,
      message.direction === "out" ? "message.recalled" : "message.deleted",
      "message",
      message.id,
      JSON.stringify({ conversationId: conversation.id, remote, warning: warning || undefined })
    );
    res.json({
      ok: true,
      remote,
      warning,
      messageId: message.id,
      message: toPublicMessage(updated),
      conversation: payload.conversation
    });
  }));

  app.post("/api/conversations/:id/media", requireAuth, express.raw({
    type: "application/octet-stream",
    limit: "20mb"
  }), asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
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
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");
    const previousAssigneeId = conversation.assignee_id;

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
      if (req.user.role !== "admin") {
        return jsonError(res, 403, "只有管理员可以分配会话");
      }
      if (body.assigneeId !== null && body.assigneeId !== "") {
        assigneeId = parseId(body.assigneeId);
        if (!assigneeId) return jsonError(res, 400, "客服 ID 不合法");
        const assignee = db.prepare(
          "SELECT id, active, role FROM users WHERE id = ?"
        ).get(assigneeId);
        if (!assignee || !assignee.active || !["admin", "agent"].includes(assignee.role)) {
          return jsonError(res, 400, "客服不存在、已停用或不是客服账号");
        }
      }

      sets.push("assignee_id = ?");
      params.push(assigneeId);
      if (assigneeId === null) {
        sets.push("assigned_at = NULL");
      } else if (assigneeId !== previousAssigneeId) {
        sets.push("assigned_at = ?");
        params.push(nowIso());
      }
    }

    let nextStatus = null;
    if (hasStatus) {
      nextStatus = String(body.status);
      if (!["open", "pending", "closed"].includes(nextStatus)) {
        return jsonError(res, 400, "会话状态不合法");
      }
      sets.push("status = ?");
      params.push(nextStatus);
      if (nextStatus === "closed") {
        sets.push("resolved_at = COALESCE(resolved_at, ?)");
        params.push(nowIso());
      } else {
        sets.push("resolved_at = NULL");
      }
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
    if (summary.assigneeId !== null && previousAssigneeId !== summary.assigneeId) {
      broadcaster?.broadcastToAgents?.({ type: "conversation.removed", conversationId: id }, summary.assigneeId);
    }
    res.json({ conversation: summary });
  });

  const statsScope = req => req.user.role === "agent" ? { userId: req.user.id } : {};

  app.get("/api/stats", requireAuth, (req, res) => {
    res.json({
      stats: getStats(db, req.query.days, {
        ...statsScope(req),
        slaFirstResponseMinutes: config.slaFirstResponseMinutes
      })
    });
  });

  app.get("/api/stats/team-daily", requireAuth, (req, res) => {
    res.json({ stats: getTeamDailyStats(db, req.query.days, statsScope(req)) });
  });

  app.get("/api/stats/export.csv", requireAuth, (req, res) => {
    const stats = getStats(db, req.query.days, {
      ...statsScope(req),
      slaFirstResponseMinutes: config.slaFirstResponseMinutes
    });
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [[
      "客服", "用户名", "角色", "进人", "新分配", "当前接待", "待处理",
      "跟进中", "已关闭", "未读", "发出消息", "平均首响(分钟)", "平均解决(分钟)", "SLA超时"
    ]];
    for (const agent of stats.agents) {
      lines.push([
        agent.displayName,
        agent.username,
        agent.role === "admin" ? "管理员" : "客服",
        agent.newConversations,
        agent.newAssigned,
        agent.assigned,
        agent.open,
        agent.pending,
        agent.closed,
        agent.unread,
        agent.outbound,
        agent.avgFirstResponseMinutes ?? "",
        agent.avgResolutionMinutes ?? "",
        agent.slaBreaches
      ]);
    }
    const csv = "\uFEFF" + lines.map(row => row.map(quote).join(",")).join("\r\n");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="support-stats-${stats.rangeDays}d.csv"`);
    res.send(csv);
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
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");

    db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(
      nowIso(),
      id
    );
    broadcaster?.broadcast({
      type: "conversation.read",
      conversationId: id,
      unreadCount: 0,
      assigneeId: conversation.assignee_id
    });
    res.json({ ok: true });
  });

  app.post("/api/conversations/:id/unread", requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const conversation = accessibleConversation(req, id);
    if (!conversation) return jsonError(res, 404, "会话不存在");

    const unreadCount = Math.max(Number(conversation.unread_count || 0), 1);
    db.prepare("UPDATE conversations SET unread_count = ?, updated_at = ? WHERE id = ?").run(
      unreadCount,
      nowIso(),
      id
    );
    broadcaster?.broadcast({
      type: "conversation.unread",
      conversationId: id,
      unreadCount,
      assigneeId: conversation.assignee_id
    });
    res.json({ ok: true, unreadCount });
  });

  app.get("/api/messages/:id/media", requireAuth, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const message = id ? getMessageById(db, id) : null;
    if (!message) return jsonError(res, 404, "消息不存在");

    const conversation = accessibleConversation(req, message.conversation_id);
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
    broadcaster.add(res, req.user);

    req.on("close", () => {
      broadcaster.remove(res);
    });
  });

  app.get("/go", (req, res) => {
    const whatsappNumber = String(config.supportWhatsAppNumber || "").replace(/\D/g, "");
    const telegramBot = String(config.supportTelegramBot || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
    const telegramUsername = String(config.supportTelegramUsername || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
    const prefill = String(config.supportGoMessage || "你好，我在 Snapchat 看到你们，想咨询一下。");
    const whatsappUrl = whatsappNumber
      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(prefill)}`
      : "";
    const telegramUrl = telegramBot
      ? `https://t.me/${telegramBot}?start=snapchat`
      : telegramUsername
        ? `https://t.me/${telegramUsername}`
        : "";

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");

    const to = String(req.query.to || "").toLowerCase();
    if (to === "whatsapp" || to === "wa") {
      if (!whatsappUrl) return res.status(503).type("html").send(renderSupportGoPage({
        whatsappUrl, telegramUrl, prefill, configured: false
      }));
      return res.redirect(302, whatsappUrl);
    }
    if (to === "telegram" || to === "tg") {
      if (!telegramUrl) return res.status(503).type("html").send(renderSupportGoPage({
        whatsappUrl, telegramUrl, prefill, configured: false
      }));
      return res.redirect(302, telegramUrl);
    }

    res.type("html").send(renderSupportGoPage({
      whatsappUrl,
      telegramUrl,
      prefill,
      configured: Boolean(whatsappUrl || telegramUrl)
    }));
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
