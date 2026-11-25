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

function getConversationCounts(db) {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
     FROM conversations`
  ).get();

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
  getCannedReplyById
};
