const { getSetting, setSetting } = require("./db");

const API_KEY_SETTING = "google_translate_api_key";
const PROVIDER_SETTING = "translate_provider";
const DEFAULT_TARGET = "zh-CN";

const PROVIDERS = [
  { code: "google", label: "Google Cloud Translation API（官方，需要 Key）" },
  { code: "google-web", label: "translate.googleapis.com（非官方备用，无需 Key）" }
];

const LANGUAGES = [
  { code: "zh-CN", label: "中文（简体）" },
  { code: "zh-TW", label: "中文（繁體）" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "tr", label: "Türkçe" },
  { code: "hi", label: "हिन्दी" }
];

const LANGUAGE_LABELS = Object.fromEntries(LANGUAGES.map(item => [item.code, item.label]));

class TranslationError extends Error {
  constructor(message, code = "TRANSLATION_ERROR") {
    super(message);
    this.name = "TranslationError";
    this.code = code;
  }
}

function normalizeLanguage(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "auto") return "auto";
  const lower = raw.toLowerCase().replace(/_/g, "-");
  if (["zh", "zh-cn", "zh-hans", "zh-chs"].includes(lower)) return "zh-CN";
  if (["zh-tw", "zh-hant", "zh-cht"].includes(lower)) return "zh-TW";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  const [base, region] = lower.split("-");
  return region ? `${base}-${region.toUpperCase()}` : base;
}

function languageLabel(code) {
  const normalized = normalizeLanguage(code);
  return LANGUAGE_LABELS[normalized] || (normalized === "auto" ? "自动识别" : normalized);
}

function normalizeProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["google-web", "web", "unofficial"].includes(raw) ? "google-web" : "google";
}

function providerLabel(code) {
  const normalized = normalizeProvider(code);
  return PROVIDERS.find(item => item.code === normalized)?.label || normalized;
}

function sameLanguage(a, b) {
  const left = normalizeLanguage(a);
  const right = normalizeLanguage(b);
  if (left === "auto" || right === "auto") return false;
  return left.toLowerCase() === right.toLowerCase();
}

