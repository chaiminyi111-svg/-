const {
  messagePreview,
  nowIso,
  toConversationSummary,
  toPublicMessage,
  toPublicAiSuggestion,
  toCannedReply
} = require("./util");

const CONVERSATION_SELECT = `
  SELECT c.*,
         u.display_name AS assignee_display_name,
         u.username AS assignee_username,
         u.ai_allowed AS assignee_ai_allowed,
         u.ai_enabled AS assignee_ai_enabled,
         u.ai_mode AS assignee_ai_mode,
         a.label AS account_label,
         a.owner_id AS account_owner_id,
         a.display_name AS account_display_name,
         ao.display_name AS account_owner_name
  FROM conversations c
  LEFT JOIN users u ON u.id = c.assignee_id
  LEFT JOIN channel_accounts a ON a.id = c.account_id
  LEFT JOIN users ao ON ao.id = a.owner_id
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

function applyModeFilter(where, params, options) {
  const mode = options.mode === "personal" ? "personal" : options.mode === "shared" ? "shared" : "all";
  if (mode === "shared") {
    where.push("c.account_id IS NULL");
  } else if (mode === "personal") {
    where.push("c.account_id IS NOT NULL");
    if (options.isAdmin === false) {
      where.push("c.account_id IN (SELECT id FROM channel_accounts WHERE owner_id = ?)");
      params.push(options.userId);
    }
  }
}

function listConversations(db, options) {
  const scope = ["mine", "unassigned", "all"].includes(options.scope) ? options.scope : "all";
  const status = ["open", "pending", "closed", "all"].includes(options.status) ? options.status : "open";
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const where = [];
  const params = [];

  applyModeFilter(where, params, options);

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
  const where = [];
  const params = [];
  applyModeFilter(where, params, options);
  if (options.isAdmin === false) {
    where.push("assignee_id = ?");
    params.push(options.userId);
  }
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
     FROM conversations c${whereSql}`
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
     ${where} AND deleted_at IS NULL
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

