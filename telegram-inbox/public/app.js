const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const FALLBACK_LANGUAGES = [
  ["zh-CN", "中文（简体）"], ["zh-TW", "中文（繁體）"], ["en", "English"],
  ["ja", "日本語"], ["ko", "한국어"], ["es", "Español"], ["fr", "Français"],
  ["de", "Deutsch"], ["ru", "Русский"], ["pt", "Português"], ["ar", "العربية"],
  ["th", "ไทย"], ["vi", "Tiếng Việt"], ["id", "Bahasa Indonesia"],
  ["it", "Italiano"], ["tr", "Türkçe"], ["hi", "हिन्दी"]
];
const LANGUAGE_LABELS = Object.fromEntries(FALLBACK_LANGUAGES);

const THEMES = [
  { id: "sunset", name: "夕阳橙", desc: "落日暖橙 · 默认", colors: ["#ff9a4d", "#ef6a3d", "#2a1720"] },
  { id: "ember", name: "熔岩红", desc: "炭火与赤铜", colors: ["#ff6a45", "#c52f32", "#241012"] },
  { id: "forest", name: "森林绿", desc: "深林与薄荷", colors: ["#65d6a0", "#25845c", "#0e1d16"] },
  { id: "sakura", name: "夜樱粉", desc: "夜色与樱花", colors: ["#ff9fc4", "#c24b7d", "#21121c"] },
  { id: "ocean", name: "深海蓝", desc: "冷冽科技蓝", colors: ["#32d3ee", "#0b7fbe", "#071523"] },
  { id: "paper", name: "暖纸白", desc: "奶油纸张 · 明亮", colors: ["#f4b277", "#d96a2b", "#fff7ee"] }
];

const AI_MODE_LABELS = {
  off: "关闭",
  suggest: "只生成建议",
  auto: "自动回复",
  first: "仅首次接待",
  after_hours: "非工作时间"
};

function aiModeLabel(code) {
  return AI_MODE_LABELS[code] || "自动回复";
}

function languageName(code) {
  if (!code) return "";
  const normalized = String(code).replace("_", "-");
  return LANGUAGE_LABELS[normalized] || LANGUAGE_LABELS[normalized.split("-")[0]] || normalized;
}

function currentTheme() {
  return document.documentElement.dataset.theme || "sunset";
}

function applyTheme(themeId, { persist = true } = {}) {
  const theme = THEMES.find(item => item.id === themeId) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  if (persist) {
    try { localStorage.setItem("cs-theme", theme.id); } catch {}
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.colors[0];
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = theme.id === "paper" ? "light" : "dark";
  renderThemeGrid();
}

function renderThemeGrid() {
  const grid = $("#themeGrid");
  if (!grid) return;
  const active = currentTheme();
  const activeTheme = THEMES.find(item => item.id === active) || THEMES[0];
  const summary = $("#appearanceSummary");
  if (summary) summary.textContent = `${activeTheme.name} · ${activeTheme.desc}`;
  grid.replaceChildren();
  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option" + (theme.id === active ? " active" : "");
    button.dataset.theme = theme.id;
    button.setAttribute("aria-pressed", String(theme.id === active));

    const swatch = document.createElement("span");
    swatch.className = "theme-swatch";
    swatch.style.background = `linear-gradient(135deg, ${theme.colors.join(", ")})`;

    const copy = document.createElement("span");
    copy.className = "theme-copy";
    const name = document.createElement("strong");
    name.textContent = theme.name;
    const desc = document.createElement("small");
    desc.textContent = theme.desc;
    copy.append(name, desc);

    const check = document.createElement("span");
    check.className = "theme-check";
    check.textContent = theme.id === active ? "✓" : "";

    button.append(swatch, copy, check);
    button.addEventListener("click", () => {
      applyTheme(theme.id);
      showToast(`已切换为${theme.name}`, "success");
    });
    grid.appendChild(button);
  }
}

function openAppearanceModal() {
  renderThemeGrid();
  $("#appearanceModal").hidden = false;
}

const state = {
  me: null,
  users: [],
  teamUsers: [],
  conversations: [],
  counts: {},
  activeId: null,
  active: null,
  messages: [],
  hasMore: false,
  messageCache: new Map(),
  filters: { scope: "all", status: "open", q: "" },
  mode: "shared",
  personal: { enabled: false, channels: [], accounts: [], timer: null, loading: false },
  cannedReplies: [],
  editingCannedId: null,
  customerTags: [],
  customerDirty: false,
  stats: null,
  statsDays: 7,
  teamDaily: null,
  sidebarStats: null,
  sidebarTimer: null,
  viewerDays: 1,
  translate: { configured: false, source: "none", languages: [], defaultTarget: "zh-CN" },
  replyLanguages: {},
  assignment: { enabled: false, strategy: "least_active", maxActive: 0 },
  channels: { telegram: null, whatsapp: null, whatsappWeb: null, translate: null, ai: null },
  admin: { system: null, users: [], audit: null, backups: [], diagnostics: null, security: null, tab: "overview" },
  whatsappWebPollTimer: null,
  ai: {
    configured: false,
    globalEnabled: false,
    allowed: false,
    enabled: false,
    mode: "auto",
    reason: "not_configured",
    modes: []
  },
  aiPrefs: null,
  aiSuggestion: null,
  telegramConfigured: false,
  whatsappConfigured: false,
  whatsappWebConfigured: false,
  eventSource: null,
  sseConnected: false,
  fallbackTimer: null,
  refreshTimer: null,
  searchTimer: null,
  threadToken: 0,
  sending: false,
  uploading: false,
  reading: null,
  composing: false,
  expiring: false
};

