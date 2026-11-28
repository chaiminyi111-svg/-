const { getSetting, setSetting } = require("./db");

const API_KEY_SETTING = "google_translate_api_key";
const PROVIDER_SETTING = "translate_provider";
const DEFAULT_TARGET = "zh-CN";

const PROVIDERS = [
  { code: "google", label: "Google Cloud Translation API（官方，需要 Key）", requiresKey: true },
  { code: "google-web", label: "Google 网页翻译 · translate.googleapis.com（无需 Key）" },
  { code: "google-web-main", label: "Google 网页翻译 · translate.google.com（无需 Key）" },
  { code: "google-chrome", label: "Google Chrome 翻译接口（无需 Key）" },
  { code: "mymemory", label: "MyMemory 免费翻译（无需 Key，有额度限制）" }
];
const PROVIDER_CODES = new Set(PROVIDERS.map(item => item.code));

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
  const aliases = {
    web: "google-web",
    unofficial: "google-web",
    "google-web-main": "google-web-main",
    "google-main": "google-web-main",
    chrome: "google-chrome",
    "google-chrome": "google-chrome",
    mymemory: "mymemory"
  };
  return PROVIDER_CODES.has(raw) ? raw : aliases[raw] || "google";
}

function providerRequiresKey(code) {
  return normalizeProvider(code) === "google";
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
  const webMainApiBase = String(
    config.googleTranslateWebMainApiBase || "https://translate.google.com"
  ).replace(/\/+$/, "");
  const chromeApiBase = String(
    config.googleTranslateChromeApiBase || "https://clients5.google.com"
  ).replace(/\/+$/, "");
  const myMemoryApiBase = String(
    config.myMemoryApiBase || "https://api.mymemory.translated.net"
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
    if (!providerRequiresKey(currentProvider())) return true;
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
      requiresKey: providerRequiresKey(provider),
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

  async function webRequest(text, target, source = "auto", base = webApiBase) {
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
      response = await fetch(`${base}/translate_a/single?${params.toString()}`, {
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

  function splitMyMemoryText(value, max = 480) {
    const text = String(value || "");
    const chunks = [];
    let remaining = text;
    while (remaining.length > max) {
      const candidates = [
        remaining.lastIndexOf("\n", max),
        remaining.lastIndexOf("。", max),
        remaining.lastIndexOf(". ", max),
        remaining.lastIndexOf(" ", max)
      ];
      let cut = Math.max(...candidates);
      if (cut < Math.floor(max * 0.4)) cut = max;
      chunks.push(remaining.slice(0, cut + 1));
      remaining = remaining.slice(cut + 1);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async function myMemoryChunk(text, target, source) {
    const params = new URLSearchParams({
      q: String(text || ""),
      langpair: `${source === "auto" ? "Autodetect" : normalizeLanguage(source)}|${target}`
    });
    let response;
    try {
      response = await fetch(`${myMemoryApiBase}/get?${params.toString()}`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      logger?.warn("MyMemory 翻译请求失败", error.message);
      throw new TranslationError("无法连接 MyMemory 翻译服务", "TRANSLATION_NETWORK");
    }

    let data = null;
    try {
      data = await response.json();
    } catch {}
    const status = Number(data?.responseStatus || 0);
    const translated = String(data?.responseData?.translatedText || "");
    if (/PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(translated)) {
      const detected = source === "auto" ? target : source;
      return {
        text: String(text || ""),
        detectedLanguage: normalizeLanguage(detected),
        targetLanguage: target
      };
    }
    if (!response.ok || status !== 200 || !translated) {
      if (/QUERY LENGTH LIMIT|INVALID SOURCE/i.test(translated)) {
        throw new TranslationError("MyMemory 翻译请求参数无效", "TRANSLATION_ERROR");
      }
      if (data?.quotaFinished) {
        throw new TranslationError("MyMemory 免费额度已用完，请切换其他翻译通道", "TRANSLATION_ERROR");
      }
      throw new TranslationError(
        `MyMemory 翻译请求失败（HTTP ${response.status}）`,
        "TRANSLATION_ERROR"
      );
    }
    return {
      text: decodeEntities(translated),
      detectedLanguage: normalizeLanguage(
        data?.responseData?.detectedLanguage || data?.matches?.[0]?.source || source || "auto"
      ),
      targetLanguage: target
    };
  }

  async function myMemoryRequest(text, target, source = "auto") {
    const chunks = splitMyMemoryText(text);
    let detectedLanguage = "auto";
    const parts = [];
    for (const chunk of chunks) {
      const result = await myMemoryChunk(chunk, target, source);
      if (detectedLanguage === "auto" && result.detectedLanguage !== "auto") {
        detectedLanguage = result.detectedLanguage;
      }
      parts.push(result.text);
    }
    return {
      text: parts.join(""),
      detectedLanguage,
      targetLanguage: target
    };
  }

  async function chromeRequest(text, target, source = "auto") {
    const params = new URLSearchParams({
      client: "dict-chrome-ex",
      sl: normalizeLanguage(source),
      tl: target,
      q: String(text || "").slice(0, 10000)
    });
    let response;
    try {
      response = await fetch(`${chromeApiBase}/translate_a/t?${params.toString()}`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      logger?.warn("Google Chrome 翻译请求失败", error.message);
      throw new TranslationError("无法连接 Google Chrome 翻译服务", "TRANSLATION_NETWORK");
    }

    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok || !Array.isArray(data)) {
      throw new TranslationError(
        `Google Chrome 翻译请求失败（HTTP ${response.status}）`,
        "TRANSLATION_ERROR"
      );
    }
    const translated = data
      .map(item => Array.isArray(item) ? item[0] : typeof item === "string" ? item : "")
      .filter(Boolean)
      .join("");
    if (!translated) {
      throw new TranslationError("Google Chrome 翻译返回为空", "TRANSLATION_ERROR");
    }
    return {
      text: decodeEntities(translated),
      detectedLanguage: normalizeLanguage(
        (Array.isArray(data[0]) ? data[0][1] : null) || source || "auto"
      ),
      targetLanguage: target
    };
  }

  const fallbackProviders = ["google-chrome", "google-web", "google-web-main", "mymemory"];

  function providerCandidates(primary) {
    return [...new Set([normalizeProvider(primary), ...fallbackProviders])];
  }

  async function translateViaProvider(provider, text, target, sourceLanguage) {
    if (provider === "google-web") {
      return webRequest(text, target, sourceLanguage);
    }
    if (provider === "google-web-main") {
      return webRequest(text, target, sourceLanguage, webMainApiBase);
    }
    if (provider === "google-chrome") {
      return chromeRequest(text, target, sourceLanguage);
    }
    if (provider === "mymemory") {
      return myMemoryRequest(text, target, sourceLanguage);
    }
    const payload = {
      q: String(text || ""),
      target,
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
      targetLanguage: target
    };
  }

  async function withFallback(text, target, sourceLanguage) {
    let lastError = null;
    for (const provider of providerCandidates(currentProvider())) {
      if (provider === "google" && !currentKey()) continue;
      try {
        const result = await translateViaProvider(provider, text, target, sourceLanguage);
        return { ...result, provider };
      } catch (error) {
        lastError = error;
        logger?.warn(`翻译通道 ${providerLabel(provider)} 失败，尝试备用通道`, error.message);
      }
    }
    throw lastError || new TranslationError("没有可用的翻译通道", "TRANSLATION_NOT_CONFIGURED");
  }

  async function detect(text) {
    let lastError = null;
    for (const provider of providerCandidates(currentProvider())) {
      if (provider === "google" && !currentKey()) continue;
      try {
        if (provider === "google") {
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
        const result = await translateViaProvider(provider, text, "en", "auto");
        return {
          language: normalizeLanguage(result.detectedLanguage || "auto"),
          confidence: 1
        };
      } catch (error) {
        lastError = error;
        logger?.warn(`语言检测通道 ${providerLabel(provider)} 失败，尝试备用通道`, error.message);
      }
    }
    throw lastError || new TranslationError("无法检测消息语言", "TRANSLATION_NOT_CONFIGURED");
  }

  async function translate(text, target, sourceLanguage = "auto") {
    const targetLanguage = normalizeLanguage(target);
    if (targetLanguage === "auto") {
      throw new TranslationError("请选择目标语言", "INVALID_LANGUAGE");
    }
    return withFallback(text, targetLanguage, sourceLanguage);
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
  providerRequiresKey,
  providerLabel,
  normalizeLanguage,
  sameLanguage,
  isTranslatableText
};