function isTranslatableText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return !/^\[[^\]]*\]/.test(value);
}

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
  return String(value || "").replace(/&(amp|lt|gt|quot|#39);/g, (match, name) => entities[name] || match);
}

function createTranslateService({ db, config = {}, logger } = {}) {
  const envKey = String(config.googleTranslateApiKey || "").trim();
  const apiBase = String(
    config.googleTranslateApiBase || "https://translation.googleapis.com"
  ).replace(/\/+$/, "");
  const webApiBase = String(
    config.googleTranslateWebApiBase || "https://translate.googleapis.com"
  ).replace(/\/+$/, "");
  const envProvider = normalizeProvider(config.translateProvider || "google");
  const defaultTarget = normalizeLanguage(config.translateTarget || DEFAULT_TARGET);
  const timeoutMs = Math.min(Math.max(Number(config.translateTimeoutMs) || 10000, 1000), 30000);

  function databaseKey() {
    return String(getSetting(db, API_KEY_SETTING, "") || "").trim();
  }

  function currentKey() {
    return databaseKey() || envKey;
  }

  function currentProvider() {
    const stored = getSetting(db, PROVIDER_SETTING, null);
    return normalizeProvider(stored || envProvider);
  }

  function configured() {
    if (currentProvider() === "google-web") return true;
    return Boolean(currentKey());
  }

  function status() {
    const dbKey = databaseKey();
    const provider = currentProvider();
    return {
      configured: configured(),
      source: dbKey ? "database" : envKey ? "environment" : "none",
      provider,
      providerLabel: providerLabel(provider),
      keyConfigured: Boolean(dbKey || envKey),
      providers: PROVIDERS,
      defaultTarget,
      languages: LANGUAGES
    };
  }

  function saveProvider(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!PROVIDERS.some(item => item.code === raw)) {
      throw new TranslationError("不支持的翻译通道", "INVALID_PROVIDER");
    }
    setSetting(db, PROVIDER_SETTING, raw);
    return status();
  }

  function saveApiKey(value) {
    const key = String(value || "").trim();
    if (!key) throw new TranslationError("请输入 Google 翻译 API Key", "INVALID_INPUT");
    setSetting(db, API_KEY_SETTING, key);
  }

  function clearApiKey() {
    db.prepare("DELETE FROM settings WHERE key = ?").run(API_KEY_SETTING);
  }

  async function webRequest(text, target, source = "auto") {
    const targetLanguage = normalizeLanguage(target);
    if (targetLanguage === "auto") {
      throw new TranslationError("请选择目标语言", "INVALID_LANGUAGE");
    }
    const params = new URLSearchParams({
      client: "gtx",
      sl: normalizeLanguage(source),
      tl: targetLanguage,
      dt: "t",
      q: String(text || "").slice(0, 10000)
    });
    let response;
    try {
      response = await fetch(`${webApiBase}/translate_a/single?${params.toString()}`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      logger?.warn("Google 网页翻译请求失败", error.message);
      throw new TranslationError("无法连接 Google 网页翻译服务", "TRANSLATION_NETWORK");
    }

    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok || !Array.isArray(data)) {
      throw new TranslationError(
        `Google 网页翻译请求失败（HTTP ${response.status}）`,
        "TRANSLATION_ERROR"
      );
    }

    const translated = (Array.isArray(data[0]) ? data[0] : [])
      .map(segment => Array.isArray(segment) ? segment[0] : "")
      .filter(Boolean)
      .join("");
    if (!translated) {
      throw new TranslationError("Google 网页翻译返回为空", "TRANSLATION_ERROR");
    }
    return {
      text: decodeEntities(translated),
      detectedLanguage: normalizeLanguage(data[2] || source || "auto"),
      targetLanguage
    };
  }

  async function request(path, payload, keyOverride = null) {
    const key = String(keyOverride || currentKey()).trim();
    if (!key) {
      throw new TranslationError(
        "未配置 Google 翻译 API Key，请让管理员在「渠道」中配置",
        "TRANSLATION_NOT_CONFIGURED"
      );
    }
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      logger?.warn("Google 翻译请求失败", error.message);
      throw new TranslationError("无法连接 Google 翻译服务", "TRANSLATION_NETWORK");
    }

    let data = {};
    try {
      data = await response.json();
    } catch {}
    if (!response.ok) {
      const message = data?.error?.message
        ? String(data.error.message).slice(0, 300)
        : `Google 翻译请求失败（HTTP ${response.status}）`;
      throw new TranslationError(message, "TRANSLATION_ERROR");
    }
    return data;
  }

  async function detect(text) {
    if (currentProvider() === "google-web") {
      const result = await webRequest(text, "en");
      return { language: result.detectedLanguage, confidence: 1 };
    }
    const data = await request("/language/translate/v2/detect", {
      q: String(text || "").slice(0, 10000),
      format: "text"
    });
    const item = data?.data?.detections?.[0]?.[0] || {};
    return {
      language: normalizeLanguage(item.language || "auto"),
      confidence: Number(item.confidence || 0)
    };
  }

  async function translate(text, target, sourceLanguage = "auto") {
    const targetLanguage = normalizeLanguage(target);
    if (targetLanguage === "auto") {
      throw new TranslationError("请选择目标语言", "INVALID_LANGUAGE");
    }
    if (currentProvider() === "google-web") {
      return webRequest(text, targetLanguage, sourceLanguage);
    }
    const payload = {
      q: String(text || ""),
      target: targetLanguage,
      format: "text"
    };
    if (sourceLanguage && sourceLanguage !== "auto") {
      payload.source = normalizeLanguage(sourceLanguage);
    }
    const data = await request("/language/translate/v2", payload);
    const item = data?.data?.translations?.[0] || {};
    return {
      text: decodeEntities(item.translatedText || ""),
      detectedLanguage: normalizeLanguage(item.detectedSourceLanguage || sourceLanguage || "auto"),
      targetLanguage
    };
  }

  async function translateInbound(text, options = {}) {
    if (!configured() || !isTranslatableText(text)) return null;
    const target = normalizeLanguage(options.target || defaultTarget);
    const detection = await detect(text);
    if (!detection.language || detection.language === "auto") {
      return { language: null, translatedBody: null, translationLanguage: null };
    }
    if (sameLanguage(detection.language, target)) {
      return { language: detection.language, translatedBody: null, translationLanguage: null };
    }
    const result = await translate(text, target, detection.language);
    return {
      language: detection.language,
      translatedBody: result.text || null,
      translationLanguage: target
    };
  }

  async function prepareOutbound(text, targetLanguage, conversation = {}) {
    const requested = normalizeLanguage(targetLanguage || "auto");
    if (!configured()) {
      if (requested === "auto") {
        return { text, language: null, meta: { translationSkipped: "not_configured" } };
      }
      throw new TranslationError(
        "未配置 Google 翻译 API Key，无法按指定语言发送",
        "TRANSLATION_NOT_CONFIGURED"
      );
    }

    let target = requested;
    if (target === "auto") {
      target = normalizeLanguage(conversation.detected_language || conversation.detectedLanguage || "");
      if (!target || target === "auto") {
        return { text, language: null, meta: { translationSkipped: "no_customer_language" } };
      }
    }

    const detection = await detect(text);
    const sourceLanguage = detection.language;
    if (sameLanguage(sourceLanguage, target)) {
      return {
        text,
        language: sourceLanguage,
        meta: { sourceLanguage, targetLanguage: target, translated: false }
      };
    }

    const result = await translate(text, target, sourceLanguage);
    return {
      text: result.text,
      language: target,
      meta: {
        originalText: text,
        sourceLanguage,
        targetLanguage: target,
        translated: true
      }
    };
  }

  async function verifyKey(value) {
    const key = String(value || "").trim();
    if (!key) throw new TranslationError("请输入 Google 翻译 API Key", "INVALID_INPUT");
    const data = await request("/language/translate/v2/detect", {
      q: "hello",
      format: "text"
    }, key);
    const language = data?.data?.detections?.[0]?.[0]?.language;
    if (!language) throw new TranslationError("Google 翻译 API Key 验证失败", "TRANSLATION_ERROR");
    return true;
  }

  async function verify() {
    const result = await detect("hello");
    return Boolean(result.language && result.language !== "auto");
  }

  return {
    configured,
    status,
    saveApiKey,
    saveProvider,
    clearApiKey,
    detect,
    translate,
    translateInbound,
    prepareOutbound,
    verifyKey,
    verify,
    defaultTarget
  };
}

module.exports = {
  createTranslateService,
  TranslationError,
  LANGUAGES,
  PROVIDERS,
  languageLabel,
  normalizeProvider,
  providerLabel,
  normalizeLanguage,
  sameLanguage,
  isTranslatableText
};
