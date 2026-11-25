const { toConversationSummary, toPublicMessage, toCannedReply } = require("./util");

const CONVERSATION_SELECT = `
  SELECT c.*,
         u.display_name AS assignee_display_name,
         u.username AS assignee_username
  FROM conversations c
  LEFT JOIN users u ON u.id = c.assignee_id
`;

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, ch => "\\" + ch);
}

function getConversationById(db, id) {
  return db.prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).get(id);
}

function getConversationByChatId(db, chatId) {
  return db.prepare(`${CONVERSATION_SELECT} WHERE c.telegram_chat_id = ?`).get(String(chatId));
}

function listConversations(db, options) {
  const scope = ["mine", "unassigned", "all"].includes(options.scope) ? options.scope : "all";
  const status = ["open", "pending", "closed", "all"].includes(options.status) ? options.status : "open";
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const where = [];
  const params = [];

  if (options.isAdmin === false) {
    where.push("c.assignee_id = ?");
    params.push(options.userId);
  }

  if (scope === "mine") {
    where.push("c.assignee_id = ?");
    params.push(options.userId);
  } else if (scope === "unassigned") {
    where.push("c.assignee_id IS NULL");
  }

  if (status !== "all") {
    where.push("c.status = ?");
    params.push(status);
  }

  const query = String(options.q || "").trim();
  if (query) {
    const pattern = "%" + escapeLike(query) + "%";
    where.push(`(c.title LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\'
      OR c.last_message_preview LIKE ? ESCAPE '\\'
      OR c.tags_json LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM conversations c${whereSql}`).get(...params).c
  );
  const rows = db.prepare(
    `${CONVERSATION_SELECT}${whereSql}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return {
    items: rows.map(toConversationSummary),
    total,
    limit,
    offset
  };
}

function getConversationCounts(db, options = {}) {
  const where = options.isAdmin === false ? " WHERE assignee_id = ?" : "";
  const params = options.isAdmin === false ? [options.userId] : [];
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
     FROM conversations${where}`
  ).get(...params);

  return {
    all: Number(row.total || 0),
    unassigned: Number(row.unassigned || 0),
    open: Number(row.open || 0),
    pending: Number(row.pending || 0),
    closed: Number(row.closed || 0)
  };
}

