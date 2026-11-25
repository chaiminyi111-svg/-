const { getSetting, setSetting } = require("./db");
const { nowIso } = require("./util");

const SETTING_KEY = "assignment_settings";

function readSettings(db, config = {}) {
  const defaults = {
    enabled: Boolean(config.autoAssign),
    strategy: config.autoAssignStrategy || "least_active",
    maxActive: Math.max(Number(config.agentMaxActive) || 0, 0)
  };
  const raw = getSetting(db, SETTING_KEY, null);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled === undefined ? defaults.enabled : Boolean(parsed.enabled),
      strategy: ["least_active", "round_robin"].includes(parsed.strategy)
        ? parsed.strategy
        : defaults.strategy,
      maxActive: Math.max(Number(parsed.maxActive) || 0, 0)
    };
  } catch {
    return defaults;
  }
}

function saveSettings(db, settings) {
  const next = {
    enabled: Boolean(settings.enabled),
    strategy: ["least_active", "round_robin"].includes(settings.strategy)
      ? settings.strategy
      : "least_active",
    maxActive: Math.max(Number(settings.maxActive) || 0, 0)
  };
  setSetting(db, SETTING_KEY, JSON.stringify(next));
  return next;
}

function autoAssignConversation(db, conversationId, config = {}) {
  const settings = readSettings(db, config);
  if (!settings.enabled) return null;

  const order = settings.strategy === "round_robin" ? "u.id ASC" : "active ASC, u.id ASC";
  const agents = db.prepare(
    `SELECT u.id, u.display_name,
            (SELECT COUNT(*) FROM conversations c
             WHERE c.assignee_id = u.id AND c.status != 'closed') AS active
     FROM users u
     WHERE u.active = 1 AND u.role = 'agent'
     ORDER BY ${order}`
  ).all().filter(agent => !settings.maxActive || Number(agent.active) < settings.maxActive);

  if (!agents.length) return null;

  let chosen;
  if (settings.strategy === "round_robin") {
    const cursor = Number(getSetting(db, "auto_assign_cursor", "0")) || 0;
    chosen = agents[cursor % agents.length];
    setSetting(db, "auto_assign_cursor", String((cursor + 1) % agents.length));
  } else {
    chosen = agents[0];
  }

  const now = nowIso();
  const result = db.prepare(
    `UPDATE conversations
     SET assignee_id = ?, assigned_at = ?, updated_at = ?
     WHERE id = ? AND assignee_id IS NULL`
  ).run(chosen.id, now, now, conversationId);

  if (!Number(result.changes)) return null;
  return { id: chosen.id, displayName: chosen.display_name };
}

module.exports = {
  readSettings,
  saveSettings,
  autoAssignConversation
};