function refreshConversationPreview(db, conversationId) {
  const last = db.prepare(
    `SELECT body, direction, created_at FROM messages
     WHERE conversation_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(conversationId);
  if (!last) {
    db.prepare(
      `UPDATE conversations
       SET last_message_at = NULL, last_message_preview = '', last_message_direction = NULL
       WHERE id = ?`
    ).run(conversationId);
    return;
  }
  db.prepare(
    `UPDATE conversations
     SET last_message_at = ?, last_message_preview = ?, last_message_direction = ?
     WHERE id = ?`
  ).run(last.created_at, messagePreview(last.body), last.direction, conversationId);
}

function softDeleteMessage(db, messageId, options = {}) {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
  if (!row) return null;
  if (row.deleted_at) return row;
  db.prepare(
    `UPDATE messages
     SET deleted_at = ?, deleted_by = ?, deletion_scope = ?, deletion_reason = ?
     WHERE id = ?`
  ).run(
    nowIso(),
    options.deletedBy || null,
    options.scope || "local",
    options.reason || null,
    messageId
  );
  refreshConversationPreview(db, row.conversation_id);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
}

function roundMinutes(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function getStats(db, days = 7, options = {}) {
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
     FROM messages WHERE created_at >= ? AND deleted_at IS NULL`
  ).get(startIso);

  const newConversations = Number(
    db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE created_at >= ?").get(startIso).c
  );
  const assignedTotals = db.prepare(
    "SELECT COUNT(*) AS assigned FROM conversations WHERE assignee_id IS NOT NULL"
  ).get();
  const totalUnread = Number(
    db.prepare("SELECT COALESCE(SUM(unread_count), 0) AS unread FROM conversations").get().unread || 0
  );
  const unanswered = Number(
    db.prepare(
      `SELECT COUNT(*) AS c FROM conversations
       WHERE status != 'closed' AND last_message_direction = 'in'`
    ).get().c || 0
  );
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
     WHERE created_at >= ? AND deleted_at IS NULL
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
         AND deleted_at IS NULL
       GROUP BY sender_id`
    ).all(startIso).map(row => [row.sender_id, Number(row.c || 0)])
  );

  const slaTargetMinutes = Math.max(Number(options.slaFirstResponseMinutes) || 15, 1);
  const responseRows = db.prepare(
    `SELECT assignee_id,
            AVG(CASE WHEN first_response_at IS NOT NULL
                     THEN (julianday(first_response_at) - julianday(created_at)) * 1440 END) AS avg_first,
            AVG(CASE WHEN resolved_at IS NOT NULL
                     THEN (julianday(resolved_at) - julianday(created_at)) * 1440 END) AS avg_resolution,
            SUM(CASE WHEN
                  (first_response_at IS NOT NULL
                   AND (julianday(first_response_at) - julianday(created_at)) * 1440 > ?)
                  OR (first_response_at IS NULL AND status != 'closed'
                      AND (julianday('now') - julianday(created_at)) * 1440 > ?)
                THEN 1 ELSE 0 END) AS sla_breaches,
            COUNT(*) AS assigned_in_range
     FROM conversations
     WHERE assignee_id IS NOT NULL AND created_at >= ?
     GROUP BY assignee_id`
  ).all(slaTargetMinutes, slaTargetMinutes, startIso);
  const responseByAgent = new Map(responseRows.map(row => [row.assignee_id, row]));
  const responseTotals = db.prepare(
    `SELECT AVG(CASE WHEN first_response_at IS NOT NULL
                     THEN (julianday(first_response_at) - julianday(created_at)) * 1440 END) AS avg_first,
            AVG(CASE WHEN resolved_at IS NOT NULL
                     THEN (julianday(resolved_at) - julianday(created_at)) * 1440 END) AS avg_resolution,
            SUM(CASE WHEN
                  (first_response_at IS NOT NULL
                   AND (julianday(first_response_at) - julianday(created_at)) * 1440 > ?)
                  OR (first_response_at IS NULL AND status != 'closed'
                      AND (julianday('now') - julianday(created_at)) * 1440 > ?)
                THEN 1 ELSE 0 END) AS sla_breaches,
            COUNT(*) AS assigned_in_range
     FROM conversations
     WHERE assignee_id IS NOT NULL AND created_at >= ?`
  ).get(slaTargetMinutes, slaTargetMinutes, startIso);

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
             WHERE r.assignee_id = u.id) AS unread,
            (SELECT COUNT(*) FROM conversations w
             WHERE w.assignee_id = u.id AND w.status != 'closed'
               AND w.last_message_direction = 'in') AS unanswered
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
    unanswered: Number(row.unanswered || 0),
    outbound: outboundByAgent.get(row.id) || 0,
    avgFirstResponseMinutes: roundMinutes(responseByAgent.get(row.id)?.avg_first),
    avgResolutionMinutes: roundMinutes(responseByAgent.get(row.id)?.avg_resolution),
    slaBreaches: Number(responseByAgent.get(row.id)?.sla_breaches || 0),
    assignedInRange: Number(responseByAgent.get(row.id)?.assigned_in_range || 0),
    slaComplianceRate: Number(responseByAgent.get(row.id)?.assigned_in_range || 0)
      ? Math.round((1 - Number(responseByAgent.get(row.id)?.sla_breaches || 0)
        / Number(responseByAgent.get(row.id)?.assigned_in_range || 1)) * 1000) / 10
      : 100
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
      unread: totalUnread,
      messagesIn: Number(messageTotals.inbound || 0),
      messagesOut: Number(messageTotals.outbound || 0),
      newConversations,
      newAssigned,
      activeAgents: agents.length,
      avgFirstResponseMinutes: roundMinutes(responseTotals?.avg_first),
      avgResolutionMinutes: roundMinutes(responseTotals?.avg_resolution),
      slaBreaches: Number(responseTotals?.sla_breaches || 0),
      slaComplianceRate: Number(responseTotals?.assigned_in_range || 0)
        ? Math.round((1 - Number(responseTotals?.sla_breaches || 0)
          / Number(responseTotals?.assigned_in_range || 1)) * 1000) / 10
        : 100,
      unanswered,
      slaTargetMinutes
    },
    daily,
    agents
  };
}

function getTeamDailyStats(db, days = 7) {
  const rangeDays = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 30);
  const now = new Date();
  const startDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (rangeDays - 1)
  ));
  const startIso = startDate.toISOString();

  const users = db.prepare(
    `SELECT id, username, display_name, role
     FROM users
     WHERE active = 1 AND role IN ('admin', 'agent')
     ORDER BY display_name ASC, id ASC`
  ).all().map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role
  }));

  const contactKey = row => {
    const username = String(row.username || "").trim().toLowerCase();
    if (username) return "username:" + username;
    const title = String(row.title || "").trim().toLowerCase();
    return title ? "title:" + title : "conversation:" + row.conversation_id;
  };

  const createdRows = db.prepare(
    `SELECT c.id AS conversation_id, c.assignee_id, c.username, c.title,
            c.channel, c.account_id, substr(c.created_at, 1, 10) AS day
     FROM conversations c
     WHERE c.created_at >= ? AND c.assignee_id IS NOT NULL`
  ).all(startIso);

  const effectiveRows = db.prepare(
    `SELECT c.id AS conversation_id, c.assignee_id, c.username, c.title,
            c.channel, c.account_id, substr(m.created_at, 1, 10) AS day,
            COUNT(*) AS message_count,
            SUM(CASE WHEN m.direction = 'in' THEN 1 ELSE 0 END) AS inbound_count,
            SUM(CASE WHEN m.direction = 'out' THEN 1 ELSE 0 END) AS outbound_count
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ? AND c.assignee_id IS NOT NULL AND m.deleted_at IS NULL
     GROUP BY c.id, substr(m.created_at, 1, 10)
     HAVING SUM(CASE WHEN m.direction = 'in' THEN 1 ELSE 0 END) >= 1`
  ).all(startIso);

  const messageRows = db.prepare(
    `SELECT c.assignee_id, substr(m.created_at, 1, 10) AS day,
            SUM(CASE WHEN m.direction = 'in' THEN 1 ELSE 0 END) AS inbound,
            SUM(CASE WHEN m.direction = 'out' THEN 1 ELSE 0 END) AS outbound
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ? AND c.assignee_id IS NOT NULL AND m.deleted_at IS NULL
     GROUP BY c.assignee_id, substr(m.created_at, 1, 10)`
  ).all(startIso);

  const daysList = [];
  for (let index = 0; index < rangeDays; index += 1) {
    const day = new Date(startDate);
    day.setUTCDate(startDate.getUTCDate() + index);
    daysList.push(day.toISOString().slice(0, 10));
  }

  const perDay = new Map();
  const perUser = new Map();
  const dayNewKeys = new Map();
  const dayEffectiveKeys = new Map();
  const dayContacts = new Map();
  const contactsByKey = new Map();

  const emptyStats = () => ({
    newContacts: new Set(),
    effectiveContacts: new Set(),
    duplicateContacts: new Set(),
    inbound: 0,
    outbound: 0
  });
  const ensureUser = userId => {
    if (!perUser.has(userId)) perUser.set(userId, emptyStats());
    return perUser.get(userId);
  };
  const ensureDay = day => {
    if (!perDay.has(day)) perDay.set(day, new Map());
    return perDay.get(day);
  };
  const ensureDayUser = (day, userId) => {
    const map = ensureDay(day);
    if (!map.has(userId)) map.set(userId, emptyStats());
    return map.get(userId);
  };
  const ensureDaySet = (map, day) => {
    if (!map.has(day)) map.set(day, new Set());
    return map.get(day);
  };
  const ensureContact = row => {
    const key = contactKey(row);
    if (!contactsByKey.has(key)) {
      contactsByKey.set(key, {
        key,
        label: String(row.username ? "@" + row.username : row.title || "未知联系人"),
        employees: new Map(),
        employeeDays: new Map(),
        days: new Set(),
        conversationIds: new Set()
      });
    }
    const contact = contactsByKey.get(key);
    contact.employees.set(row.assignee_id, true);
    if (!contact.employeeDays.has(row.assignee_id)) contact.employeeDays.set(row.assignee_id, new Set());
    contact.employeeDays.get(row.assignee_id).add(row.day);
    contact.days.add(row.day);
    contact.conversationIds.add(row.conversation_id);
    return contact;
  };
  const addDayContact = (day, key, userId) => {
    if (!dayContacts.has(day)) dayContacts.set(day, new Map());
    const map = dayContacts.get(day);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(userId);
  };

  for (const user of users) ensureUser(user.id);

  for (const row of createdRows) {
    const key = contactKey(row);
    const userStats = ensureUser(row.assignee_id);
    const dayStats = ensureDayUser(row.day, row.assignee_id);
    userStats.newContacts.add(key);
    dayStats.newContacts.add(key);
    ensureDaySet(dayNewKeys, row.day).add(key);
    ensureContact(row);
    addDayContact(row.day, key, row.assignee_id);
  }

  for (const row of effectiveRows) {
    const key = contactKey(row);
    const userStats = ensureUser(row.assignee_id);
    const dayStats = ensureDayUser(row.day, row.assignee_id);
    userStats.effectiveContacts.add(key);
    dayStats.effectiveContacts.add(key);
    ensureDaySet(dayEffectiveKeys, row.day).add(key);
    ensureContact(row);
    addDayContact(row.day, key, row.assignee_id);
  }

  for (const row of messageRows) {
    const userStats = ensureUser(row.assignee_id);
    const dayStats = ensureDayUser(row.day, row.assignee_id);
    userStats.inbound += Number(row.inbound || 0);
    userStats.outbound += Number(row.outbound || 0);
    dayStats.inbound += Number(row.inbound || 0);
    dayStats.outbound += Number(row.outbound || 0);
  }

  const duplicateKeysByUser = new Map();
  for (const [day, map] of dayContacts) {
    for (const [key, userIds] of map) {
      if (userIds.size < 2) continue;
      for (const userId of userIds) {
        ensureDayUser(day, userId).duplicateContacts.add(key);
        if (!duplicateKeysByUser.has(userId)) duplicateKeysByUser.set(userId, new Set());
        duplicateKeysByUser.get(userId).add(key);
      }
    }
  }
  for (const [userId, keys] of duplicateKeysByUser) {
    ensureUser(userId).duplicateContacts = new Set(keys);
  }

  const duplicates = [...contactsByKey.values()]
    .filter(contact => contact.employees.size > 1)
    .map(contact => {
      const duplicateDays = [...contact.days]
        .filter(day => (dayContacts.get(day)?.get(contact.key)?.size || 0) > 1)
        .sort();
      return {
        key: contact.key,
        contact: contact.label,
        employeeIds: [...contact.employees.keys()],
        employeeNames: users.filter(user => contact.employees.has(user.id)).map(user => user.displayName),
        days: [...contact.days].sort(),
        duplicateDays,
        conversations: contact.conversationIds.size,
        sameDay: duplicateDays.length > 0
      };
    })
    .sort((left, right) =>
      right.employeeIds.length - left.employeeIds.length
      || right.duplicateDays.length - left.duplicateDays.length
      || right.conversations - left.conversations
    );

  const daily = daysList.map(day => {
    const map = ensureDay(day);
    const dayMap = dayContacts.get(day) || new Map();
    let duplicateContacts = 0;
    for (const userIds of dayMap.values()) {
      if (userIds.size > 1) duplicateContacts += 1;
    }
    return {
      date: day,
      team: {
        newContacts: (dayNewKeys.get(day) || new Set()).size,
        effectiveContacts: (dayEffectiveKeys.get(day) || new Set()).size,
        duplicateContacts
      },
      employees: users.map(user => {
        const stats = map.get(user.id);
        return {
          id: user.id,
          displayName: user.displayName,
          username: user.username,
          newContacts: stats ? stats.newContacts.size : 0,
          effectiveContacts: stats ? stats.effectiveContacts.size : 0,
          duplicateContacts: stats ? stats.duplicateContacts.size : 0,
          inbound: stats ? stats.inbound : 0,
          outbound: stats ? stats.outbound : 0
        };
      })
    };
  });

  const totals = users.map(user => {
    const stats = ensureUser(user.id);
    const newContacts = stats.newContacts.size;
    const effectiveContacts = stats.effectiveContacts.size;
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      newContacts,
      effectiveContacts,
      duplicateContacts: stats.duplicateContacts.size,
      inbound: stats.inbound,
      outbound: stats.outbound,
      effectiveRate: (() => {
        const contactCount = new Set([...stats.newContacts, ...stats.effectiveContacts]).size;
        return contactCount ? Math.round((effectiveContacts / contactCount) * 1000) / 10 : 0;
      })()
    };
  });

  const allNewKeys = new Set(createdRows.map(contactKey));
  const allEffectiveKeys = new Set(effectiveRows.map(contactKey));
  const allContactKeys = new Set([...allNewKeys, ...allEffectiveKeys]);
  const duplicateKeys = new Set(duplicates.map(item => item.key));
  const activeEmployees = totals.filter(item =>
    item.newContacts > 0 || item.effectiveContacts > 0 || item.inbound > 0 || item.outbound > 0
  ).length;
  const team = {
    totalNewContacts: allNewKeys.size,
    totalEffectiveContacts: allEffectiveKeys.size,
    totalContacts: allContactKeys.size,
    duplicateContacts: duplicateKeys.size,
    duplicateRate: allContactKeys.size
      ? Math.round((duplicateKeys.size / allContactKeys.size) * 1000) / 10
      : 0,
    effectiveRate: allContactKeys.size
      ? Math.round((allEffectiveKeys.size / allContactKeys.size) * 1000) / 10
      : 0,
    activeEmployees,
    totalEmployees: users.length,
    zeroContactEmployees: Math.max(0, users.length - activeEmployees),
    avgNewPerEmployee: users.length
      ? Math.round((allNewKeys.size / users.length) * 10) / 10
      : 0,
    avgEffectivePerEmployee: users.length
      ? Math.round((allEffectiveKeys.size / users.length) * 10) / 10
      : 0,
    inbound: totals.reduce((sum, item) => sum + item.inbound, 0),
    outbound: totals.reduce((sum, item) => sum + item.outbound, 0)
  };

  return {
    rangeDays,
    start: startIso,
    end: now.toISOString(),
    users,
    daily,
    totals,
    duplicates,
    team,
    definition: "进人=当天新建会话的不同联系人；有效聊天=当天客户主动发过至少 1 条消息的不同联系人；重复=同一联系人出现在多个员工名下，同日重复会额外标注。"
  };
}

function getLatestAiSuggestion(db, conversationId) {
  return toPublicAiSuggestion(
    db.prepare(
      `SELECT * FROM ai_suggestions
       WHERE conversation_id = ? AND status = 'pending'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    ).get(conversationId)
  );
}

function getAiSuggestionById(db, id) {
  return db.prepare("SELECT * FROM ai_suggestions WHERE id = ?").get(id);
}

function updateAiSuggestionStatus(db, id, status) {
  db.prepare(
    "UPDATE ai_suggestions SET status = ?, updated_at = ? WHERE id = ?"
  ).run(status, new Date().toISOString(), id);
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
    "SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC"
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
  refreshConversationPreview,
  softDeleteMessage,
  getConversationMessagesForExport,
  getLatestAiSuggestion,
  getAiSuggestionById,
  updateAiSuggestionStatus,
  listCannedReplies,
  getCannedReplyById,
  getStats,
  getTeamDailyStats
};
