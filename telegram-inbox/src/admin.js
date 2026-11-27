const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nowIso } = require("./util");

const BACKUP_RE = /^inbox-\d{8}-\d{6}-\d{3}\.db$/;

function createAdminService({ db, config, logger, telegram, whatsapp, whatsappWeb, accounts }) {
  const backupDir = path.join(config.dataDir, "backups");

  function fileSize(file) {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  function diskStatus() {
    try {
      const stats = fs.statfsSync(config.dataDir);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      return { total, free, used: Math.max(0, total - free) };
    } catch {
      return null;
    }
  }

  function accountSummary() {
    if (!accounts) return { total: 0, online: 0, byChannel: {}, errors: [] };
    let rows = [];
    try {
      rows = accounts.list({ role: "admin" }, { all: true });
    } catch (error) {
      return { total: 0, online: 0, byChannel: {}, errors: [{ message: error.message }] };
    }
    const byChannel = {};
    const errors = [];
    let online = 0;
    for (const account of rows) {
      const channel = account.channel;
      byChannel[channel] = byChannel[channel] || { total: 0, online: 0 };
      byChannel[channel].total += 1;
      if (account.status?.running) {
        online += 1;
        byChannel[channel].online += 1;
      }
      if (account.status?.error) {
        errors.push({
          id: account.id,
          channel,
          ownerName: account.ownerName,
          error: account.status.error
        });
      }
    }
    return { total: rows.length, online, byChannel, errors };
  }

  function systemStatus() {
    const memory = process.memoryUsage();
    const database = {
      path: config.dbPath,
      size: fileSize(config.dbPath),
      walSize: fileSize(config.dbPath + "-wal"),
      shmSize: fileSize(config.dbPath + "-shm")
    };
    return {
      now: nowIso(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        systemTotal: os.totalmem(),
        systemFree: os.freemem()
      },
      disk: diskStatus(),
      database,
      channels: {
        telegram: {
          configured: Boolean(telegram?.configured),
          running: Boolean(telegram?.running),
          source: telegram?.tokenSource || "none"
        },
        whatsapp: {
          configured: Boolean(whatsapp?.configured),
          source: whatsapp?.source || "none",
          phoneNumberId: whatsapp?.phoneNumberId || ""
        },
        whatsappWeb: whatsappWeb?.status?.() || { enabled: false, running: false },
        personalAccounts: Boolean(accounts?.enabled)
      },
      accounts: accountSummary(),
      recentErrors: logger?.recent?.(30, "error") || [],
      recentWarnings: logger?.recent?.(20, "warn") || []
    };
  }

  function listAudit({ limit = 100, offset = 0, action = "", userId = null } = {}) {
    const max = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
    const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
    const where = [];
    const params = [];
    if (action) {
      where.push("a.action LIKE ?");
      params.push("%" + String(action).trim() + "%");
    }
    if (userId) {
      where.push("a.user_id = ?");
      params.push(Number(userId));
    }
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const total = Number(db.prepare(
      `SELECT COUNT(*) AS c FROM audit_logs a${whereSql}`
    ).get(...params).c);
    const rows = db.prepare(
      `SELECT a.*, u.display_name AS user_display_name, u.username AS user_username
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`
    ).all(...params, max, skip);
    return {
      total,
      limit: max,
      offset: skip,
      items: rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_display_name || row.user_username || "",
        username: row.user_username || "",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail,
        createdAt: row.created_at
      }))
    };
  }

  function createBackup() {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    const millis = String(new Date().getMilliseconds()).padStart(3, "0");
    const name = `inbox-${stamp}-${millis}.db`;
    const target = path.join(backupDir, name);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(config.dbPath, target);
    fs.chmodSync(target, 0o600);
    return backupInfo(name);
  }

  function backupInfo(name) {
    const file = path.join(backupDir, name);
    const stats = fs.statSync(file);
    return {
      name,
      size: stats.size,
      createdAt: stats.mtime.toISOString()
    };
  }

  function listBackups() {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter(name => BACKUP_RE.test(name))
      .map(name => {
        try {
          return backupInfo(name);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function backupPath(name) {
    const safe = path.basename(String(name || ""));
    if (!BACKUP_RE.test(safe)) return null;
    const file = path.join(backupDir, safe);
    return fs.existsSync(file) ? file : null;
  }

  function exportConversationsCsv() {
    const rows = db.prepare(
      `SELECT c.id, c.channel, c.account_id, a.label AS account_label,
              ao.display_name AS account_owner_name,
              c.title, c.username, c.status, c.assignee_id,
              u.display_name AS assignee_name, c.created_at, c.last_message_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
              c.tags_json, c.notes
       FROM conversations c
       LEFT JOIN channel_accounts a ON a.id = c.account_id
       LEFT JOIN users ao ON ao.id = a.owner_id
       LEFT JOIN users u ON u.id = c.assignee_id
       ORDER BY c.id ASC`
    ).all();
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = [
      "会话ID", "渠道", "个人号", "个人号归属", "客户", "用户名", "状态",
      "客服", "创建时间", "最后消息时间", "消息数", "标签", "备注"
    ];
    const lines = [header];
    for (const row of rows) {
      lines.push([
        row.id,
        row.channel,
        row.account_label || "",
        row.account_owner_name || "",
        row.title,
        row.username || "",
        row.status,
        row.assignee_name || "",
        row.created_at,
        row.last_message_at || "",
        row.message_count,
        row.tags_json,
        row.notes
      ]);
    }
    return "\uFEFF" + lines.map(line => line.map(quote).join(",")).join("\r\n");
  }

  function cleanupOldMessages({ days = 30, dryRun = true } = {}) {
    const keepDays = Math.min(Math.max(Number.parseInt(days, 10) || 30, 1), 3650);
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
    const count = Number(
      db.prepare("SELECT COUNT(*) AS c FROM messages WHERE created_at < ?").get(cutoff).c
    );
    if (dryRun) return { days: keepDays, cutoff, deleted: 0, wouldDelete: count, dryRun: true };
    const result = db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return {
      days: keepDays,
      cutoff,
      deleted: Number(result.changes || 0),
      wouldDelete: count,
      dryRun: false
    };
  }

  async function diagnostics() {
    let telegramInfo = null;
    let telegramWarning = null;
    if (telegram?.configured) {
      try {
        telegramInfo = await telegram.getBotInfo();
      } catch (error) {
        telegramWarning = error.message;
      }
    }
    let whatsappInfo = null;
    let whatsappWarning = null;
    if (whatsapp?.configured) {
      try {
        whatsappInfo = await whatsapp.getInfo();
      } catch (error) {
        whatsappWarning = error.message;
      }
    }
    const accountRows = accounts
      ? accounts.list({ role: "admin" }, { all: true }).map(account => ({
        id: account.id,
        channel: account.channel,
        ownerId: account.ownerId,
        ownerName: account.ownerName,
        label: account.label,
        displayName: account.displayName,
        available: account.available,
        status: {
          enabled: account.status?.enabled,
          configured: account.status?.configured,
          running: account.status?.running,
          loginInProgress: account.status?.loginInProgress,
          error: account.status?.error,
          me: account.status?.me || null
        }
      }))
      : [];
    return {
      telegram: {
        configured: Boolean(telegram?.configured),
        running: Boolean(telegram?.running),
        source: telegram?.tokenSource || "none",
        bot: telegramInfo,
        warning: telegramWarning
      },
      whatsapp: {
        configured: Boolean(whatsapp?.configured),
        source: whatsapp?.source || "none",
        phoneNumberId: whatsapp?.phoneNumberId || "",
        hasVerifyToken: Boolean(whatsapp?.hasVerifyToken),
        hasAppSecret: Boolean(whatsapp?.hasAppSecret),
        info: whatsappInfo,
        warning: whatsappWarning
      },
      whatsappWeb: (() => {
        const status = whatsappWeb?.status?.() || { enabled: false, running: false };
        return {
          enabled: Boolean(status.enabled),
          configured: Boolean(status.configured),
          running: Boolean(status.running),
          loginInProgress: Boolean(status.loginInProgress),
          qr: status.loginInProgress ? status.qr : null,
          error: status.error || null,
          me: status.me || null
        };
      })(),
      accounts: accountRows,
      recentErrors: logger?.recent?.(50, "error") || [],
      recentWarnings: logger?.recent?.(30, "warn") || []
    };
  }

  return {
    systemStatus,
    listAudit,
    createBackup,
    listBackups,
    backupPath,
    exportConversationsCsv,
    cleanupOldMessages,
    diagnostics
  };
}

module.exports = { createAdminService };