class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function api(path, options = {}) {
  const init = { credentials: "same-origin", ...options };
  if (init.body && typeof init.body === "object") {
    init.headers = { "content-type": "application/json", ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("无法连接服务器，请检查服务是否运行");
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }

  if (!response.ok) {
    if (response.status === 401 && state.me) handleSessionExpired();
    throw new ApiError(data.error || `请求失败（${response.status}）`, response.status, data);
  }
  return data;
}

let toastTimer = null;
function showToast(message, type = "") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function setConnection(mode) {
  const el = $("#connectionStatus");
  if (!el) return;
  el.classList.remove("online", "offline");
  if (mode === "online") {
    el.classList.add("online");
    el.querySelector("span").textContent = "实时连接";
  } else if (mode === "offline") {
    el.classList.add("offline");
    el.querySelector("span").textContent = "轮询模式";
  } else {
    el.querySelector("span").textContent = "连接中";
  }
}

function handleSessionExpired() {
  if (state.expiring) return;
  state.expiring = true;
  showToast("登录已过期，请重新登录", "error");
  showLogin();
  setTimeout(() => { state.expiring = false; }, 1200);
}

function setLoginError(message) {
  const error = $("#loginError");
  error.textContent = message || "";
  error.hidden = !message;
}

async function boot() {
  try {
    const health = await api("/api/health");
    state.telegramConfigured = Boolean(health.telegramConfigured);
    state.whatsappConfigured = Boolean(health.whatsappConfigured);
    state.whatsappWebConfigured = Boolean(health.whatsappWebConfigured && health.whatsappWebRunning);
    state.personal.enabled = Boolean(health.personalAccountsEnabled);
    const data = await api("/api/auth/me");
    state.me = data.user;
    await enterInbox();
  } catch (error) {
    if (error.status !== 401) setLoginError(error.message);
    showLogin();
  }
}

async function enterInbox() {
  if (state.me.role === "viewer") {
    showViewer();
    await loadViewerStats();
    return;
  }
  showInbox();
  if (state.me.role === "admin") await loadUsers();
  await Promise.all([
    loadTranslateConfig(),
    loadAiPreferences(),
    loadConversations(),
    loadPersonalAccounts({ silent: true }),
    loadSidebarStats()
  ]);
  connectRealtime();
  startFallbackPolling();
}

function roleLabel(role) {
  return { admin: "管理员", agent: "客服", viewer: "统计员" }[role] || role;
}

function applyRoleScope() {
  const isAdmin = state.me?.role === "admin";
  for (const tab of $$(".scope-tab")) {
    if (tab.dataset.scope === "mine") continue;
    tab.hidden = !isAdmin;
  }
  document.querySelector(".scope-tabs")?.classList.toggle("agent", !isAdmin);
  if (!isAdmin && state.filters.scope !== "mine") state.filters.scope = "mine";
  $$(".scope-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.scope === state.filters.scope));
}

function showViewer() {
  stopRealtime();
  stopFallbackPolling();
  $("#loginView").hidden = true;
  $("#inboxView").hidden = true;
  $("#viewerView").hidden = false;
  $("#viewerUser").textContent = `${state.me.displayName} · 统计员`;
  $("#viewerRange").value = String(state.viewerDays || 1);
  document.title = "客服统计 · 只读看板";
}

function showInbox() {
  $("#loginView").hidden = true;
  $("#viewerView").hidden = true;
  $("#inboxView").hidden = false;
  $("#currentUser").textContent = `${state.me.displayName} · ${roleLabel(state.me.role)}`;
  $("#channelsBtn").hidden = state.me.role !== "admin";
  $("#teamBtn").hidden = state.me.role !== "admin";
  $("#adminBtn").hidden = state.me.role !== "admin";
  $("#passwordBtn").hidden = state.me.role === "admin";
  $("#personalAccountsBtn").hidden = state.me.role === "viewer" || !state.personal.enabled;
  $("#modeSwitch").hidden = state.me.role === "viewer" || !state.personal.enabled;
  $("#aiBtn").hidden = state.me.role === "viewer";
  applyModeUi();
  applyRoleScope();
  renderTelegramState();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function applyModeUi() {
  for (const tab of $$(".mode-tab")) {
    tab.classList.toggle("active", tab.dataset.mode === state.mode);
  }
  const personal = state.mode === "personal";
  $("#personalAccountsBtn").textContent = personal ? "我的个人号" : "个人号";
  document.body.classList.toggle("personal-mode", personal);
}

function stopPersonalPolling() {
  if (state.personal.timer) clearInterval(state.personal.timer);
  state.personal.timer = null;
}

function startPersonalPolling() {
  stopPersonalPolling();
  state.personal.timer = setInterval(() => {
    if ($("#personalModal").hidden) {
      stopPersonalPolling();
      return;
    }
    loadPersonalAccounts({ silent: true });
  }, 2500);
}

function setPersonalError(message) {
  const error = $("#personalError");
  error.textContent = message || "";
  error.hidden = !message;
}

async function loadPersonalAccounts(options = {}) {
  if (!state.me || state.me.role === "viewer") return;
  if (state.personal.loading) return;
  state.personal.loading = true;
  try {
    const data = await api("/api/accounts");
    state.personal.enabled = Boolean(data.enabled);
    state.personal.channels = Array.isArray(data.channels) ? data.channels : [];
    state.personal.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    renderPersonalAccounts();
    if (state.active) {
      renderTelegramState();
    }
  } catch (error) {
    if (!options.silent && error.status !== 401) setPersonalError(error.message);
  } finally {
    state.personal.loading = false;
  }
}

function personalStatusText(channel, account) {
  if (!channel.available) return "未启用";
  if (!account) return "未绑定";
  const status = account.status || {};
  if (status.passwordRequired) return "需要两步验证密码";
  if (status.running) {
    const name = status.me?.name ||
      [status.me?.firstName, status.me?.lastName].filter(Boolean).join(" ") ||
      status.me?.username ||
      account.displayName ||
      "";
    return name ? `已连接 ${name}` : "已连接";
  }
  if (status.loginInProgress) return status.qr ? "等待扫码" : "正在生成二维码…";
  if (status.error) return status.error;
  return "未登录";
}

function renderPersonalAccounts() {
  const wrap = $("#personalAccountsList");
  if (!wrap) return;
  if (wrap.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
  const enabled = state.personal.enabled;
  $("#personalModeNote").textContent = enabled
    ? "个人号消息只进入你自己的收件箱；管理员可以在「共用收件箱」和「个人号模式」之间切换查看。"
    : "服务器未启用个人号模式（PERSONAL_ACCOUNTS_ENABLED=false）。";

  if (!state.personal.channels.length) {
    wrap.innerHTML = '<p class="channel-note">个人号服务未启动。</p>';
    return;
  }

  const cards = state.personal.channels.map(channel => {
    const account = state.personal.accounts.find(item => item.channel === channel.channel);
    const status = account?.status || {};
    const available = Boolean(channel.available) && enabled;
    const connected = Boolean(status.running);
    const qr = status.qr
      ? `<div class="qr-wrap"><img src="${escapeHtml(status.qr)}" alt="${escapeHtml(channel.label)} 登录二维码" width="320" height="320"><p>用手机 ${escapeHtml(channel.label)} 扫描二维码完成登录。</p></div>`
      : "";
    const password = status.passwordRequired
      ? `<form class="channel-form personal-password" data-password-form="${account.id}">
           <label>两步验证密码${status.passwordHint ? `（提示：${escapeHtml(status.passwordHint)}）` : ""}
             <input type="password" name="password" autocomplete="current-password" required>
           </label>
           <div class="channel-actions"><button class="primary" type="submit">提交密码</button></div>
         </form>`
      : "";
    const actions = [];
    if (available) {
      if (!account) {
        actions.push(`<button class="primary" type="button" data-personal-action="bind" data-channel="${channel.channel}">绑定并扫码</button>`);
      } else if (!connected) {
        actions.push(`<button class="primary" type="button" data-personal-action="login" data-id="${account.id}">${status.loginInProgress ? "刷新二维码" : "扫码登录"}</button>`);
      }
      if (account) {
        actions.push(`<button class="ghost" type="button" data-personal-action="logout" data-id="${account.id}">退出登录</button>`);
      }
    }
    return `<section class="personal-card">
      <div class="personal-card-head">
        <div>
          <strong>${escapeHtml(channel.label)} 个人号</strong>
          <span class="personal-status ${connected ? "on" : ""}">${escapeHtml(personalStatusText(channel, account))}</span>
        </div>
        <span class="channel-dot ${connected ? "on" : "off"}" aria-hidden="true"></span>
      </div>
      ${account ? `<p class="channel-note">账号：${escapeHtml(account.label || "我的个人号")}${account.displayName ? ` · ${escapeHtml(account.displayName)}` : ""}</p>` : ""}
      ${!channel.available ? `<p class="channel-note">${escapeHtml(channel.hint || "")}</p>` : ""}
      ${qr}
      ${password}
      <div class="channel-actions">${actions.join("")}</div>
      ${status.error && !status.running ? `<div class="form-error">${escapeHtml(status.error)}</div>` : ""}
    </section>`;
  });

  const html = cards.join("");
  if (wrap._renderedHtml === html) return;
  wrap.innerHTML = html;
  wrap._renderedHtml = html;
}

async function openPersonalModal() {
  setPersonalError("");
  $("#personalModal").hidden = false;
  await loadPersonalAccounts();
  startPersonalPolling();
}

async function personalBind(channel) {
  setPersonalError("");
  try {
    const data = await api("/api/accounts", {
      method: "POST",
      body: { channel, label: `${state.me.displayName} 的${channel === "whatsapp_web" ? "WhatsApp" : "Telegram"}` }
    });
    await api(`/api/accounts/${data.account.id}/login`, { method: "POST" });
    await loadPersonalAccounts();
    startPersonalPolling();
  } catch (error) {
    setPersonalError(error.message);
  }
}

async function personalLogin(id) {
  setPersonalError("");
  try {
    await api(`/api/accounts/${id}/login`, { method: "POST" });
    await loadPersonalAccounts();
    startPersonalPolling();
  } catch (error) {
    setPersonalError(error.message);
  }
}

async function personalLogout(id) {
  setPersonalError("");
  try {
    await api(`/api/accounts/${id}/logout`, { method: "POST" });
    await loadPersonalAccounts();
    if (state.mode === "personal") await loadConversations();
  } catch (error) {
    setPersonalError(error.message);
  }
}

async function personalPassword(id, password) {
  setPersonalError("");
  try {
    await api(`/api/accounts/${id}/password`, {
      method: "POST",
      body: { password }
    });
    await loadPersonalAccounts();
    startPersonalPolling();
  } catch (error) {
    setPersonalError(error.message);
  }
}

async function switchMode(mode) {
  if (mode !== "shared" && mode !== "personal") return;
  if (state.mode === mode) return;
  if (mode === "personal" && !state.personal.enabled) {
    showToast("服务器未启用个人号模式", "error");
    return;
  }
  state.mode = mode;
  state.activeId = null;
  state.active = null;
  state.messages = [];
  document.body.classList.remove("mobile-chat-open");
  applyModeUi();
  renderChatHeader();
  renderMessages();
  await loadConversations();
  await loadPersonalAccounts({ silent: true });
  if (mode === "personal") {
    const hasAccounts = state.personal.accounts.length > 0;
    if (!hasAccounts) showToast("还没有绑定个人号，点击「我的个人号」扫码绑定", "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  showLogin();
}

function showLogin() {
  stopRealtime();
  stopFallbackPolling();
  state.me = null;
  state.activeId = null;
  state.active = null;
  state.messages = [];
  state.messageCache.clear();
  state.conversations = [];
  state.counts = {};
  state.filters = { scope: "all", status: "open", q: "" };
  state.aiSuggestion = null;
  state.aiPrefs = null;
  state.sending = false;
  state.uploading = false;
  document.body.classList.remove("mobile-chat-open");
  $("#inboxView").hidden = true;
  $("#viewerView").hidden = true;
  $("#loginView").hidden = false;
  $("#channelsModal").hidden = true;
  $("#personalModal").hidden = true;
  stopPersonalPolling();
  state.mode = "shared";
  $("#teamModal").hidden = true;
  $("#adminModal").hidden = true;
  $("#passwordModal").hidden = true;
  $("#cannedModal").hidden = true;
  $("#statsModal").hidden = true;
  $("#loginTotpWrap").hidden = true;
  $("#loginTotp").value = "";
  $("#customerPanel").hidden = true;
  state.stats = null;
  state.sidebarStats = null;
  state.viewerDays = 1;
  state.translate = { configured: false, source: "none", languages: [], defaultTarget: "zh-CN" };
  state.replyLanguages = {};
  state.channels = { telegram: null, whatsapp: null, whatsappWeb: null, translate: null, ai: null };
  state.cannedReplies = [];
  state.editingCannedId = null;
  state.customerTags = [];
  state.customerDirty = false;
  $("#chatPanel").hidden = true;
  $("#chatEmpty").hidden = false;
  renderAiSuggestion();
  document.title = "聚合客服台 · 多渠道收件箱";
  setTimeout(() => $("#loginUsername")?.focus(), 50);
}

async function loadUsers() {
  const data = await api(`/api/users${state.me.role === "admin" ? "?includeInactive=1" : ""}`);
  state.users = data.users.filter(user => user.active);
  if (state.active) renderChatHeader();
}

async function loadAiPreferences() {
  if (!state.me || state.me.role === "viewer") return;
  try {
    const data = await api("/api/ai/preferences");
    state.ai = data.ai || state.ai;
    state.aiPrefs = data.ai || null;
  } catch {
    state.ai = {
      configured: false,
      globalEnabled: false,
      allowed: false,
      enabled: false,
      mode: "auto",
      reason: "not_configured",
      modes: []
    };
  }
  if (state.active) renderChatHeader();
}

async function loadTranslateConfig() {
  if (!state.me || state.me.role === "viewer") return;
  try {
    const data = await api("/api/translate/config");
    state.translate = data.translate || state.translate;
    for (const item of state.translate.languages || []) {
      if (item?.code) LANGUAGE_LABELS[item.code] = item.label || item.code;
    }
  } catch {
    state.translate = { configured: false, source: "none", languages: [], defaultTarget: "zh-CN" };
  }
  if (state.active) renderChatHeader();
}

async function loadConversations(options = {}) {
  const params = new URLSearchParams({
    scope: state.filters.scope,
    status: state.filters.status,
    mode: state.mode,
    limit: "50"
  });
  if (state.filters.q) params.set("q", state.filters.q);

  try {
    const data = await api(`/api/conversations?${params.toString()}`);
    state.conversations = data.items;
    state.counts = data.counts || {};
    renderConversationList();
    renderCounts();
    scheduleSidebarStats();

    if (state.activeId) {
      const active = data.items.find(item => item.id === state.activeId);
      if (active) {
        state.active = active;
        renderChatHeader();
      } else {
        state.threadToken += 1;
        state.activeId = null;
        state.active = null;
        state.messages = [];
        document.body.classList.remove("mobile-chat-open");
        renderChatHeader();
        renderMessages();
      }
    }
    if (!state.activeId && data.items.length && window.innerWidth > 760) {
      selectConversation(data.items[0].id);
    }
  } catch (error) {
    if (!options.silent && error.status !== 401) showToast(error.message, "error");
  }
}

function renderCounts() {
  $("#countMine").textContent = state.counts.mine ?? 0;
  $("#countUnassigned").textContent = state.counts.unassigned ?? 0;
  $("#countAll").textContent = state.counts.all ?? 0;

  const total = state.counts.all ?? 0;
  const open = state.counts.open ?? 0;
  const modeLabel = state.mode === "personal" ? "个人号" : "共用";
  $("#inboxSubtitle").textContent = total
    ? (state.me.role === "admin"
      ? `${modeLabel} · ${total} 个会话 · ${open} 个待处理`
      : `${modeLabel} · ${total} 个分配给我的会话 · ${open} 个待处理`)
    : (state.mode === "personal"
      ? "还没有个人号会话，扫码绑定后客户消息会出现在这里"
      : (state.me.role === "admin" ? "Telegram 私聊与群聊" : "暂无分配给我的会话"));
}

function conversationTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  if (isSameDay(date, now)) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "昨天";
  if (now.getTime() - date.getTime() < 7 * 86400000) {
    return "周" + ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderConversationList() {
  const list = $("#conversationList");
  list.replaceChildren();

  if (!state.conversations.length) {
    $("#listEmpty").hidden = false;
    $("#listEmptyText").textContent = state.filters.q
      ? "没有找到匹配的会话，试试其他关键词。"
      : state.mode === "personal"
        ? "还没有个人号会话。点击「个人号」绑定自己的 WhatsApp 或 Telegram，客户消息会出现在这里。"
        : state.me.role === "agent"
          ? "管理员分配会话后，会显示在这里。"
          : (state.telegramConfigured || state.whatsappConfigured || state.whatsappWebConfigured)
            ? "在 Telegram 或 WhatsApp 里给客户发一条消息，就会出现在这里。"
            : "配置 TELEGRAM_BOT_TOKEN 或 WHATSAPP_*，或在「渠道」中扫码登录 WhatsApp 个人号，消息会出现在这里。";
    updateDocumentTitle();
    return;
  }

  $("#listEmpty").hidden = true;
  const fragment = document.createDocumentFragment();

  for (const conversation of state.conversations) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "conversation-item" + (conversation.id === state.activeId ? " active" : "");
    item.addEventListener("click", () => selectConversation(conversation.id));

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.setProperty("--hue", hueFor(conversation.title));
    avatar.textContent = initials(conversation.title);

    const main = document.createElement("div");
    main.className = "conversation-main";

    const top = document.createElement("div");
    top.className = "conversation-top";
    const title = document.createElement("strong");
    title.textContent = conversation.title || "未命名会话";
    const time = document.createElement("time");
    time.textContent = conversationTime(conversation.lastMessageAt);
    top.append(title, time);

    const preview = document.createElement("div");
    preview.className = "conversation-preview" + (conversation.unreadCount ? " unread" : "");
    preview.textContent =
      (conversation.lastMessageDirection === "out" ? "你：" : "") +
      (conversation.lastMessagePreview || "暂无消息");

    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    const channel = document.createElement("span");
    channel.className = "channel-chip " + (conversation.channel || "telegram");
    channel.textContent = conversation.accountId
      ? (conversation.channel === "whatsapp_web" ? "WA·个人" : "TG·个人")
      : conversation.channel === "whatsapp"
        ? "WA"
        : conversation.channel === "whatsapp_web" ? "WAW" : "TG";
    channel.title = conversation.accountId
      ? `${channelLabel(conversation.channel)} · ${conversation.accountLabel || conversation.accountName || "个人号"}`
      : channelLabel(conversation.channel);
    meta.appendChild(channel);
    if (conversation.accountId && state.me.role === "admin" && conversation.accountOwnerName) {
      const owner = document.createElement("span");
      owner.className = "assignee-chip";
      owner.textContent = conversation.accountOwnerName;
      owner.title = "个人号所属员工";
      meta.appendChild(owner);
    }
    if (conversation.assigneeName) {
      const assignee = document.createElement("span");
      assignee.className = "assignee-chip";
      assignee.textContent = conversation.assigneeName;
      meta.appendChild(assignee);
    }
    const status = document.createElement("span");
    status.className = "status-chip " + conversation.status;
    status.textContent = statusLabel(conversation.status);
    meta.appendChild(status);

    const tags = Array.isArray(conversation.tags) ? conversation.tags : [];
    for (const tag of tags.slice(0, 2)) {
      const chip = document.createElement("span");
      chip.className = "tag-chip small";
      chip.textContent = tag;
      meta.appendChild(chip);
    }
    if (tags.length > 2) {
      const more = document.createElement("span");
      more.className = "tag-chip small";
      more.textContent = "+" + (tags.length - 2);
      meta.appendChild(more);
    }

    main.append(top, preview, meta);

    item.append(avatar, main);

    if (conversation.unreadCount > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-badge";
      unread.textContent = conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount);
      item.appendChild(unread);
    }

    fragment.appendChild(item);
  }

  list.appendChild(fragment);
  updateDocumentTitle();
}

function updateDocumentTitle() {
  const unread = state.conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0);
  document.title = unread
    ? `(${unread}) 聚合客服台 · 统一收件箱`
    : "聚合客服台 · 统一收件箱";
}

function upsertConversation(conversation) {
  const index = state.conversations.findIndex(item => item.id === conversation.id);
  if (index >= 0) state.conversations[index] = conversation;
  else state.conversations.push(conversation);

  state.conversations.sort((a, b) => {
    const left = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
    const right = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
    return right - left;
  });

  if (state.activeId === conversation.id) state.active = conversation;
}

function rememberThread(id, messages = state.messages, hasMore = state.hasMore) {
  if (!id) return;
  state.messageCache.delete(id);
  state.messageCache.set(id, { messages: messages.slice(), hasMore });
  while (state.messageCache.size > 20) {
    state.messageCache.delete(state.messageCache.keys().next().value);
  }
}

function forgetThread(id) {
  if (id) state.messageCache.delete(id);
}

function mergeMessage(list, message) {
  const original = message.meta?.originalText || message.body;
  const optimisticIndex = list.findIndex(item =>
    item.optimistic && item.direction === "out" && item.body === original
  );
  if (optimisticIndex >= 0) list.splice(optimisticIndex, 1);

  const index = list.findIndex(item => item.id === message.id);
  if (index >= 0) list[index] = message;
  else list.push(message);
  list.sort((a, b) => {
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || a.id - b.id;
  });
}

function dropOptimisticMessage(id, conversationId) {
  const matches = item => item.optimistic && item.id === id;
  if (state.activeId === conversationId) state.messages = state.messages.filter(item => !matches(item));
  const cached = state.messageCache.get(conversationId);
  if (cached) cached.messages = cached.messages.filter(item => !matches(item));
}

async function selectConversation(id) {
  if (!id) return;
  if (state.activeId === id) {
    document.body.classList.add("mobile-chat-open");
    $("#chatEmpty").hidden = true;
    $("#chatPanel").hidden = false;
    renderChatHeader();
    loadAiSuggestion(id);
    markRead(id);
    return;
  }

  if (state.activeId && state.messages.length) {
    rememberThread(state.activeId);
  }

  const token = ++state.threadToken;
  state.activeId = id;
  state.active = state.conversations.find(item => item.id === id) || null;
  const cached = state.messageCache.get(id);
  state.messages = cached ? cached.messages.slice() : [];
  state.hasMore = cached ? cached.hasMore : false;
  state.customerDirty = false;
  state.customerTags = [...(state.active?.tags || [])];
  state.aiSuggestion = null;
  renderAiSuggestion();

  document.body.classList.add("mobile-chat-open");
  $("#chatEmpty").hidden = true;
  $("#chatPanel").hidden = false;
  renderChatHeader();
  renderMessages({ scrollToBottom: Boolean(cached) });

  let detailFailed = false;
  const detailPromise = state.active
    ? Promise.resolve()
    : api(`/api/conversations/${id}`).then(data => {
      if (token !== state.threadToken) return;
      state.active = data.conversation;
      upsertConversation(data.conversation);
      renderChatHeader();
    }).catch(error => {
      if (token !== state.threadToken) return;
      detailFailed = true;
      state.activeId = null;
      state.active = null;
      renderChatHeader();
      showToast(error.message, "error");
    });

  const messagesPromise = loadMessages(id, token);
  loadAiSuggestion(id, token);

  await detailPromise;
  if (token !== state.threadToken || detailFailed) return;
  markRead(id);
  await messagesPromise;
}

async function loadMessages(id, token) {
  try {
    const data = await api(`/api/conversations/${id}/messages?limit=50`);
    if (state.activeId !== id || token !== state.threadToken) return;
    state.messages = data.messages;
    state.hasMore = data.hasMore;
    rememberThread(id, data.messages, data.hasMore);
    renderMessages({ scrollToBottom: true });
  } catch (error) {
    if (token === state.threadToken && error.status !== 401) {
      showToast(error.message, "error");
    }
  }
}

async function loadMoreMessages() {
  if (!state.activeId || !state.messages.length) return;
  const id = state.activeId;
  const token = state.threadToken;
  const before = state.messages[0].createdAt;
  const button = $("#loadMoreBtn");
  button.disabled = true;

  try {
    const data = await api(
      `/api/conversations/${id}/messages?limit=50&before=${encodeURIComponent(before)}`
    );
    if (state.activeId !== id || token !== state.threadToken) return;

    const list = $("#messageList");
    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;
    const existing = new Set(state.messages.map(message => message.id));
    const older = data.messages.filter(message => !existing.has(message.id));

    state.messages = [...older, ...state.messages];
    state.hasMore = data.hasMore;
    rememberThread(id, state.messages, state.hasMore);
    renderMessages();
    list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function renderMessages(options = {}) {
  const list = $("#messageList");
  if (!list) return;

  const wasNearBottom = isNearBottom();
  list.replaceChildren();

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "message-list-empty";
    empty.textContent = "还没有消息";
    list.appendChild(empty);
  }

  let lastDay = "";
  for (const message of state.messages) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      const separator = document.createElement("div");
      separator.className = "date-separator";
      const label = document.createElement("span");
      label.textContent = dayLabel(message.createdAt);
      separator.appendChild(label);
      list.appendChild(separator);
    }
    list.appendChild(buildMessageRow(message));
  }

  $("#loadMoreWrap").hidden = !state.hasMore;
  $("#loadMoreBtn").disabled = false;

  if (options.scrollToBottom || wasNearBottom) {
    list.scrollTop = list.scrollHeight;
  }
}

function buildMessageRow(message) {
  const out = message.direction === "out";
  const row = document.createElement("div");
  row.className = "message-row " + (out ? "out" : "in") + (message.optimistic ? " pending" : "");

  if (!out) {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.style.setProperty("--hue", hueFor(message.senderName));
    avatar.textContent = initials(message.senderName);
    row.appendChild(avatar);
  }

  const stack = document.createElement("div");
  stack.className = "message-stack";

  if (!out) {
    const sender = document.createElement("div");
    sender.className = "message-sender";
    sender.textContent = message.senderName || "联系人";
    stack.appendChild(sender);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  appendMessageContent(bubble, message);
  appendTranslationNote(bubble, message);

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = messageTime(message.createdAt);
  if (out) {
    const status = message.deliveryStatus || "sent";
    const delivery = document.createElement("span");
    delivery.className = "delivery-status " + status;
    delivery.textContent = deliveryStatusIcon(status);
    delivery.title = deliveryStatusLabel(status);
    delivery.setAttribute("aria-label", deliveryStatusLabel(status));
    time.appendChild(delivery);
  }

  stack.append(bubble, time);

  if (!message.optimistic) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "message-action";
    remove.dataset.messageAction = "delete";
    remove.dataset.messageId = String(message.id);
    remove.dataset.direction = message.direction;
    remove.textContent = out ? "撤回" : "删除";
    remove.title = out ? "撤回这条消息" : "删除对方这条消息";
    actions.appendChild(remove);
    stack.appendChild(actions);
  }

  row.appendChild(stack);
  return row;
}

function appendMessageContent(bubble, message) {
  const type = message.type || "text";
  const meta = message.meta || {};
  const body = String(message.body || "");
  const mediaUrl = `/api/messages/${encodeURIComponent(message.id)}/media`;
  const canProxyMedia = (state.active?.channel || "telegram") === "telegram" && state.telegramConfigured;

  if (type === "photo") {
    if (canProxyMedia) {
      const image = document.createElement("img");
      image.className = "message-media";
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = meta.fileName || "Telegram 图片";
      image.src = mediaUrl;
      image.addEventListener("click", () => window.open(mediaUrl, "_blank", "noopener,noreferrer"));
      bubble.appendChild(image);
    } else {
      bubble.appendChild(document.createTextNode("[图片]"));
    }
    if (body && body !== "[图片]") appendCaption(bubble, body);
    return;
  }

  if (type === "document") {
    if (canProxyMedia) {
      const link = document.createElement("a");
      link.className = "file-link";
      link.href = mediaUrl;
      link.download = meta.fileName || "telegram-file";
      link.textContent = "📎 " + (meta.fileName || "下载文件");
      bubble.appendChild(link);
    } else {
      bubble.appendChild(document.createTextNode(body || "[文件]"));
    }
    if (body && !body.startsWith("[文件]")) appendCaption(bubble, body);
    return;
  }

  if (type === "voice" || type === "audio") {
    if (canProxyMedia) {
      const audio = document.createElement("audio");
      audio.className = "audio-player";
      audio.controls = true;
      audio.preload = "none";
      audio.src = mediaUrl;
      bubble.appendChild(audio);
    } else {
      bubble.appendChild(document.createTextNode(body || "[语音]"));
    }
    if (body && !body.startsWith("[语音]") && !body.startsWith("[音频]")) appendCaption(bubble, body);
    return;
  }

  if (type === "video" || type === "video_note") {
    if (canProxyMedia) {
      const video = document.createElement("video");
      video.className = "video-player";
      video.controls = true;
      video.preload = "metadata";
      video.src = mediaUrl;
      bubble.appendChild(video);
    } else {
      bubble.appendChild(document.createTextNode(body || "[视频]"));
    }
    if (body && !body.startsWith("[视频]")) appendCaption(bubble, body);
    return;
  }

  if (type === "sticker") {
    if (canProxyMedia) {
      const image = document.createElement("img");
      image.className = "message-media";
      image.loading = "lazy";
      image.alt = "贴纸";
      image.src = mediaUrl;
      bubble.appendChild(image);
    } else {
      bubble.appendChild(document.createTextNode(body || "[贴纸]"));
    }
    return;
  }

  bubble.appendChild(document.createTextNode(body || "（空消息）"));
}

function appendCaption(bubble, text) {
  const caption = document.createElement("div");
  caption.className = "message-caption";
  caption.textContent = text;
  bubble.appendChild(caption);
}

function appendTranslationNote(bubble, message) {
  const meta = message.meta || {};
  if (message.translatedBody) {
    const note = document.createElement("div");
    note.className = "message-translation";
    const label = document.createElement("span");
    label.className = "message-translation-label";
    label.textContent = `译文 · ${languageName(message.translationLanguage)}`;
    const text = document.createElement("p");
    text.textContent = message.translatedBody;
    note.append(label, text);
    bubble.appendChild(note);
  } else if (message.direction === "out" && meta.translated && meta.originalText) {
    const note = document.createElement("div");
    note.className = "message-translation out";
    const label = document.createElement("span");
    label.className = "message-translation-label";
    label.textContent = `原文 · ${languageName(meta.sourceLanguage)}`;
    const text = document.createElement("p");
    text.textContent = meta.originalText;
    note.append(label, text);
    bubble.appendChild(note);
  }
}

function renderChatHeader() {
  const conversation = state.active;
  if (!conversation) {
    $("#chatPanel").hidden = true;
    $("#chatEmpty").hidden = false;
    return;
  }

  $("#chatEmpty").hidden = true;
  $("#chatPanel").hidden = false;

  const avatar = $("#chatAvatar");
  avatar.style.setProperty("--hue", hueFor(conversation.title));
  avatar.textContent = initials(conversation.title);

  $("#chatTitle").textContent = conversation.title || "未命名会话";
  const typeLabel = conversation.chatType === "private" ? "私聊" : "群聊";
  const displayId = String(conversation.chatId || "")
    .replace(/^wa:/, "")
    .replace(/^waweb:\d+:/, "")
    .replace(/^mtproto:\d+:/, "");
  $("#chatSubtitle").textContent =
    channelLabel(conversation.channel) +
    (conversation.accountId ? ` · ${conversation.accountLabel || conversation.accountName || "个人号"}` : "") + " · " +
    (conversation.username ? "@" + conversation.username + " · " : "") +
    typeLabel + " · ID " + displayId;

  const language = $("#chatLanguage");
  if (conversation.detectedLanguage) {
    language.hidden = false;
    language.textContent = `客户语言：${languageName(conversation.detectedLanguage)}`;
  } else {
    language.hidden = true;
    language.textContent = "";
  }

  const aiState = $("#chatAiState");
  if (aiState) {
    if (!conversation.assigneeId) {
      aiState.hidden = true;
      aiState.textContent = "";
    } else {
      let label = "AI 未配置";
      let tone = "off";
      if (state.ai?.configured && !state.ai.globalEnabled) {
        label = "AI 总开关关闭";
      } else if (state.ai?.configured && !conversation.assigneeAiAllowed) {
        label = "AI 未授权";
      } else if (state.ai?.configured && !conversation.assigneeAiEnabled) {
        label = "AI 已关闭";
      } else if (state.ai?.configured) {
        label = `AI ${aiModeLabel(conversation.assigneeAiMode)}`;
        tone = conversation.assigneeAiMode === "suggest" ? "suggest" : "on";
      }
      aiState.hidden = false;
      aiState.className = "chat-ai-state " + tone;
      aiState.textContent = label;
      aiState.title = conversation.assigneeId === state.me?.id
        ? "点击打开我的 AI 设置"
        : "该会话负责客服的 AI 状态";
    }
  }

  const unread = Number(conversation.unreadCount || 0);
  const readState = $("#chatReadState");
  readState.hidden = false;
  readState.className = "chat-read-state " + (unread ? "unread" : "read");
  readState.textContent = unread ? `未读 ${unread}` : "已读";
  const markUnreadBtn = $("#markUnreadBtn");
  markUnreadBtn.disabled = unread > 0;
  markUnreadBtn.title = unread > 0 ? "当前会话已有未读消息" : "把当前会话标记为未读";
  $("#deleteConversationBtn").hidden = state.me?.role !== "admin";

  $("#statusSelect").value = conversation.status;
  renderAssigneeOptions(conversation);
  renderReplyLanguageOptions(conversation);
  renderTelegramState();
  renderCustomerPanel();
}

function renderReplyLanguageOptions(conversation) {
  const wrap = $("#replyLanguageWrap");
  const select = $("#replyLanguage");
  const hint = $("#translateHint");
  const configured = Boolean(state.translate?.configured);
  if (!wrap || !select) return;
  wrap.hidden = !configured;
  hint.hidden = configured;
  if (!configured) return;

  const detected = conversation.detectedLanguage;
  const previous = state.replyLanguages[conversation.id] || "auto";
  select.replaceChildren();

  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = detected ? `跟随客户（${languageName(detected)}）` : "跟随客户（自动识别）";
  select.appendChild(auto);

  const languages = (state.translate.languages || []).length
    ? state.translate.languages
    : FALLBACK_LANGUAGES.map(([code, label]) => ({ code, label }));
  for (const item of languages) {
    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = item.label;
    select.appendChild(option);
  }
  select.value = [...select.options].some(option => option.value === previous) ? previous : "auto";
  select.disabled = state.sending || state.uploading;
}

function renderAssigneeOptions(conversation) {
  const select = $("#assigneeSelect");
  select.replaceChildren();

  const addOption = (value, label, disabled = false) => {
    const option = document.createElement("option");
    option.value = value === null ? "" : String(value);
    option.textContent = label;
    option.disabled = disabled;
    select.appendChild(option);
  };

  const isAdmin = state.me.role === "admin";
  select.disabled = !isAdmin;

  if (isAdmin) {
    addOption(null, "未分配");
    for (const user of state.users) {
      if (user.role === "viewer") continue;
      addOption(user.id, user.displayName);
    }
    if (
      conversation.assigneeId &&
      !state.users.some(user => user.id === conversation.assigneeId && user.role !== "viewer")
    ) {
      addOption(conversation.assigneeId, (conversation.assigneeName || "已停用客服") + "（不可分配）", true);
    }
  } else if (conversation.assigneeId) {
    addOption(
      conversation.assigneeId,
      conversation.assigneeId === state.me.id ? "我" : (conversation.assigneeName || "其他客服"),
      true
    );
  } else {
    addOption(null, "未分配", true);
  }

  select.value = conversation.assigneeId ? String(conversation.assigneeId) : "";

  const claim = $("#claimBtn");
  claim.hidden = true;
}

function channelLabel(channel) {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "whatsapp_web") return "WhatsApp 个人号";
  if (channel === "telegram_user") return "Telegram 个人号";
  return "Telegram";
}

function activeChannelConfigured() {
  if (state.active?.accountId) {
    const account = state.personal.accounts.find(item => item.id === state.active.accountId);
    return Boolean(account?.status?.running);
  }
  const channel = state.active?.channel || "telegram";
  if (channel === "whatsapp") return state.whatsappConfigured;
  if (channel === "whatsapp_web") return state.whatsappWebConfigured;
  return state.telegramConfigured;
}

function renderTelegramState() {
  const channel = state.active?.channel || "telegram";
  const configured = activeChannelConfigured();
  const label = channelLabel(channel);
  $("#telegramWarning").hidden = configured;
  $("#setupHint").hidden = configured;
  $("#telegramWarning").textContent = state.active?.accountId
    ? "该个人号未登录或连接已断开，当前只能查看本地数据。请到「个人号」中重新扫码。"
    : channel === "whatsapp"
      ? "未配置 WhatsApp 凭据，当前只能查看本地数据，无法发送回复。请让管理员在「渠道」中配置。"
      : channel === "whatsapp_web"
        ? "WhatsApp 个人号未登录或连接已断开，当前只能查看本地数据，无法发送回复。请让管理员在「渠道」中扫码。"
        : channel === "telegram_user"
          ? "Telegram 个人号未登录或连接已断开，当前只能查看本地数据。请到「个人号」中重新扫码。"
          : "未配置 Telegram Bot Token，当前只能查看本地数据，无法发送回复。请让管理员在「渠道」中配置。";

  const input = $("#messageInput");
  const send = $("#sendBtn");
  const attach = $("#attachBtn");
  input.disabled = !configured;
  send.disabled = !configured || state.sending || state.uploading;
  if (attach) {
    attach.hidden = channel !== "telegram";
    attach.disabled = !configured || state.uploading;
  }
  input.placeholder = configured
    ? "输入回复，Enter 发送，Shift + Enter 换行"
    : `未配置 ${label} 凭据，暂时无法发送`;
}

async function updateConversation(payload) {
  if (!state.active) return;
  try {
    const data = await api(`/api/conversations/${state.active.id}`, {
      method: "PATCH",
      body: payload
    });
    state.active = data.conversation;
    upsertConversation(data.conversation);
    renderChatHeader();
    renderConversationList();
    scheduleSidebarStats();
    scheduleRefresh();
    showToast("会话已更新", "success");
  } catch (error) {
    showToast(error.message, "error");
    renderChatHeader();
  }
}

async function markConversationUnread() {
  const id = state.activeId;
  const conversation = state.conversations.find(item => item.id === id) ||
    (state.activeId === id ? state.active : null);
  if (!id || !conversation) return;

  const button = $("#markUnreadBtn");
  button.disabled = true;
  try {
    const data = await api(`/api/conversations/${id}/unread`, { method: "POST" });
    conversation.unreadCount = data.unreadCount;
    if (state.activeId === id && state.active) state.active.unreadCount = data.unreadCount;
    renderConversationList();
    renderChatHeader();
    scheduleSidebarStats();
    showToast("已标记为未读", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = Number(conversation.unreadCount || 0) > 0;
  }
}

async function deleteActiveConversation() {
  const conversation = state.active;
  if (!conversation || state.me?.role !== "admin") return;
  const title = conversation.title || "未命名会话";
  const confirmed = window.confirm(
    `确定删除「${title}」吗？\n\n` +
    "只会删除工作台里的会话和消息，不会删除客户手机上的聊天记录。\n" +
    "删除后无法恢复；客户之后发新消息会创建新会话。"
  );
  if (!confirmed) return;

  const button = $("#deleteConversationBtn");
  button.disabled = true;
  try {
    await api(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    state.threadToken += 1;
    forgetThread(conversation.id);
    state.activeId = null;
    state.active = null;
    state.messages = [];
    document.body.classList.remove("mobile-chat-open");
    await loadConversations({ silent: true });
    renderChatHeader();
    renderMessages();
    showToast("会话已删除", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function markRead(id, options = {}) {
  const conversation = state.conversations.find(item => item.id === id) ||
    (state.activeId === id ? state.active : null);
  if (!conversation || !conversation.unreadCount || state.reading === id) return;
  state.reading = id;
  try {
    await api(`/api/conversations/${id}/read`, { method: "POST" });
    conversation.unreadCount = 0;
    if (state.activeId === id && state.active) state.active.unreadCount = 0;
    renderConversationList();
    if (state.activeId === id) renderChatHeader();
    scheduleSidebarStats();
  } catch (error) {
    if (!options.silent && error.status !== 401) showToast(error.message, "error");
  } finally {
    state.reading = null;
  }
}

function connectRealtime() {
  stopRealtime();
  setConnection("connecting");
  try {
    const source = new EventSource("/api/events");
    state.eventSource = source;
    source.onopen = () => {
      state.sseConnected = true;
      setConnection("online");
    };
    source.onerror = () => {
      state.sseConnected = false;
      setConnection("offline");
    };
    source.onmessage = event => {
      try {
        handleRealtime(JSON.parse(event.data));
      } catch {}
    };
  } catch {
    setConnection("offline");
  }
}

function stopRealtime() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.sseConnected = false;
}

function startFallbackPolling() {
  stopFallbackPolling();
  state.fallbackTimer = setInterval(() => {
    if (state.sseConnected) return;
    loadConversations({ silent: true });
    if (state.activeId) refreshActiveThread();
  }, 10000);
}

function stopFallbackPolling() {
  if (state.fallbackTimer) clearInterval(state.fallbackTimer);
  state.fallbackTimer = null;
}

function handleRealtime(event) {
  if (!event || !event.type) return;

  if (event.conversation) {
    const eventMode = event.conversation.accountId ? "personal" : "shared";
    if (eventMode !== state.mode) {
      if (state.activeId === event.conversation.id) {
        state.threadToken += 1;
        state.activeId = null;
        state.active = null;
        state.messages = [];
        renderChatHeader();
        renderMessages();
      }
      scheduleRefresh();
      return;
    }
  }

  if (event.type === "conversation.removed") {
    state.conversations = state.conversations.filter(item => item.id !== event.conversationId);
    forgetThread(event.conversationId);
    if (state.activeId === event.conversationId) {
      state.threadToken += 1;
      state.activeId = null;
      state.active = null;
      state.messages = [];
      document.body.classList.remove("mobile-chat-open");
      renderChatHeader();
      renderMessages();
    }
    renderConversationList();
    scheduleSidebarStats();
    return;
  }

  if (event.type === "ai.preferences_updated") {
    if (event.user?.id === state.me?.id) {
      state.me = { ...state.me, ...event.user };
      loadAiPreferences();
      if (state.active) renderChatHeader();
    }
    return;
  }

  if (event.conversation) {
    upsertConversation(event.conversation);
    if (state.activeId === event.conversation.id) state.active = event.conversation;
  }

  if (event.type === "ai.suggestion") {
    if (state.activeId === event.conversation?.id) {
      state.aiSuggestion = event.suggestion || null;
      renderAiSuggestion();
      showToast("AI 已生成回复建议", "success");
    }
    renderConversationList();
    return;
  }

  if (event.type === "ai.error") {
    if (state.activeId === event.conversation?.id) {
      showToast(`AI 自动回复失败：${event.error || "请稍后重试"}`, "error");
    }
    return;
  }

  if (event.type === "ai.replied") {
    return;
  }

  if (event.type === "message.created" || event.type === "message.updated") {
    if (event.message && state.activeId === event.conversation?.id) {
      const nearBottom = isNearBottom();
      upsertMessage(event.message);
      renderMessages({ scrollToBottom: nearBottom });
      if (document.visibilityState === "visible") markRead(state.activeId, { silent: true });
    }
    renderConversationList();
    if (state.active) renderChatHeader();
    scheduleSidebarStats();
    scheduleRefresh();
    return;
  }

  if (event.type === "message.deleted") {
    if (state.activeId === event.conversationId) {
      state.messages = state.messages.filter(message => message.id !== event.messageId);
      renderMessages();
    }
    renderConversationList();
    if (state.activeId === event.conversationId) renderChatHeader();
    scheduleSidebarStats();
    return;
  }

  if (event.type === "message.status" && event.message) {
    if (state.activeId === event.message.conversationId) {
      upsertMessage(event.message);
      renderMessages();
    }
    return;
  }

  if (event.type === "conversation.created" || event.type === "conversation.updated") {
    renderConversationList();
    if (state.activeId === event.conversation?.id) renderChatHeader();
    scheduleSidebarStats();
    scheduleRefresh();
    return;
  }

  if (event.type === "conversation.read" || event.type === "conversation.unread") {
    const conversation = state.conversations.find(item => item.id === event.conversationId);
    const unread = Number(event.unreadCount || 0);
    if (conversation) conversation.unreadCount = unread;
    if (state.activeId === event.conversationId && state.active) state.active.unreadCount = unread;
    renderConversationList();
    if (state.activeId === event.conversationId) renderChatHeader();
    scheduleSidebarStats();
  }
}

function upsertMessage(message) {
  mergeMessage(state.messages, message);
  const cached = state.messageCache.get(message.conversationId);
  if (cached && state.activeId !== message.conversationId) {
    mergeMessage(cached.messages, message);
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    loadConversations({ silent: true });
  }, 600);
}

async function refreshActiveThread() {
  if (!state.activeId) return;
  const id = state.activeId;
  const token = state.threadToken;
  try {
    const data = await api(`/api/conversations/${id}/messages?limit=50`);
    if (state.activeId !== id || token !== state.threadToken) return;

    const existing = new Map(state.messages.map(message => [message.id, message]));
    let added = 0;
    for (const message of data.messages) {
      if (!existing.has(message.id)) added++;
      existing.set(message.id, message);
    }
    if (!added) return;

    state.messages = [...existing.values()].sort((a, b) => {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || a.id - b.id;
    });
    if (state.messages.length <= data.messages.length) state.hasMore = data.hasMore;
    rememberThread(id, state.messages, state.hasMore);
    const nearBottom = isNearBottom();
    renderMessages({ scrollToBottom: nearBottom });
    markRead(id, { silent: true });
  } catch {}
}

async function removeMessage(messageId, direction) {
  const label = direction === "out" ? "撤回" : "删除";
  if (!window.confirm(`确定${label}这条消息？`)) return;
  try {
    const data = await api(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      body: { remote: true }
    });
    state.messages = state.messages.filter(message => message.id !== Number(messageId));
    if (data.conversation) {
      state.active = data.conversation;
      upsertConversation(data.conversation);
    }
    renderMessages();
    renderConversationList();
    renderChatHeader();
    showToast(
      data.remote ? "消息已撤回" : `已从本地删除${data.warning ? "：" + data.warning : ""}`,
      data.remote ? "success" : ""
    );
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function sendMessage() {
  if (!state.active || state.sending || state.uploading) return;
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text) return;
  const conversation = state.active;
  const conversationId = conversation.id;
  const channel = conversation.channel || "telegram";
  if (!activeChannelConfigured()) {
    showToast(conversation.accountId
      ? "该个人号未登录，请到「我的个人号」中扫码"
      : `未配置 ${channelLabel(channel)} 凭据，无法发送`, "error");
    return;
  }

  const targetLanguage = state.translate?.configured
    ? ($("#replyLanguage")?.value || "auto")
    : "auto";
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  state.sending = true;
  const button = $("#sendBtn");
  button.disabled = true;
  button.textContent = "发送中…";

  state.messages.push({
    id: tempId,
    conversationId,
    direction: "out",
    senderId: state.me?.id,
    senderName: state.me?.displayName || state.me?.username || "我",
    body: text,
    type: "text",
    meta: {},
    deliveryStatus: "sending",
    createdAt: new Date().toISOString(),
    optimistic: true
  });
  renderMessages({ scrollToBottom: true });
  input.value = "";
  updateCharCount();
  autoResize(input);
  input.focus();

  try {
    const data = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { text, targetLanguage }
    });
    dropOptimisticMessage(tempId, conversationId);

    if (state.activeId === conversationId) {
      state.active = data.conversation;
      upsertConversation(data.conversation);
      upsertMessage(data.message);
      renderMessages({ scrollToBottom: true });
      renderChatHeader();
      renderConversationList();
      scheduleSidebarStats();
    } else {
      upsertConversation(data.conversation);
      const cached = state.messageCache.get(conversationId);
      if (cached) mergeMessage(cached.messages, data.message);
      renderConversationList();
    }
    showToast("已发送", "success");
  } catch (error) {
    dropOptimisticMessage(tempId, conversationId);
    if (!input.value.trim()) {
      input.value = text;
      updateCharCount();
      autoResize(input);
    }
    if (state.activeId === conversationId) renderMessages();
    showToast(error.message, "error");
  } finally {
    state.sending = false;
    button.textContent = "发送";
    button.disabled = !activeChannelConfigured() || state.uploading;
    input.focus();
  }
}

async function uploadAttachment(file) {
  if (!state.active || !file || state.uploading || state.sending) return;
  if ((state.active.channel || "telegram") !== "telegram") {
    showToast("当前渠道暂不支持出站附件", "error");
    return;
  }
  if (!state.telegramConfigured) {
    showToast("未配置 TELEGRAM_BOT_TOKEN，无法发送附件", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("文件不能超过 20MB", "error");
    return;
  }
  const caption = $("#messageInput").value.trim();
  if (caption.length > 1024) {
    showToast("附件说明不能超过 1024 个字符", "error");
    return;
  }

  const conversationId = state.active.id;
  const button = $("#attachBtn");
  state.uploading = true;
  button.disabled = true;
  button.textContent = "上传中…";
  renderTelegramState();

  try {
    const response = await fetch(`/api/conversations/${conversationId}/media`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || "file"),
        "x-file-type": file.type || "application/octet-stream",
        "x-caption": encodeURIComponent(caption)
      },
      body: file
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!response.ok) {
      if (response.status === 401 && state.me) handleSessionExpired();
      throw new ApiError(data.error || `上传失败（${response.status}）`, response.status);
    }

    if (state.activeId === conversationId) {
      state.active = data.conversation;
      upsertConversation(data.conversation);
      upsertMessage(data.message);
      renderMessages({ scrollToBottom: true });
      renderChatHeader();
      renderConversationList();
      scheduleSidebarStats();
    }
    $("#messageInput").value = "";
    updateCharCount();
    autoResize($("#messageInput"));
    showToast("附件已发送", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.uploading = false;
    $("#fileInput").value = "";
    button.textContent = "附件";
    renderTelegramState();
  }
}

/* ---------- Sidebar stats ---------- */
function scheduleSidebarStats() {
  if (!state.me || state.me.role === "viewer") return;
  if (state.sidebarTimer) clearTimeout(state.sidebarTimer);
  state.sidebarTimer = setTimeout(loadSidebarStats, 500);
}

async function loadSidebarStats() {
  if (!state.me || state.me.role === "viewer") return;
  try {
    const data = await api("/api/stats?days=1");
    state.sidebarStats = data.stats;
    renderSidebarStats();
  } catch {}
}

function renderSidebarStats() {
  const stats = state.sidebarStats;
  if (!stats) return;
  const isAdmin = state.me.role === "admin";
  const agents = (isAdmin
    ? stats.agents.slice()
    : stats.agents.filter(agent => agent.id === state.me.id))
    .sort((a, b) => b.newConversations - a.newConversations || b.assigned - a.assigned);

  const own = agents[0] || {};
  $("#sidebarIncoming").textContent = Number(isAdmin ? stats.totals.newConversations : own.newConversations || 0)
    .toLocaleString("zh-CN");
  $("#sidebarActive").textContent = Number(isAdmin ? stats.totals.assigned : own.assigned || 0)
    .toLocaleString("zh-CN");
  $("#sidebarUnread").textContent = Number(isAdmin ? stats.totals.unread : own.unread || 0)
    .toLocaleString("zh-CN");
  $("#sidebarStatsHint").textContent = isAdmin ? "全团队 · 今日" : "我的 · 今日";
  $("#sidebarStats").classList.toggle("agent", !isAdmin);

  const rows = $("#sidebarAgentRows");
  rows.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement("div");
    row.className = "sidebar-agent-row";
    const name = document.createElement("strong");
    name.textContent = agent.displayName;
    const value = document.createElement("span");
    value.textContent = `进人 ${agent.newConversations} · 接待 ${agent.assigned}`;
    row.append(name, value);
    rows.appendChild(row);
  }
}

/* ---------- Stats ---------- */
async function openStatsModal() {
  const isAdmin = state.me.role === "admin";
  $("#statsTitle").textContent = isAdmin ? "统计看板" : "我的数据";
  $("#statsSubtitle").textContent = isAdmin
    ? "会话、消息和客服工作量概览。"
    : "仅显示分配给我的会话和消息。";
  $("#statsWorkloadLabel").textContent = isAdmin ? "客服工作量" : "我的工作量";
  $("#statsDailyLabel").textContent = isAdmin ? "每日进人 / 有效聊天" : "我的每日进人 / 有效聊天";
  $("#statsExport").textContent = isAdmin ? "导出 CSV" : "导出我的 CSV";
  $("#statsTeamSummary").hidden = !isAdmin;
  $("#statsDuplicates").hidden = !isAdmin;
  $("#statsModal").hidden = false;
  $("#statsRange").value = String(state.statsDays || 7);
  await loadStats();
}

async function loadStats() {
  const days = Number($("#statsRange").value) || 7;
  try {
    const [data, team] = await Promise.all([
      api(`/api/stats?days=${days}`),
      api(`/api/stats/team-daily?days=${days}`)
    ]);
    state.stats = data.stats;
    state.teamDaily = team.stats;
    state.statsDays = days;
    renderStats();
    renderTeamDaily();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadViewerStats() {
  const days = Number($("#viewerRange").value) || 1;
  try {
    const [data, team] = await Promise.all([
      api(`/api/stats?days=${days}`),
      api(`/api/stats/team-daily?days=${days}`)
    ]);
    state.stats = data.stats;
    state.teamDaily = team.stats;
    state.viewerDays = days;
    renderStats();
    renderTeamDaily();
    $("#viewerSubtitle").textContent = days === 1
      ? "只读统计账号 · 今日数据 · 不显示客户会话内容。"
      : `只读统计账号 · 最近 ${days} 天 · 不显示客户会话内容。`;
  } catch (error) {
    showToast(error.message, "error");
  }
}

function rangeLabel(days) {
  return Number(days) === 1 ? "今日" : `最近 ${days} 天`;
}

function formatMinutes(value) {
  if (value === null || value === undefined || value === "") return "—";
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} 分钟`;
  return `${(minutes / 60).toFixed(1)} 小时`;
}

function exportStatsCsv() {
  const days = state.stats?.rangeDays || state.viewerDays || 7;
  window.location.assign(`/api/stats/export.csv?days=${encodeURIComponent(days)}`);
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  const totals = stats.totals;

  const isAdmin = state.me.role === "admin";
  const cards = [
    ["区间进人", totals.newConversations, rangeLabel(stats.rangeDays)],
    ["新分配", totals.newAssigned, "管理员分配"],
    ["当前接待", totals.assigned, "已分配会话"],
    ["未读消息", totals.unread, "客户未读"],
    ["收到消息", totals.messagesIn, "客户发来"],
    ["发出消息", totals.messagesOut, "客服回复"],
    ["待处理", totals.open, "需要跟进"],
    ["未分配", totals.unassigned, "等待分配"],
    ["平均首响", formatMinutes(totals.avgFirstResponseMinutes), `SLA ${totals.slaTargetMinutes || 15} 分钟`],
    ["平均解决", formatMinutes(totals.avgResolutionMinutes), "已关闭会话"],
    ["SLA 超时", totals.slaBreaches, "需要优先处理"],
    ["SLA 达标率", `${totals.slaComplianceRate ?? 100}%`, "区间内新分配会话"],
    ["未回复会话", totals.unanswered, "最后一条是客户消息"]
  ].filter(([label]) => isAdmin || label !== "未分配");

  for (const cardBox of [$("#statsCards"), $("#viewerCards")]) {
    if (!cardBox) continue;
    cardBox.replaceChildren();
    for (const [label, value, hint] of cards) {
      const item = document.createElement("div");
      item.className = "stats-card-item";
      const name = document.createElement("span");
      name.textContent = label;
      const number = document.createElement("strong");
      number.textContent = typeof value === "string" ? value : Number(value || 0).toLocaleString("zh-CN");
      const note = document.createElement("small");
      note.textContent = hint;
      item.append(name, number, note);
      cardBox.appendChild(item);
    }
  }

  const chart = $("#statsChart");
  if (chart) {
    chart.replaceChildren();
    const max = Math.max(
      1,
      ...stats.daily.flatMap(day => [Number(day.inbound || 0), Number(day.outbound || 0)])
    );
    for (const day of stats.daily) {
      const column = document.createElement("div");
      column.className = "chart-day";
      column.title = `${day.date}：收到 ${day.inbound}，发出 ${day.outbound}，新会话 ${day.newConversations}`;

      const bars = document.createElement("div");
      bars.className = "chart-bars";
      for (const [kind, value] of [["in", day.inbound], ["out", day.outbound]]) {
        const bar = document.createElement("i");
        bar.className = `chart-bar ${kind}`;
        bar.style.height = `${Math.max(2, Math.round((Number(value || 0) / max) * 100))}%`;
        bars.appendChild(bar);
      }

      const label = document.createElement("span");
      label.className = "chart-label";
      label.textContent = day.date.slice(5).replace("-", "/");
      column.append(bars, label);
      chart.appendChild(column);
    }
  }

  for (const tbody of [$("#statsAgentRows"), $("#viewerAgentRows")]) {
    if (!tbody) continue;
    tbody.replaceChildren();
    if (!stats.agents.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 12;
      cell.className = "stats-empty";
      cell.textContent = "暂无客服数据";
      row.appendChild(cell);
      tbody.appendChild(row);
      continue;
    }
    for (const agent of stats.agents) {
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      nameCell.className = "agent-cell";
      const name = document.createElement("strong");
      name.textContent = agent.displayName;
      const username = document.createElement("span");
      username.textContent = "@" + agent.username + " · " + roleLabel(agent.role);
      nameCell.append(name, username);

      const values = [
        agent.newConversations,
        agent.newAssigned,
        agent.assigned,
        agent.open,
        agent.pending,
        agent.closed,
        agent.unread,
        agent.outbound,
        formatMinutes(agent.avgFirstResponseMinutes),
        formatMinutes(agent.avgResolutionMinutes),
        agent.slaBreaches
      ];
      row.appendChild(nameCell);
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = typeof value === "string" ? value : Number(value || 0).toLocaleString("zh-CN");
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
  }
}

function renderTeamSummary(data) {
  for (const container of [$("#statsTeamSummary"), $("#viewerTeamSummary")]) {
    if (!container) continue;
    container.replaceChildren();
    const team = data.team;
    if (!team) continue;
    const cards = [
      ["团队进人", team.totalNewContacts, "区间内去重联系人"],
      ["活跃联系人", team.totalContacts, "进人 + 有效去重"],
      ["有效聊天", team.totalEffectiveContacts, "客户主动发过消息"],
      ["重复联系人", team.duplicateContacts, `重复率 ${team.duplicateRate}%`],
      ["有效聊天占比", `${team.effectiveRate}%`, "有效 / 活跃联系人"],
      ["活跃员工", `${team.activeEmployees}/${team.totalEmployees}`, `零接待 ${team.zeroContactEmployees}`],
      ["人均进人", team.avgNewPerEmployee, "团队平均值"],
      ["人均有效", team.avgEffectivePerEmployee, "团队平均值"],
      ["收到 / 发出", `${team.inbound} / ${team.outbound}`, "区间消息量"]
    ];
    for (const [label, value, noteText] of cards) {
      const item = document.createElement("div");
      item.className = "stats-card-item";
      const name = document.createElement("span");
      name.textContent = label;
      const number = document.createElement("strong");
      number.textContent = typeof value === "string" ? value : Number(value || 0).toLocaleString("zh-CN");
      const note = document.createElement("small");
      note.textContent = noteText;
      item.append(name, number, note);
      container.appendChild(item);
    }
  }
}

function renderTeamDaily() {
  const data = state.teamDaily;
  if (!data) return;
  const hint = $("#teamDailyHint");
  if (hint) hint.textContent = state.me.role === "agent" ? "仅统计我的会话" : (data.definition || "");
  renderTeamSummary(data);

  for (const [tableId, duplicateId] of [
    ["#statsTeamDaily", "#statsDuplicates"],
    ["#viewerTeamDaily", "#viewerDuplicates"]
  ]) {
    const wrap = $(tableId);
    const duplicateBox = $(duplicateId);
    if (!wrap) continue;
    wrap.replaceChildren();
    if (!data.users?.length || !data.daily?.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "暂无员工统计数据";
      wrap.appendChild(empty);
      if (duplicateBox) duplicateBox.replaceChildren();
      continue;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const dateHead = document.createElement("th");
    dateHead.textContent = "日期";
    headRow.appendChild(dateHead);
    for (const user of data.users) {
      const th = document.createElement("th");
      th.textContent = user.displayName;
      th.title = "进人 / 有效 / 重复";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const day of data.daily) {
      const row = document.createElement("tr");
      const dateCell = document.createElement("td");
      dateCell.className = "team-day";
      dateCell.textContent = day.date.slice(5).replace("-", "/");
      if (day.team) {
        const teamLine = document.createElement("small");
        const teamPrefix = state.me.role === "agent" ? "我" : "团队";
        teamLine.textContent = `${teamPrefix} 进${day.team.newContacts} · 有效${day.team.effectiveContacts} · 重复${day.team.duplicateContacts}`;
        dateCell.appendChild(teamLine);
      }
      row.appendChild(dateCell);
      for (const employee of day.employees) {
        const cell = document.createElement("td");
        const values = [
          ["进 " + employee.newContacts, employee.newContacts > 0],
          ["有效 " + employee.effectiveContacts, employee.effectiveContacts > 0],
          ["重 " + employee.duplicateContacts, employee.duplicateContacts > 0]
        ];
        for (const [text, active] of values) {
          const span = document.createElement("span");
          span.className = "team-count" +
            (active ? "" : " team-zero") +
            (text.startsWith("重 ") && active ? " dup" : "");
          span.textContent = text;
          cell.appendChild(span);
          cell.appendChild(document.createTextNode(" "));
        }
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (duplicateBox) {
      duplicateBox.replaceChildren();
      if (data.duplicates?.length) {
        for (const duplicate of data.duplicates) {
          const item = document.createElement("div");
          item.className = "duplicate-item";
          const name = document.createElement("strong");
          name.textContent = duplicate.contact;
          item.appendChild(name);
          const duplicateDays = duplicate.duplicateDays?.length || 0;
          item.appendChild(document.createTextNode(
            ` 同时出现在 ${duplicate.employeeNames.join("、")} 名下，涉及 ${duplicate.days.length} 天` +
            (duplicateDays ? `，其中 ${duplicateDays} 天同日重复` : "（跨天重复）")
          ));
          duplicateBox.appendChild(item);
        }
      } else {
        const none = document.createElement("p");
        none.className = "admin-empty";
        none.textContent = "没有发现跨员工重复联系人。";
        duplicateBox.appendChild(none);
      }
    }
  }
}

/* ---------- Customer profile ---------- */
function renderCustomerPanel() {
  const conversation = state.active;
  if (!conversation) return;

  if (!state.customerDirty) {
    state.customerTags = Array.isArray(conversation.tags) ? [...conversation.tags] : [];
    const notes = $("#customerNotes");
    if (notes && document.activeElement !== notes) notes.value = conversation.notes || "";
    const hint = $("#customerDirtyHint");
    if (hint) hint.textContent = "标签和备注仅团队可见";
  }

  renderTagList();
}

function renderTagList() {
  const list = $("#tagList");
  if (!list) return;
  list.replaceChildren();

  if (!state.customerTags.length) {
    const empty = document.createElement("span");
    empty.className = "tag-empty";
    empty.textContent = "还没有标签";
    list.appendChild(empty);
    return;
  }

  for (const tag of state.customerTags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.append(document.createTextNode(tag));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除标签 ${tag}`);
    remove.addEventListener("click", () => removeCustomerTag(tag));
    chip.appendChild(remove);
    list.appendChild(chip);
  }
}

function markCustomerDirty() {
  state.customerDirty = true;
  const hint = $("#customerDirtyHint");
  if (hint) hint.textContent = "有未保存的修改";
}

function addCustomerTag(raw) {
  const tag = String(raw || "").trim();
  if (!tag) return;
  if (tag.length > 20) return showToast("标签最多 20 个字符", "error");
  if (state.customerTags.length >= 8) return showToast("最多添加 8 个标签", "error");
  if (state.customerTags.includes(tag)) return showToast("这个标签已经存在", "error");

  state.customerTags.push(tag);
  markCustomerDirty();
  renderTagList();
  $("#tagInput").value = "";
}

function removeCustomerTag(tag) {
  state.customerTags = state.customerTags.filter(item => item !== tag);
  markCustomerDirty();
  renderTagList();
}

async function saveCustomerProfile() {
  if (!state.active) return;
  const button = $("#saveCustomerBtn");
  button.disabled = true;
  button.textContent = "保存中…";

  try {
    const data = await api(`/api/conversations/${state.active.id}`, {
      method: "PATCH",
      body: {
        tags: state.customerTags,
        notes: $("#customerNotes").value
      }
    });
    state.active = data.conversation;
    upsertConversation(data.conversation);
    state.customerDirty = false;
    renderChatHeader();
    renderConversationList();
    showToast("客户资料已保存", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "保存资料";
  }
}

/* ---------- Canned replies ---------- */
async function openCannedModal() {
  if (!state.active) {
    showToast("先选择一个会话", "error");
    return;
  }
  $("#cannedModal").hidden = false;
  resetCannedForm();
  await loadCannedReplies();
}

function resetCannedForm() {
  state.editingCannedId = null;
  $("#cannedForm").reset();
  $("#cannedFormTitle").textContent = "新增快捷回复";
  $("#cannedCancel").hidden = true;
  $("#cannedError").hidden = true;
}

async function loadCannedReplies() {
  try {
    const data = await api("/api/canned-replies");
    state.cannedReplies = data.items || [];
    renderCannedReplies();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderCannedReplies() {
  const list = $("#cannedList");
  list.replaceChildren();

  if (!state.cannedReplies.length) {
    const empty = document.createElement("div");
    empty.className = "canned-empty";
    empty.textContent = "还没有快捷回复。在右侧新增一条常用话术，之后就能一键插入。";
    list.appendChild(empty);
    return;
  }

  for (const reply of state.cannedReplies) {
    const item = document.createElement("div");
    item.className = "canned-item";

    const head = document.createElement("div");
    head.className = "canned-item-head";
    const title = document.createElement("strong");
    title.textContent = reply.title;
    const meta = document.createElement("span");
    meta.textContent = reply.createdByName || "团队";
    head.append(title, meta);

    const content = document.createElement("p");
    content.textContent = reply.content;

    const actions = document.createElement("div");
    actions.className = "canned-actions";

    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "mini-button";
    insert.textContent = "插入";
    insert.addEventListener("click", () => insertCannedReply(reply));
    actions.appendChild(insert);

    const canManage = state.me.role === "admin" || reply.createdBy === state.me.id;
    if (canManage) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "mini-button";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => editCannedReply(reply));
      actions.appendChild(edit);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mini-button danger";
      remove.textContent = "删除";
      remove.addEventListener("click", () => deleteCannedReply(reply));
      actions.appendChild(remove);
    }

    item.append(head, content, actions);
    list.appendChild(item);
  }
}

function insertCannedReply(reply) {
  const input = $("#messageInput");
  const current = input.value.trimEnd();
  input.value = current ? `${current}\n${reply.content}` : reply.content;
  updateCharCount();
  autoResize(input);
  $("#cannedModal").hidden = true;
  input.focus();
  showToast("已插入快捷回复", "success");
}

function editCannedReply(reply) {
  state.editingCannedId = reply.id;
  $("#cannedFormTitle").textContent = "编辑快捷回复";
  $("#cannedTitle").value = reply.title;
  $("#cannedContent").value = reply.content;
  $("#cannedCancel").hidden = false;
  $("#cannedError").hidden = true;
  $("#cannedTitle").focus();
}

async function saveCannedReply(event) {
  event.preventDefault();
  const errorBox = $("#cannedError");
  errorBox.hidden = true;
  const title = $("#cannedTitle").value.trim();
  const content = $("#cannedContent").value.trim();

  if (!title || title.length > 40) {
    errorBox.textContent = "标题需为 1-40 个字符";
    errorBox.hidden = false;
    return;
  }
  if (!content || content.length > 2000) {
    errorBox.textContent = "内容需为 1-2000 个字符";
    errorBox.hidden = false;
    return;
  }

  const editing = state.editingCannedId;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    await api(editing ? `/api/canned-replies/${editing}` : "/api/canned-replies", {
      method: editing ? "PATCH" : "POST",
      body: { title, content }
    });
    showToast(editing ? "快捷回复已更新" : "快捷回复已创建", "success");
    resetCannedForm();
    await loadCannedReplies();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function deleteCannedReply(reply) {
  if (!window.confirm(`确定删除快捷回复「${reply.title}」吗？`)) return;
  try {
    await api(`/api/canned-replies/${reply.id}`, { method: "DELETE" });
    if (state.editingCannedId === reply.id) resetCannedForm();
    showToast("快捷回复已删除", "success");
    await loadCannedReplies();
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ---------- Channels ---------- */
function setChannelError(elementId, message) {
  const box = $("#" + elementId);
  box.textContent = message || "";
  box.hidden = !message;
}

function renderTelegramSettings() {
  const settings = state.channels.telegram || {};
  const configured = Boolean(settings.configured);
  const bot = settings.bot;

  $("#channelDot").className = "channel-dot " + (configured ? "on" : "off");
  let text;
  if (!configured) {
    text = "未配置，填入 Token 后即可接收消息";
  } else if (bot) {
    text = "已连接";
    if (bot.username) text += ` @${bot.username}`;
    else if (bot.firstName) text += ` ${bot.firstName}`;
    if (bot.id) text += ` · ID ${bot.id}`;
    if (settings.source === "environment") text += " · 来自环境变量";
  } else {
    text = "已配置，但暂时无法连接 Telegram";
    if (settings.warning) text += `：${settings.warning}`;
  }
  $("#channelStatusText").textContent = text;
  $("#telegramClearBtn").hidden = !configured;
  $("#telegramTokenInput").placeholder = configured
    ? "已配置，留空保持不变"
    : "从 @BotFather 获取，例如 123456:ABC...";
}

function renderWhatsAppSettings() {
  const settings = state.channels.whatsapp || {};
  const configured = Boolean(settings.configured);
  const info = settings.info;

  $("#whatsappDot").className = "channel-dot " + (configured ? "on" : "off");
  let text;
  if (!configured) {
    text = "未配置，填写 Meta 凭据后启用";
  } else if (info) {
    text = "已连接";
    if (info.verifiedName) text += ` ${info.verifiedName}`;
    if (info.displayPhoneNumber) text += ` · ${info.displayPhoneNumber}`;
    if (settings.source === "environment") text += " · 来自环境变量";
    const missing = [];
    if (!settings.hasVerifyToken) missing.push("Verify Token");
    if (!settings.hasAppSecret) missing.push("App Secret");
    if (missing.length) text += ` · 缺少 ${missing.join("、")}`;
  } else {
    text = "已配置，但暂时无法连接 WhatsApp";
    if (settings.warning) text += `：${settings.warning}`;
  }
  $("#whatsappStatusText").textContent = text;
  $("#whatsappClearBtn").hidden = !configured;
  if (settings.phoneNumberId) $("#whatsappPhoneInput").value = settings.phoneNumberId;
  $("#whatsappTokenInput").placeholder = configured
    ? "已配置，留空保持不变"
    : "Meta 永久访问 Token";
  $("#whatsappVerifyInput").placeholder = settings.hasVerifyToken
    ? "已配置，留空保持不变"
    : "自定义校验串，与 Meta 后台填写一致";
  $("#whatsappSecretInput").placeholder = settings.hasAppSecret
    ? "已配置，留空保持不变"
    : "用于校验 X-Hub-Signature-256";
  $("#whatsappWebhookUrl").textContent = location.origin + "/webhook/whatsapp";
}

function renderWhatsAppWebSettings() {
  const settings = state.channels.whatsappWeb || {};
  const enabled = Boolean(settings.enabled);
  const configured = Boolean(settings.configured);
  const running = Boolean(settings.running);
  const loginInProgress = Boolean(settings.loginInProgress);
  const me = settings.me;

  $("#whatsappWebDot").className = "channel-dot " + (running ? "on" : "off");
  let text;
  if (!enabled) {
    text = "未启用，需要设置 WHATSAPP_WEB_ENABLED=true";
  } else if (running) {
    text = "已连接";
    if (me?.name) text += ` ${me.name}`;
    if (me?.phone) text += ` · ${me.phone}`;
  } else if (loginInProgress) {
    text = settings.qr ? "等待手机扫码…" : "正在生成二维码…";
  } else if (configured) {
    text = "已登录，等待重新连接";
  } else {
    text = "未登录，点击下方按钮生成二维码";
  }
  if (settings.error && !running) text += `：${settings.error}`;
  $("#whatsappWebStatusText").textContent = text;

  const loginBtn = $("#whatsappWebLoginBtn");
  loginBtn.hidden = running || loginInProgress;
  loginBtn.disabled = !enabled;
  loginBtn.textContent = configured ? "重新连接" : "生成登录二维码";

  const logoutBtn = $("#whatsappWebLogoutBtn");
  logoutBtn.hidden = !configured && !running && !loginInProgress;
  logoutBtn.disabled = !enabled;

  const qrWrap = $("#whatsappWebQrWrap");
  const qrImage = $("#whatsappWebQr");
  if (settings.qr) {
    qrImage.src = settings.qr;
    qrWrap.hidden = false;
  } else {
    qrImage.removeAttribute("src");
    qrWrap.hidden = true;
  }
}

function stopWhatsAppWebPolling() {
  if (state.whatsappWebPollTimer) {
    clearTimeout(state.whatsappWebPollTimer);
    state.whatsappWebPollTimer = null;
  }
}

async function refreshWhatsAppWebStatus() {
  const data = await api("/api/admin/whatsapp-web");
  state.channels.whatsappWeb = data.whatsappWeb;
  state.whatsappWebConfigured = Boolean(data.whatsappWeb.configured && data.whatsappWeb.running);
  renderWhatsAppWebSettings();
  renderTelegramState();
  return data.whatsappWeb;
}

function scheduleWhatsAppWebPoll() {
  stopWhatsAppWebPolling();
  const settings = state.channels.whatsappWeb;
  if (!settings?.loginInProgress) return;
  state.whatsappWebPollTimer = setTimeout(async () => {
    try {
      await refreshWhatsAppWebStatus();
    } catch (error) {
      setChannelError("whatsappWebError", error.message);
    }
    scheduleWhatsAppWebPoll();
  }, 2000);
}

async function beginWhatsAppWebLogin() {
  const button = $("#whatsappWebLoginBtn");
  button.disabled = true;
  button.textContent = "正在生成…";
  setChannelError("whatsappWebError", "");
  try {
    const data = await api("/api/admin/whatsapp-web/login", { method: "POST", body: {} });
    state.channels.whatsappWeb = data.whatsappWeb;
    state.whatsappWebConfigured = Boolean(data.whatsappWeb.configured && data.whatsappWeb.running);
    renderWhatsAppWebSettings();
    renderTelegramState();
    showToast("二维码已生成，请用手机 WhatsApp 扫描", "success");
    scheduleWhatsAppWebPoll();
  } catch (error) {
    setChannelError("whatsappWebError", error.message);
  } finally {
    button.disabled = false;
    renderWhatsAppWebSettings();
  }
}

async function logoutWhatsAppWeb() {
  if (!window.confirm("确定退出 WhatsApp 个人号？退出后需要重新扫码。")) return;
  const button = $("#whatsappWebLogoutBtn");
  button.disabled = true;
  setChannelError("whatsappWebError", "");
  stopWhatsAppWebPolling();
  try {
    const data = await api("/api/admin/whatsapp-web/logout", { method: "POST", body: {} });
    state.channels.whatsappWeb = data.whatsappWeb;
    state.whatsappWebConfigured = false;
    renderWhatsAppWebSettings();
    renderTelegramState();
    showToast("WhatsApp 个人号已退出", "success");
  } catch (error) {
    setChannelError("whatsappWebError", error.message);
  } finally {
    button.disabled = false;
  }
}

function renderTranslateSettings() {
  const settings = state.channels.translate || state.translate || {};
  const configured = Boolean(settings.configured);
  const provider = settings.provider || "google";
  const requiresKey = settings.requiresKey ?? provider === "google";
  $("#translateDot").className = "channel-dot " + (configured ? "on" : "off");
  $("#translateProvider").value = provider;
  let text;
  if (!configured) {
    text = "未配置，填写 Google Cloud Translation API Key 后启用";
  } else if (!requiresKey) {
    text = `已启用 · ${settings.providerLabel || "免费翻译通道"}`;
  } else {
    text = "已启用，会自动识别客户语言并翻译外文消息";
    if (settings.source === "environment") text += " · 来自环境变量";
    else if (settings.source === "database") text += " · 已保存到服务器";
  }
  $("#translateStatusText").textContent = text;
  $("#translateClearBtn").hidden = !settings.keyConfigured || settings.source === "environment";
  $("#translateKeyLabel").hidden = !requiresKey;
  $("#translateKeyHelp").hidden = !requiresKey;
  $("#translateKeyInput").disabled = !requiresKey;
  $("#translateSaveBtn").hidden = !requiresKey;
  $("#translateKeyInput").placeholder = settings.keyConfigured
    ? "已配置，留空保持不变"
    : requiresKey
      ? "AIza...（需要启用 Cloud Translation API）"
      : "当前通道无需 Key；切换官方 API 时再填写";
}

async function saveTranslateProvider() {
  const select = $("#translateProvider");
  const provider = select.value;
  if (!provider) return;
  select.disabled = true;
  setChannelError("translateError", "");
  try {
    const data = await api("/api/admin/translate", {
      method: "POST",
      body: { provider }
    });
    state.channels.translate = data.translate;
    state.translate = { ...state.translate, ...data.translate };
    renderChannelSettings();
    if (state.active) renderChatHeader();
    showToast(
      provider === "google"
        ? "已切换到官方翻译 API"
        : `已切换到 ${data.translate?.providerLabel || "免费翻译通道"}`,
      "success"
    );
  } catch (error) {
    setChannelError("translateError", error.message);
    renderTranslateSettings();
  } finally {
    select.disabled = false;
  }
}

function renderChannelSettings() {
  renderTelegramSettings();
  renderWhatsAppSettings();
  renderWhatsAppWebSettings();
  renderTranslateSettings();
  renderAiSettings();
}

async function loadChannelSettings() {
  const [telegramResult, whatsappResult, whatsappWebResult, translateResult, aiResult] = await Promise.allSettled([
    api("/api/admin/telegram"),
    api("/api/admin/whatsapp"),
    api("/api/admin/whatsapp-web"),
    api("/api/admin/translate"),
    api("/api/admin/ai")
  ]);

  if (telegramResult.status === "fulfilled") {
    state.channels.telegram = telegramResult.value.telegram;
    state.telegramConfigured = Boolean(telegramResult.value.telegram.configured);
  } else {
    setChannelError("channelError", telegramResult.reason.message);
    $("#channelDot").className = "channel-dot off";
    $("#channelStatusText").textContent = "读取配置失败";
  }

  if (whatsappResult.status === "fulfilled") {
    state.channels.whatsapp = whatsappResult.value.whatsapp;
    state.whatsappConfigured = Boolean(whatsappResult.value.whatsapp.configured);
  } else {
    setChannelError("whatsappError", whatsappResult.reason.message);
    $("#whatsappDot").className = "channel-dot off";
    $("#whatsappStatusText").textContent = "读取配置失败";
  }

  if (whatsappWebResult.status === "fulfilled") {
    state.channels.whatsappWeb = whatsappWebResult.value.whatsappWeb;
    state.whatsappWebConfigured = Boolean(
      whatsappWebResult.value.whatsappWeb.configured && whatsappWebResult.value.whatsappWeb.running
    );
    scheduleWhatsAppWebPoll();
  } else {
    setChannelError("whatsappWebError", whatsappWebResult.reason.message);
    $("#whatsappWebDot").className = "channel-dot off";
    $("#whatsappWebStatusText").textContent = "读取配置失败";
  }

  if (translateResult.status === "fulfilled") {
    state.channels.translate = translateResult.value.translate;
    state.translate = { ...state.translate, ...translateResult.value.translate };
  } else {
    setChannelError("translateError", translateResult.reason.message);
    $("#translateDot").className = "channel-dot off";
    $("#translateStatusText").textContent = "读取配置失败";
  }

  if (aiResult.status === "fulfilled") {
    state.channels.ai = aiResult.value.ai;
  } else {
    setChannelError("aiError", aiResult.reason.message);
    $("#aiDot").className = "channel-dot off";
    $("#aiStatusText").textContent = "读取配置失败";
  }

  renderChannelSettings();
  renderTelegramState();
}

function renderSupportLinksPreview(support = {}) {
  const lines = [];
  if (support.whatsappUrl) lines.push(`WhatsApp: ${support.whatsappUrl}`);
  if (support.telegramUrl) lines.push(`Telegram: ${support.telegramUrl}`);
  $("#supportLinksPreview").textContent = lines.length
    ? lines.join("  ·  ")
    : "当前未设置客户页跳转账号。";
}

async function loadSupportLinks() {
  setChannelError("supportLinksError", "");
  $("#supportLinksPreview").textContent = "正在读取当前账号…";
  try {
    const data = await api("/api/admin/support-links");
    const support = data.support || {};
    $("#supportWhatsappInput").value = support.whatsappNumber || "";
    $("#supportTelegramInput").value = support.telegramTarget || "";
    renderSupportLinksPreview(support);
  } catch (error) {
    setChannelError("supportLinksError", error.message);
    $("#supportLinksPreview").textContent = "读取失败";
  }
}

async function saveSupportLinks(event) {
  event.preventDefault();
  const button = $("#supportLinksSaveBtn");
  const payload = {
    whatsappNumber: $("#supportWhatsappInput").value.trim(),
    telegramTarget: $("#supportTelegramInput").value.trim()
  };
  button.disabled = true;
  button.textContent = "保存中…";
  setChannelError("supportLinksError", "");
  try {
    const data = await api("/api/admin/support-links", {
      method: "POST",
      body: payload
    });
    const support = data.support || {};
    $("#supportWhatsappInput").value = support.whatsappNumber || "";
    $("#supportTelegramInput").value = support.telegramTarget || "";
    renderSupportLinksPreview(support);
    showToast("客户页账号已保存，立即生效", "success");
  } catch (error) {
    setChannelError("supportLinksError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存客户页账号";
  }
}

async function openChannelsModal() {
  if (state.me?.role !== "admin") return;
  stopWhatsAppWebPolling();
  $("#channelsModal").hidden = false;
  $("#telegramTokenInput").value = "";
  $("#whatsappTokenInput").value = "";
  $("#whatsappPhoneInput").value = "";
  $("#whatsappVerifyInput").value = "";
  $("#whatsappSecretInput").value = "";
  $("#translateKeyInput").value = "";
  $("#aiApiKey").value = "";
  $("#telegramClearBtn").hidden = true;
  $("#whatsappClearBtn").hidden = true;
  $("#translateClearBtn").hidden = true;
  $("#aiClearBtn").hidden = true;
  $("#channelDot").className = "channel-dot";
  $("#whatsappDot").className = "channel-dot";
  $("#whatsappWebDot").className = "channel-dot";
  $("#translateDot").className = "channel-dot";
  $("#aiDot").className = "channel-dot";
  $("#channelStatusText").textContent = "正在检查配置…";
  $("#whatsappStatusText").textContent = "正在检查配置…";
  $("#whatsappWebStatusText").textContent = "正在检查配置…";
  $("#whatsappWebQrWrap").hidden = true;
  $("#whatsappWebQr").removeAttribute("src");
  $("#translateStatusText").textContent = "正在检查配置…";
  $("#aiStatusText").textContent = "正在检查配置…";
  setChannelError("channelError", "");
  setChannelError("whatsappError", "");
  setChannelError("whatsappWebError", "");
  setChannelError("translateError", "");
  setChannelError("aiError", "");
  await Promise.all([loadChannelSettings(), loadSupportLinks()]);
}

async function saveTelegramToken(event) {
  event.preventDefault();
  const token = $("#telegramTokenInput").value.trim();
  if (!token) {
    setChannelError("channelError", "请输入 Telegram Bot Token");
    return;
  }

  const button = $("#telegramSaveBtn");
  button.disabled = true;
  button.textContent = "验证中…";
  setChannelError("channelError", "");

  try {
    const data = await api("/api/admin/telegram", {
      method: "POST",
      body: { token }
    });
    state.channels.telegram = data.telegram;
    state.telegramConfigured = Boolean(data.telegram.configured);
    $("#telegramTokenInput").value = "";
    renderChannelSettings();
    renderTelegramState();
    showToast("Telegram 已连接，开始接收消息", "success");
  } catch (error) {
    setChannelError("channelError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存并连接";
  }
}

async function clearTelegramToken() {
  if (!window.confirm("确定清除 Telegram Token？清除后将停止接收 Telegram 消息。")) return;

  const button = $("#telegramClearBtn");
  button.disabled = true;
  setChannelError("channelError", "");
  try {
    const data = await api("/api/admin/telegram", { method: "DELETE" });
    state.channels.telegram = data.telegram;
    state.telegramConfigured = false;
    renderChannelSettings();
    renderTelegramState();
    showToast("Telegram Token 已清除", "success");
  } catch (error) {
    setChannelError("channelError", error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveWhatsAppCredentials(event) {
  event.preventDefault();
  const payload = {
    token: $("#whatsappTokenInput").value.trim(),
    phoneNumberId: $("#whatsappPhoneInput").value.trim(),
    verifyToken: $("#whatsappVerifyInput").value.trim(),
    appSecret: $("#whatsappSecretInput").value.trim()
  };
  if (!payload.phoneNumberId) {
    setChannelError("whatsappError", "请填写 WhatsApp Phone Number ID");
    return;
  }

  const button = $("#whatsappSaveBtn");
  button.disabled = true;
  button.textContent = "验证中…";
  setChannelError("whatsappError", "");

  try {
    const data = await api("/api/admin/whatsapp", {
      method: "POST",
      body: payload
    });
    state.channels.whatsapp = data.whatsapp;
    state.whatsappConfigured = Boolean(data.whatsapp.configured);
    $("#whatsappTokenInput").value = "";
    $("#whatsappVerifyInput").value = "";
    $("#whatsappSecretInput").value = "";
    renderChannelSettings();
    renderTelegramState();
    showToast("WhatsApp 配置已保存", "success");
  } catch (error) {
    setChannelError("whatsappError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存 WhatsApp 配置";
  }
}

async function clearWhatsAppCredentials() {
  if (!window.confirm("确定清除 WhatsApp 配置？清除后将停止收发 WhatsApp 消息。")) return;

  const button = $("#whatsappClearBtn");
  button.disabled = true;
  setChannelError("whatsappError", "");
  try {
    const data = await api("/api/admin/whatsapp", { method: "DELETE" });
    state.channels.whatsapp = data.whatsapp;
    state.whatsappConfigured = false;
    $("#whatsappPhoneInput").value = "";
    renderChannelSettings();
    renderTelegramState();
    showToast("WhatsApp 配置已清除", "success");
  } catch (error) {
    setChannelError("whatsappError", error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveTranslateKey(event) {
  event.preventDefault();
  const provider = $("#translateProvider").value;
  if (provider !== "google") {
    setChannelError("translateError", "当前通道无需 API Key，可直接使用");
    return;
  }
  const apiKey = $("#translateKeyInput").value.trim();
  if (!apiKey) {
    setChannelError("translateError", "请输入 Google 翻译 API Key");
    return;
  }

  const button = $("#translateSaveBtn");
  button.disabled = true;
  button.textContent = "验证中…";
  setChannelError("translateError", "");

  try {
    const data = await api("/api/admin/translate", {
      method: "POST",
      body: { apiKey }
    });
    state.channels.translate = data.translate;
    state.translate = { ...state.translate, ...data.translate };
    $("#translateKeyInput").value = "";
    renderChannelSettings();
    showToast("Google 翻译已启用", "success");
  } catch (error) {
    setChannelError("translateError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "验证并保存";
  }
}

async function clearTranslateKey() {
  const requiresKey = state.channels.translate?.requiresKey ?? state.channels.translate?.provider === "google";
  const message = requiresKey
    ? "确定清除 Google 翻译 API Key？清除后将停止自动识别和翻译。"
    : "确定清除官方 Google 翻译 API Key？当前使用免费通道，清除后仍会继续翻译。";
  if (!window.confirm(message)) return;

  const button = $("#translateClearBtn");
  button.disabled = true;
  setChannelError("translateError", "");
  try {
    const data = await api("/api/admin/translate", { method: "DELETE" });
    state.channels.translate = data.translate;
    state.translate = { ...state.translate, ...data.translate };
    renderChannelSettings();
    if (state.active) renderChatHeader();
    showToast("Google 翻译 Key 已清除", "success");
  } catch (error) {
    setChannelError("translateError", error.message);
  } finally {
    button.disabled = false;
  }
}

/* ---------- AI settings ---------- */
const AI_PRESETS = {
  pollinations: { baseUrl: "https://text.pollinations.ai/openai", model: "openai" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:3b" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" }
};

function aiPresetKey(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  for (const [key, preset] of Object.entries(AI_PRESETS)) {
    if (preset.baseUrl.replace(/\/+$/, "") === normalized) return key;
  }
  return "custom";
}

function updateAiPresetHint() {
  const hint = $("#aiPresetHint");
  let host = "";
  try { host = new URL($("#aiBaseUrl").value.trim()).hostname.toLowerCase(); } catch {}
  if (host === "pollinations.ai" || host.endsWith(".pollinations.ai")) {
    hint.textContent = "免费公共接口无需 API Key，但约 45 秒只能请求 1 次，消息多时会排队。消息会发送到第三方服务，可能被记录或用于模型改进；仅建议测试，不要发送敏感客户信息。";
    hint.hidden = false;
  } else if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"].includes(host)) {
    hint.textContent = "本地模型无需 API Key，但需要先运行 Ollama 等服务并下载模型。";
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = "";
  }
}

function renderAiSettings() {
  const settings = state.channels.ai || {};
  const configured = Boolean(settings.configured);
  const keyless = Boolean(settings.keyless);
  $("#aiDot").className = "channel-dot " + (configured && settings.enabled ? "on" : "off");
  let text;
  if (!configured) {
    text = "未配置，填写接口地址和模型；需要鉴权的服务再填 API Key";
  } else if (settings.enabled) {
    text = `已启用 · ${settings.model || "模型未填写"}`;
    if (keyless) text += " · 免费接口（无需 Key）";
    else if (settings.source === "environment") text += " · 来自环境变量";
    else if (settings.source === "database") text += " · 已保存到服务器";
  } else {
    text = keyless ? "已配置免费接口，但总开关关闭" : "已配置，但总开关关闭";
  }
  $("#aiStatusText").textContent = text;
  $("#aiEnabled").checked = Boolean(settings.enabled);
  $("#aiBaseUrl").value = settings.baseUrl || "https://api.openai.com/v1";
  $("#aiModel").value = settings.model || "gpt-4o-mini";
  $("#aiDefaultMode").value = settings.defaultMode || "suggest";
  $("#aiSystemPrompt").value = settings.systemPrompt || "";
  $("#aiWorkStart").value = settings.workStart || "09:00";
  $("#aiWorkEnd").value = settings.workEnd || "18:00";
  $("#aiWorkTimezone").value = settings.workTimezone || "Asia/Shanghai";
  $("#aiIncludeGroups").checked = Boolean(settings.includeGroups);
  $("#aiDelayMs").value = Number(settings.delayMs ?? 1500);
  $("#aiPreset").value = aiPresetKey(settings.baseUrl);
  $("#aiApiKey").placeholder = keyless
    ? "无需 API Key，可留空"
    : settings.hasApiKey
      ? (settings.source === "environment" ? "已配置（来自环境变量）" : "已配置，留空保持不变")
      : "sk-...";
  $("#aiClearBtn").hidden = !settings.hasApiKey || settings.source === "environment";
  $("#aiTestBtn").disabled = !configured;
  updateAiPresetHint();
}

function applyAiPreset() {
  const preset = AI_PRESETS[$("#aiPreset").value];
  if (!preset) return;
  $("#aiBaseUrl").value = preset.baseUrl;
  $("#aiModel").value = preset.model;
  updateAiPresetHint();
}

async function saveAiSettings(event) {
  event.preventDefault();
  const button = $("#aiSaveBtn");
  button.disabled = true;
  button.textContent = "保存中…";
  setChannelError("aiError", "");
  try {
    const data = await api("/api/admin/ai", {
      method: "POST",
      body: {
        enabled: $("#aiEnabled").checked,
        baseUrl: $("#aiBaseUrl").value.trim(),
        apiKey: $("#aiApiKey").value.trim(),
        model: $("#aiModel").value.trim(),
        defaultMode: $("#aiDefaultMode").value,
        systemPrompt: $("#aiSystemPrompt").value.trim(),
        workStart: $("#aiWorkStart").value,
        workEnd: $("#aiWorkEnd").value,
        workTimezone: $("#aiWorkTimezone").value.trim(),
        includeGroups: $("#aiIncludeGroups").checked,
        delayMs: Number($("#aiDelayMs").value) || 0
      }
    });
    state.channels.ai = data.ai;
    $("#aiApiKey").value = "";
    renderAiSettings();
    await loadAiPreferences();
    if (state.active) renderChatHeader();
    showToast("AI 配置已保存", "success");
  } catch (error) {
    setChannelError("aiError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存 AI 配置";
  }
}

async function testAiConnection() {
  const button = $("#aiTestBtn");
  button.disabled = true;
  button.textContent = "测试中…";
  setChannelError("aiError", "");
  try {
    const data = await api("/api/admin/ai/test", { method: "POST" });
    showToast(`AI 连接成功：${String(data.test?.reply || "OK").slice(0, 40)}`, "success");
  } catch (error) {
    setChannelError("aiError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "测试连接";
  }
}

async function clearAiKey() {
  if (!window.confirm("确定清除 AI API Key？清除后会关闭 AI 总开关。")) return;
  const button = $("#aiClearBtn");
  button.disabled = true;
  setChannelError("aiError", "");
  try {
    const data = await api("/api/admin/ai", { method: "DELETE" });
    state.channels.ai = data.ai;
    renderAiSettings();
    await loadAiPreferences();
    if (state.active) renderChatHeader();
    showToast("AI API Key 已清除", "success");
  } catch (error) {
    setChannelError("aiError", error.message);
  } finally {
    button.disabled = false;
  }
}

/* ---------- My AI preferences ---------- */
async function loadAiUserPreferences() {
  try {
    const data = await api("/api/ai/preferences");
    state.ai = data.ai || state.ai;
    state.aiPrefs = data.ai || null;
    renderAiUserPreferences();
  } catch (error) {
    setChannelError("aiPrefsError", error.message);
  }
}

function renderAiUserPreferences() {
  const data = state.aiPrefs || state.ai || {};
  const usable = Boolean(data.configured && data.globalEnabled && data.allowed);
  $("#aiUserDot").className = "channel-dot " + (usable && data.enabled ? "on" : "off");
  let text;
  if (!data.configured) text = "管理员尚未配置 AI 服务";
  else if (!data.globalEnabled) text = "管理员已关闭 AI 总开关";
  else if (!data.allowed) text = "管理员尚未给你开通 AI 权限";
  else if (data.enabled) text = `已开启 · ${aiModeLabel(data.mode)}`;
  else text = "已关闭，可在下方开启";
  $("#aiUserStatusText").textContent = text;
  $("#aiUserEnabled").checked = Boolean(data.enabled);
  $("#aiUserEnabled").disabled = !usable;
  $("#aiUserMode").disabled = !usable || !data.enabled;
  $("#aiUserMode").value = data.mode || "auto";
  $("#aiPrefsSave").disabled = !usable;
  $("#openAiAdminBtn").hidden = state.me?.role !== "admin";
  let hint = "保存后只影响分配给你的会话。";
  if (!data.allowed) hint = "请联系管理员在「团队」中给你开通 AI 权限。";
  else if (!data.configured) hint = "请联系管理员在「渠道 → AI 自动回复」中配置服务。";
  else if (!data.globalEnabled) hint = "管理员已关闭 AI 总开关，暂时无法使用。";
  $("#aiUserHint").textContent = hint;
}

async function openAiModal() {
  if (!state.me || state.me.role === "viewer") return;
  $("#aiModal").hidden = false;
  setChannelError("aiPrefsError", "");
  await loadAiUserPreferences();
}

async function saveAiUserPreferences(event) {
  event.preventDefault();
  const button = $("#aiPrefsSave");
  button.disabled = true;
  button.textContent = "保存中…";
  setChannelError("aiPrefsError", "");
  try {
    const data = await api("/api/ai/preferences", {
      method: "PATCH",
      body: {
        enabled: $("#aiUserEnabled").checked,
        mode: $("#aiUserMode").value
      }
    });
    state.ai = data.ai;
    state.aiPrefs = data.ai;
    renderAiUserPreferences();
    await loadConversations({ silent: true });
    if (state.active) renderChatHeader();
    showToast("我的 AI 设置已保存", "success");
  } catch (error) {
    setChannelError("aiPrefsError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存我的 AI 设置";
  }
}

/* ---------- AI suggestion ---------- */
async function loadAiSuggestion(conversationId, token = state.threadToken) {
  try {
    const data = await api(`/api/conversations/${conversationId}/ai-suggestion`);
    if (state.activeId !== conversationId || token !== state.threadToken) return;
    state.aiSuggestion = data.suggestion || null;
    renderAiSuggestion();
  } catch {
    if (state.activeId === conversationId) {
      state.aiSuggestion = null;
      renderAiSuggestion();
    }
  }
}

function renderAiSuggestion() {
  const panel = $("#aiSuggestion");
  if (!panel) return;
  const suggestion = state.aiSuggestion;
  if (!suggestion || !state.active || suggestion.conversationId !== state.active.id) {
    panel.hidden = true;
    $("#aiSuggestionText").textContent = "";
    $("#aiSuggestionMeta").textContent = "";
    return;
  }
  panel.hidden = false;
  $("#aiSuggestionText").textContent = suggestion.body;
  $("#aiSuggestionMeta").textContent = suggestion.model
    ? `${suggestion.model} · ${messageTime(suggestion.createdAt)}`
    : messageTime(suggestion.createdAt);
}

async function updateAiSuggestion(status) {
  if (!state.active || !state.aiSuggestion) return;
  const suggestion = state.aiSuggestion;
  try {
    await api(`/api/conversations/${state.active.id}/ai-suggestion/${suggestion.id}`, {
      method: "PATCH",
      body: { status }
    });
    state.aiSuggestion = null;
    renderAiSuggestion();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function useAiSuggestion() {
  const suggestion = state.aiSuggestion;
  if (!suggestion) return;
  const input = $("#messageInput");
  input.value = suggestion.body;
  updateCharCount();
  autoResize(input);
  input.focus();
  updateAiSuggestion("used");
}

function dismissAiSuggestion() {
  updateAiSuggestion("dismissed");
}

/* ---------- Team ---------- */
async function openTeamModal() {
  if (state.me.role !== "admin") return;
  $("#teamModal").hidden = false;
  $("#createUserError").hidden = true;
  setChannelError("assignmentError", "");
  await Promise.all([loadTeamUsers(), loadAssignmentSettings()]);
}

async function loadAssignmentSettings() {
  try {
    const data = await api("/api/admin/assignment");
    renderAssignmentSettings(data.assignment);
  } catch (error) {
    setChannelError("assignmentError", error.message);
  }
}

function renderAssignmentSettings(settings) {
  state.assignment = settings || state.assignment;
  $("#autoAssignEnabled").checked = Boolean(state.assignment.enabled);
  $("#autoAssignStrategy").value = state.assignment.strategy || "least_active";
  $("#autoAssignMax").value = Number(state.assignment.maxActive || 0);
}

async function saveAssignmentSettings(event) {
  event.preventDefault();
  const button = $("#autoAssignSaveBtn");
  button.disabled = true;
  button.textContent = "保存中…";
  setChannelError("assignmentError", "");
  try {
    const data = await api("/api/admin/assignment", {
      method: "POST",
      body: {
        enabled: $("#autoAssignEnabled").checked,
        strategy: $("#autoAssignStrategy").value,
        maxActive: Number($("#autoAssignMax").value) || 0
      }
    });
    renderAssignmentSettings(data.assignment);
    showToast(data.assignment.enabled ? "自动分配已开启" : "自动分配已关闭", "success");
  } catch (error) {
    setChannelError("assignmentError", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "保存自动分配";
  }
}

async function loadTeamUsers() {
  try {
    const data = await api("/api/users?includeInactive=1");
    state.teamUsers = data.users;
    renderTeamUsers();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderTeamUsers() {
  const list = $("#teamList");
  list.replaceChildren();

  for (const user of state.teamUsers) {
    const row = document.createElement("div");
    row.className = "team-row" + (user.active ? "" : " inactive");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.setProperty("--hue", hueFor(user.displayName));
    avatar.textContent = initials(user.displayName);

    const info = document.createElement("div");
    info.className = "team-info";
    const name = document.createElement("strong");
    name.textContent = user.displayName + (user.id === state.me.id ? "（我）" : "");
    const username = document.createElement("span");
    username.textContent = "@" + user.username + " · " + roleLabel(user.role) + (user.active ? "" : " · 已停用");
    info.append(name, username);

    const controls = document.createElement("div");
    controls.className = "team-controls";

    const aiPermission = document.createElement("label");
    aiPermission.className = "ai-permission";
    aiPermission.title = "允许该员工使用 AI 助手";
    const aiPermissionBox = document.createElement("input");
    aiPermissionBox.type = "checkbox";
    aiPermissionBox.checked = user.role === "admin" ? true : Boolean(user.aiAllowed);
    aiPermissionBox.disabled = user.role === "admin" || !user.active;
    aiPermissionBox.addEventListener("change", () => {
      updateTeamUser(user.id, { aiAllowed: aiPermissionBox.checked });
    });
    aiPermission.append(aiPermissionBox, document.createTextNode("允许 AI"));

    const role = document.createElement("select");
    role.setAttribute("aria-label", "角色");
    role.innerHTML = '<option value="agent">客服</option><option value="viewer">统计员</option><option value="admin">管理员</option>';
    role.value = user.role;
    role.disabled = !user.active;
    role.addEventListener("change", () => updateTeamUser(user.id, { role: role.value }));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mini-button" + (user.active ? " danger" : "");
    toggle.textContent = user.active ? "停用" : "启用";
    toggle.disabled = user.id === state.me.id;
    toggle.addEventListener("click", () => updateTeamUser(user.id, { active: !user.active }));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "mini-button";
    reset.textContent = "重置密码";
    reset.addEventListener("click", () => resetUserPassword(user));

    controls.append(aiPermission, role, toggle, reset);
    row.append(avatar, info, controls);
    list.appendChild(row);
  }
}

async function updateTeamUser(id, payload) {
  try {
    const data = await api(`/api/users/${id}`, { method: "PATCH", body: payload });
    if (data.user.id === state.me.id) {
      state.me = data.user;
      $("#currentUser").textContent = `${state.me.displayName} · ${roleLabel(state.me.role)}`;
      $("#channelsBtn").hidden = state.me.role !== "admin";
      $("#teamBtn").hidden = state.me.role !== "admin";
      $("#adminBtn").hidden = state.me.role !== "admin";
      if (state.me.role !== "admin") {
        $("#channelsModal").hidden = true;
        $("#teamModal").hidden = true;
        $("#adminModal").hidden = true;
      }
      if (state.me.role === "viewer") {
        showToast("成员已更新", "success");
        await enterInbox();
        return;
      }
      applyRoleScope();
    }
    showToast("成员已更新", "success");
    await Promise.all([loadUsers(), loadTeamUsers(), loadAiPreferences()]);
    scheduleRefresh();
    if (state.active) renderChatHeader();
    if (!$("#aiModal").hidden) renderAiUserPreferences();
  } catch (error) {
    showToast(error.message, "error");
    await loadTeamUsers();
  }
}

async function resetUserPassword(user) {
  const password = window.prompt(`为 ${user.displayName} 设置新密码（至少 8 位）`);
  if (password === null) return;
  if (password.length < 8) {
    showToast("密码至少 8 位", "error");
    return;
  }
  try {
    await api(`/api/users/${user.id}/password`, { method: "POST", body: { password } });
    showToast("密码已重置", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ---------- Admin console ---------- */
const AUDIT_LABELS = {
  "auth.login": "管理员/员工登录",
  "auth.logout": "退出登录",
  "auth.password_changed": "修改密码",
  "user.created": "创建员工",
  "user.updated": "修改员工",
  "user.password_reset": "重置员工密码",
  "user.force_logout": "强制下线",
  "account.created": "绑定个人号",
  "account.login_started": "开始个人号登录",
  "account.relogin_started": "重新生成个人号二维码",
  "account.password_submitted": "提交个人号两步密码",
  "account.logged_out": "退出个人号",
  "account.removed": "删除个人号",
  "account.reconnected": "重连个人号",
  "message.recalled": "撤回消息",
  "message.deleted": "删除消息",
  "conversation.deleted": "删除会话",
  "support.links_updated": "修改客户页跳转账号",
  "telegram.token_updated": "修改 Telegram 渠道",
  "telegram.token_cleared": "清除 Telegram 渠道",
  "telegram.token_tested": "测试 Telegram Token",
  "whatsapp.credentials_updated": "修改 WhatsApp 渠道",
  "whatsapp.credentials_cleared": "清除 WhatsApp 渠道",
  "whatsapp_web.login_started": "WhatsApp 个人号扫码",
  "whatsapp_web.logged_out": "WhatsApp 个人号退出",
  "whatsapp_web.reconnected": "WhatsApp 个人号重连",
  "data.backup_created": "创建数据库备份",
  "data.backup_downloaded": "下载数据库备份",
  "data.conversations_exported": "导出会话 CSV",
  "data.messages_cleaned": "清理旧消息",
  "security.ip_allowlist_updated": "修改管理员 IP 白名单",
  "security.totp_setup_started": "生成两步验证密钥",
  "security.totp_enabled": "开启两步验证",
  "security.totp_disabled": "关闭两步验证"
};

function auditLabel(action) {
  return AUDIT_LABELS[action] || action;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso || "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderAdminCards(container, cards) {
  if (!container) return;
  container.replaceChildren();
  for (const [label, value, hint] of cards) {
    const item = document.createElement("div");
    item.className = "stats-card-item";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("strong");
    number.textContent = value;
    const note = document.createElement("small");
    note.textContent = hint || "";
    item.append(name, number, note);
    container.appendChild(item);
  }
}

function openAdminModal(tab = "overview") {
  if (state.me?.role !== "admin") return;
  $("#adminModal").hidden = false;
  switchAdminTab(tab);
}

function switchAdminTab(tab) {
  state.admin.tab = tab;
  $$(".admin-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === tab);
  });
  $$(".admin-panel").forEach(panel => {
    panel.hidden = panel.dataset.adminPanel !== tab;
  });
  loadAdminPanel(tab);
}

async function loadAdminPanel(tab) {
  if (tab === "overview") return loadAdminSystem();
  if (tab === "employees") return loadAdminUsers();
  if (tab === "audit") return loadAdminAudit();
  if (tab === "data") return loadAdminData();
  if (tab === "channels") return loadAdminChannels();
  if (tab === "security") return loadAdminSecurity();
}

async function loadAdminSystem() {
  try {
    const data = await api("/api/admin/system");
    state.admin.system = data.system;
    renderAdminSystem();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminSystem() {
  const system = state.admin.system;
  if (!system) return;
  const channels = system.channels || {};
  const accounts = system.accounts || {};
  renderAdminCards($("#adminSystemCards"), [
    ["运行时间", formatUptime(system.uptimeSeconds), "Node 服务"],
    ["Node 版本", system.nodeVersion, system.platform],
    ["进程内存", formatBytes(system.memory?.rss), `堆 ${formatBytes(system.memory?.heapUsed)}`],
    ["磁盘", system.disk ? `${formatBytes(system.disk.used)} / ${formatBytes(system.disk.total)}` : "—", system.disk ? `剩余 ${formatBytes(system.disk.free)}` : "无法读取"],
    ["数据库", formatBytes(system.database?.size), `WAL ${formatBytes(system.database?.walSize)}`],
    ["个人号在线", `${accounts.online || 0} / ${accounts.total || 0}`, "已登录 / 已绑定"],
    ["Telegram", channels.telegram?.configured ? "已配置" : "未配置", channels.telegram?.running ? "轮询中" : "未运行"],
    ["WhatsApp", channels.whatsapp?.configured ? "已配置" : "未配置", channels.whatsapp?.phoneNumberId || "Cloud API"],
    ["WhatsApp 个人号", channels.whatsappWeb?.running ? "在线" : channels.whatsappWeb?.enabled ? "等待扫码" : "未启用", "Web 扫码"],
    ["最近错误", String((system.recentErrors || []).length), "最近 30 条"]
  ]);

  const summary = $("#adminAccountSummary");
  if (summary) {
    summary.replaceChildren();
    const rows = [
      ["绑定总数", String(accounts.total || 0)],
      ["在线数量", String(accounts.online || 0)],
      ...Object.entries(accounts.byChannel || {}).map(([channel, value]) =>
        [channel === "whatsapp_web" ? "WhatsApp" : "Telegram", `${value.online || 0} / ${value.total || 0}`]
      ),
      ...(accounts.errors || []).map(item => [
        `${item.ownerName || item.channel} 错误`,
        item.error
      ])
    ];
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "admin-kv-row";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = value;
      row.append(key, val);
      summary.appendChild(row);
    }
  }

  const errors = $("#adminRecentErrors");
  if (errors) {
    errors.replaceChildren();
    if (!system.recentErrors?.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "没有错误日志。";
      errors.appendChild(empty);
    } else {
      for (const item of system.recentErrors) {
        const row = document.createElement("div");
        row.className = "admin-log-item";
        const title = document.createElement("strong");
        title.textContent = formatDateTime(item.time);
        row.appendChild(title);
        row.appendChild(document.createTextNode(" " + item.message));
        if (item.meta) {
          const meta = document.createElement("div");
          meta.textContent = item.meta;
          row.appendChild(meta);
        }
        errors.appendChild(row);
      }
    }
  }
}

async function loadAdminUsers() {
  try {
    const data = await api("/api/users?includeInactive=1");
    state.admin.users = data.users || [];
    renderAdminUsers();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminUsers() {
  const tbody = $("#adminUserRows");
  if (!tbody) return;
  tbody.replaceChildren();
  for (const user of state.admin.users) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = user.displayName + (user.id === state.me?.id ? "（我）" : "");
    const username = document.createElement("div");
    username.textContent = "@" + user.username;
    nameCell.append(name, username);

    const role = document.createElement("td");
    role.textContent = roleLabel(user.role);

    const status = document.createElement("td");
    status.innerHTML = `<span class="admin-status-pill ${user.active ? "on" : "off"}">${user.active ? "启用" : "停用"}</span>`;

    const activeConversations = document.createElement("td");
    activeConversations.textContent = String(user.activeConversationCount || 0);

    const accounts = document.createElement("td");
    accounts.textContent = String(user.accountCount || 0);

    const totp = document.createElement("td");
    totp.innerHTML = `<span class="admin-status-pill ${user.totpEnabled ? "on" : ""}">${user.totpEnabled ? "已开启" : "未开启"}</span>`;

    const actions = document.createElement("td");
    actions.className = "admin-actions";
    const reset = document.createElement("button");
    reset.className = "mini-button";
    reset.textContent = "重置密码";
    reset.dataset.adminUserAction = "reset";
    reset.dataset.userId = String(user.id);
    const toggle = document.createElement("button");
    toggle.className = "mini-button" + (user.active ? " danger" : "");
    toggle.textContent = user.active ? "停用" : "启用";
    toggle.dataset.adminUserAction = "toggle";
    toggle.dataset.userId = String(user.id);
    toggle.disabled = user.id === state.me?.id;
    const logout = document.createElement("button");
    logout.className = "mini-button";
    logout.textContent = "强制下线";
    logout.dataset.adminUserAction = "logout";
    logout.dataset.userId = String(user.id);
    logout.disabled = user.id === state.me?.id;
    actions.append(reset, toggle, logout);

    row.append(nameCell, role, status, activeConversations, accounts, totp, actions);
    tbody.appendChild(row);
  }
}

async function adminUserAction(action, userId) {
  const user = state.admin.users.find(item => item.id === userId);
  if (!user) return;
  if (action === "reset") {
    const password = window.prompt(`为 ${user.displayName} 设置新密码（至少 8 位）`);
    if (password === null) return;
    if (password.length < 8) return showToast("密码至少 8 位", "error");
    try {
      await api(`/api/users/${userId}/password`, { method: "POST", body: { password } });
      showToast("密码已重置", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  if (action === "toggle") {
    try {
      await api(`/api/users/${userId}`, { method: "PATCH", body: { active: !user.active } });
      showToast(user.active ? "员工已停用" : "员工已启用", "success");
      await loadAdminUsers();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  if (action === "logout") {
    if (!window.confirm(`强制 ${user.displayName} 下线？`)) return;
    try {
      await api(`/api/users/${userId}/logout`, { method: "POST", body: {} });
      showToast("已强制下线", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }
}

async function adminCreateUser(event) {
  event.preventDefault();
  const message = $("#adminUserMessage");
  message.hidden = true;
  try {
    await api("/api/users", {
      method: "POST",
      body: {
        username: $("#adminNewUsername").value,
        displayName: $("#adminNewDisplayName").value,
        password: $("#adminNewPassword").value,
        role: $("#adminNewRole").value
      }
    });
    event.target.reset();
    showToast("员工账号已创建", "success");
    await loadAdminUsers();
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
}

async function loadAdminAudit() {
  try {
    const action = $("#adminAuditAction")?.value.trim() || "";
    const data = await api(`/api/admin/audit?limit=150&action=${encodeURIComponent(action)}`);
    state.admin.audit = data.audit;
    renderAdminAudit();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminAudit() {
  const box = $("#adminAuditList");
  if (!box) return;
  box.replaceChildren();
  const items = state.admin.audit?.items || [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "没有审计记录。";
    box.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "admin-audit-item";
    const title = document.createElement("strong");
    title.textContent = auditLabel(item.action);
    const code = document.createElement("code");
    code.textContent = item.action;
    const meta = document.createElement("div");
    meta.textContent = `${formatDateTime(item.createdAt)} · ${item.userName || "系统"}` +
      (item.targetType ? ` · ${item.targetType}#${item.targetId || ""}` : "");
    row.append(title, document.createTextNode(" "), code, meta);
    if (item.detail) {
      const detail = document.createElement("div");
      detail.textContent = String(item.detail).slice(0, 300);
      row.appendChild(detail);
    }
    box.appendChild(row);
  }
}

async function loadAdminData() {
  try {
    const [systemData, backupData] = await Promise.all([
      api("/api/admin/system"),
      api("/api/admin/backups")
    ]);
    state.admin.system = systemData.system;
    state.admin.backups = backupData.backups || [];
    renderAdminData();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminData() {
  const system = state.admin.system;
  const summary = $("#adminDataSummary");
  if (summary && system) {
    summary.replaceChildren();
    const rows = [
      ["数据库大小", formatBytes(system.database?.size)],
      ["WAL 大小", formatBytes(system.database?.walSize)],
      ["数据库路径", system.database?.path || "—"],
      ["磁盘剩余", system.disk ? formatBytes(system.disk.free) : "—"]
    ];
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "admin-kv-row";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = value;
      row.append(key, val);
      summary.appendChild(row);
    }
  }

  const list = $("#adminBackupList");
  if (list) {
    list.replaceChildren();
    if (!state.admin.backups.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "还没有备份。点击「立即备份」生成。";
      list.appendChild(empty);
    } else {
      for (const backup of state.admin.backups) {
        const row = document.createElement("div");
        row.className = "admin-backup-item";
        const name = document.createElement("strong");
        name.textContent = backup.name;
        const meta = document.createElement("div");
        meta.textContent = `${formatDateTime(backup.createdAt)} · ${formatBytes(backup.size)}`;
        const link = document.createElement("a");
        link.href = `/api/admin/backups/${encodeURIComponent(backup.name)}/download`;
        link.textContent = "下载";
        row.append(name, meta, link);
        list.appendChild(row);
      }
    }
  }
}

async function adminCreateBackup() {
  try {
    const data = await api("/api/admin/backups", { method: "POST", body: {} });
    showToast(`备份完成：${data.backup.name}`, "success");
    await loadAdminData();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function adminExportConversations() {
  window.location.assign("/api/admin/export/conversations.csv");
}

async function adminCleanup(preview) {
  const result = $("#adminCleanupResult");
  const days = Number($("#adminCleanupDays").value) || 30;
  const confirmCode = $("#adminCleanupConfirm").value.trim();
  if (!preview) {
    if (confirmCode !== "CLEANUP") {
      result.textContent = "实际清理需要输入确认码 CLEANUP。";
      return;
    }
    if (!window.confirm(`确定删除 ${days} 天以前的旧消息？会话会保留，此操作不可恢复。`)) return;
  }
  try {
    const data = await api("/api/admin/data/cleanup", {
      method: "POST",
      body: { days, dryRun: preview, confirm: confirmCode }
    });
    const cleanup = data.cleanup;
    result.textContent = preview
      ? `预览：将删除 ${cleanup.wouldDelete} 条旧消息（保留最近 ${cleanup.days} 天）。`
      : `已删除 ${cleanup.deleted} 条旧消息。`;
    if (!preview) await loadAdminData();
  } catch (error) {
    result.textContent = error.message;
  }
}

async function loadAdminChannels() {
  try {
    const data = await api("/api/admin/diagnostics");
    state.admin.diagnostics = data.diagnostics;
    renderAdminDiagnostics();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminDiagnostics() {
  const data = state.admin.diagnostics;
  const box = $("#adminDiagnostics");
  if (!data || !box) return;
  const rows = [
    ["Telegram Bot", data.telegram?.configured, data.telegram?.running,
      data.telegram?.bot ? `@${data.telegram.bot.username || data.telegram.bot.id}` : "未配置",
      data.telegram?.warning],
    ["WhatsApp Cloud API", data.whatsapp?.configured, data.whatsapp?.configured,
      data.whatsapp?.info?.displayPhoneNumber || data.whatsapp?.phoneNumberId || "未配置",
      data.whatsapp?.warning],
    ["WhatsApp 个人号", data.whatsappWeb?.enabled, data.whatsappWeb?.running,
      data.whatsappWeb?.running ? "在线" : data.whatsappWeb?.loginInProgress ? "等待扫码" : "未登录",
      data.whatsappWeb?.error]
  ];
  box.innerHTML = rows.map(([label, configured, running, detail, warning]) => `
    <div class="admin-diag-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <div>${escapeHtml(detail || "")}</div>
        ${warning ? `<div class="admin-warning">${escapeHtml(warning)}</div>` : ""}
      </div>
      <span class="admin-status-pill ${running ? "on" : configured ? "" : "off"}">
        ${running ? "在线" : configured ? "已配置" : "未配置"}
      </span>
    </div>
  `).join("");

  if (data.whatsappWeb?.enabled) {
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const login = document.createElement("button");
    login.className = "mini-button";
    login.textContent = data.whatsappWeb.loginInProgress ? "重新生成二维码" : "开始扫码";
    login.dataset.adminChannelAction = "whatsapp-login";
    const reconnect = document.createElement("button");
    reconnect.className = "mini-button";
    reconnect.textContent = "重连";
    reconnect.dataset.adminChannelAction = "whatsapp-reconnect";
    const logout = document.createElement("button");
    logout.className = "mini-button danger";
    logout.textContent = "退出个人号";
    logout.dataset.adminChannelAction = "whatsapp-logout";
    actions.append(login, reconnect, logout);
    box.appendChild(actions);
  }

  if (data.whatsappWeb?.qr) {
    const qr = document.createElement("div");
    qr.className = "admin-block";
    qr.innerHTML = `<h4>WhatsApp 个人号二维码</h4><img src="${data.whatsappWeb.qr}" alt="WhatsApp 二维码" width="260" height="260"><p class="channel-note">用手机 WhatsApp 扫描；过期后点下方重新生成。</p>`;
    box.appendChild(qr);
  }

  const accountBox = $("#adminDiagnosticAccounts");
  if (accountBox) {
    accountBox.replaceChildren();
    if (!data.accounts?.length) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "还没有绑定个人号。";
      accountBox.appendChild(empty);
    } else {
      for (const account of data.accounts) {
        const row = document.createElement("div");
        row.className = "admin-account-item";
        const title = document.createElement("strong");
        title.textContent = `${account.channel === "whatsapp_web" ? "WhatsApp" : "Telegram"} · ${account.ownerName || account.label}`;
        const status = document.createElement("div");
        status.textContent = `${account.displayName || account.label || ""} · ${account.status?.running ? "在线" : "离线"}`;
        if (account.status?.error) {
          const error = document.createElement("div");
          error.className = "admin-warning";
          error.textContent = account.status.error;
          status.appendChild(error);
        }
        const actions = document.createElement("div");
        actions.className = "admin-actions";
        const relogin = document.createElement("button");
        relogin.className = "mini-button";
        relogin.textContent = "重新生成二维码";
        relogin.dataset.adminAccountAction = "relogin";
        relogin.dataset.accountId = String(account.id);
        const reconnect = document.createElement("button");
        reconnect.className = "mini-button";
        reconnect.textContent = "重连";
        reconnect.dataset.adminAccountAction = "reconnect";
        reconnect.dataset.accountId = String(account.id);
        const logout = document.createElement("button");
        logout.className = "mini-button danger";
        logout.textContent = "断开";
        logout.dataset.adminAccountAction = "logout";
        logout.dataset.accountId = String(account.id);
        const remove = document.createElement("button");
        remove.className = "mini-button danger";
        remove.textContent = "解绑";
        remove.dataset.adminAccountAction = "remove";
        remove.dataset.accountId = String(account.id);
        actions.append(relogin, reconnect, logout, remove);
        row.append(title, status, actions);
        accountBox.appendChild(row);
      }
    }
  }
}

async function adminAccountAction(action, accountId) {
  if (!accountId) return;
  const confirmText = action === "relogin"
    ? "重新生成二维码会先断开当前登录，确定继续？"
    : action === "remove"
      ? "解绑后会话记录会保留，但这个个人号需要重新绑定。确定继续？"
      : action === "reconnect"
        ? "确定重新连接这个个人号？"
        : "确定断开这个个人号？";
  if (!window.confirm(confirmText)) return;
  try {
    if (action === "remove") {
      await api(`/api/accounts/${accountId}`, { method: "DELETE" });
      showToast("个人号已解绑", "success");
    } else {
      const path = action === "relogin" ? "relogin" : action === "reconnect" ? "reconnect" : "logout";
      await api(`/api/accounts/${accountId}/${path}`, { method: "POST", body: {} });
      showToast(action === "relogin" ? "二维码已重新生成" : action === "reconnect" ? "个人号已重连" : "个人号已断开", "success");
    }
    await loadAdminChannels();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function adminTelegramTest(event) {
  event.preventDefault();
  const result = $("#adminTelegramTestResult");
  result.textContent = "测试中…";
  try {
    const data = await api("/api/admin/diagnostics/telegram/test", {
      method: "POST",
      body: { token: $("#adminTelegramTestToken").value.trim() }
    });
    result.textContent = `连接成功：@${data.bot.username || data.bot.id}`;
  } catch (error) {
    result.textContent = error.message;
  }
}

async function loadAdminSecurity() {
  try {
    const data = await api("/api/admin/security");
    state.admin.security = data.security;
    renderAdminSecurity();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAdminSecurity() {
  const security = state.admin.security;
  if (!security) return;
  $("#adminCurrentIp").textContent = security.currentIp || "—";
  $("#adminIpAllowlist").value = (security.ipAllowlist || []).join("\n");
  $("#adminTotpStatus").textContent = security.totpEnabled
    ? "两步验证已开启。登录时需要输入验证器中的 6 位验证码。"
    : security.totpPending
      ? "已生成密钥，但还没有完成验证。"
      : "两步验证未开启。";
  $("#adminTotpSetup").disabled = Boolean(security.totpEnabled);
  $("#adminTotpEnableForm").hidden = !security.totpPending;
  $("#adminTotpDisableForm").hidden = !security.totpEnabled;
  if (!security.totpPending) $("#adminTotpSetupResult").hidden = true;
}

async function adminIpSave() {
  const message = $("#adminIpMessage");
  try {
    const data = await api("/api/admin/security/ip-allowlist", {
      method: "POST",
      body: { allowlist: $("#adminIpAllowlist").value }
    });
    message.textContent = data.ipAllowlist.length
      ? `已保存 ${data.ipAllowlist.length} 条规则。`
      : "白名单已清空，不再限制管理员 IP。";
    showToast("IP 白名单已保存", "success");
    await loadAdminSecurity();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function adminTotpSetup() {
  const message = $("#adminTotpMessage");
  try {
    const data = await api("/api/admin/security/totp/setup", { method: "POST", body: {} });
    state.admin.totpSetup = data;
    $("#adminTotpSetupResult").hidden = false;
    $("#adminTotpSecret").textContent = data.secret;
    $("#adminTotpOtpauth").value = data.otpauth;
    $("#adminTotpEnableForm").hidden = false;
    message.textContent = "请把密钥加入验证器，然后输入验证码开启。";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function adminTotpEnable(event) {
  event.preventDefault();
  const message = $("#adminTotpMessage");
  try {
    await api("/api/admin/security/totp/enable", {
      method: "POST",
      body: { code: $("#adminTotpEnableCode").value.trim() }
    });
    message.textContent = "两步验证已开启。";
    showToast("两步验证已开启", "success");
    $("#adminTotpSetupResult").hidden = true;
    await loadAdminSecurity();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function adminTotpDisable(event) {
  event.preventDefault();
  const message = $("#adminTotpMessage");
  try {
    await api("/api/admin/security/totp/disable", {
      method: "POST",
      body: {
        password: $("#adminTotpDisablePassword").value,
        code: $("#adminTotpDisableCode").value.trim()
      }
    });
    message.textContent = "两步验证已关闭。";
    showToast("两步验证已关闭", "success");
    event.target.reset();
    await loadAdminSecurity();
  } catch (error) {
    message.textContent = error.message;
  }
}

/* ---------- Helpers ---------- */
function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function dayKey(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function messageTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isNearBottom() {
  const list = $("#messageList");
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
}

function initials(name) {
  const value = String(name || "?").trim();
  if (!value) return "?";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return Array.from(value).slice(0, 2).join("").toUpperCase();
}

function hueFor(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function statusLabel(status) {
  return { open: "待处理", pending: "跟进中", closed: "已关闭" }[status] || status;
}

function deliveryStatusLabel(status) {
  return {
    sending: "发送中",
    sent: "已发送",
    delivered: "已送达",
    read: "对方已读",
    failed: "发送失败"
  }[status] || "";
}

function deliveryStatusIcon(status) {
  return { sending: "…", sent: "✓", delivered: "✓", read: "✓✓", failed: "!" }[status] || "✓";
}

function updateCharCount() {
  const input = $("#messageInput");
  $("#charCount").textContent = `${input.value.length} / 4096`;
}

function autoResize(element) {
  element.style.height = "auto";
  element.style.height = Math.min(element.scrollHeight, 150) + "px";
}

/* ---------- Events ---------- */
function bindEvents() {
  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#loginButton");
    button.disabled = true;
    setLoginError("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: {
          username: $("#loginUsername").value,
          password: $("#loginPassword").value,
          totpCode: $("#loginTotp").value
        }
      });
      state.me = data.user;
      $("#loginForm").reset();
      $("#loginTotpWrap").hidden = true;
      await enterInbox();
    } catch (error) {
      if (error.data?.totpRequired) {
        $("#loginTotpWrap").hidden = false;
        $("#loginTotp").focus();
      }
      setLoginError(error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#logoutBtn").addEventListener("click", logout);
  $("#viewerLogoutBtn").addEventListener("click", logout);
  $("#viewerRefresh").addEventListener("click", loadViewerStats);
  $("#viewerRange").addEventListener("change", loadViewerStats);
  $("#viewerPasswordBtn").addEventListener("click", () => {
    $("#passwordModal").hidden = false;
    $("#passwordError").hidden = true;
    $("#passwordForm").reset();
  });

  $$(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => switchMode(tab.dataset.mode));
  });

  $("#personalAccountsBtn").addEventListener("click", openPersonalModal);
  $("#personalClose").addEventListener("click", () => {
    $("#personalModal").hidden = true;
    stopPersonalPolling();
  });
  $("#personalModal").addEventListener("click", event => {
    if (event.target === $("#personalModal")) {
      $("#personalModal").hidden = true;
      stopPersonalPolling();
    }
  });
  $("#personalAccountsList").addEventListener("click", event => {
    const button = event.target.closest("[data-personal-action]");
    if (!button) return;
    const action = button.dataset.personalAction;
    if (action === "bind") {
      personalBind(button.dataset.channel);
    } else if (action === "login") {
      personalLogin(Number(button.dataset.id));
    } else if (action === "logout") {
      personalLogout(Number(button.dataset.id));
    }
  });
  $("#personalAccountsList").addEventListener("submit", event => {
    const form = event.target.closest("[data-password-form]");
    if (!form) return;
    event.preventDefault();
    const password = form.querySelector('input[name="password"]')?.value || "";
    personalPassword(Number(form.dataset.passwordForm), password);
  });

  $("#refreshBtn").addEventListener("click", async () => {
    await loadConversations();
    if (state.activeId) await refreshActiveThread();
    await loadSidebarStats();
    showToast("已刷新", "success");
  });

  $("#searchInput").addEventListener("input", event => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.filters.q = event.target.value.trim();
    state.searchTimer = setTimeout(() => loadConversations(), 300);
  });

  $$(".scope-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".scope-tab").forEach(item => item.classList.toggle("active", item === tab));
      state.filters.scope = tab.dataset.scope;
      loadConversations();
    });
  });

  $$(".status-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".status-tab").forEach(item => item.classList.toggle("active", item === tab));
      state.filters.status = tab.dataset.status;
      loadConversations();
    });
  });

  $("#statusSelect").addEventListener("change", event => {
    updateConversation({ status: event.target.value });
  });

  $("#assigneeSelect").addEventListener("change", event => {
    const value = event.target.value;
    updateConversation({ assigneeId: value ? Number(value) : null });
  });

  $("#claimBtn").addEventListener("click", () => {
    if (!state.active) return;
    const next = state.active.assigneeId === state.me.id ? null : state.me.id;
    updateConversation({ assigneeId: next });
  });

  $("#loadMoreBtn").addEventListener("click", loadMoreMessages);
  $("#messageList").addEventListener("click", event => {
    const button = event.target.closest("[data-message-action='delete']");
    if (!button) return;
    removeMessage(Number(button.dataset.messageId), button.dataset.direction);
  });

  $("#markUnreadBtn").addEventListener("click", markConversationUnread);
  $("#deleteConversationBtn").addEventListener("click", deleteActiveConversation);
  $("#customerBtn").addEventListener("click", () => {
    const panel = $("#customerPanel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderCustomerPanel();
  });
  $("#customerClose").addEventListener("click", () => { $("#customerPanel").hidden = true; });
  $("#tagForm").addEventListener("submit", event => {
    event.preventDefault();
    addCustomerTag($("#tagInput").value);
  });
  $("#customerNotes").addEventListener("input", markCustomerDirty);
  $("#saveCustomerBtn").addEventListener("click", saveCustomerProfile);

  $("#attachBtn").addEventListener("click", () => {
    if (!state.telegramConfigured) {
      showToast("未配置 TELEGRAM_BOT_TOKEN，无法发送附件", "error");
      return;
    }
    $("#fileInput").click();
  });
  $("#fileInput").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) uploadAttachment(file);
  });
  $("#cannedBtn").addEventListener("click", openCannedModal);
  $("#cannedClose").addEventListener("click", () => { $("#cannedModal").hidden = true; });
  $("#cannedModal").addEventListener("click", event => {
    if (event.target === $("#cannedModal")) $("#cannedModal").hidden = true;
  });
  $("#cannedForm").addEventListener("submit", saveCannedReply);
  $("#cannedCancel").addEventListener("click", resetCannedForm);

  const input = $("#messageInput");
  input.addEventListener("input", () => {
    updateCharCount();
    autoResize(input);
  });
  input.addEventListener("compositionstart", () => { state.composing = true; });
  input.addEventListener("compositionend", () => { state.composing = false; });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !state.composing && !event.isComposing) {
      event.preventDefault();
      $("#composer").requestSubmit();
    }
  });

  $("#composer").addEventListener("submit", event => {
    event.preventDefault();
    sendMessage();
  });

  $("#statsBtn").addEventListener("click", openStatsModal);
  $("#statsClose").addEventListener("click", () => { $("#statsModal").hidden = true; });
  $("#statsExport").addEventListener("click", exportStatsCsv);
  $("#viewerExport").addEventListener("click", exportStatsCsv);
  $("#statsModal").addEventListener("click", event => {
    if (event.target === $("#statsModal")) $("#statsModal").hidden = true;
  });
  $("#statsRange").addEventListener("change", loadStats);

  $("#appearanceBtn").addEventListener("click", openAppearanceModal);
  $("#viewerAppearanceBtn").addEventListener("click", openAppearanceModal);
  $("#loginThemeBtn").addEventListener("click", openAppearanceModal);
  $("#channelsAppearanceBtn").addEventListener("click", () => {
    stopWhatsAppWebPolling();
    $("#channelsModal").hidden = true;
    openAppearanceModal();
  });
  $("#appearanceClose").addEventListener("click", () => { $("#appearanceModal").hidden = true; });
  $("#appearanceModal").addEventListener("click", event => {
    if (event.target === $("#appearanceModal")) $("#appearanceModal").hidden = true;
  });

  $("#channelsBtn").addEventListener("click", openChannelsModal);
  $("#channelsClose").addEventListener("click", () => {
    stopWhatsAppWebPolling();
    $("#channelsModal").hidden = true;
  });
  $("#channelsModal").addEventListener("click", event => {
    if (event.target === $("#channelsModal")) {
      stopWhatsAppWebPolling();
      $("#channelsModal").hidden = true;
    }
  });
  $("#aiForm").addEventListener("submit", saveAiSettings);
  $("#aiPreset").addEventListener("change", applyAiPreset);
  $("#aiBaseUrl").addEventListener("input", updateAiPresetHint);
  $("#aiTestBtn").addEventListener("click", testAiConnection);
  $("#aiClearBtn").addEventListener("click", clearAiKey);

  $("#aiBtn").addEventListener("click", openAiModal);
  $("#aiClose").addEventListener("click", () => { $("#aiModal").hidden = true; });
  $("#aiModal").addEventListener("click", event => {
    if (event.target === $("#aiModal")) $("#aiModal").hidden = true;
  });
  $("#aiPrefsForm").addEventListener("submit", saveAiUserPreferences);
  $("#aiUserEnabled").addEventListener("change", () => {
    const data = state.aiPrefs || state.ai || {};
    const usable = Boolean(data.configured && data.globalEnabled && data.allowed);
    $("#aiUserMode").disabled = !usable || !$("#aiUserEnabled").checked;
  });
  $("#openAiAdminBtn").addEventListener("click", async () => {
    $("#aiModal").hidden = true;
    await openChannelsModal();
    $("#aiStatus")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#aiUseSuggestion").addEventListener("click", useAiSuggestion);
  $("#aiDismissSuggestion").addEventListener("click", dismissAiSuggestion);
  $("#chatAiState").addEventListener("click", () => {
    if (state.active?.assigneeId === state.me?.id) openAiModal();
  });

  $("#supportLinksForm").addEventListener("submit", saveSupportLinks);
  $("#supportLinksPreviewBtn").addEventListener("click", () => window.open("/go", "_blank", "noopener"));
  $("#telegramForm").addEventListener("submit", saveTelegramToken);
  $("#telegramClearBtn").addEventListener("click", clearTelegramToken);
  $("#whatsappForm").addEventListener("submit", saveWhatsAppCredentials);
  $("#whatsappClearBtn").addEventListener("click", clearWhatsAppCredentials);
  $("#whatsappWebLoginBtn").addEventListener("click", beginWhatsAppWebLogin);
  $("#whatsappWebLogoutBtn").addEventListener("click", logoutWhatsAppWeb);
  $("#translateForm").addEventListener("submit", saveTranslateKey);
  $("#translateProvider").addEventListener("change", saveTranslateProvider);
  $("#translateClearBtn").addEventListener("click", clearTranslateKey);
  $("#replyLanguage").addEventListener("change", () => {
    if (state.active) state.replyLanguages[state.active.id] = $("#replyLanguage").value;
  });

  $("#teamBtn").addEventListener("click", openTeamModal);
  $("#assignmentForm").addEventListener("submit", saveAssignmentSettings);
  $("#teamClose").addEventListener("click", () => { $("#teamModal").hidden = true; });
  $("#teamModal").addEventListener("click", event => {
    if (event.target === $("#teamModal")) $("#teamModal").hidden = true;
  });

  $("#createUserForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorBox = $("#createUserError");
    errorBox.hidden = true;
    try {
      await api("/api/users", {
        method: "POST",
        body: {
          username: $("#newUsername").value,
          displayName: $("#newDisplayName").value,
          password: $("#newPassword").value,
          role: $("#newRole").value,
          aiAllowed: $("#newAiAllowed").checked
        }
      });
      event.target.reset();
      showToast("客服账号已创建", "success");
      await Promise.all([loadUsers(), loadTeamUsers()]);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  });

  $("#adminBtn").addEventListener("click", () => openAdminModal());
  $("#adminClose").addEventListener("click", () => { $("#adminModal").hidden = true; });
  $("#adminModal").addEventListener("click", event => {
    if (event.target === $("#adminModal")) $("#adminModal").hidden = true;
  });
  $$(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => switchAdminTab(tab.dataset.adminTab));
  });
  $("#adminSystemRefresh").addEventListener("click", loadAdminSystem);
  $("#adminOpenTeam").addEventListener("click", () => {
    $("#adminModal").hidden = true;
    openTeamModal();
  });
  $("#adminUserRows").addEventListener("click", event => {
    const button = event.target.closest("[data-admin-user-action]");
    if (!button) return;
    adminUserAction(button.dataset.adminUserAction, Number(button.dataset.userId));
  });
  $("#adminCreateUserForm").addEventListener("submit", adminCreateUser);
  $("#adminAuditRefresh").addEventListener("click", loadAdminAudit);
  $("#adminAuditAction").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadAdminAudit();
    }
  });
  $("#adminDataRefresh").addEventListener("click", loadAdminData);
  $("#adminCreateBackup").addEventListener("click", adminCreateBackup);
  $("#adminExportConversations").addEventListener("click", adminExportConversations);
  $("#adminCleanupPreview").addEventListener("click", () => adminCleanup(true));
  $("#adminCleanupForm").addEventListener("submit", event => {
    event.preventDefault();
    adminCleanup(false);
  });
  $("#adminDiagRefresh").addEventListener("click", loadAdminChannels);
  $("#adminTelegramTestForm").addEventListener("submit", adminTelegramTest);
  $("#adminDiagnostics").addEventListener("click", event => {
    const button = event.target.closest("[data-admin-channel-action]");
    if (!button) return;
    const action = button.dataset.adminChannelAction;
    if (action === "whatsapp-login") {
      api("/api/admin/whatsapp-web/login", { method: "POST", body: {} })
        .then(() => loadAdminChannels())
        .catch(error => showToast(error.message, "error"));
    } else if (action === "whatsapp-reconnect") {
      api("/api/admin/whatsapp-web/reconnect", { method: "POST", body: {} })
        .then(() => { showToast("WhatsApp 个人号已重连", "success"); return loadAdminChannels(); })
        .catch(error => showToast(error.message, "error"));
    } else if (action === "whatsapp-logout") {
      if (!window.confirm("确定退出 WhatsApp 个人号？")) return;
      api("/api/admin/whatsapp-web/logout", { method: "POST", body: {} })
        .then(() => loadAdminChannels())
        .catch(error => showToast(error.message, "error"));
    }
  });
  $("#adminDiagnosticAccounts").addEventListener("click", event => {
    const button = event.target.closest("[data-admin-account-action]");
    if (!button) return;
    adminAccountAction(button.dataset.adminAccountAction, Number(button.dataset.accountId));
  });
  $("#adminSecurityRefresh").addEventListener("click", loadAdminSecurity);
  $("#adminPasswordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("#adminPasswordMessage");
    const currentPassword = $("#adminCurrentPassword").value;
    const newPassword = $("#adminNewPassword").value;
    const confirmPassword = $("#adminConfirmPassword").value;
    if (newPassword !== confirmPassword) {
      message.textContent = "两次输入的新密码不一致";
      return;
    }
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword }
      });
      message.textContent = "密码已修改，其他设备需要重新登录。";
      event.target.reset();
      showToast("管理员密码已修改", "success");
    } catch (error) {
      message.textContent = error.message;
    }
  });
  $("#adminIpSave").addEventListener("click", adminIpSave);
  $("#adminTotpSetup").addEventListener("click", adminTotpSetup);
  $("#adminTotpEnableForm").addEventListener("submit", adminTotpEnable);
  $("#adminTotpDisableForm").addEventListener("submit", adminTotpDisable);
  $("#adminTotpCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#adminTotpOtpauth").value);
      showToast("otpauth 链接已复制", "success");
    } catch {
      $("#adminTotpOtpauth").select();
    }
  });

  $("#passwordBtn").addEventListener("click", () => {
    $("#passwordModal").hidden = false;
    $("#passwordError").hidden = true;
    $("#passwordForm").reset();
  });
  $("#passwordClose").addEventListener("click", () => { $("#passwordModal").hidden = true; });
  $("#passwordModal").addEventListener("click", event => {
    if (event.target === $("#passwordModal")) $("#passwordModal").hidden = true;
  });

  $("#passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorBox = $("#passwordError");
    errorBox.hidden = true;
    const currentPassword = $("#currentPassword").value;
    const newPassword = $("#newPasswordSelf").value;
    const confirmPassword = $("#confirmPassword").value;

    if (newPassword !== confirmPassword) {
      errorBox.textContent = "两次输入的新密码不一致";
      errorBox.hidden = false;
      return;
    }

    try {
      await api("/api/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword }
      });
      showToast("密码已修改", "success");
      $("#passwordModal").hidden = true;
      event.target.reset();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  });

  $("#mobileBack").addEventListener("click", () => {
    document.body.classList.remove("mobile-chat-open");
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      $("#channelsModal").hidden = true;
      $("#teamModal").hidden = true;
      $("#adminModal").hidden = true;
      $("#aiModal").hidden = true;
      $("#passwordModal").hidden = true;
      $("#cannedModal").hidden = true;
      $("#statsModal").hidden = true;
      $("#appearanceModal").hidden = true;
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === "cs-theme" && event.newValue) {
      applyTheme(event.newValue, { persist: false });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.activeId) {
      markRead(state.activeId, { silent: true });
      refreshActiveThread();
    }
  });

  window.addEventListener("online", () => setConnection(state.sseConnected ? "online" : "offline"));
  window.addEventListener("offline", () => setConnection("offline"));
}

function init() {
  applyTheme(currentTheme(), { persist: false });
  bindEvents();
  boot();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
