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
  whatsappWebEnabled: readBool("WHATSAPP_WEB_ENABLED", false),
  whatsappWebSessionPath: path.resolve(
    process.env.WHATSAPP_WEB_SESSION_PATH || path.join(dataDir, "whatsapp-web")
  ),
  personalAccountsEnabled: readBool("PERSONAL_ACCOUNTS_ENABLED", true),
  accountsDir: path.resolve(process.env.ACCOUNTS_DIR || path.join(dataDir, "accounts")),
  telegramUserEnabled: readBool("TELEGRAM_USER_ENABLED", false),
  telegramUserApiId: readInt("TELEGRAM_USER_API_ID", 0),
  telegramUserApiHash: (process.env.TELEGRAM_USER_API_HASH || "").trim(),
  telegramUserSessionPath: path.resolve(
    process.env.TELEGRAM_USER_SESSION_PATH || path.join(dataDir, "telegram-user")
  ),
  googleTranslateApiKey: (process.env.GOOGLE_TRANSLATE_API_KEY || "").trim(),
  googleTranslateApiBase: (process.env.GOOGLE_TRANSLATE_API_BASE || "https://translation.googleapis.com").replace(/\/+$/, ""),
  googleTranslateWebApiBase: (process.env.GOOGLE_TRANSLATE_WEB_API_BASE || "https://translate.googleapis.com").replace(/\/+$/, ""),
  googleTranslateWebMainApiBase: (process.env.GOOGLE_TRANSLATE_WEB_MAIN_API_BASE || "https://translate.google.com").replace(/\/+$/, ""),
  googleTranslateChromeApiBase: (process.env.GOOGLE_TRANSLATE_CHROME_API_BASE || "https://clients5.google.com").replace(/\/+$/, ""),
  myMemoryApiBase: (process.env.MYMEMORY_API_BASE || "https://api.mymemory.translated.net").replace(/\/+$/, ""),
  translateProvider: (process.env.TRANSLATE_PROVIDER || "google").trim(),
  translateTarget: (process.env.TRANSLATE_TARGET || "zh-CN").trim(),
  translateTimeoutMs: readInt("TRANSLATE_TIMEOUT_MS", 10000),
  aiEnabled: readBool("AI_ENABLED", false),
  aiApiKey: (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
  aiBaseUrl: (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  aiModel: (process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
  aiDefaultMode: (process.env.AI_DEFAULT_MODE || "auto").trim(),
  aiWorkStart: (process.env.AI_WORK_START || "09:00").trim(),
  aiWorkEnd: (process.env.AI_WORK_END || "18:00").trim(),
  aiWorkTimezone: (process.env.AI_WORK_TIMEZONE || "Asia/Shanghai").trim(),
  aiIncludeGroups: readBool("AI_INCLUDE_GROUPS", false),
  aiDelayMs: Math.max(readInt("AI_DELAY_MS", 1500), 0),
  aiTimeoutMs: Math.max(readInt("AI_TIMEOUT_MS", 30000), 1000),
  aiPublicMinIntervalMs: Math.max(readInt("AI_PUBLIC_MIN_INTERVAL_MS", 45000), 0),
  aiMaxContext: Math.min(Math.max(readInt("AI_MAX_CONTEXT", 12), 2), 40),
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
  supportWhatsAppNumber: (process.env.SUPPORT_WHATSAPP_NUMBER || "").trim(),
  supportTelegramBot: (process.env.SUPPORT_TELEGRAM_BOT || "").trim(),
  supportTelegramUsername: (process.env.SUPPORT_TELEGRAM_USERNAME || "").trim(),
  supportGoMessage: (process.env.SUPPORT_GO_MESSAGE || "你好，我在 Snapchat 看到你们，想咨询一下。").trim(),
  logLevel: process.env.LOG_LEVEL || "info"
};

module.exports = config;
