const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generatePassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let index = 0; index < length; index++) {
    password += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return password;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function displayNameFromTelegram(from) {
  if (!from) return "未知联系人";
  const full = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return full || from.username || String(from.id || "未知联系人");
}

function messagePreview(text, max = 140) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createLogger(level = "info") {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = levels[level] || levels.info;

  function write(kind, message, meta) {
    if ((levels[kind] || 20) < threshold) return;
    const line = `[${new Date().toISOString()}] ${kind.toUpperCase()} ${message}`;
    if (meta !== undefined) {
      console[kind === "debug" ? "log" : kind](line, meta);
    } else {
      console[kind === "debug" ? "log" : kind](line);
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    aiAllowed: Boolean(row.ai_allowed),
    aiEnabled: Boolean(row.ai_enabled),
    aiMode: row.ai_mode || "auto",
    createdAt: row.created_at
  };
}

function parseTags(value) {
  const parsed = Array.isArray(value) ? value : safeJsonParse(value, []);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(tag => String(tag || "").trim()).filter(Boolean))].slice(0, 12);
}

function toPublicMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    telegramMessageId: row.telegram_message_id,
    direction: row.direction,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    type: row.message_type,
    meta: safeJsonParse(row.meta_json, {}),
    language: row.language || null,
    translatedBody: row.translated_body || null,
    translationLanguage: row.translation_language || null,
    deliveryStatus: row.delivery_status || null,
    deliveryUpdatedAt: row.delivery_updated_at || null,
    aiStatus: row.ai_status || null,
    aiError: row.ai_error || null,
    createdAt: row.created_at
  };
}

function toConversationSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.telegram_chat_id,
    channel: row.channel || "telegram",
    accountId: row.account_id || null,
    accountLabel: row.account_label || "",
    accountName: row.account_display_name || "",
    accountOwnerId: row.account_owner_id || null,
    accountOwnerName: row.account_owner_name || "",
    chatType: row.chat_type,
    title: row.title,
    username: row.username || "",
    status: row.status,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_display_name || "",
    assigneeUsername: row.assignee_username || "",
    assignedAt: row.assigned_at || null,
    detectedLanguage: row.detected_language || null,
    firstResponseAt: row.first_response_at || null,
    resolvedAt: row.resolved_at || null,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview || "",
    lastMessageDirection: row.last_message_direction || "",
    unreadCount: Number(row.unread_count || 0),
    tags: parseTags(row.tags_json),
    notes: row.notes || "",
    assigneeAiAllowed: Boolean(row.assignee_ai_allowed),
    assigneeAiEnabled: Boolean(row.assignee_ai_enabled),
    assigneeAiMode: row.assignee_ai_mode || "auto",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPublicAiSuggestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    agentId: row.agent_id,
    body: row.body,
    model: row.model || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCannedReply(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  nowIso,
  randomToken,
  sha256,
  generatePassword,
  parseCookies,
  clampInt,
  displayNameFromTelegram,
  messagePreview,
  safeJsonParse,
  sleep,
  createLogger,
  toPublicUser,
  toPublicMessage,
  toConversationSummary,
  toPublicAiSuggestion,
  toCannedReply,
  parseTags
};
