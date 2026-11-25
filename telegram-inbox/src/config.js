const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function readBool(name, fallback) {
  const value = String(process.env[name] || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
fs.mkdirSync(dataDir, { recursive: true });

const config = {
  root,
  dataDir,
  dbPath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "inbox.db")),
  port: readInt("PORT", 3000),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  adminUsername: (process.env.ADMIN_USERNAME || "admin").trim(),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminDisplayName: (process.env.ADMIN_DISPLAY_NAME || "管理员").trim(),
  telegramToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),
  telegramApiBase: (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, ""),
  telegramPollTimeout: Math.min(Math.max(readInt("TELEGRAM_POLL_TIMEOUT", 25), 5), 50),
  telegramDeleteWebhook: readBool("TELEGRAM_DELETE_WEBHOOK", false),
  whatsappToken: (process.env.WHATSAPP_TOKEN || "").trim(),
  whatsappPhoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
  whatsappVerifyToken: (process.env.WHATSAPP_VERIFY_TOKEN || "").trim(),
  whatsappAppSecret: (process.env.WHATSAPP_APP_SECRET || "").trim(),
  whatsappApiBase: (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v20.0").replace(/\/+$/, ""),
  googleTranslateApiKey: (process.env.GOOGLE_TRANSLATE_API_KEY || "").trim(),
  googleTranslateApiBase: (process.env.GOOGLE_TRANSLATE_API_BASE || "https://translation.googleapis.com").replace(/\/+$/, ""),
  googleTranslateWebApiBase: (process.env.GOOGLE_TRANSLATE_WEB_API_BASE || "https://translate.googleapis.com").replace(/\/+$/, ""),
  translateProvider: (process.env.TRANSLATE_PROVIDER || "google").trim(),
  translateTarget: (process.env.TRANSLATE_TARGET || "zh-CN").trim(),
  translateTimeoutMs: readInt("TRANSLATE_TIMEOUT_MS", 10000),
  autoAssign: readBool("AUTO_ASSIGN", false),
  autoAssignStrategy: (process.env.AUTO_ASSIGN_STRATEGY || "least_active").trim(),
  agentMaxActive: Math.max(readInt("AGENT_MAX_ACTIVE", 0), 0),
  slaFirstResponseMinutes: Math.max(readInt("SLA_FIRST_RESPONSE_MINUTES", 15), 1),
  sessionDays: Math.max(readInt("SESSION_DAYS", 7), 1),
  trustProxy: readBool("TRUST_PROXY", true),
  cookieSecure:
    process.env.COOKIE_SECURE === "true"
      ? true
      : process.env.COOKIE_SECURE === "false"
        ? false
        : "auto",
  publicOrigin: (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, ""),
  maxMessageLength: Math.min(Math.max(readInt("MAX_MESSAGE_LENGTH", 4096), 1), 4096),
  logLevel: process.env.LOG_LEVEL || "info"
};

module.exports = config;