function listMessages(db, conversationId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const before = String(options.before || "").slice(0, 40);
  const params = [conversationId];
  let where = "WHERE conversation_id = ?";

  if (before) {
    where += " AND created_at < ?";
    params.push(before);
  }

  const rows = db.prepare(
    `SELECT * FROM messages
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const list = rows.slice(0, limit).reverse().map(toPublicMessage);
  return { messages: list, hasMore };
}

function getMessageById(db, id) {
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
}

function getStats(db, days = 7) {
  const rangeDays = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 30);
  const now = new Date();
  const startDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (rangeDays - 1)
  ));
  const startIso = startDate.toISOString();
  const counts = getConversationCounts(db);

  const messageTotals = db.prepare(
    `SELECT SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS inbound,
            SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outbound
     FROM messages WHERE created_at >= ?`
  ).get(startIso);

  const newConversations = Number(
    db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE created_at >= ?").get(startIso).c
  );
  const assignedTotals = db.prepare(
    `SELECT COUNT(*) AS assigned,
            COALESCE(SUM(unread_count), 0) AS unread
     FROM conversations WHERE assignee_id IS NOT NULL`
  ).get();
  const newAssigned = Number(
    db.prepare(
      `SELECT COUNT(*) AS c FROM conversations
       WHERE assignee_id IS NOT NULL AND assigned_at >= ?`
    ).get(startIso).c
  );

  const dailyRows = db.prepare(
    `SELECT substr(created_at, 1, 10) AS day,
            SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS inbound,
            SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outbound
     FROM messages
     WHERE created_at >= ?
     GROUP BY day`
  ).all(startIso);
  const newRows = db.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c
     FROM conversations WHERE created_at >= ? GROUP BY day`
  ).all(startIso);
  const dailyMap = new Map();
  for (const row of dailyRows) {
    dailyMap.set(row.day, {
      inbound: Number(row.inbound || 0),
      outbound: Number(row.outbound || 0),
      newConversations: 0
    });
  }
  for (const row of newRows) {
    const item = dailyMap.get(row.day) || { inbound: 0, outbound: 0, newConversations: 0 };
    item.newConversations = Number(row.c || 0);
    dailyMap.set(row.day, item);
  }

  const daily = [];
  for (let index = 0; index < rangeDays; index++) {
    const day = new Date(startDate);
    day.setUTCDate(startDate.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const item = dailyMap.get(key) || { inbound: 0, outbound: 0, newConversations: 0 };
    daily.push({ date: key, ...item });
  }

  const outboundByAgent = new Map(
    db.prepare(
      `SELECT sender_id, COUNT(*) AS c
       FROM messages
       WHERE direction = 'out' AND sender_id IS NOT NULL AND created_at >= ?
       GROUP BY sender_id`
    ).all(startIso).map(row => [row.sender_id, Number(row.c || 0)])
  );

  const agents = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role,
            COUNT(c.id) AS assigned,
            SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END) AS closed,
            (SELECT COUNT(*) FROM conversations n
             WHERE n.assignee_id = u.id AND n.created_at >= ?) AS new_conversations,
            (SELECT COUNT(*) FROM conversations a
             WHERE a.assignee_id = u.id AND a.assigned_at >= ?) AS new_assigned,
            (SELECT COALESCE(SUM(r.unread_count), 0) FROM conversations r
             WHERE r.assignee_id = u.id) AS unread
     FROM users u
     LEFT JOIN conversations c ON c.assignee_id = u.id
     WHERE u.active = 1 AND u.role IN ('admin', 'agent')
     GROUP BY u.id
     ORDER BY assigned DESC, u.display_name ASC`
  ).all(startIso, startIso).map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    newConversations: Number(row.new_conversations || 0),
    newAssigned: Number(row.new_assigned || 0),
    assigned: Number(row.assigned || 0),
    open: Number(row.open || 0),
    pending: Number(row.pending || 0),
    closed: Number(row.closed || 0),
    unread: Number(row.unread || 0),
    outbound: outboundByAgent.get(row.id) || 0
  }));

  return {
    rangeDays,
    start: startIso,
    end: now.toISOString(),
    totals: {
      conversations: counts.all,
      open: counts.open,
      pending: counts.pending,
      closed: counts.closed,
      unassigned: counts.unassigned,
      assigned: Number(assignedTotals.assigned || 0),
      unread: Number(assignedTotals.unread || 0),
      messagesIn: Number(messageTotals.inbound || 0),
      messagesOut: Number(messageTotals.outbound || 0),
      newConversations,
      newAssigned,
      activeAgents: agents.length
    },
    daily,
    agents
  };
}

function listCannedReplies(db) {
  const rows = db.prepare(
    `SELECT r.*, u.display_name AS created_by_name
     FROM canned_replies r
     LEFT JOIN users u ON u.id = r.created_by
     ORDER BY r.updated_at DESC, r.id DESC`
  ).all();
  return rows.map(toCannedReply);
}

function getCannedReplyById(db, id) {
  return db.prepare(
    `SELECT r.*, u.display_name AS created_by_name
     FROM canned_replies r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.id = ?`
  ).get(id);
}

function getConversationMessagesForExport(db, conversationId) {
  return db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC"
  ).all(conversationId).map(toPublicMessage);
}

module.exports = {
  CONVERSATION_SELECT,
  escapeLike,
  getConversationById,
  getConversationByChatId,
  listConversations,
  getConversationCounts,
  listMessages,
  getMessageById,
  getConversationMessagesForExport,
  listCannedReplies,
  getCannedReplyById,
  getStats
};
