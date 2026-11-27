const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createWhatsAppWebService, readCreds } = require("./whatsapp-web");
const { createTelegramUserService, sessionExists } = require("./telegram-user");
const { nowIso } = require("./util");

const CHANNELS = new Set(["whatsapp_web", "telegram_user"]);

class AccountError extends Error {
  constructor(message, code = "ACCOUNT_ERROR") {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

function channelLabel(channel) {
  return channel === "whatsapp_web" ? "WhatsApp" : channel === "telegram_user" ? "Telegram" : channel;
}

function createAccountsService({ db, config, logger, broadcaster, translate, hooks = {}, whatsappFactory, telegramFactory }) {
  const services = new Map();
  const accountsDir = config.accountsDir || path.join(config.dataDir || config.root, "accounts");

  function enabled() {
    return config.personalAccountsEnabled !== false;
  }

  function channelAvailable(channel) {
    if (channel === "whatsapp_web") return Boolean(config.whatsappWebEnabled);
    if (channel === "telegram_user") {
      return Boolean(config.telegramUserEnabled && Number(config.telegramUserApiId) > 0 && config.telegramUserApiHash);
    }
    return false;
  }

  function channelHint(channel) {
    if (channelAvailable(channel)) return "";
    if (channel === "whatsapp_web") {
      return "服务器未启用 WHATSAPP_WEB_ENABLED，暂时无法绑定 WhatsApp 个人号";
    }
    if (channel === "telegram_user") {
      return "服务器未配置 TELEGRAM_USER_ENABLED / TELEGRAM_USER_API_ID / TELEGRAM_USER_API_HASH，暂时无法绑定 Telegram 个人号";
    }
    return "不支持的渠道";
  }

  function rowById(id) {
    return db.prepare(
      `SELECT a.*, u.display_name AS owner_display_name, u.username AS owner_username
       FROM channel_accounts a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.id = ?`
    ).get(id);
  }

  function rowsForUser(user, all = false) {
    if (all && user?.role === "admin") {
      return db.prepare(
        `SELECT a.*, u.display_name AS owner_display_name, u.username AS owner_username
         FROM channel_accounts a
         LEFT JOIN users u ON u.id = a.owner_id
         ORDER BY a.owner_id, a.channel`
      ).all();
    }
    return db.prepare(
      `SELECT a.*, u.display_name AS owner_display_name, u.username AS owner_username
       FROM channel_accounts a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.owner_id = ?
       ORDER BY a.channel`
    ).all(user.id);
  }

  function canManage(user, row) {
    return Boolean(row) && (user?.role === "admin" || row.owner_id === user?.id);
  }

  function fallbackStatus(row) {
    const channelOk = channelAvailable(row.channel);
    return {
      enabled: channelOk,
      accountId: row.id,
      ownerId: row.owner_id,
      configured: false,
      running: false,
      loginInProgress: false,
      qr: null,
      me: null,
      error: channelOk ? null : channelHint(row.channel),
      passwordRequired: false,
      passwordHint: ""
    };
  }

  function serviceFor(row) {
    if (!row) return null;
    const existing = services.get(row.id);
    if (existing) return existing;

    const common = {
      db,
      config,
      logger,
      broadcaster,
      translate,
      hooks,
      account: row
    };
    const service = row.channel === "whatsapp_web"
      ? (whatsappFactory ? whatsappFactory(common) : createWhatsAppWebService(common))
      : (telegramFactory ? telegramFactory(common) : createTelegramUserService(common));
    services.set(row.id, service);
    return service;
  }

  function rememberIdentity(row, status) {
    if (!row || !status?.me) return;
    const externalId = String(status.me.id || status.me.username || "");
    const displayName = String(
      status.me.name ||
      [status.me.firstName, status.me.lastName].filter(Boolean).join(" ") ||
      status.me.username ||
      ""
    );
    if (!externalId && !displayName) return;
    if (externalId === (row.external_id || "") && displayName === (row.display_name || "")) return;
    db.prepare(
      `UPDATE channel_accounts
       SET external_id = ?, display_name = ?, updated_at = ?
       WHERE id = ?`
    ).run(externalId || null, displayName || null, nowIso(), row.id);
  }

  function serialize(row, withStatus = true) {
    const service = services.get(row.id);
    const status = withStatus
      ? (service ? service.status() : fallbackStatus(row))
      : null;
    if (status) rememberIdentity(row, status);
    return {
      id: row.id,
      channel: row.channel,
      channelLabel: channelLabel(row.channel),
      ownerId: row.owner_id,
      ownerName: row.owner_display_name || row.owner_username || "",
      label: row.label,
      externalId: row.external_id || "",
      displayName: row.display_name || "",
      available: channelAvailable(row.channel),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status
    };
  }

  function list(user, options = {}) {
    return rowsForUser(user, Boolean(options.all)).map(row => serialize(row));
  }

  function get(user, id) {
    const row = rowById(id);
    if (!canManage(user, row)) return null;
    return serialize(row);
  }

  function ensureAccount(user, channel, label) {
    if (!enabled()) {
      throw new AccountError("个人号模式未启用", "NOT_CONFIGURED");
    }
    if (!CHANNELS.has(channel)) {
      throw new AccountError("不支持的渠道", "INVALID_INPUT");
    }
    if (!channelAvailable(channel)) {
      throw new AccountError(channelHint(channel), "NOT_CONFIGURED");
    }

    const existing = db.prepare(
      "SELECT * FROM channel_accounts WHERE channel = ? AND owner_id = ?"
    ).get(channel, user.id);
    if (existing) {
      if (label && label !== existing.label) {
        db.prepare("UPDATE channel_accounts SET label = ?, updated_at = ? WHERE id = ?")
          .run(label, nowIso(), existing.id);
      }
      return rowById(existing.id);
    }

    const sessionPath = path.join(
      accountsDir,
      channel,
      `${user.id}-${randomUUID()}`
    );
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
    const now = nowIso();
    const result = db.prepare(
      `INSERT INTO channel_accounts
         (channel, owner_id, label, session_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      channel,
      user.id,
      String(label || `${channelLabel(channel)} 个人号`).slice(0, 60),
      sessionPath,
      now,
      now
    );
    return rowById(Number(result.lastInsertRowid));
  }

  async function startAll() {
    if (!enabled()) return;
    const rows = db.prepare("SELECT * FROM channel_accounts").all();
    for (const row of rows) {
      if (!channelAvailable(row.channel)) continue;
      const service = serviceFor(row);
      try {
        await service.start();
      } catch (error) {
        logger?.warn(`个人号 ${row.id} 启动失败`, error?.message || String(error));
      }
    }
  }

  async function beginLogin(user, id) {
    const row = rowById(id);
    if (!canManage(user, row)) throw new AccountError("账号不存在", "NOT_FOUND");
    if (!channelAvailable(row.channel)) throw new AccountError(channelHint(row.channel), "NOT_CONFIGURED");
    const service = serviceFor(row);
    const status = await service.beginLogin();
    rememberIdentity(row, status);
    return serialize(rowById(id));
  }

  async function submitPassword(user, id, password) {
    const row = rowById(id);
    if (!canManage(user, row)) throw new AccountError("账号不存在", "NOT_FOUND");
    const service = services.get(row.id);
    if (!service?.submitPassword) throw new AccountError("当前账号不需要两步验证密码", "INVALID_INPUT");
    await service.submitPassword(password);
    return serialize(rowById(id));
  }

  async function logout(user, id) {
    const row = rowById(id);
    if (!canManage(user, row)) throw new AccountError("账号不存在", "NOT_FOUND");
    const service = services.get(row.id);
    if (service) await service.logout();
    else {
      try { fs.rmSync(row.session_path, { recursive: true, force: true }); } catch {}
    }
    db.prepare("UPDATE channel_accounts SET external_id = NULL, display_name = NULL, updated_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    return serialize(rowById(id));
  }

  async function remove(user, id) {
    const row = rowById(id);
    if (!canManage(user, row)) throw new AccountError("账号不存在", "NOT_FOUND");
    const count = Number(
      db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE account_id = ?").get(id).c
    );
    if (count > 0) {
      throw new AccountError("该账号已有会话，不能删除；可以先退出登录", "CONFLICT");
    }
    const service = services.get(row.id);
    if (service) {
      try { await service.logout(); } catch {}
      services.delete(row.id);
    }
    try { fs.rmSync(row.session_path, { recursive: true, force: true }); } catch {}
    db.prepare("DELETE FROM channel_accounts WHERE id = ?").run(id);
    return { ok: true };
  }

  async function sendReply(conversation, text, user, options = {}) {
    const row = conversation?.account_id ? rowById(conversation.account_id) : null;
    if (!row) throw new AccountError("个人号账号不存在", "NOT_CONFIGURED");
    const service = serviceFor(row);
    if (!service.running) throw new AccountError(`${channelLabel(row.channel)} 个人号未登录`, "NOT_CONFIGURED");
    return service.sendReply(conversation, text, user, options);
  }

  async function deleteMessage(conversation, message) {
    const row = conversation?.account_id ? rowById(conversation.account_id) : null;
    if (!row) throw new AccountError("个人号账号不存在", "NOT_CONFIGURED");
    const service = serviceFor(row);
    if (typeof service.deleteMessage !== "function") {
      throw new AccountError("当前个人号渠道不支持撤回消息", "NOT_SUPPORTED");
    }
    return service.deleteMessage(conversation, message);
  }

  async function reconnect(user, id) {
    const row = rowById(id);
    if (!canManage(user, row)) throw new AccountError("账号不存在", "NOT_FOUND");
    if (!channelAvailable(row.channel)) throw new AccountError(channelHint(row.channel), "NOT_CONFIGURED");
    const service = serviceFor(row);
    await service.stop();
    await service.start();
    return serialize(rowById(id));
  }

  async function stopAll() {
    const list = [...services.values()];
    services.clear();
    await Promise.allSettled(list.map(service => service.stop()));
  }

  return {
    get enabled() {
      return enabled();
    },
    channelAvailable,
    channelHint,
    list,
    get,
    ensureAccount,
    startAll,
    beginLogin,
    submitPassword,
    logout,
    remove,
    reconnect,
    sendReply,
    deleteMessage,
    stopAll
  };
}

module.exports = {
  AccountError,
  CHANNELS,
  channelLabel,
  createAccountsService
};
