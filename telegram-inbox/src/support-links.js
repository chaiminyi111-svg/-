const { getSetting, setSetting } = require("./db");

const WHATSAPP_KEY = "support_whatsapp_number";
const TELEGRAM_KEY = "support_telegram_target";

function normalizeWhatsApp(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeTelegram(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function readSupportLinks(db, config = {}) {
  return {
    whatsappNumber: normalizeWhatsApp(
      getSetting(db, WHATSAPP_KEY, config.supportWhatsAppNumber || "")
    ),
    telegramTarget: normalizeTelegram(
      getSetting(
        db,
        TELEGRAM_KEY,
        config.supportTelegramBot || config.supportTelegramUsername || ""
      )
    )
  };
}

function buildSupportLinks(links) {
  const whatsappNumber = normalizeWhatsApp(links.whatsappNumber);
  const telegramTarget = normalizeTelegram(links.telegramTarget);
  return {
    whatsappNumber,
    telegramTarget,
    whatsappUrl: whatsappNumber ? `https://wa.me/${whatsappNumber}` : "",
    telegramUrl: telegramTarget ? `https://t.me/${telegramTarget}` : ""
  };
}

function saveSupportLinks(db, input = {}) {
  const whatsappNumber = normalizeWhatsApp(input.whatsappNumber);
  const telegramTarget = normalizeTelegram(input.telegramTarget);

  if (whatsappNumber && !/^\d{7,15}$/.test(whatsappNumber)) {
    const error = new Error("WhatsApp 号码格式不正确，请填写 7-15 位国际号码，只保留数字");
    error.code = "VALIDATION";
    throw error;
  }
  if (telegramTarget && !/^[A-Za-z0-9_]{5,32}$/.test(telegramTarget)) {
    const error = new Error("Telegram 用户名格式不正确，应为 5-32 位字母、数字或下划线");
    error.code = "VALIDATION";
    throw error;
  }

  setSetting(db, WHATSAPP_KEY, whatsappNumber);
  setSetting(db, TELEGRAM_KEY, telegramTarget);
  return buildSupportLinks({ whatsappNumber, telegramTarget });
}

module.exports = {
  readSupportLinks,
  buildSupportLinks,
  saveSupportLinks
};
