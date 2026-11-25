const $=s=>document.querySelector(s);
let me=null, activeConversation=null, socket=null, contacts=[];
let activeConversationType = "direct";
async function api(path, options = {}) { const r = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`); return data; }
function showMsg(t){$("#authMsg").textContent=t}
document.addEventListener("click", e => {
  const button = e.target.closest("[data-toggle-password]");
  if (!button) return;

  const wrap = button.closest(".password-wrap");
  const input = wrap?.querySelector("input");
  if (!input) return;

  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
  button.title = visible ? "隐藏密码" : "显示密码";
  button.textContent = visible ? "🙈" : "👁";
});
function showTab(tab){document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));["login","register"].forEach(x=>$("#"+x+"Form").hidden=x!==tab);showMsg("")}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("#loginForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("/api/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});await boot()}catch(x){showMsg(x.message)}};
$("#registerForm").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); try { const d = await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(f)) }); showMsg(d.message); showTab("login"); } catch (x) { showMsg(x.message); } };
let contactsRefreshTimer = null;
let contactsLoading = false;
let messageRefreshTimer = null;
let messagesLoading = false;
let conversationOpenSequence = 0;
let presenceRefreshTimer = null;
let typingStopTimer = null;
let remoteTypingTimer = null;
let typingSent = false;
let lastTypingSignal = 0;
// ========== 浏览器新消息通知 ==========
let notificationBaselineReady = false;
const knownLastMessageIds = new Map();
let notificationAudioContext = null;
let notificationPermissionRequested = false;

function unlockNotificationAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    if (!notificationAudioContext) {
      notificationAudioContext = new AudioContextClass();
    }
    if (notificationAudioContext.state === "suspended") {
      notificationAudioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn("提示音初始化失败：", error);
  }
}

async function playNotificationSound() {
  if (!notificationAudioContext) return;

  try {
    const ctx = notificationAudioContext;

    // NOTIF-20261123: 浏览器会在 AudioContext 长时间空闲后自动挂起它，
    // 而旧代码只在用户点击/按键时解锁——挂机一段时间后再收到消息，
    // 上下文已是 suspended，playNotificationSound 直接 return，提示音必哑。
    // 现在播放前按需 resume（页面可见时浏览器允许），挂起→恢复失败才放弃。
    if (ctx.state === "suspended") {
      await Promise.race([
        ctx.resume(),
        new Promise(resolve => setTimeout(resolve, 600))
      ]);
    }

    if (ctx.state !== "running") return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(1174.66, now + 0.10);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
  } catch (error) {
    console.warn("消息提示音播放失败：", error);
  }
}

// 用户首次操作页面时解锁提示音，并在浏览器允许时申请桌面通知权限
document.addEventListener("pointerdown", () => {
  if (!me) return;
  unlockNotificationAudio();

  if (
    !notificationPermissionRequested &&
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    notificationPermissionRequested = true;
    Notification.requestPermission().catch(() => {});
  }
}, { passive: true });

document.addEventListener("keydown", () => {
  if (me) unlockNotificationAudio();
}, { passive: true });

// NOTIF-20261123: 桌面通知权限被拒绝或默认关闭时，在页面内提示一次，
// 并给出开启入口（地址栏的站点设置里可重新授权）。
// 旧逻辑只在手势时静默请求一次，被拒后用户完全不知道没有权限。
let notificationDeniedHintShown = false;
function checkNotificationPermissionHint() {
  if (notificationDeniedHintShown) return;
  if (!me || !("Notification" in window)) return;

  const permission = Notification.permission;
  if (permission === "granted") return;

  if (permission === "denied") {
    const bar = document.createElement("div");
    bar.className = "notification-denied-bar";
    bar.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
      "z-index:9999;max-width:min(520px,90vw);background:#fff3cd;" +
      "border:1px solid #ffe08a;border-radius:10px;padding:10px 14px;" +
      "font-size:13px;line-height:1.5;color:#664d03;box-shadow:0 4px 16px rgba(0,0,0,.12);";
    const text = document.createElement("span");
    text.textContent =
      "桌面通知被浏览器禁用，新消息不会有弹窗提醒。可在浏览器地址栏左侧的站点设置中，将“通知”改为允许后刷新页面。";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "知道了";
    close.style.cssText =
      "margin-left:10px;border:none;background:#fff;color:#664d03;" +
      "border:1px solid #e5d5a0;border-radius:6px;padding:2px 10px;" +
      "cursor:pointer;font-size:12px;";
    close.onclick = () => bar.remove();
    bar.append(text, close);
    document.body.appendChild(bar);
    setTimeout(() => { try { bar.remove(); } catch {} }, 60000);
    notificationDeniedHintShown = true;
    return;
  }

  // permission === "default"：手势请求被用户忽略/未弹框时同样静默，
  // 30 秒后若仍是 default 则提示一次。
  if (permission === "default") {
    setTimeout(() => {
      if (Notification.permission === "default") {
        notificationDeniedHintShown = true;
        checkNotificationPermissionHint();
      }
    }, 30000);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkNotificationPermissionHint();
}, { passive: true });

function showConversationNotification(conv) {
  if (!me || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!conv.last_sender_id || conv.last_sender_id === me.id) return;
  // NOTIF-20261123: 旧逻辑在"正在查看该会话"时一律跳过桌面通知。
  // 但页面在后台标签页（document.hidden）时，用户其实不在看，
  // 此时即使是当前会话也应该弹通知。只有页面可见且确实在看才跳过。
  const viewingThisConversation = !document.hidden && conv.id === activeConversation;
  if (viewingThisConversation) return;

  const senderName =
    conv.last_sender_display_name ||
    conv.other_display_name ||
    conv.other_username ||
    "新消息";

  const title = conv.type === "group"
    ? senderName + "（" + (conv.group_name || "群聊") + "）"
    : senderName;

  try {
    const notification = new Notification(title, {
      body: String(conv.last_message || "发送了一条新消息").slice(0, 180),
      requireInteraction: false
    });

    notification.onclick = async () => {
      notification.close();
      window.focus();

      try {
        if (conv.type === "group") {
          await openGroup(conv);
        } else {
          let contact = contacts.find(item => item.id === conv.other_user_id);
          if (!contact) {
            await loadContacts();
            contact = contacts.find(item => item.id === conv.other_user_id);
          }
          if (contact) await openDirect(contact);
        }
      } catch (error) {
        console.error("通知跳转失败：", error);
      }
    };
  } catch (error) {
    console.error("桌面通知显示失败：", error);
  }
}

function checkNewMessageNotifications(conversations) {
  if (!Array.isArray(conversations)) return;

  if (!notificationBaselineReady) {
    conversations.forEach(conv => {
      knownLastMessageIds.set(conv.id, conv.last_message_id || null);
    });
    notificationBaselineReady = true;
    return;
  }

  conversations.forEach(conv => {
    const currentId = conv.last_message_id || null;
    const previousId = knownLastMessageIds.get(conv.id);

    if (previousId === undefined) {
      knownLastMessageIds.set(conv.id, currentId);

      // NOTIF-20261123: 基线建立后新出现的会话（新建的群、新开的私聊），
      // 旧逻辑一律静默记基线，导致该会话的第一条消息永远不通知。
      // 若该会话存在未读（unread_count>0 表示最后一条是别人发的且我没读过），
      // 这条消息必然在页面打开之后到达，按新消息通知；
      // 无未读的仍静默记基线，避免历史旧消息补通知。
      if (
        currentId &&
        Number(conv.unread_count || 0) > 0 &&
        conv.last_sender_id &&
        conv.last_sender_id !== me?.id
      ) {
        playNotificationSound();
        showConversationNotification(conv);
      }
      return;
    }

    if (
      currentId &&
      currentId !== previousId &&
      conv.last_sender_id &&
      conv.last_sender_id !== me?.id
    ) {
      playNotificationSound();
      showConversationNotification(conv);
    }

    knownLastMessageIds.set(conv.id, currentId);
  });
}

/* CLOUDCHAT_WEBRTC_FRONTEND_V1 */

let callsSocket = null;
let callSocketRetryTimer = null;
let callSocketGeneration = 0;
let callState = null;

const CLOUDCHAT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" }
];

function callSend(payload) {
  if (!callsSocket || callsSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    callsSocket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function callSendSignal(type, extra = {}) {
  if (!callState) return false;

  return callSend({
    type,
    callId: callState.callId,
    conversationId: callState.conversationId,
    ...extra
  });
}

function connectCallSocket() {
  if (!me) return;

  if (
    callsSocket &&
    [WebSocket.OPEN, WebSocket.CONNECTING].includes(callsSocket.readyState)
  ) return;

  if (callSocketRetryTimer) {
    clearTimeout(callSocketRetryTimer);
    callSocketRetryTimer = null;
  }

  const generation = ++callSocketGeneration;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";

  let ws;

  try {
    ws = new WebSocket(`${proto}//${location.host}/ws/calls`);
  } catch {
    scheduleCallSocketReconnect(generation);
    return;
  }

  callsSocket = ws;

  ws.onmessage = event => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handleCallSignal(data);
  };

  ws.onclose = () => {
    if (callsSocket === ws) callsSocket = null;
    if (me && generation === callSocketGeneration) {
      scheduleCallSocketReconnect(generation);
    }
  };

  ws.onerror = () => {
    try { ws.close(); } catch {}
  };
}

function scheduleCallSocketReconnect(generation) {
  if (!me || generation !== callSocketGeneration) return;

  if (callSocketRetryTimer) clearTimeout(callSocketRetryTimer);

  callSocketRetryTimer = setTimeout(() => {
    callSocketRetryTimer = null;
    if (me && generation === callSocketGeneration) connectCallSocket();
  }, 2500);
}

function disconnectCallSocket() {
  ++callSocketGeneration;

  if (callSocketRetryTimer) {
    clearTimeout(callSocketRetryTimer);
    callSocketRetryTimer = null;
  }

  const ws = callsSocket;
  callsSocket = null;

  if (ws) {
    try {
      ws.onclose = null;
      ws.close(1000, "logout");
    } catch {}
  }
}

function ensureCallUi() {
  if ($("#cloudCallOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "cloudCallOverlay";
  overlay.className = "cloud-call-overlay";
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="cloud-call-panel">
      <div class="cloud-call-heading">
        <div id="cloudCallName">通话</div>
        <div id="cloudCallStatus">正在连接</div>
      </div>
      <div class="cloud-call-stage">
        <video id="cloudCallRemoteVideo" autoplay playsinline></video>
        <video id="cloudCallLocalVideo" autoplay muted playsinline></video>
        <audio id="cloudCallRemoteAudio" autoplay></audio>
      </div>
      <div class="cloud-call-controls">
        <button id="cloudCallAccept" type="button">接听</button>
        <button id="cloudCallReject" type="button">拒绝</button>
        <button id="cloudCallMute" type="button" hidden>静音</button>
        <button id="cloudCallCamera" type="button" hidden>关闭摄像头</button>
        <button id="cloudCallHangup" type="button">取消呼叫</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  $("#cloudCallAccept").onclick = acceptIncomingCall;
  $("#cloudCallReject").onclick = rejectIncomingCall;
  $("#cloudCallHangup").onclick = hangupCurrentCall;

  $("#cloudCallMute").onclick = () => {
    if (!callState?.localStream) return;
    const tracks = callState.localStream.getAudioTracks();
    if (!tracks.length) return;

    const enabled = tracks.some(track => track.enabled);
    tracks.forEach(track => track.enabled = !enabled);
    $("#cloudCallMute").textContent = enabled ? "取消静音" : "静音";
  };

  $("#cloudCallCamera").onclick = () => {
    if (!callState?.localStream) return;
    const tracks = callState.localStream.getVideoTracks();
    if (!tracks.length) return;

    const enabled = tracks.some(track => track.enabled);
    tracks.forEach(track => track.enabled = !enabled);
    $("#cloudCallCamera").textContent =
      enabled ? "开启摄像头" : "关闭摄像头";
  };

  if ($("#audioCallBtn")) {
    $("#audioCallBtn").onclick = () => startOutgoingCall("audio");
    $("#videoCallBtn").onclick = () => startOutgoingCall("video");
  }
}

function renderCallActions() {
  const actions = $("#callActions");
  if (!actions) return;

  const direct = !!activeConversation &&
    activeConversationType === "direct";

  actions.hidden = !direct;

  const disabled = !direct || !!callState;
  $("#audioCallBtn").disabled = disabled;
  $("#videoCallBtn").disabled = disabled;
}

function getCallDisplayName(userId) {
  const contact = (contacts || []).find(item =>
    String(item.id || item.user_id || "") === String(userId)
  );

  return contact?.display_name || contact?.username || "好友";
}

function showCallUi() {
  ensureCallUi();
  if (!callState) return;

  $("#cloudCallOverlay").hidden = false;
  $("#cloudCallName").textContent = callState.displayName || "好友";
  $("#cloudCallStatus").textContent = callState.statusText || "正在连接";

  const isVideo = callState.mode === "video";
  const incoming = callState.role === "callee" &&
    callState.status === "ringing";
  const ringing = callState.status === "ringing";

  $("#cloudCallAccept").hidden = !incoming;
  $("#cloudCallReject").hidden = !incoming;
  $("#cloudCallMute").hidden = ringing;
  $("#cloudCallCamera").hidden = ringing || !isVideo;

  $("#cloudCallHangup").textContent =
    callState.role === "caller" && ringing ? "取消呼叫" : "挂断";

  $("#cloudCallLocalVideo").hidden = !isVideo;
  $("#cloudCallRemoteVideo").hidden = !isVideo;

  $("#cloudCallLocalVideo").srcObject = callState.localStream || null;
  $("#cloudCallRemoteVideo").srcObject = callState.remoteStream || null;
  $("#cloudCallRemoteAudio").srcObject = callState.remoteStream || null;

  renderCallActions();
}

function setCallStatus(text) {
  if (!callState) return;
  callState.statusText = text;
  if ($("#cloudCallStatus")) $("#cloudCallStatus").textContent = text;
}

async function startOutgoingCall(mode) {
  if (!me || !activeConversation ||
      activeConversationType !== "direct") return;

  if (callState) {
    alert("当前已有通话，请先结束当前通话");
    return;
  }

  if (!callsSocket || callsSocket.readyState !== WebSocket.OPEN) {
    alert("通话连接尚未建立，请稍后重试");
    connectCallSocket();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("当前浏览器不支持音视频通话");
    return;
  }

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video"
    });
  } catch (error) {
    alert(
      error.name === "NotAllowedError"
        ? "请允许浏览器使用麦克风和摄像头"
        : "无法获取麦克风或摄像头：" + (error.message || "未知错误")
    );
    return;
  }

  if (!activeConversation || activeConversationType !== "direct") {
    stream.getTracks().forEach(track => track.stop());
    return;
  }

  callState = {
    callId: crypto.randomUUID().replace(/-/g, ""),
    conversationId: activeConversation,
    mode,
    role: "caller",
    status: "ringing",
    statusText: "正在呼叫…",
    displayName: $("#convTitle").textContent || "好友",
    localStream: stream,
    remoteStream: null,
    pc: null,
    pendingIce: [],
    timeout: null
  };

  showCallUi();

  if (!callSendSignal("call_invite", { mode })) {
    finishCall(false);
    alert("呼叫发送失败，请检查通话连接");
    return;
  }

  callState.timeout = setTimeout(() => {
    if (callState?.status === "ringing") {
      callSendSignal("call_cancel");
      finishCall(false);
      alert("对方暂时没有接听");
    }
  }, 120000);
}

async function acceptIncomingCall() {
  if (!callState || callState.role !== "callee" ||
      callState.status !== "ringing") return;

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callState.mode === "video"
    });
  } catch (error) {
    alert(
      error.name === "NotAllowedError"
        ? "请允许浏览器使用麦克风和摄像头"
        : "无法获取麦克风或摄像头：" + (error.message || "未知错误")
    );
    callSendSignal("call_reject");
    finishCall(false);
    return;
  }

  if (!callState || callState.role !== "callee") {
    stream.getTracks().forEach(track => track.stop());
    return;
  }

  callState.localStream = stream;
  callState.status = "active";
  callState.statusText = "已接听，正在建立连接…";

  if (callState.timeout) clearTimeout(callState.timeout);

  if (!callSendSignal("call_accept")) {
    finishCall(false);
    alert("接听失败，通话连接已断开");
    return;
  }

  showCallUi();
}

function rejectIncomingCall() {
  if (!callState || callState.role !== "callee") return;
  callSendSignal("call_reject");
  finishCall(false);
}

function hangupCurrentCall() {
  if (!callState) return;

  if (callState.status === "ringing") {
    callSendSignal(
      callState.role === "caller" ? "call_cancel" : "call_reject"
    );
  } else {
    callSendSignal("call_end");
  }

  finishCall(false);
}

function finishCall(sendSignal = false) {
  if (!callState) return;

  const old = callState;

  if (sendSignal) {
    callSendSignal(old.status === "ringing"
      ? (old.role === "caller" ? "call_cancel" : "call_reject")
      : "call_end");
  }

  callState = null;

  if (old.timeout) clearTimeout(old.timeout);

  if (old.pc) {
    try {
      old.pc.ontrack = null;
      old.pc.onicecandidate = null;
      old.pc.close();
    } catch {}
  }

  if (old.localStream) {
    old.localStream.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
  }

  if ($("#cloudCallOverlay")) {
    $("#cloudCallOverlay").hidden = true;
    $("#cloudCallLocalVideo").srcObject = null;
    $("#cloudCallRemoteVideo").srcObject = null;
    $("#cloudCallRemoteAudio").srcObject = null;
  }

  renderCallActions();
}

async function createCallPeerConnection(isCaller) {
  if (!callState) return null;
  if (callState.pc) return callState.pc;

  const pc = new RTCPeerConnection({
    iceServers: CLOUDCHAT_STUN_SERVERS
  });

  callState.pc = pc;

  if (callState.localStream) {
    callState.localStream.getTracks().forEach(track => {
      pc.addTrack(track, callState.localStream);
    });
  }

  pc.onicecandidate = event => {
    if (!event.candidate || !callState) return;
    callSendSignal("webrtc_ice", {
      candidate: event.candidate.toJSON()
    });
  };

  pc.ontrack = event => {
    if (!callState) return;

    const stream = event.streams?.[0];
    if (stream) {
      callState.remoteStream = stream;
      $("#cloudCallRemoteVideo").srcObject = stream;
      $("#cloudCallRemoteAudio").srcObject = stream;
    }

    setCallStatus("通话已连接");
  };

  pc.onconnectionstatechange = () => {
    if (!callState || callState.pc !== pc) return;

    if (pc.connectionState === "connected") {
      setCallStatus("通话已连接");
    } else if (pc.connectionState === "connecting") {
      setCallStatus("正在建立音视频连接…");
    } else if (pc.connectionState === "failed") {
      setCallStatus("连接失败，请检查网络或稍后重试");
    }
  };

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (!callState || callState.pc !== pc) return null;

    if (!callSendSignal("webrtc_offer", {
      description: {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      }
    })) {
      throw new Error("无法发送视频通话邀请");
    }
  }

  return pc;
}

async function flushPendingCallIce() {
  if (!callState?.pc?.remoteDescription) return;

  const pending = callState.pendingIce.splice(0);

  for (const candidate of pending) {
    try {
      await callState.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn("ICE candidate 添加失败：", error);
    }
  }
}

async function handleCallSignal(data) {
  if (!data || typeof data !== "object") return;

  if (data.type === "call_error") {
    if (callState && data.callId === callState.callId) {
      const message = data.message || "通话操作失败";
      finishCall(false);
      alert(message);
    }
    return;
  }

  if (data.type === "call_invite") {
    if (callState) {
      callSend({
        type: "call_reject",
        callId: data.callId,
        conversationId: data.conversationId
      });
      return;
    }

    if (!data.callId || !data.conversationId ||
        !["audio", "video"].includes(data.mode)) return;

    callState = {
      callId: data.callId,
      conversationId: data.conversationId,
      mode: data.mode,
      role: "callee",
      status: "ringing",
      statusText: data.mode === "video"
        ? "邀请你进行视频通话"
        : "邀请你进行语音通话",
      displayName: getCallDisplayName(data.fromUserId),
      localStream: null,
      remoteStream: null,
      pc: null,
      pendingIce: [],
      timeout: null
    };

    callState.timeout = setTimeout(() => {
      if (callState?.role === "callee" &&
          callState.status === "ringing") {
        callSendSignal("call_reject");
        finishCall(false);
      }
    }, 120000);

    showCallUi();
    return;
  }

  if (!callState || data.callId !== callState.callId) return;

  if (data.type === "call_accept") {
    if (callState.role !== "caller") return;

    callState.status = "active";
    if (callState.timeout) clearTimeout(callState.timeout);

    setCallStatus("对方已接听，正在建立连接…");

    try {
      await createCallPeerConnection(true);
    } catch (error) {
      console.error("创建通话连接失败：", error);
      callSendSignal("call_end");
      finishCall(false);
      alert("建立通话连接失败：" + (error.message || "未知错误"));
    }
    return;
  }

  if (["call_reject", "call_cancel", "call_end"].includes(data.type)) {
    const message =
      data.type === "call_reject" ? "对方拒绝了通话" :
      data.type === "call_cancel" ? "对方取消了呼叫" :
      "通话已结束";

    finishCall(false);

    if (data.type !== "call_end") alert(message);
    return;
  }

  if (data.type === "webrtc_offer") {
    if (callState.role !== "callee" ||
        !data.description ||
        data.description.type !== "offer") return;

    try {
      const pc = await createCallPeerConnection(false);
      if (!pc || !callState) return;

      await pc.setRemoteDescription(
        new RTCSessionDescription(data.description)
      );

      await flushPendingCallIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (!callState || callState.pc !== pc) return;

      if (!callSendSignal("webrtc_answer", {
        description: {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp
        }
      })) throw new Error("无法发送通话应答");

      setCallStatus("正在连接对方…");
    } catch (error) {
      console.error("处理 WebRTC offer 失败：", error);
      callSendSignal("call_end");
      finishCall(false);
      alert("建立音视频连接失败：" + (error.message || "未知错误"));
    }
    return;
  }

  if (data.type === "webrtc_answer") {
    if (callState.role !== "caller" ||
        !data.description ||
        data.description.type !== "answer" ||
        !callState.pc) return;

    try {
      await callState.pc.setRemoteDescription(
        new RTCSessionDescription(data.description)
      );
      await flushPendingCallIce();
      setCallStatus("正在连接对方…");
    } catch (error) {
      console.error("处理 WebRTC answer 失败：", error);
      callSendSignal("call_end");
      finishCall(false);
      alert("通话应答处理失败");
    }
    return;
  }

  if (data.type === "webrtc_ice") {
    if (!data.candidate) return;

    if (!callState.pc || !callState.pc.remoteDescription) {
      callState.pendingIce.push(data.candidate);
      return;
    }

    try {
      await callState.pc.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
    } catch (error) {
      console.warn("接收 ICE candidate 失败：", error);
    }
  }
}

ensureCallUi();
renderCallActions();

window.addEventListener("beforeunload", () => {
  if (callState?.status === "active") {
    callSendSignal("call_end");
  } else if (callState?.status === "ringing") {
    callSendSignal(
      callState.role === "caller" ? "call_cancel" : "call_reject"
    );
  }

  if (callState?.localStream) {
    callState.localStream.getTracks().forEach(track => track.stop());
  }

  try { callState?.pc?.close(); } catch {}
});
async function boot() {
  try {
    const d = await api("/api/me");
    me = d.user;
    connectCallSocket();
    notificationBaselineReady = false;
    knownLastMessageIds.clear();
    api("/api/presence/heartbeat", { method: "POST" }).catch(() => {});
    if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
    presenceRefreshTimer = setInterval(() => {
      if (me && !document.hidden) {
        api("/api/presence/heartbeat", { method: "POST" }).catch(() => {});
      }
    }, 20000);

    $("#auth").hidden = true;
    $("#chat").hidden = false;
    $("#adminPanel").hidden = true;
    $("#userbar").textContent = `${me.displayName}\uFF08${me.role === "admin" ? "\u8D85\u7EA7\u7BA1\u7406\u5458" : "\u666E\u901A\u7528\u6237"}\uFF09`;
    $("#adminBtn").hidden = me.role !== "admin";
await loadContacts();

    if (contactsRefreshTimer) clearInterval(contactsRefreshTimer);
    // PERF-20261123: 联系人/会话列表兜底轮询 3s → 10s。
    // 当前会话的新消息由 WebSocket 实时推送，此轮询负责：
    // 其它会话的未读角标/预览刷新，以及新消息通知的兜底检测
    // （checkNewMessageNotifications 依赖此轮询的数据）。
    // 保留后台标签页运行（浏览器会自行节流），避免后台漏通知。
    contactsRefreshTimer = setInterval(() => {
      if (me) { loadContacts().catch(() => {}); }
    }, 10000);

    // NOTIF-20261123: 登录成功后检查桌面通知权限并给出页面内提示
    checkNotificationPermissionHint();
  } catch {
    if (contactsRefreshTimer) clearInterval(contactsRefreshTimer);
    contactsRefreshTimer = null;
    $("#auth").hidden = false;
    $("#chat").hidden = true;
  }
}

// 会话列表：显示最后一条消息的发送者和内容
function formatConversationPreview(conv) {
  if (!conv || !conv.last_message_id) {
    return conv?.type === "group"
      ? "\u7fa4\u804a\u5df2\u521b\u5efa"
      : "\u8fd8\u6ca1\u6709\u6d88\u606f";
  }

  const sender = conv.last_sender_display_name || "\u7528\u6237";
  const body = String(conv.last_message || "");
  return sender + "\uff1a" + body;
}
// PERF-20261123: 收到 WebSocket 消息后的侧栏刷新调度（节流 3 秒）。
// 原先每条消息都直接 loadContacts()（一次 3 个 HTTP 请求），
// 消息密集时是请求风暴的主要来源。节流后侧栏的预览/未读
// 最多延迟 3 秒刷新，而当前会话的消息本身仍由 WS 即时渲染。
let sidebarRefreshTimer = null;
function scheduleSidebarRefresh() {
  if (sidebarRefreshTimer) return;
  sidebarRefreshTimer = setTimeout(() => {
    sidebarRefreshTimer = null;
    loadContacts().catch(() => {});
  }, 3000);
}

async function loadContacts() {
  if (contactsLoading) return;
  contactsLoading = true;

  try {
    // PERF-20261123: 三个接口并发请求。
    // 原为串行 await：跨境 RTT 200-350ms 时一轮要 0.7-1.1s，
    // 并发后只花一次 RTT，且总耗时不再随接口数量线性增长。
    const [d, req, convData] = await Promise.all([
      api("/api/contacts"),
      api("/api/contacts/requests"),
      api("/api/conversations")
    ]);
    contacts = d.contacts;
    const conversations = convData.conversations || [];
    checkNewMessageNotifications(conversations);
    const list = $("#contactList");

    // CLOUDCHAT_STABLE_FRIEND_AVATAR_V1
    // 保存已有头像节点，刷新好友列表时继续复用
    const existingAvatars = new Map(
      Array.from(list.querySelectorAll(".contact[data-contact-id]"))
        .map(item => [
          item.dataset.contactId,
          item.querySelector(".contact-avatar")
        ])
        .filter(([, avatar]) => avatar)
    );

    list.innerHTML = "";

    req.requests.forEach(r => {
      const el = document.createElement("div");
      el.className = "contact friend-request";

      const info = document.createElement("div");
      info.className = "friend-request-info";

      const name = document.createElement("b");
      name.textContent = r.display_name || r.username;

      const username = document.createElement("small");
      username.textContent = "@" + r.username + " · 请求添加你为好友";

      info.append(name, username);

      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "friend-accept-btn";
      accept.textContent = "接受";

      accept.onclick = async event => {
        event.stopPropagation();
        accept.disabled = true;
        try {
          await api("/api/contacts/accept", {
            method: "POST",
            body: JSON.stringify({ userId: r.user_id })
          });
          await loadContacts();
        } catch (error) {
          alert(error.message || "接受好友申请失败");
          accept.disabled = false;
        }
      };

      el.append(info, accept);
      list.append(el);
    });

    const conversationMap = new Map(
      conversations
        .filter(conv => conv.type === "direct")
        .map(conv => [conv.other_user_id, conv])
    );

    // 群聊独立显示，不混入一对一好友映射
    conversations
      .filter(conv => conv.type === "group")
      .forEach(conv => {
        const el = document.createElement("div");
        el.className = "contact group-contact" +
          (conv.id === activeConversation ? " active" : "");

        const top = document.createElement("div");
        top.className = "contact-top";

        const name = document.createElement("b");
        name.className = "contact-name";
        name.textContent = "群聊 · " + (conv.group_name || "未命名群聊");

        const unread = Number(conv.unread_count || 0);
        if (unread > 0) {
          const badge = document.createElement("span");
          badge.className = "unread-badge";
          badge.textContent = unread > 99 ? "99+" : String(unread);
          name.appendChild(badge);
        }

        const time = document.createElement("span");
        time.className = "contact-time";
        time.textContent = formatConversationTime(conv.last_at);
        top.append(name, time);

        const bottom = document.createElement("div");
        bottom.className = "contact-bottom";

        const preview = document.createElement("span");
        preview.className = "contact-preview";
        preview.textContent = formatConversationPreview(conv);

        const count = document.createElement("span");
        count.className = "group-member-count";
        count.textContent = (Number(conv.member_count) || 1) + "人";

        bottom.append(preview, count);
        el.append(top, bottom);

        el.onclick = () => openGroup(conv);
        list.append(el);
      });

    const sortedContacts = [...contacts].sort((a, b) => {
      const ca = conversationMap.get(a.id);
      const cb = conversationMap.get(b.id);
      return (cb?.last_at || "").localeCompare(ca?.last_at || "");
    });

    sortedContacts.forEach(contact => {
      const conv = conversationMap.get(contact.id);
      const unread = Number(conv?.unread_count || 0);

      const el = document.createElement("div");
      el.className = "contact" +
        (conv && conv.id === activeConversation ? " active" : "");
      el.dataset.contactId = String(contact.id);

      const top = document.createElement("div");
      top.className = "contact-top";

      const avatarInitial = (contact.display_name || contact.username || "?").slice(0, 1);
      const avatarUrl = contact.avatar_url || "";
      const existingAvatar = existingAvatars.get(String(contact.id));

      // 头像地址未变化时，直接复用原节点和图片，不重新加载
      let avatar;
      if (existingAvatar && existingAvatar.dataset.avatarUrl === avatarUrl) {
        avatar = existingAvatar;
        if (!avatarUrl) avatar.textContent = avatarInitial;
      } else {
        avatar = document.createElement("div");
        avatar.className = "contact-avatar";
        avatar.dataset.avatarUrl = avatarUrl;
        avatar.textContent = avatarInitial;

        if (avatarUrl) {
          const img = document.createElement("img");
          img.src = "/api/users/" + encodeURIComponent(contact.id) + "/avatar?t=" + Date.now();
          img.alt = "";
          img.onload = () => {
            avatar.textContent = "";
            avatar.appendChild(img);
          };
          img.onerror = () => {
            img.remove();
            avatar.textContent = avatarInitial;
          };
          avatar.appendChild(img);
        }
      }

      const name = document.createElement("b");
      name.className = "contact-name";
      name.textContent = contact.display_name || contact.username;

      if (unread > 0) {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = unread > 99 ? "99+" : String(unread);
        name.appendChild(badge);
      }

      const time = document.createElement("span");
      time.className = "contact-time";
      time.textContent = formatConversationTime(conv?.last_at);

      top.append(avatar, name, time);

      const bottom = document.createElement("div");
      bottom.className = "contact-bottom";

      const preview = document.createElement("span");
      preview.className = "contact-preview";
      preview.textContent = formatConversationPreview(conv);

      bottom.appendChild(preview);
      const presence = document.createElement("div");
      presence.className = "contact-presence";

      const dot = document.createElement("span");
      dot.className = "presence-dot" +
        (Number(contact.is_online) === 1 ? " online" : "");

      const presenceText = document.createElement("span");
      presenceText.textContent = Number(contact.is_online) === 1
        ? "在线"
        : formatLastSeen(contact.last_seen_at);

      presence.append(dot, presenceText);
      const showFriendProfile = () => {
        event.stopPropagation();

        const overlay = document.createElement("div");
        overlay.className = "friend-profile-overlay";

        const dialog = document.createElement("div");
        dialog.className = "friend-profile-dialog";

        const heading = document.createElement("div");
        heading.className = "friend-profile-heading";
        heading.textContent = "\u597d\u53cb\u8d44\u6599";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "friend-profile-close";
        closeButton.textContent = "\u00d7";

        const profileAvatar = document.createElement("img");
        profileAvatar.className = "friend-profile-avatar";
        profileAvatar.alt = "好友头像";
        profileAvatar.src = contact.avatar_url
          ? "/api/users/" + encodeURIComponent(contact.id) + "/avatar?t=" + Date.now()
          : "";
        if (!contact.avatar_url) profileAvatar.hidden = true;
        profileAvatar.onerror = () => { profileAvatar.hidden = true; };

        const nameLine = document.createElement("div");
        nameLine.className = "friend-profile-name";
        nameLine.textContent = contact.display_name || contact.username || "";

        const usernameLine = document.createElement("div");
        usernameLine.className = "friend-profile-field";
        usernameLine.textContent = "\u7528\u6237\u540d\uff1a" + (contact.username || "");

        const statusLine = document.createElement("div");
        statusLine.className = "friend-profile-field";
        statusLine.textContent = "\u72b6\u6001\uff1a" +
          (Number(contact.is_online) === 1
            ? "\u5728\u7ebf"
            : formatLastSeen(contact.last_seen_at));

        const footer = document.createElement("div");
        footer.className = "friend-profile-footer";

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "friend-profile-delete";
        removeButton.textContent = "\u5220\u9664\u597d\u53cb";

        const closeProfile = () => overlay.remove();

        closeButton.onclick = closeProfile;
        overlay.addEventListener("click", event => {
          if (event.target === overlay) closeProfile();
        });

        removeButton.onclick = async () => {
          const friendName = contact.display_name || contact.username;
          if (!confirm(
            "\u786e\u5b9a\u5220\u9664\u597d\u53cb\u201c" + friendName +
            "\u201d\u5417\uff1f\n\u5220\u9664\u540e\u53cc\u65b9\u597d\u53cb\u5173\u7cfb\u89e3\u9664\uff0c\u4f46\u539f\u804a\u5929\u8bb0\u5f55\u4f1a\u4fdd\u7559\u3002"
          )) return;

          removeButton.disabled = true;
          removeButton.textContent = "\u6b63\u5728\u5220\u9664...";
          try {
            await api("/api/contacts/" + encodeURIComponent(contact.id), {
              method: "DELETE"
            });

            const directConversation = conv && activeConversation === conv.id;
            if (directConversation) {
              conversationOpenSequence++;
              if (messageRefreshTimer) clearInterval(messageRefreshTimer);
              messageRefreshTimer = null;

              if (socket) {
                try { socket.close(); } catch {}
                socket = null;
              }

              if (typeof clearRemoteTyping === "function") clearRemoteTyping();

              activeConversation = null;
              activeConversationType = null;
              setMobileChatView(false);
              $("#messages").innerHTML = "";
              $("#convTitle").textContent = "\u9009\u62e9\u8054\u7cfb\u4eba\u5f00\u59cb\u804a\u5929";
              $("#clearChatBtn").disabled = true;
              $("#messageInput").disabled = true;
              $("#sendButton").disabled = true;
            }

            closeProfile();
            await loadContacts();
          } catch (error) {
            alert(error.message || "\u5220\u9664\u597d\u53cb\u5931\u8d25");
            removeButton.disabled = false;
            removeButton.textContent = "\u5220\u9664\u597d\u53cb";
          }
        };

        heading.appendChild(closeButton);
        footer.appendChild(removeButton);
        dialog.append(heading, profileAvatar, nameLine, usernameLine, statusLine, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
      };
      contact.showProfile = showFriendProfile;

      el.append(top, bottom, presence);
      el.onclick = () => openDirect(contact);
      list.append(el);
    });  } finally {
    contactsLoading = false;
  }
}
function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const pad = n => String(n).padStart(2, "0");

  if (date.toDateString() === now.toDateString()) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  return pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}
function formatLastSeen(value) {
  if (!value) return "从未在线";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "离线";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚在线";
  if (seconds < 3600) return Math.floor(seconds / 60) + "分钟前在线";

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return "今天 " +
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0");
  }

  return String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0") + " " +
    String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0");
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const addFriendModal = $("#addFriendModal");
const addFriendForm = $("#addFriendForm");
const addFriendInput = $("#addFriendUsername");
const addFriendError = $("#addFriendError");

function closeAddFriendModal() {
  addFriendModal.hidden = true;
  addFriendForm.reset();
  addFriendError.textContent = "";
}

$("#newContact").onclick = () => {
  addFriendModal.hidden = false;
  addFriendError.textContent = "";
  requestAnimationFrame(() => addFriendInput.focus());
};

$("#closeAddFriend").onclick = closeAddFriendModal;
$("#cancelAddFriend").onclick = closeAddFriendModal;

addFriendModal.addEventListener("click", event => {
  if (event.target === addFriendModal) closeAddFriendModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !addFriendModal.hidden) {
    closeAddFriendModal();
  }
});

addFriendForm.onsubmit = async event => {
  event.preventDefault();
  const username = addFriendInput.value.trim();
  if (!username) {
    addFriendError.textContent = "请输入对方用户名";
    addFriendInput.focus();
    return;
  }

  const submit = $("#submitAddFriend");
  submit.disabled = true;
  addFriendError.textContent = "";

  try {
    const result = await api("/api/contacts/request", {
      method: "POST",
      body: JSON.stringify({ username })
    });
    closeAddFriendModal();
    await loadContacts();
    alert(result.message || "好友申请已发送");
  } catch (error) {
    addFriendError.textContent = error.message || "发送好友申请失败";
  } finally {
    submit.disabled = false;
  }
};

function setMobileChatView(show) {
  const chat = document.getElementById("chat");
  if (!chat) return;
  chat.classList.toggle("mobile-chat-view", Boolean(show));
}

const mobileBackButton = document.getElementById("mobileBackBtn");
if (mobileBackButton) {
  mobileBackButton.addEventListener("click", () => {
    setMobileChatView(false);
    const input = document.getElementById("messageInput");
    if (input) input.blur();
  });
}
let messageLoadSequence = 0;

const conversationDrafts = new Map();

async function openDirect(contact) {

  if (activeConversation) conversationDrafts.set(String(activeConversation), $("#messageInput").value);
  // 切换聊天对象时，清空上一个聊天未发送的文字
  $("#messageInput").value = "";
  $("#messageInput").blur();
  const openToken = ++conversationOpenSequence;
  messageLoadSequence++;

  if (socket) {
    try { socket.close(1000, "switch_conversation"); } catch {}
    socket = null;
  }

  if (messageRefreshTimer) clearInterval(messageRefreshTimer);
  messageRefreshTimer = null;

  activeConversation = null;
  activeConversationType = null;
  $("#messages").innerHTML = "";
  $("#messageInput").disabled = true;
  $("#sendButton").disabled = true;
  $("#convTitle").textContent = "正在加载聊天记录…";

  try {
    const d = await api("/api/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ username: contact.username })
    });

    if (openToken !== conversationOpenSequence) return;

    const conversationId = d.id;
    activeConversation = conversationId;
    activeConversationType = "direct";
  connectSocket();
    renderCallActions();
  $("#messageInput").value = conversationDrafts.get(String(activeConversation)) || "";

    $("#convTitle").textContent = contact.display_name || contact.username;
    $("#convTitle").onclick = () => contact.showProfile?.();
    $("#clearChatBtn").disabled = false;
    $("#messageInput").disabled = false;
    $("#sendButton").disabled = false;

    await loadMessages();
    if (openToken !== conversationOpenSequence) return;

    // 先显示手机聊天区域，再等待浏览器完成布局
    setMobileChatView(true);
    await new Promise(resolve =>
      requestAnimationFrame(() =>
        requestAnimationFrame(resolve)
      )
    );

    if (openToken !== conversationOpenSequence) return;

    const messagesContainer = $("#messages");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    await api(`/api/conversations/${conversationId}/read`, {
      method: "POST"
    });
    if (openToken !== conversationOpenSequence) return;

    await loadContacts();
    if (openToken !== conversationOpenSequence) return;

    // PERF-20261123: 打开会话后的消息兜底轮询 4s → 30s。
    // 新消息由 WebSocket 实时推送并即时渲染（见 connectSocket 的
    // onmessage），此轮询只作为 WS 断线时的兜底，30s 足够，
    // 同时避免每 4s 全量重拉 100 条消息与重 SQL。
    messageRefreshTimer = setInterval(() => {
      if (
        !document.hidden &&
        activeConversation === conversationId
      ) {
        loadMessages().catch(() => {});
      }
    }, 30000);

    setMobileChatView(true);
  } catch (e) {
    if (openToken === conversationOpenSequence) {
      alert(e.message || "打开聊天失败");
    }
  }
}

async function openGroup(conv) {

  if (activeConversation) conversationDrafts.set(String(activeConversation), $("#messageInput").value);
  // 切换聊天对象时，清空上一个聊天未发送的文字
  $("#messageInput").value = "";
  $("#messageInput").blur();
  const openToken = ++conversationOpenSequence;
  messageLoadSequence++;
  const conversationId = conv.id;

  if (socket) {
    try { socket.close(1000, "switch_conversation"); } catch {}
    socket = null;
  }

  if (messageRefreshTimer) clearInterval(messageRefreshTimer);
  messageRefreshTimer = null;

  activeConversation = conversationId;
  activeConversationType = "group";
  connectSocket();
  renderCallActions();
  $("#messageInput").value = conversationDrafts.get(String(activeConversation)) || "";
  $("#messages").innerHTML = "";

  const groupName = conv.group_name || conv.name || "群聊";
  $("#convTitle").onclick = null;
  const memberCount = Number(conv.member_count) || 1;

  $("#convTitle").textContent =
    groupName + "（" + memberCount + "人）";

  $("#clearChatBtn").disabled = false;
  $("#messageInput").disabled = false;
  $("#sendButton").disabled = false;

  try {
    await loadMessages();
    if (openToken !== conversationOpenSequence) return;

    // 先显示手机聊天区域，再等待浏览器完成布局
    setMobileChatView(true);
    await new Promise(resolve =>
      requestAnimationFrame(() =>
        requestAnimationFrame(resolve)
      )
    );

    if (openToken !== conversationOpenSequence) return;

    const messagesContainer = $("#messages");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    await api(`/api/conversations/${conversationId}/read`, {
      method: "POST"
    });
    if (openToken !== conversationOpenSequence) return;

    await loadContacts();
    if (openToken !== conversationOpenSequence) return;

    // PERF-20261123: 打开会话后的消息兜底轮询 4s → 30s。
    // 新消息由 WebSocket 实时推送并即时渲染（见 connectSocket 的
    // onmessage），此轮询只作为 WS 断线时的兜底，30s 足够，
    // 同时避免每 4s 全量重拉 100 条消息与重 SQL。
    messageRefreshTimer = setInterval(() => {
      if (
        !document.hidden &&
        activeConversation === conversationId
      ) {
        loadMessages().catch(() => {});
      }
    }, 30000);

    setMobileChatView(true);
  } catch (e) {
    if (openToken === conversationOpenSequence) {
      alert(e.message || "打开群聊失败");
    }
  }
}

async function loadMessages() {
  if (!activeConversation) return;

  const conversationId = activeConversation;
  const loadToken = ++messageLoadSequence;
  messagesLoading = true;

  try {
    const d = await api(`/api/conversations/${conversationId}/messages`);

    // 请求期间如果切换了聊天，不渲染旧会话的数据
    if (activeConversation !== conversationId || loadToken !== messageLoadSequence) return;

    const container = $("#messages");
    const existingIds = new Set(
      Array.from(
        container.querySelectorAll("[data-message-id]"),
        el => el.dataset.messageId
      )
    );

    // 只补充尚未显示的消息
    for (const message of d.messages) {
      const id = message.id ? String(message.id) : "";

      if (id && existingIds.has(id)) continue;

      if (me && message.sender_id === me.id) clearPendingMessage(message.body);
      renderMessage(message);

      if (id) existingIds.add(id);
    }
  } finally {
    if (loadToken === messageLoadSequence) messagesLoading = false;
  }
}

function showImagePreview(src) {
  let overlay = document.querySelector("#imagePreviewOverlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "imagePreviewOverlay";
    overlay.className = "image-preview-overlay";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "image-preview-close";
    close.textContent = "关闭";

    const image = document.createElement("img");
    image.alt = "图片预览";

    overlay.append(close, image);
    document.body.appendChild(overlay);

    close.addEventListener("click", () => {
      overlay.hidden = true;
      image.removeAttribute("src");
    });

    overlay.addEventListener("click", event => {
      if (event.target === overlay) {
        overlay.hidden = true;
        image.removeAttribute("src");
      }
    });
  }

  const previewImage = overlay.querySelector("img");
  previewImage.src = src;
  overlay.hidden = false;
}
async function forwardTextMessage(message) {
  const sourceMessageId = String(message.id || "");
  const sourceConversationId = activeConversation;
  if (!sourceMessageId || !sourceConversationId) return;

  const type = message.message_type || "text";
  const typeNames = {
    text: "\u6587\u5b57",
    image: "\u56fe\u7247",
    file: "\u6587\u4ef6",
    voice: "\u8bed\u97f3"
  };
  const typeName = typeNames[type];

  if (!typeName) {
    alert("\u8fd9\u79cd\u6d88\u606f\u7c7b\u578b\u4e0d\u652f\u6301\u8f6c\u53d1");
    return;
  }

  let overlay;

  try {
    const data = await api("/api/conversations");
    const conversations = (data.conversations || [])
      .filter(item => item.id && item.id !== sourceConversationId);

    if (!conversations.length) {
      alert("\u6ca1\u6709\u53ef\u4ee5\u8f6c\u53d1\u7684\u8054\u7cfb\u4eba\u6216\u7fa4\u804a");
      return;
    }

    const getName = item => {
      if (item.type === "group") {
        return item.group_name || item.name || "\u672a\u547d\u540d\u7fa4\u804a";
      }
      return item.other_display_name ||
        item.other_username ||
        item.name ||
        "\u672a\u547d\u540d\u8054\u7cfb\u4eba";
    };

    const getKind = item => item.type === "group" ? "\u7fa4\u804a" : "\u79c1\u804a";

    overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      background: "rgba(0,0,0,.48)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px"
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "min(420px, 100%)",
      maxHeight: "min(680px, 85vh)",
      background: "var(--panel-bg, #fff)",
      color: "var(--text-color, #222)",
      borderRadius: "16px",
      boxShadow: "0 12px 40px rgba(0,0,0,.25)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "18px 20px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: "17px",
      fontWeight: "600"
    });
    header.textContent = "\u9009\u62e9\u8f6c\u53d1\u5bf9\u8c61";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "\u00d7";
    Object.assign(closeButton.style, {
      border: "0",
      background: "transparent",
      fontSize: "26px",
      cursor: "pointer",
      padding: "0 5px",
      color: "inherit"
    });
    header.appendChild(closeButton);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "\u641c\u7d22\u8054\u7cfb\u4eba\u6216\u7fa4\u804a";
    Object.assign(search.style, {
      margin: "4px 16px 12px",
      padding: "11px 13px",
      border: "1px solid #ddd",
      borderRadius: "9px",
      fontSize: "14px",
      outline: "none",
      background: "transparent",
      color: "inherit"
    });

    const list = document.createElement("div");
    Object.assign(list.style, {
      overflowY: "auto",
      minHeight: "100px",
      flex: "1",
      padding: "0 12px"
    });

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      padding: "12px 16px",
      borderTop: "1px solid rgba(128,128,128,.2)",
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px"
    });

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "\u53d6\u6d88";

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "\u786e\u8ba4\u8f6c\u53d1";
    confirmButton.disabled = true;

    [cancelButton, confirmButton].forEach(button => {
      Object.assign(button.style, {
        padding: "10px 18px",
        borderRadius: "9px",
        border: "1px solid #ddd",
        cursor: "pointer",
        fontSize: "14px"
      });
    });

    confirmButton.style.background = "#1677ff";
    confirmButton.style.color = "#fff";
    confirmButton.style.borderColor = "#1677ff";
    confirmButton.style.opacity = ".5";

    footer.append(cancelButton, confirmButton);
    panel.append(header, search, list, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let selected = null;

    const closePicker = () => {
      if (overlay && overlay.parentNode) overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };

    const onKeyDown = event => {
      if (event.key === "Escape") {
        closePicker();
        resolveSelection(null);
      }
    };

    let resolveSelection;
    const selectionPromise = new Promise(resolve => {
      resolveSelection = resolve;
    });

    const choose = item => {
      selected = item;
      renderList();
      confirmButton.disabled = false;
      confirmButton.style.opacity = "1";
    };

    const renderList = () => {
      list.replaceChildren();

      const keyword = search.value.trim().toLocaleLowerCase();
      const filtered = conversations.filter(item => {
        const name = getName(item).toLocaleLowerCase();
        const username = String(item.other_username || "").toLocaleLowerCase();
        return name.includes(keyword) || username.includes(keyword);
      });

      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.textContent = "\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u5bf9\u8c61";
        empty.style.cssText = "padding:28px 10px;text-align:center;opacity:.6";
        list.appendChild(empty);
        return;
      }

      filtered.forEach(item => {
        const row = document.createElement("button");
        row.type = "button";
        const active = selected && selected.id === item.id;

        Object.assign(row.style, {
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "11px 10px",
          marginBottom: "5px",
          border: active ? "1px solid #1677ff" : "1px solid transparent",
          borderRadius: "10px",
          background: active ? "rgba(22,119,255,.10)" : "transparent",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer"
        });

        const avatar = document.createElement("div");
        avatar.textContent = item.type === "group" ? "\u7fa4" : getName(item).slice(0, 1);
        Object.assign(avatar.style, {
          width: "42px",
          height: "42px",
          flexShrink: "0",
          borderRadius: item.type === "group" ? "12px" : "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(120,140,160,.18)",
          fontSize: "17px",
          fontWeight: "600",
          overflow: "hidden"
        });

        if (item.type !== "group" && item.avatar_url) {
          const avatarImage = document.createElement("img");
          avatarImage.src = "/api/users/" + encodeURIComponent(item.id) + "/avatar";
          avatarImage.alt = "";
          avatarImage.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
          avatarImage.onerror = () => avatarImage.remove();
          avatar.textContent = "";
          avatar.appendChild(avatarImage);
        }

        const info = document.createElement("div");
        info.style.cssText = "min-width:0;flex:1";

        const name = document.createElement("div");
        name.textContent = getName(item);
        name.style.cssText = "font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

        const kind = document.createElement("div");
        kind.textContent = getKind(item);
        kind.style.cssText = "font-size:12px;opacity:.6;margin-top:4px";

        info.append(name, kind);

        const mark = document.createElement("div");
        mark.textContent = active ? "\u2713" : "";
        mark.style.cssText = "font-size:19px;color:#1677ff;padding:0 5px";

        row.append(avatar, info, mark);
        row.addEventListener("click", () => choose(item));
        list.appendChild(row);
      });
    };

    search.addEventListener("input", renderList);
    closeButton.addEventListener("click", () => {
      closePicker();
      resolveSelection(null);
    });
    cancelButton.addEventListener("click", () => {
      closePicker();
      resolveSelection(null);
    });
    overlay.addEventListener("click", event => {
      if (event.target === overlay) {
        closePicker();
        resolveSelection(null);
      }
    });
    confirmButton.addEventListener("click", () => {
      if (!selected) return;
      const target = selected;
      closePicker();
      resolveSelection(target);
    });

    document.addEventListener("keydown", onKeyDown);
    renderList();
    search.focus();

    const target = await selectionPromise;
    if (!target) return;

    confirmButton.disabled = true;
    await api("/api/conversations/" + encodeURIComponent(target.id) + "/forward", {
      method: "POST",
      body: JSON.stringify({ messageId: sourceMessageId })
    });

    alert("\u5df2\u8f6c\u53d1\u5230\uff1a" + getName(target));
  } catch (error) {
    if (overlay && overlay.parentNode) overlay.remove();
    alert("\u8f6c\u53d1\u5931\u8d25\uff1a" + (error.message || "\u8bf7\u7a0d\u540e\u91cd\u8bd5"));
  }
}


// CLOUDCHAT_RED_ENVELOPE_UI_V1
function redMoney(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

async function showRedEnvelope(envelopeId) {
  if (!envelopeId) return;

  let data;
  try {
    data = await api("/api/red-envelopes/" + encodeURIComponent(envelopeId));
  } catch (error) {
    alert(error.message || "红包读取失败");
    return;
  }

  const envelope = data.envelope;
  if (!envelope) return;

  const overlay = document.createElement("div");
  overlay.className = "red-envelope-overlay";

  const dialog = document.createElement("div");
  dialog.className = "red-envelope-dialog";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "red-envelope-close";
  close.textContent = "×";
  close.onclick = () => overlay.remove();

  const icon = document.createElement("div");
  icon.className = "red-envelope-icon";
  icon.textContent = "🧧";

  const greeting = document.createElement("div");
  greeting.className = "red-envelope-greeting";
  greeting.textContent = envelope.greeting || "恭喜发财，大吉大利";

  const sender = document.createElement("div");
  sender.className = "red-envelope-sender";
  sender.textContent = (envelope.sender_name || "好友") + " 发出的红包";

  const amount = document.createElement("div");
  amount.className = "red-envelope-detail-amount";
  amount.textContent = data.myClaimCents != null
    ? "¥" + redMoney(data.myClaimCents)
    : "¥" + redMoney(envelope.total_cents);

  const amountHint = document.createElement("div");
  amountHint.className = "red-envelope-hint";
  amountHint.textContent = data.myClaimCents != null
    ? "你已经领取了这个红包"
    : "共 " + envelope.total_count + " 个红包";

  const claimButton = document.createElement("button");
  claimButton.type = "button";
  claimButton.className = "red-envelope-claim";
  claimButton.textContent = "開";
  claimButton.disabled =
    data.myClaimCents != null ||
    envelope.status !== "open" ||
    Number(envelope.remaining_count) <= 0 ||
    envelope.sender_id === me.id;

  claimButton.onclick = async () => {
    claimButton.disabled = true;
    claimButton.textContent = "领取中…";
    try {
      await api("/api/red-envelopes/" + encodeURIComponent(envelope.id) + "/claim", {
        method: "POST",
        body: JSON.stringify({})
      });
      overlay.remove();
      await showRedEnvelope(envelope.id);
      loadMessages().catch(() => {});
    } catch (error) {
      alert(error.message || "领取失败");
      overlay.remove();
      showRedEnvelope(envelope.id);
    }
  };

  const status = document.createElement("div");
  status.className = "red-envelope-hint";
  status.textContent = envelope.status === "completed"
    ? "红包已领完"
    : envelope.status === "expired"
      ? "红包已过期"
      : "剩余 " + envelope.remaining_count + " 个";

  const claimTitle = document.createElement("div");
  claimTitle.className = "red-envelope-claim-title";
  claimTitle.textContent = "领取记录";

  const claimList = document.createElement("div");
  claimList.className = "red-envelope-claim-list";

  const claims = Array.isArray(data.claims) ? data.claims : [];
  if (!claims.length) {
    const empty = document.createElement("div");
    empty.className = "red-envelope-hint";
    empty.textContent = "还没有人领取";
    claimList.appendChild(empty);
  } else {
    claims.forEach(item => {
      const row = document.createElement("div");
      row.className = "red-envelope-claim-row";

      const name = document.createElement("span");
      name.textContent = item.display_name || "用户";

      const value = document.createElement("strong");
      value.textContent = "¥" + redMoney(item.amount_cents);

      row.append(name, value);
      claimList.appendChild(row);
    });
  }

  dialog.append(
    close, icon, greeting, sender, amount, amountHint,
    claimButton, status, claimTitle, claimList
  );
  overlay.appendChild(dialog);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function openRedEnvelopeComposer() {
  if (!activeConversation) {
    alert("请先打开一个聊天");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "red-envelope-overlay";

  const dialog = document.createElement("div");
  dialog.className = "red-envelope-dialog red-envelope-send-dialog";

  const heading = document.createElement("div");
  heading.className = "red-envelope-send-heading";
  heading.textContent = "发红包";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "red-envelope-close";
  close.textContent = "×";
  close.onclick = () => overlay.remove();

  const walletInfo = document.createElement("div");
  walletInfo.className = "red-envelope-wallet-info";
  walletInfo.textContent = "正在读取虚拟余额…";

  api("/api/me/red-wallet").then(wallet => {
    walletInfo.textContent = "可用虚拟余额：¥" + redMoney(wallet.balanceCents);
  }).catch(error => {
    walletInfo.textContent = error.message || "余额读取失败";
  });

  const form = document.createElement("form");
  form.className = "red-envelope-send-form";

  function addField(labelText, input) {
    const label = document.createElement("label");
    label.className = "red-envelope-field";
    const caption = document.createElement("span");
    caption.textContent = labelText;
    label.append(caption, input);
    form.appendChild(label);
  }

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.min = "0.01";
  amountInput.max = "2000";
  amountInput.step = "0.01";
  amountInput.value = "1.00";
  amountInput.required = true;
  addField("红包总金额（元）", amountInput);

  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "100";
  countInput.step = "1";
  countInput.value = activeConversationType === "group" ? "5" : "1";
  countInput.required = true;
  addField("红包个数", countInput);

  const typeSelect = document.createElement("select");
  [
    { value: "random", label: "拼手气红包" },
    { value: "fixed", label: "普通红包（金额均分）" }
  ].forEach(option => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    typeSelect.appendChild(item);
  });
  addField("红包类型", typeSelect);

  const greetingInput = document.createElement("input");
  greetingInput.type = "text";
  greetingInput.maxLength = 40;
  greetingInput.value = "恭喜发财，大吉大利";
  addField("祝福语", greetingInput);

  const error = document.createElement("div");
  error.className = "red-envelope-form-error";
  error.setAttribute("role", "alert");

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "red-envelope-submit";
  submit.textContent = "塞钱进红包";

  form.append(error, submit);
  dialog.append(heading, close, walletInfo, form);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  form.onsubmit = async event => {
    event.preventDefault();
    error.textContent = "";

    const amount = Math.round(Number(amountInput.value) * 100);
    const count = Number(countInput.value);

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 200000) {
      error.textContent = "金额必须在 0.01 至 2000 元之间";
      return;
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      error.textContent = "红包个数必须在 1 至 100 之间";
      return;
    }
    if (activeConversationType !== "group" && count !== 1) {
      error.textContent = "私聊红包只能设置 1 个";
      return;
    }

    submit.disabled = true;
    submit.textContent = "正在发送…";

    try {
      await api("/api/conversations/" + encodeURIComponent(activeConversation) + "/red-envelopes", {
        method: "POST",
        body: JSON.stringify({
          totalCents: amount,
          totalCount: count,
          envelopeType: typeSelect.value,
          greeting: greetingInput.value.trim()
        })
      });

      overlay.remove();
      await loadMessages();
      loadContacts().catch(() => {});
    } catch (err) {
      error.textContent = err.message || "红包发送失败";
      submit.disabled = false;
      submit.textContent = "塞钱进红包";
    }
  };
}


/* CLOUDCHAT_CALCULATOR_V2 */
function openChatCalculator() {
  const existing = document.getElementById("ccCalculatorOverlay");
  if (existing) {
    existing.hidden = false;
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "ccCalculatorOverlay";
  overlay.className = "cc-calculator-overlay";

  const panel = document.createElement("section");
  panel.className = "cc-calculator";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "聊天计算器");

  const header = document.createElement("div");
  header.className = "cc-calculator-header";

  const heading = document.createElement("strong");
  heading.textContent = "计算器";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "cc-calculator-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "关闭");

  header.append(heading, closeButton);

  const display = document.createElement("input");
  display.className = "cc-calculator-display";
  display.type = "text";
  display.readOnly = true;
  display.value = "0";
  display.setAttribute("aria-label", "计算表达式");

  const resultLine = document.createElement("div");
  resultLine.className = "cc-calculator-result";
  resultLine.textContent = "结果显示在这里";

  const keys = document.createElement("div");
  keys.className = "cc-calculator-keys";

  const keyLabels = [
    "C", "⌫", "(", ")", 
    "7", "8", "9", "÷",
    "4", "5", "6", "×",
    "1", "2", "3", "−",
    "%", "0", ".", "+",
    "发送", "="
  ];

  let expression = "";
  let calculated = false;
  let currentResult = null;
  /* CLOUDCHAT_CALC_SEND_FULL_EXPRESSION_V1 */
  let calculationRecord = '';

  function updateDisplay() {
    display.value = expression || "0";
  }

  function formatResult(value) {
    if (!Number.isFinite(value)) throw new Error("计算结果无效");
    const rounded = Number.parseFloat(value.toPrecision(12));
    return String(rounded);
  }

  function evaluateExpression(source) {
    const tokens = [];
    const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([+\-*/()%()]))/y;
    let position = 0;

    while (position < source.length) {
      pattern.lastIndex = position;
      const match = pattern.exec(source);
      if (!match) throw new Error("表达式格式不正确");
      tokens.push(match[1] !== undefined ? Number(match[1]) : match[2]);
      position = pattern.lastIndex;
    }

    if (!tokens.length) throw new Error("请输入算式");

    let index = 0;

    function primary() {
      const token = tokens[index];

      if (token === "+" || token === "-") {
        index++;
        const value = primary();
        return token === "-" ? -value : value;
      }

      if (token === "(") {
        index++;
        const value = addSub();
        if (tokens[index] !== ")") throw new Error("括号不匹配");
        index++;
        return value;
      }

      if (typeof token === "number") {
        index++;
        return token;
      }

      throw new Error("表达式格式不正确");
    }

    function postfix() {
      let value = primary();
      while (tokens[index] === "%") {
        index++;
        value = value / 100;
      }
      return value;
    }

    function multiplyDivide() {
      let value = postfix();
      while (tokens[index] === "*" || tokens[index] === "/") {
        const operator = tokens[index++];
        const right = postfix();
        if (operator === "/" && right === 0) throw new Error("不能除以零");
        value = operator === "*" ? value * right : value / right;
      }
      return value;
    }

    function addSub() {
      let value = multiplyDivide();
      while (tokens[index] === "+" || tokens[index] === "-") {
        const operator = tokens[index++];
        const right = multiplyDivide();
        value = operator === "+" ? value + right : value - right;
      }
      return value;
    }

    const result = addSub();
    if (index !== tokens.length) throw new Error("表达式格式不正确");
    return result;
  }

  function calculate() {
    try {
      const originalExpression = expression;
      const value = evaluateExpression(expression);
      currentResult = formatResult(value);
      calculationRecord = originalExpression
        .replace(/\*/g, ' × ')
        .replace(/\//g, ' ÷ ')
        .replace(/-/g, ' − ')
        .replace(/\+/g, ' + ')
        .replace(/\s+/g, ' ')
        .trim() + ' = ' + currentResult;
      resultLine.textContent = "= " + currentResult;
      expression = currentResult;
      calculated = true;
      updateDisplay();
      return true;
    } catch (error) {
      currentResult = null;
      resultLine.textContent = error.message || "计算失败";
      return false;
    }
  }

  function appendKey(key) {
    if (key === "C") {
      expression = "";
      currentResult = null;
      calculated = false;
      resultLine.textContent = "结果显示在这里";
      updateDisplay();
      return;
    }

    if (key === "⌫") {
      if (calculated) {
        expression = "";
        calculated = false;
      } else {
        expression = expression.slice(0, -1);
      }
      currentResult = null;
      resultLine.textContent = "结果显示在这里";
      updateDisplay();
      return;
    }

    if (key === "=") {
      calculate();
      return;
    }

    if (key === "发送") {
      if (currentResult === null && !calculate()) return;

      if (typeof socket === "undefined" ||
          !socket ||
          socket.readyState !== WebSocket.OPEN) {
        resultLine.textContent = "聊天连接尚未建立，请稍后重试";
        return;
      }

      if (typeof activeConversation === "undefined" || !activeConversation) {
        resultLine.textContent = "请先打开一个聊天";
        return;
      }

      if (typeof stopTyping === "function") stopTyping();

      socket.send(JSON.stringify({ body: String(calculationRecord || currentResult) }));

      if (typeof conversationDrafts !== "undefined" && conversationDrafts) {
        conversationDrafts.delete(String(activeConversation));
      }

      expression = "";
      currentResult = null;
      calculated = false;
      resultLine.textContent = "已发送";
      updateDisplay();
      return;
    }

    if (calculated) {
      if (/^[0-9.(]$/.test(key)) {
        expression = "";
      }
      calculated = false;
      currentResult = null;
    }

    const operators = ["+", "−", "×", "÷", "%"];
    const normalized = key === "−" ? "-" :
      key === "×" ? "*" :
      key === "÷" ? "/" : key;

    if (operators.includes(key) && !expression && key !== "−") return;

    expression += normalized;
    resultLine.textContent = "结果显示在这里";
    currentResult = null;
    updateDisplay();
  }

  keyLabels.forEach(label => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cc-calculator-key";
    if (label === "发送") button.classList.add("cc-calculator-send");
    if (label === "=") button.classList.add("cc-calculator-equals");
    if (["+", "−", "×", "÷", "%"].includes(label)) {
      button.classList.add("cc-calculator-operator");
    }
    button.textContent = label;
    button.addEventListener("click", () => appendKey(label));
    keys.appendChild(button);
  });

  function closeCalculator() {
    overlay.hidden = true;
  }

  closeButton.addEventListener("click", closeCalculator);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeCalculator();
  });

  panel.append(header, display, resultLine, keys);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function installRedEnvelopeButton() {
  const form = document.getElementById("sendForm");
  const sendButton = document.getElementById("sendButton");
  const messageInput = document.getElementById("messageInput");

  if (!form || !sendButton || !messageInput) return;

  let redButton = document.getElementById("redEnvelopeButton");
  if (!redButton) {
    redButton = document.createElement("button");
    redButton.id = "redEnvelopeButton";
    redButton.type = "button";
    redButton.className = "red-envelope-toolbar-button";
    redButton.textContent = "🧧 发红包";
    redButton.title = "发送虚拟红包";
    redButton.onclick = openRedEnvelopeComposer;
  }

  if (document.getElementById("composerToolsMenu")) return;

  const toolbar = document.createElement("div");
  toolbar.className = "composer-tools";
  toolbar.id = "composerTools";
  toolbar.setAttribute("data-cloudchat-plus-menu", "1");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "composerToolsToggle";
  toggle.className = "composer-tools-toggle";
  toggle.textContent = "+";
  toggle.title = "更多功能";
  toggle.setAttribute("aria-label", "打开更多聊天功能");
  toggle.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.id = "composerToolsMenu";
  menu.className = "composer-tools-menu";
  menu.hidden = true;
  menu.setAttribute("aria-label", "聊天工具");

  const imageButton = document.getElementById("imageButton");
  const imageInput = document.getElementById("imageFileInput");
  const fileButton = document.getElementById("fileButton");
  const fileInput = document.getElementById("fileFileInput");
  const voiceButton = document.getElementById("voiceButton");

  
const calculatorButton = document.createElement("button");
calculatorButton.type = "button";
calculatorButton.textContent = "计算器";
calculatorButton.title = "打开聊天计算器";
calculatorButton.addEventListener("click", () => {
  if (typeof closeComposerMenu === "function") closeComposerMenu();
  openChatCalculator();
});

const actions = [calculatorButton, redButton, imageButton, fileButton];

  actions.forEach(button => {
    if (!button) return;
    button.classList.add("composer-tool-action");
    menu.appendChild(button);
  });

  [imageInput, fileInput].forEach(input => {
    if (input) menu.appendChild(input);
  });

  toolbar.append(toggle, menu);
form.insertBefore(toolbar, form.firstChild);

// CLOUDCHAT_VOICE_MODE_TOGGLE_V1
const modeToggle = document.createElement("button");
modeToggle.type = "button";
modeToggle.id = "composerModeToggle";
modeToggle.className = "composer-mode-toggle";
modeToggle.textContent = "🎙";
modeToggle.title = "切换语音输入";
modeToggle.setAttribute("aria-label", "切换语音输入");
modeToggle.setAttribute("aria-pressed", "false");

form.insertBefore(modeToggle, toolbar.nextSibling);

if (voiceButton) {
  voiceButton.classList.add("composer-voice-hold");
  voiceButton.title = "按住说话，松开发送";
  form.insertBefore(voiceButton, sendButton);
  voiceButton.hidden = true;
}

function setComposerInputMode(mode) {
  const voiceMode = mode === "voice";

  messageInput.hidden = voiceMode;
  sendButton.hidden = voiceMode;

  if (voiceButton) {
    voiceButton.hidden = !voiceMode;
  }

  modeToggle.textContent = voiceMode ? "⌨" : "🎙";
  modeToggle.title = voiceMode ? "切换文字输入" : "切换语音输入";
  modeToggle.setAttribute("aria-label", modeToggle.title);
  modeToggle.setAttribute("aria-pressed", voiceMode ? "true" : "false");

  if (voiceMode) {
    messageInput.blur();
  } else if (!messageInput.disabled) {
    messageInput.focus();
  }
}

modeToggle.addEventListener("click", event => {
  event.preventDefault();
  const currentlyVoiceMode =
    modeToggle.getAttribute("aria-pressed") === "true";

  setComposerInputMode(currentlyVoiceMode ? "text" : "voice");
});

setComposerInputMode("text");

  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("active");
  }

  function openMenu() {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.classList.add("active");
  }

  toggle.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  document.addEventListener("pointerdown", event => {
    if (!toolbar.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  menu.addEventListener("click", event => {
    const action = event.target.closest("button");
    if (action) closeMenu();
  });
}

// CLOUDCHAT_COMPOSER_PLUS_MENU_V1
installRedEnvelopeButton();
function renderMessage(m, pendingBody) {
  const el = document.createElement("div");
  const mine = m.sender_id === me.id;
  const recalled = Boolean(m.recalled_at);

  el.className = "bubble" + (mine ? " mine" : "") + (recalled ? " recalled" : "");
  if (m.id) el.dataset.messageId = m.id;
  if (pendingBody) {
    el.classList.add("pending");
    el.dataset.pendingBody = pendingBody;
  }

  const messageAvatar = document.createElement("div");
  messageAvatar.className = "chat-message-avatar";
  const avatarName = mine
    ? (me.displayName || "我")
    : (m.sender_display_name || m.sender_name || "用户");
  const avatarInitial = avatarName.slice(0, 1) || "?";
  messageAvatar.textContent = avatarInitial;

  if (m.sender_id) {
    const avatarImage = document.createElement("img");
    avatarImage.alt = "";
    avatarImage.src =
      "/api/conversations/" + encodeURIComponent(activeConversation) +
      "/members/" + encodeURIComponent(m.sender_id) + "/avatar";

    avatarImage.onload = () => {
      messageAvatar.textContent = "";
      messageAvatar.appendChild(avatarImage);
    };
    avatarImage.onerror = () => {
      avatarImage.remove();
      messageAvatar.textContent = avatarInitial;
    };
    messageAvatar.appendChild(avatarImage);
  }

  el.appendChild(messageAvatar);

  // 群聊显示发送者姓名，私聊保持原样
  if (activeConversationType === "group") {
    const senderLabel = document.createElement("div");
    senderLabel.className = "group-sender-name";
    senderLabel.textContent = mine
      ? (me.displayName || "\u6211")
      : (m.sender_display_name || m.sender_name || "\u7fa4\u6210\u5458");
    el.appendChild(senderLabel);
  }

  const time = esc(m.created_at || "");

  if (recalled) {
    const notice = document.createElement("div");
    notice.className = "recalled-text";
    notice.textContent = mine ? "你撤回了一条消息" : "对方撤回了一条消息";
    el.appendChild(notice);
  } else {
    if (m.forwarded_from) {
      const forwardedLabel = document.createElement("div");
      forwardedLabel.className = "forwarded-label";
      forwardedLabel.textContent = "↪ 转发消息";
      forwardedLabel.style.fontSize = "12px";
      forwardedLabel.style.opacity = "0.7";
      forwardedLabel.style.marginBottom = "5px";
      el.appendChild(forwardedLabel);
    }

    if (m.message_type === "red_envelope") {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "red-envelope-card";
      const envelopeId = m.body || m.red_envelope_id || "";
      card.dataset.redEnvelopeId = envelopeId;
      card.dataset.redRemainingCents = String(m.red_remaining_cents || 0);

      const cardIcon = document.createElement("span");
      cardIcon.className = "red-envelope-card-icon";
      cardIcon.textContent = "🧧";

      const cardText = document.createElement("span");
      cardText.className = "red-envelope-card-text";

      const cardGreeting = document.createElement("strong");
      cardGreeting.textContent = m.red_greeting || "恭喜发财，大吉大利";

      const cardStatus = document.createElement("small");
      cardStatus.dataset.redStatus = "1";
      cardStatus.textContent = m.red_status === "completed"
        ? "已领完"
        : m.red_status === "expired" ? "已过期" : "领取红包";

      const cardCount = document.createElement("small");
      cardCount.dataset.redCount = "1";
      cardCount.textContent = "剩余 " + Number(m.red_remaining_count ?? m.red_total_count ?? 0) + " 个";

      cardText.append(cardGreeting, cardStatus, cardCount);
      card.append(cardIcon, cardText);
      card.addEventListener("click", () => showRedEnvelope(envelopeId));
      el.appendChild(card);
    } else if (m.message_type === "image") {
      const image = document.createElement("img");
      const imageUrl = `/api/conversations/${encodeURIComponent(activeConversation)}/images/${encodeURIComponent(m.id)}`;
      image.className = "chat-image";
      image.alt = m.image_file_name || m.file_name || "聊天图片";
      image.loading = "lazy";
      image.src = imageUrl;
      image.addEventListener("click", () => showImagePreview(imageUrl));
      el.appendChild(image);
    } else if (m.message_type === "voice") {
      const voiceCard = document.createElement("div");
      voiceCard.className = "chat-voice";

      const voiceLabel = document.createElement("div");
      voiceLabel.className = "chat-voice-label";
      voiceLabel.textContent = "\uD83C\uDF99\uFE0F \u8BED\u97F3\u6D88\u606F";

      const audio = document.createElement("audio");
      audio.className = "chat-voice-player";
      audio.controls = true;
      audio.preload = "metadata";

      const durationLabel = document.createElement("small");
      durationLabel.className = "chat-file-size chat-voice-duration";

      const savedDuration = Number(m.duration_ms || 0);
      durationLabel.textContent = savedDuration > 0
        ? Math.ceil(savedDuration / 1000) + "\u79D2"
        : "\u8BFB\u53D6\u65F6\u957F\u2026";

      const updateVoiceDuration = () => {
        if (savedDuration > 0) return;
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          durationLabel.textContent = Math.ceil(audio.duration) + "\u79D2";
        }
      };

      audio.addEventListener("loadedmetadata", updateVoiceDuration);
      audio.addEventListener("durationchange", updateVoiceDuration);
      audio.addEventListener("timeupdate", updateVoiceDuration);
      audio.addEventListener("error", () => {
        if (savedDuration <= 0) {
          durationLabel.textContent = "\u65F6\u957F\u8BFB\u53D6\u5931\u8D25";
        }
      });

      audio.src = `/api/conversations/${encodeURIComponent(activeConversation)}/voices/${encodeURIComponent(m.id)}`;

      const voiceSize = Number(m.image_file_size || m.file_size || 0);
      const sizeLabel = document.createElement("small");
      sizeLabel.className = "chat-file-size";
      sizeLabel.textContent = voiceSize > 0
        ? (voiceSize / 1024).toFixed(1) + " KB"
        : "\u8BED\u97F3";

      voiceCard.append(voiceLabel, audio, durationLabel, sizeLabel);
      el.appendChild(voiceCard);} else if (m.message_type === "file") {
      const fileCard = document.createElement("div");
      fileCard.className = "chat-file";

      const fileLink = document.createElement("a");
      fileLink.className = "chat-file-link";
      fileLink.href = `/api/conversations/${encodeURIComponent(activeConversation)}/files/${encodeURIComponent(m.id)}`;
      fileLink.textContent = "📎 " + (m.image_file_name || m.file_name || m.body || "下载文件");

      const fileSize = Number(m.image_file_size || m.file_size || 0);
      const sizeLabel = document.createElement("small");
      sizeLabel.className = "chat-file-size";
      sizeLabel.textContent = fileSize > 0
        ? (fileSize >= 1024 * 1024
            ? (fileSize / 1024 / 1024).toFixed(2) + " MB"
            : (fileSize / 1024).toFixed(1) + " KB")
        : "文件";

      fileCard.append(fileLink, sizeLabel);
      el.appendChild(fileCard);
    } else {
      const content = document.createElement("div");
      content.textContent = m.body || "";
      el.appendChild(content);
    }

    const createdAt = new Date(m.created_at || "").getTime();
    const canRecall = mine && m.id &&
      Number.isFinite(createdAt) &&
      Date.now() >= createdAt &&
      Date.now() - createdAt <= 120000;

    if (canRecall) {
      const recallButton = document.createElement("button");
      recallButton.type = "button";
      recallButton.className = "recall-button";
      recallButton.textContent = "撤回";

      recallButton.addEventListener("click", () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          alert("聊天连接尚未建立，请稍后重试");
          return;
        }

        if (!confirm("确定撤回这条消息吗？")) return;

        socket.send(JSON.stringify({
          type: "recall",
          messageId: m.id
        }));
      });

      el.appendChild(recallButton);
    }
  }

  if (!recalled && m.id && ["text","image","file","voice"].includes(m.message_type || "text")) {
    const forwardButton = document.createElement("button");
    forwardButton.type = "button";
    forwardButton.className = "message-forward-button";
    forwardButton.textContent = "转发";
    forwardButton.addEventListener("click", () => forwardTextMessage(m));
    el.appendChild(forwardButton);
  }
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "message-delete-button";
  deleteButton.textContent = "删除";

  deleteButton.addEventListener("click", async () => {
    if (!confirm("确定只从自己的聊天记录中删除这条消息吗？")) return;

    deleteButton.disabled = true;

    try {
      await api(
        `/api/conversations/${encodeURIComponent(activeConversation)}/messages/${encodeURIComponent(m.id)}/delete`,
        { method: "POST" }
      );
      el.remove();
    } catch (error) {
      alert(error.message || "删除失败");
      deleteButton.disabled = false;
    }
  });

  if (m.id) {
    deleteButton.classList.add("message-delete-button");
    el.appendChild(deleteButton);
  }
  const small = document.createElement("small");
  small.textContent = time;

  if (!recalled && mine) {
    const status = Number(m.is_read) === 1 ? "已读" : "已发送";
    const statusSpan = document.createElement("span");
    statusSpan.className = "message-status";
    statusSpan.textContent = status;
    small.appendChild(statusSpan);
  }

  el.appendChild(small);

  const messagesContainer = $("#messages");
  const wasAtBottom =
    messagesContainer.scrollHeight -
    messagesContainer.clientHeight -
    messagesContainer.scrollTop <= 80;

  messagesContainer.append(el);

  if (wasAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  return el;
}

function renderPendingMessage(body) {
  if (!activeConversation || !me) return null;
  return renderMessage({
    id: "",
    sender_id: me.id,
    body,
    created_at: new Date().toISOString(),
    sender_display_name: me.displayName || "",
    message_type: "text"
  }, body);
}

function clearPendingMessage(body) {
  try {
    document.querySelectorAll("[data-pending-body]").forEach(el => {
      if (el.dataset.pendingBody === body) el.remove();
    });
  } catch {}
}

function updateRecalledMessage(messageId) {
  if (!activeConversation || !messageId) return;

  const container = $("#messages");
  if (!container) return;

  const bubble = Array.from(
    container.querySelectorAll("[data-message-id]")
  ).find(el => el.dataset.messageId === String(messageId));

  if (!bubble || bubble.classList.contains("recalled")) return;

  bubble.classList.add("recalled");

  const groupLabel = bubble.querySelector(".group-sender-name");
  const deleteButton = bubble.querySelector(".message-delete-button");
  const time = bubble.querySelector("small");

  Array.from(bubble.children).forEach(child => {
    if (child !== groupLabel && child !== deleteButton && child !== time) {
      child.remove();
    }
  });

  if (time) {
    const status = time.querySelector(".message-status");
    if (status) status.remove();
  }

  const notice = document.createElement("div");
  notice.className = "recalled-text";
  notice.textContent = bubble.classList.contains("mine")
    ? "\u4f60\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f"
    : "\u5bf9\u65b9\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f";

  bubble.insertBefore(notice, deleteButton || time || null);
}
function showRemoteTyping() {
  const indicator = $("#typingIndicator");
  if (!indicator) return;

  indicator.textContent = "对方正在输入…";
  indicator.hidden = false;

  if (remoteTypingTimer) clearTimeout(remoteTypingTimer);
  remoteTypingTimer = setTimeout(clearRemoteTyping, 4500);
}

function clearRemoteTyping() {
  if (remoteTypingTimer) clearTimeout(remoteTypingTimer);
  remoteTypingTimer = null;

  const indicator = $("#typingIndicator");
  if (indicator) indicator.hidden = true;
}

function stopTyping() {
  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = null;

  if (typingSent && socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: "stop_typing" }));
    } catch {}
  }

  typingSent = false;
  lastTypingSignal = 0;
}

function handleTypingInput() {
  const input = $("#messageInput");
  if (!input || !input.value.trim()) {
    stopTyping();
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    const now = Date.now();

    if (!typingSent || now - lastTypingSignal >= 1500) {
      socket.send(JSON.stringify({ type: "typing" }));
      typingSent = true;
      lastTypingSignal = now;
    }
  }

  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(stopTyping, 1800);
}

$("#messageInput").addEventListener("input", handleTypingInput);
$("#messageInput").addEventListener("blur", stopTyping);
function connectSocket() {
  stopTyping();
  clearRemoteTyping();
  if (socket) socket.close();

  const conversationId = activeConversation;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";

  
    const ws = new WebSocket(`${proto}//${location.host}/ws/${conversationId}`);
    socket = ws;

    // 连接建立前禁止发送，避免消息丢失。
    $("#sendButton").disabled = true;

    ws.onopen = () => {
      if (socket !== ws || activeConversation !== conversationId) return;
      $("#sendButton").disabled = false;
      console.log("[CloudChat] WebSocket connected:", conversationId);
    };

    ws.onerror = event => {
      if (socket !== ws || activeConversation !== conversationId) return;
      $("#sendButton").disabled = true;
      console.warn("[CloudChat] WebSocket error:", event);
    };

    ws.onclose = event => {
      if (socket !== ws || activeConversation !== conversationId) return;
      $("#sendButton").disabled = true;
      console.warn("[CloudChat] WebSocket closed:", event.code, event.reason);
    };


  socket.onmessage = async e => {
    const d = JSON.parse(e.data);

    if (activeConversation !== conversationId) return;

    if (d.type === "member_removed" || d.type === "conversation_deleted") {
      if (messageRefreshTimer) clearInterval(messageRefreshTimer);
      messageRefreshTimer = null;

      if (socket) {
        try { socket.close(); } catch {}
        socket = null;
      }

      stopTyping();
      clearRemoteTyping();

      activeConversation = null;
      activeConversationType = null;
      setMobileChatView(false);

      $("#messages").innerHTML = "";
      $("#convTitle").textContent =
        "\u9009\u62e9\u8054\u7cfb\u4eba\u5f00\u59cb\u804a\u5929";
      $("#clearChatBtn").disabled = true;
      $("#messageInput").disabled = true;
      $("#sendButton").disabled = true;
      $("#typingIndicator").hidden = true;

      const groupModal = $("#groupMembersModal");
      if (groupModal) {
        const closeButton = $("#groupMembersClose");
        if (closeButton) closeButton.click();
        groupModal.hidden = true;
      }

      loadContacts().catch(() => {});
      alert("\u4f60\u5df2\u4e0d\u518d\u80fd\u8bbf\u95ee\u8be5\u7fa4\u804a");
      return;
    }

    if (d.type === "typing") {
      if (d.userId !== me.id) showRemoteTyping();
      return;
    }

    if (d.type === "stop_typing") {
      clearRemoteTyping();
      return;
    }

    if (d.type === "red_envelope_update") {
      document.querySelectorAll("[data-red-envelope-id]").forEach(card => {
        if (card.dataset.redEnvelopeId !== d.envelopeId) return;
        const count = card.querySelector("[data-red-count]");
        const state = card.querySelector("[data-red-status]");
        if (count) count.textContent = String(d.remainingCount);
        if (state) state.textContent = d.status === "completed" ? "已领完"
          : d.status === "expired" ? "已过期" : "领取中";
        card.dataset.redRemainingCents = String(d.remainingCents);
      });
      return;
    }

    if (d.type === "message_recalled") {
      if (activeConversation === conversationId) {
        updateRecalledMessage(d.messageId);
      }
      loadContacts().catch(() => {});
      return;
    }
    if (d.type === "recall_error") {
      alert(d.message || "\u64a4\u56de\u5931\u8d25");
      return;
    }

    if (d.type !== "message") return;
    if (activeConversation !== conversationId) return;

    if (me && d.message.senderId === me.id) clearPendingMessage(d.message.body);
    renderMessage({
      id: d.message.id,
      sender_id: d.message.senderId,
      body: d.message.body,
      created_at: d.message.createdAt,
      sender_display_name: d.message.senderDisplayName || "",
      message_type: d.message.messageType || "text",
      image_file_name: d.message.fileName || "",
      image_file_size: d.message.fileSize || 0,
      image_mime_type: d.message.mimeType || "",
      duration_ms: d.message.durationMs || 0,
      forwarded_from: d.message.forwardedFrom || null,
      red_total_cents: d.message.redEnvelope?.totalCents || 0,
      red_remaining_cents: d.message.redEnvelope?.remainingCents || 0,
      red_total_count: d.message.redEnvelope?.totalCount || 0,
      red_remaining_count: d.message.redEnvelope?.remainingCount || 0,
      red_envelope_type: d.message.redEnvelope?.envelopeType || "random",
      red_greeting: d.message.redEnvelope?.greeting || "恭喜发财，大吉大利",
      red_status: d.message.redEnvelope?.status || "open",
      red_sender_id: d.message.redEnvelope?.senderId || d.message.senderId || ""
    });

    if (!document.hidden) {
      try {
        await api(`/api/conversations/${conversationId}/read`, {
          method: "POST"
        });
      } catch {}
    }

    // PERF-20261123: 每条消息后的侧栏刷新改为 3s 节流，
    // 避免消息密集时每条消息都触发 3 个 HTTP 请求。
    // 当前会话内容已由上面的 renderMessage 即时渲染，不受影响。
    scheduleSidebarRefresh();
  };
}
$("#sendForm").onsubmit = e => {
  e.preventDefault();
  const body = $("#messageInput").value.trim();
  if (!body) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert("聊天连接尚未建立，请稍后重试");
    return;
  }
  stopTyping();
  socket.send(JSON.stringify({ body }));
  let pendingEl = null;
  try {
    pendingEl = renderPendingMessage(body);
  } catch {}
  setTimeout(() => {
    if (pendingEl && pendingEl.isConnected) pendingEl.remove();
  }, 20000);
  conversationDrafts.delete(String(activeConversation));
  $("#messageInput").value = "";
};

let cloudChatVoiceRecorder = null;
let cloudChatVoiceStream = null;
let cloudChatVoiceChunks = [];
let cloudChatVoiceHeld = false;
let cloudChatVoiceCancelled = false;
let cloudChatVoiceTimer = null;
let cloudChatVoiceStartedAt = 0;

const cloudChatVoiceButton = $("#voiceButton");

function cloudChatVoiceResetButton() {
  cloudChatVoiceButton.textContent = "按住说话";
  cloudChatVoiceButton.classList.remove("recording");
  cloudChatVoiceButton.disabled = false;
}

async function cloudChatVoiceUpload(blob, durationMs = 0) {
  if (!blob || !blob.size) return;

  if (blob.size > 5 * 1024 * 1024) {
    alert("录音超过 5 MB，无法发送");
    return;
  }

  const conversationId = activeConversation;
  if (!conversationId) return;

  const mimeType = (blob.type || "audio/webm").split(";")[0];
  const extension = mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") ? "m4a"
    : mimeType.includes("mpeg") ? "mp3"
    : "webm";

  const form = new FormData();
  form.append(
    "file",
    new File([blob], `voice-${Date.now()}.${extension}`, { type: mimeType })
  );

  cloudChatVoiceButton.disabled = true;
  cloudChatVoiceButton.textContent = "发送中";

  try {
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/voices`,
      {
        method: "POST",
        credentials: "same-origin",
        body: form
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `语音发送失败 (${response.status})`);
    }

    if (activeConversation === conversationId) {
      await loadMessages();
      await loadContacts();
    }
  } catch (error) {
    alert(error.message || "语音发送失败");
  } finally {
    cloudChatVoiceResetButton();
  }
}

async function cloudChatVoiceStart() {
  if (!activeConversation) {
    cloudChatVoiceHeld = false;
    alert("请先打开一个聊天");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === "undefined") {
    cloudChatVoiceHeld = false;
    alert("当前浏览器不支持录音，请使用最新版浏览器");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (!cloudChatVoiceHeld) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    cloudChatVoiceStream = stream;
    cloudChatVoiceChunks = [];
    cloudChatVoiceCancelled = false;

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4"
    ];

    const mimeType = candidates.find(type =>
      MediaRecorder.isTypeSupported(type)
    );

    cloudChatVoiceRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    cloudChatVoiceRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        cloudChatVoiceChunks.push(event.data);
      }
    };

    cloudChatVoiceRecorder.onerror = () => {
      cloudChatVoiceCancelled = true;
      alert("录音发生错误，请重试");
      if (cloudChatVoiceRecorder &&
          cloudChatVoiceRecorder.state !== "inactive") {
        cloudChatVoiceRecorder.stop();
      }
    };

    cloudChatVoiceRecorder.onstop = async () => {
      const recorder = cloudChatVoiceRecorder;
      const cancelled = cloudChatVoiceCancelled;
      const chunks = cloudChatVoiceChunks;
      const durationMs = cloudChatVoiceStartedAt
        ? Math.max(0, Math.min(120000, Date.now() - cloudChatVoiceStartedAt))
        : 0;
      cloudChatVoiceStartedAt = 0;

      cloudChatVoiceRecorder = null;
      cloudChatVoiceChunks = [];

      if (cloudChatVoiceStream) {
        cloudChatVoiceStream.getTracks().forEach(track => track.stop());
        cloudChatVoiceStream = null;
      }

      clearTimeout(cloudChatVoiceTimer);
      cloudChatVoiceTimer = null;
      cloudChatVoiceResetButton();

      if (cancelled || !chunks.length) return;

      const blob = new Blob(chunks, {
        type: recorder && recorder.mimeType
          ? recorder.mimeType
          : "audio/webm"
      });

      console.log("[语音诊断] 录音Blob", {
        mimeType: blob.type,
        size: blob.size,
        chunkCount: chunks.length,
        chunkSizes: chunks.map(item => item.size)
      });

      const diagnosticAudio = document.createElement("audio");
      const diagnosticUrl = URL.createObjectURL(blob);
      diagnosticAudio.preload = "metadata";
      diagnosticAudio.onloadedmetadata = () => {
        console.log("[语音诊断] 本地Blob时长", diagnosticAudio.duration);
        URL.revokeObjectURL(diagnosticUrl);
      };
      diagnosticAudio.onerror = () => {
        console.error("[语音诊断] 本地Blob无法读取");
        URL.revokeObjectURL(diagnosticUrl);
      };
      diagnosticAudio.src = diagnosticUrl;

      await cloudChatVoiceUpload(blob, durationMs);
    };

    cloudChatVoiceStartedAt = Date.now();
    cloudChatVoiceRecorder.start(250);
    cloudChatVoiceButton.textContent = "正在录音…松开发送";
    cloudChatVoiceButton.classList.add("recording");

    cloudChatVoiceTimer = setTimeout(() => {
      if (cloudChatVoiceRecorder &&
          cloudChatVoiceRecorder.state !== "inactive") {
        cloudChatVoiceHeld = false;
        cloudChatVoiceButton.textContent = "录音结束，发送中";
        cloudChatVoiceRecorder.stop();
      }
    }, 120000);

  } catch (error) {
    cloudChatVoiceHeld = false;
    cloudChatVoiceResetButton();

    if (error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError") {
      alert("请允许浏览器使用麦克风，然后重新按住说话");
    } else {
      alert(error.message || "无法启动录音");
    }
  }
}

function cloudChatVoiceStop(cancelled = false) {
  cloudChatVoiceHeld = false;
  cloudChatVoiceCancelled = cancelled;
  clearTimeout(cloudChatVoiceTimer);
  cloudChatVoiceTimer = null;

  if (cloudChatVoiceRecorder &&
      cloudChatVoiceRecorder.state !== "inactive") {
    cloudChatVoiceRecorder.stop();
  } else if (!cloudChatVoiceRecorder) {
    if (cloudChatVoiceStream) {
      cloudChatVoiceStream.getTracks().forEach(track => track.stop());
      cloudChatVoiceStream = null;
    }
    cloudChatVoiceResetButton();
  }
}

cloudChatVoiceButton.addEventListener("pointerdown", event => {
  if (event.button !== 0 || cloudChatVoiceButton.disabled) return;
  event.preventDefault();

  cloudChatVoiceHeld = true;

  try {
    cloudChatVoiceButton.setPointerCapture(event.pointerId);
  } catch {}

  cloudChatVoiceStart();
});

cloudChatVoiceButton.addEventListener("pointerup", event => {
  event.preventDefault();
  cloudChatVoiceStop(false);
});

cloudChatVoiceButton.addEventListener("pointercancel", () => {
  cloudChatVoiceStop(true);
});

cloudChatVoiceButton.addEventListener("contextmenu", event => {
  event.preventDefault();
});
$("#imageButton").addEventListener("click", () => {
  if (!activeConversation) {
    alert("请先打开一个聊天");
    return;
  }
  $("#imageFileInput").click();
});

$("#imageFileInput").addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = "";

  if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
    alert("图片大小不能超过 8 MB");
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    alert("只支持 JPEG、PNG、WebP、GIF 图片");
    return;
  }

  if (!activeConversation) {
    alert("请先打开一个聊天");
    return;
  }

  const conversationId = activeConversation;
  const button = $("#imageButton");
  button.disabled = true;
  button.textContent = "上传中";

  try {
    const form = new FormData();
    form.append("file", file);

    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/images`,
      {
        method: "POST",
        credentials: "same-origin",
        body: form
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `上传失败 (${response.status})`);
    }

    if (activeConversation === conversationId) {
      await loadMessages();
      await loadContacts();
    }
  } catch (error) {
    alert(error.message || "图片上传失败");
  } finally {
    button.disabled = false;
    button.textContent = "图片";
  }
});
$("#fileButton").addEventListener("click", () => {
  if (!activeConversation) {
    alert("请先打开一个聊天");
    return;
  }
  $("#fileFileInput").click();
});

$("#fileFileInput").addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = "";

  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    alert("文件大小必须大于 0 且不能超过 20 MB");
    return;
  }

  if (!activeConversation) {
    alert("请先打开一个聊天");
    return;
  }

  const conversationId = activeConversation;
  const button = $("#fileButton");
  button.disabled = true;
  button.textContent = "上传中";

  try {
    const form = new FormData();
    form.append("file", file);

    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/files`,
      {
        method: "POST",
        credentials: "same-origin",
        body: form
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `上传失败 (${response.status})`);
    }

    if (activeConversation === conversationId) {
      await loadMessages();
      await loadContacts();
    }
  } catch (error) {
    alert(error.message || "文件上传失败");
  } finally {
    button.disabled = false;
    button.textContent = "文件";
  }
});
$("#logoutBtn").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  if (contactsRefreshTimer) clearInterval(contactsRefreshTimer);
  contactsRefreshTimer = null;
  stopTyping();
  clearRemoteTyping();
  stopTyping();
  clearRemoteTyping();
  if (socket) socket.close();
  finishCall(true);
  disconnectCallSocket();
  me = null;
  notificationBaselineReady = false;
  knownLastMessageIds.clear();
  boot();
};
async function openMyProfile() {
  if (!me) return;

  const overlay = document.createElement("div");
  overlay.className = "friend-profile-overlay";

  const dialog = document.createElement("div");
  dialog.className = "friend-profile-dialog my-profile-dialog";

  const heading = document.createElement("div");
  heading.className = "friend-profile-heading";
  heading.textContent = "我的资料";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "friend-profile-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭");
  heading.appendChild(close);

  const content = document.createElement("div");
  content.className = "my-profile-content";

  const avatarArea = document.createElement("div");
  avatarArea.className = "my-profile-avatar-area";

  const avatar = document.createElement("img");
  avatar.className = "my-profile-avatar";
  avatar.alt = "我的头像";
  avatar.src = "/api/me/avatar?t=" + Date.now();
  avatar.onerror = () => {
    avatar.removeAttribute("src");
    avatar.classList.add("avatar-empty");
  };

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png,image/webp";
  fileInput.hidden = true;

  const chooseAvatar = document.createElement("button");
  chooseAvatar.type = "button";
  chooseAvatar.className = "my-profile-avatar-button";
  chooseAvatar.textContent = "更换头像";
  chooseAvatar.onclick = () => fileInput.click();

  let selectedFile = null;
  let previewUrl = null;

  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("头像不能超过2MB");
      fileInput.value = "";
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert("请选择 JPG、PNG 或 WebP 图片");
      fileInput.value = "";
      return;
    }

    selectedFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    avatar.classList.remove("avatar-empty");
    avatar.src = previewUrl;
  };

  avatarArea.append(avatar, chooseAvatar, fileInput);

  const walletPanel = document.createElement("div");
  walletPanel.className = "my-profile-wallet";
  walletPanel.style.cssText = "margin:14px 0;padding:16px;border:1px solid var(--border,#ddd);border-radius:12px;background:var(--panel,#fff);";
  walletPanel.innerHTML = `
    <div class="my-wallet-top">
      <div>
        <div class="my-wallet-label">我的红包余额</div>
        <div data-wallet-balance class="my-wallet-amount">正在加载...</div>
        <div data-wallet-message class="my-wallet-hint">仅用于站内红包，不可提现</div>
      </div>
      <span class="my-wallet-icon">🧧</span>
    </div>
    <button type="button" class="my-wallet-toggle" data-wallet-toggle aria-expanded="false">
      <span>查看收支明细</span><span data-wallet-arrow>展开 ↓</span>
    </button>
    <div class="my-wallet-ledger" data-wallet-ledger hidden>
      <div class="my-wallet-ledger-title">最近收支记录</div>
      <div data-wallet-ledger-list class="my-wallet-ledger-list">
        <div class="my-wallet-empty">正在加载记录...</div>
      </div>
    </div>
  `;

  const form = document.createElement("form");
  form.className = "my-profile-form";

  const usernameLabel = document.createElement("label");
  usernameLabel.textContent = "用户名";

  const usernameInput = document.createElement("input");
  usernameInput.value = me.username || "";
  usernameInput.readOnly = true;
  usernameInput.className = "my-profile-readonly";
  usernameLabel.appendChild(usernameInput);

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "昵称";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 32;
  nameInput.required = true;
  nameInput.value = me.displayName || "";
  nameInput.placeholder = "请输入昵称";
  nameLabel.appendChild(nameInput);

  const message = document.createElement("div");
  message.className = "my-profile-message";
  message.setAttribute("role", "status");

  const actions = document.createElement("div");
  actions.className = "my-profile-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "admin-secondary";
  cancel.textContent = "取消";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary";
  save.textContent = "保存资料";

  actions.append(cancel, save);
  form.append(usernameLabel, nameLabel, message, actions);
  content.append(avatarArea, walletPanel, form);
  dialog.append(heading, content);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // 加载钱包余额和最近收支明细
  api("/api/me/red-wallet")
    .then(wallet => {
      const balance = Number(wallet.balanceCents || 0);
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new Error("红包余额数据格式异常");
      }

      walletPanel.querySelector("[data-wallet-balance]").textContent =
        "¥" + (balance / 100).toFixed(2);

      const ledgerBox = walletPanel.querySelector("[data-wallet-ledger]");
      const ledgerList = walletPanel.querySelector("[data-wallet-ledger-list]");
      const toggle = walletPanel.querySelector("[data-wallet-toggle]");
      const arrow = walletPanel.querySelector("[data-wallet-arrow]");
      const entries = Array.isArray(wallet.ledger) ? wallet.ledger : [];

      toggle.onclick = () => {
        const opening = ledgerBox.hidden;
        ledgerBox.hidden = !opening;
        toggle.setAttribute("aria-expanded", String(opening));
        arrow.textContent = opening ? "收起 ↑" : "展开 ↓";
      };

      ledgerList.replaceChildren();

      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "my-wallet-empty";
        empty.textContent = "暂无收支记录";
        ledgerList.appendChild(empty);
      } else {
        const labels = {
          admin_grant: "管理员充值",
          send: "发送红包",
          claim: "领取红包",
          refund: "红包退款",
          expire_refund: "过期退款"
        };

        entries.forEach(entry => {
          const item = document.createElement("div");
          item.className = "my-wallet-ledger-item";

          const info = document.createElement("div");
          info.className = "my-wallet-ledger-info";

          const title = document.createElement("div");
          title.className = "my-wallet-ledger-name";
          title.textContent = labels[entry.entry_type] || "红包余额变动";

          const note = document.createElement("div");
          note.className = "my-wallet-ledger-note";
          note.textContent = entry.note || entry.created_at || "";

          const amount = document.createElement("div");
          const delta = Number(entry.delta_cents || 0);
          amount.className = "my-wallet-ledger-delta " + (delta >= 0 ? "positive" : "negative");
          amount.textContent = (delta > 0 ? "+" : "") + "¥" + (delta / 100).toFixed(2);

          const after = document.createElement("div");
          after.className = "my-wallet-ledger-after";
          after.textContent = "余额 ¥" + (Number(entry.balance_after_cents || 0) / 100).toFixed(2);

          info.append(title, note);
          const values = document.createElement("div");
          values.className = "my-wallet-ledger-values";
          values.append(amount, after);

          item.append(info, values);
          ledgerList.appendChild(item);
        });
      }
    })
    .catch(error => {
      walletPanel.querySelector("[data-wallet-balance]").textContent = "暂不可用";
      walletPanel.querySelector("[data-wallet-message]").textContent =
        error.message || "读取红包余额失败";

      const list = walletPanel.querySelector("[data-wallet-ledger-list]");
      if (list) list.textContent = "收支记录暂时无法加载";
    });

  const closeProfile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    overlay.remove();
  };

  close.onclick = closeProfile;
  cancel.onclick = closeProfile;
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeProfile();
  });

  form.onsubmit = async event => {
    event.preventDefault();

    const displayName = nameInput.value.trim();
    if (!displayName || displayName.length > 32) {
      message.textContent = "昵称不能为空，最多32个字符";
      return;
    }

    save.disabled = true;
    save.textContent = "正在保存...";
    message.textContent = "";

    try {
      await api("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName })
      });

      if (selectedFile) {
        const data = new FormData();
        data.append("avatar", selectedFile);

        const response = await fetch("/api/me/avatar", {
          method: "POST",
          credentials: "same-origin",
          body: data
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "头像上传失败");
        }
      }

      me.displayName = displayName;
      if (selectedFile) me.avatarUrl = "updated";

      $("#userbar").textContent =
        `${me.displayName}（${me.role === "admin" ? "超级管理员" : "普通用户"}）`;

      await loadContacts();
      closeProfile();
    } catch (error) {
      message.textContent = error.message || "保存失败";
      save.disabled = false;
      save.textContent = "保存资料";
    }
  };
}

$("#profileBtn").onclick = openMyProfile;
function adminEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function adminDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? adminEscape(value) : date.toLocaleString();
}

function adminNotice(message, isError = false) {
  const el = $("#adminNotice");
  el.textContent = message || "";
  el.classList.toggle("error", !!isError);
}

function adminSetView(view) {
  const views = {
    users: "#adminUsersView",
    invites: "#adminInvitesView",
    audit: "#adminAuditView"
  };
  Object.entries(views).forEach(([key, selector]) => {
    $(selector).hidden = key !== view;
  });
  document.querySelectorAll("[data-admin-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.adminView === view);
  });
  adminNotice("");
}

document.querySelectorAll("[data-admin-view]").forEach(button => {
  button.addEventListener("click", () => adminSetView(button.dataset.adminView));
});

$("#adminBtn").onclick = () => {
  $("#chat").hidden = true;
  $("#adminPanel").hidden = false;
  adminSetView("users");
  loadAdminUsers();
};

$("#backChat").onclick = () => {
  $("#adminPanel").hidden = true;
  $("#chat").hidden = false;
};

async function loadAdminUsers() {
  const body = $("#adminUsersBody");
  body.innerHTML = '<tr><td colspan="6" class="admin-empty">正在加载用户...</td></tr>';
  adminNotice("");

  try {
    const data = await api("/api/admin/users");
    const users = Array.isArray(data.users) ? data.users : [];

    if (!users.length) {
      body.innerHTML = '<tr><td colspan="6" class="admin-empty">暂时没有注册用户</td></tr>';
    } else {
      body.innerHTML = users.map(user => {
        const status = user.status === "active"
          ? '<span class="admin-status active">正常</span>'
          : '<span class="admin-status suspended">已停用</span>';
        const role = user.role === "admin"
          ? '<span class="admin-role">超级管理员</span>'
          : "";
        const protectedUser = user.role === "admin" || String(user.username || "").startsWith("deleted_");
        const actions = protectedUser
          ? '<span class="admin-footnote">不可操作</span>'
          : `
            <div class="admin-user-actions">
              <button type="button" class="admin-secondary" data-admin-action="red-wallet" data-id="${adminEscape(user.id)}">红包充值</button>
              <button type="button" class="admin-secondary" data-admin-action="nickname" data-id="${adminEscape(user.id)}">改昵称</button>
              <button type="button" class="admin-secondary" data-admin-action="password" data-id="${adminEscape(user.id)}">重置密码</button>
              <button type="button" class="admin-secondary" data-admin-action="${user.status === "active" ? "suspend" : "activate"}" data-id="${adminEscape(user.id)}">${user.status === "active" ? "停用" : "恢复"}</button>
              <button type="button" class="admin-secondary" data-admin-action="conversations" data-id="${adminEscape(user.id)}">查看会话</button>
              <button type="button" class="admin-secondary" data-admin-action="delete" data-id="${adminEscape(user.id)}">注销</button>
            </div>`;
        return `<tr>
          <td><strong>${adminEscape(user.username)}</strong>${role}</td>
          <td>${adminEscape(user.display_name || "—")}</td>
          <td>${adminDate(user.created_at)}</td>
          <td><strong class="admin-wallet-balance">¥${(Number(user.red_wallet_balance_cents || 0) / 100).toFixed(2)}</strong></td>
          <td>${status}</td>
          <td>${actions}</td>
        </tr>`;
      }).join("");
    }

    $("#adminUsersCount").textContent = `共 ${users.length} 个账户`;
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="admin-empty">${adminEscape(error.message)}</td></tr>`;
    $("#adminUsersCount").textContent = "";
    adminNotice(error.message, true);
  }
}

$("#loadUsers").onclick = loadAdminUsers;

$("#adminUsersBody").addEventListener("click", async event => {
  const button = event.target.closest("[data-admin-action]");
  if (!button || button.disabled) return;

  const id = button.dataset.id;
  const action = button.dataset.adminAction;
  if (!id || !action) return;

  const askReason = () => {
    const reason = prompt("请输入审查原因（3-300 字）：");
    if (reason === null) return null;
    const value = reason.trim();
    if (value.length < 3 || value.length > 300) {
      alert("审查原因必须为 3-300 个字符");
      return null;
    }
    return value;
  };

  button.disabled = true;
  try {
    if (action === "red-wallet") {
      const amountText = prompt("请输入要发放的红包余额（人民币元）");
      if (amountText === null) return;

      const normalized = amountText.trim();
      if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(normalized)) {
        alert("金额格式不正确，请输入例如 50 或 50.88");
        return;
      }

      const amountCents = Math.round(Number(normalized) * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
        alert("金额必须大于 0，且不能超过 1000000 元");
        return;
      }

      const noteInput = prompt("请输入发放备注（可留空）", "管理员发放虚拟红包余额");
      if (noteInput === null) return;

      if (!confirm("确认向该用户发放 ¥" + (amountCents / 100).toFixed(2) + " 虚拟红包余额？")) return;

      const result = await api(
        "/api/admin/users/" + encodeURIComponent(id) + "/red-wallet/grant",
        {
          method: "POST",
          body: JSON.stringify({
            amountCents,
            note: noteInput.trim().slice(0, 100) || "管理员发放虚拟红包余额"
          })
        }
      );

      await loadAdminUsers();
      adminNotice("红包余额发放成功，当前余额：¥" + (Number(result.balanceCents || 0) / 100).toFixed(2));
    } else if (action === "nickname") {
      const nickname = prompt("请输入新昵称（最多 30 字）：");
      if (nickname === null) return;
      if (!nickname.trim() || nickname.trim().length > 30) {
        alert("昵称不能为空且不能超过 30 个字符");
        return;
      }
      await api(`/api/admin/users/${encodeURIComponent(id)}/nickname`, {
        method: "POST",
        body: JSON.stringify({nickname: nickname.trim()})
      });
      adminNotice("昵称修改成功");
      await loadAdminUsers();
    } else if (action === "password") {
      const password = prompt("请输入新密码（8-128 个字符）：");
      if (password === null) return;
      if (password.length < 8 || password.length > 128) {
        alert("密码长度必须为 8-128 个字符");
        return;
      }
      if (!confirm("确认重置该用户密码并注销其现有登录会话？")) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({password})
      });
      adminNotice("密码已重置，该用户需要重新登录");
    } else if (action === "suspend") {
      if (!confirm("确认停用该账户？用户将被强制退出登录。")) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}/suspend`, {method:"POST"});
      adminNotice("停用请求已完成");
      await loadAdminUsers();
    } else if (action === "activate") {
      if (!confirm("确认恢复该账户？")) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}/activate`, {method:"POST"});
      adminNotice("账户已恢复，请用户重新登录");
      await loadAdminUsers();
    } else if (action === "delete") {
      if (!confirm("确认注销此账户？账户将被匿名化，聊天记录和附件保留，操作不可直接撤销。")) return;
      if (!confirm("再次确认：确定注销该用户？")) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}/delete`, {method:"POST"});
      adminNotice("账户已注销，历史消息和附件已保留");
      await loadAdminUsers();
    } else if (action === "conversations") {
      const reason = askReason();
      if (reason === null) return;

      const data = await api(
        "/api/admin/users/" + encodeURIComponent(id) +
        "/conversations?reason=" + encodeURIComponent(reason)
      );
      const conversations = Array.isArray(data.conversations) ? data.conversations : [];

      const modal = document.createElement("div");
      modal.id = "adminReviewModal";
      modal.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:20px;";

      const panelStyle = "background:var(--panel,#fff);color:var(--text,#222);width:min(920px,96vw);max-height:88vh;overflow:auto;border-radius:14px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.3);";
      const title = "用户会话审查 · " + (data.user?.display_name || data.user?.username || id);

      const renderConversations = () => {
        modal.innerHTML = '<div style="' + panelStyle + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<div><h3 style="margin:0 0 6px;">' + adminEscape(title) + '</h3>' +
          '<div class="admin-footnote">共 ' + conversations.length + ' 个会话。选择会话查看消息。</div></div>' +
          '<button type="button" class="admin-secondary" data-review-close>关闭</button></div>' +
          '<div style="margin-top:16px;display:grid;gap:10px;">' +
          (conversations.length ? conversations.map((item, index) =>
            '<div style="border:1px solid var(--border,#ddd);border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div style="min-width:0;flex:1;">' +
            '<strong>' + adminEscape(item.group_name || (item.type === "group" ? "群聊" : "单聊")) + '</strong>' +
            '<div class="admin-footnote">成员：' + adminEscape(String(item.member_count ?? "—")) +
            ' · 最近消息：' + adminEscape(item.last_message_at || "暂无") + '</div>' +
            '<div class="admin-footnote">会话 ID：' + adminEscape(item.id) + '</div>' +
            '<div style="margin-top:5px;white-space:pre-wrap;overflow-wrap:anywhere;">' +
            adminEscape(item.last_message_preview || "暂无消息") + '</div></div>' +
            '<button type="button" class="admin-secondary" data-review-conversation="' +
            adminEscape(item.id) + '">查看消息</button></div>'
          ).join("") : '<div class="admin-empty">该用户没有可显示的会话</div>') +
          '</div></div>';
      };

      renderConversations();
      document.body.appendChild(modal);

      modal.addEventListener("click", async event => {
        const closeButton = event.target.closest("[data-review-close]");
        if (closeButton) {
          (modal._reviewObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
          modal._reviewObjectUrls = [];
          modal.remove();
          return;
        }

        const attachmentButton = event.target.closest("[data-review-attachment]");
        if (attachmentButton) {
          const conversationId = attachmentButton.dataset.reviewConversation;
          const messageId = attachmentButton.dataset.reviewMessage;
          const messageType = attachmentButton.dataset.reviewAttachment;
          const fileName = attachmentButton.dataset.reviewFilename || "attachment";
          const reason = prompt("请输入本次查看或下载附件的审查原因（3-300字）");

          if (reason === null) return;
          if (reason.trim().length < 3 || reason.trim().length > 300) {
            alert("审查原因必须为 3-300 个字符");
            return;
          }

          attachmentButton.disabled = true;
          attachmentButton.textContent = "正在读取附件...";
          try {
            const url = "/api/admin/conversations/" +
              encodeURIComponent(conversationId) + "/attachments/" +
              encodeURIComponent(messageId) + "?reason=" +
              encodeURIComponent(reason.trim());

            const response = await fetch(url, { credentials: "same-origin" });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || "附件读取失败（HTTP " + response.status + "）");
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);

            if (messageType === "image" || messageType === "voice") {
              modal._reviewObjectUrls = modal._reviewObjectUrls || [];
              modal._reviewObjectUrls.push(objectUrl);

              const wrap = attachmentButton.closest("[data-review-attachment-wrap]");
              const oldPreview = wrap.querySelector("[data-review-preview]");
              if (oldPreview) oldPreview.remove();

              const preview = document.createElement("div");
              preview.dataset.reviewPreview = "1";
              preview.style.cssText = "margin-top:10px;max-width:100%;";

              if (messageType === "image") {
                const image = document.createElement("img");
                image.src = objectUrl;
                image.alt = fileName;
                image.style.cssText = "display:block;max-width:100%;max-height:420px;object-fit:contain;border-radius:8px;";
                preview.appendChild(image);
              } else {
                const audio = document.createElement("audio");
                audio.controls = true;
                audio.preload = "metadata";
                audio.src = objectUrl;
                audio.style.cssText = "display:block;width:min(420px,100%);";
                preview.appendChild(audio);
              }

              wrap.appendChild(preview);
              attachmentButton.textContent = messageType === "image" ? "重新查看图片" : "重新播放语音";
            } else {
              const link = document.createElement("a");
              link.href = objectUrl;
              link.download = fileName;
              link.style.display = "none";
              document.body.appendChild(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
              attachmentButton.textContent = "再次下载文件";
            }
          } catch (error) {
            alert(error.message || "附件读取失败");
            attachmentButton.textContent = "重试查看附件";
          } finally {
            attachmentButton.disabled = false;
          }
          return;
        }

        const reviewButton = event.target.closest("[data-review-conversation]");
        if (!reviewButton || reviewButton.disabled) return;

        const conversationId = reviewButton.dataset.reviewConversation;
        if (!conversationId) return;

        const reviewReason = prompt("请输入本次查看聊天记录的审查原因（3-300 字）：");
        if (reviewReason === null) return;
        if (reviewReason.trim().length < 3 || reviewReason.trim().length > 300) {
          alert("审查原因必须为 3-300 个字符");
          return;
        }

        reviewButton.disabled = true;
        reviewButton.textContent = "正在读取...";
        try {
          const result = await api(
            "/api/admin/conversations/" + encodeURIComponent(conversationId) +
            "/messages?reason=" + encodeURIComponent(reviewReason.trim())
          );
          const messages = Array.isArray(result.messages) ? result.messages : [];

          const formatSize = value => {
            const bytes = Number(value || 0);
            if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / 1024 / 1024).toFixed(2) + " MB";
          };

          const messageTypeName = value => ({
            text: "文字",
            image: "图片",
            voice: "语音",
            file: "文件",
            video: "视频"
          }[value] || value || "消息");

          modal.innerHTML = '<div style="' + panelStyle + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div><h3 style="margin:0 0 6px;">聊天记录审查</h3>' +
            '<div class="admin-footnote">会话 ID：' + adminEscape(conversationId) +
            ' · 返回 ' + messages.length + ' 条，最多 500 条</div></div>' +
            '<div style="display:flex;gap:8px;"><button type="button" class="admin-secondary" data-review-back>返回会话</button>' +
            '<button type="button" class="admin-secondary" data-review-close>关闭</button></div></div>' +
            '<div style="margin-top:14px;display:grid;gap:10px;">' +
            (messages.length ? messages.map(message => {
              const sender = message.sender_display_name || message.sender_username || message.sender_id || "未知用户";
              const attachment = message.attachment_file_name
                ? '<div data-review-attachment-wrap style="margin-top:8px;padding:9px;border-radius:8px;background:rgba(127,127,127,.10);">' +
                  '<strong>附件：' + adminEscape(message.attachment_file_name) + '</strong>' +
                  '<div class="admin-footnote">' +
                  adminEscape(message.attachment_mime_type || "类型未知") + ' · ' +
                  formatSize(message.attachment_file_size) +
                  (Number(message.attachment_duration_ms) > 0
                    ? ' · 时长 ' + (Number(message.attachment_duration_ms) / 1000).toFixed(1) + ' 秒'
                    : '') +
                  '</div>' +
                  '<button type="button" class="admin-secondary" style="margin-top:8px;" data-review-attachment="' +
                  adminEscape(message.message_type) + '" data-review-conversation="' +
                  adminEscape(conversationId) + '" data-review-message="' +
                  adminEscape(message.id) + '" data-review-filename="' +
                  adminEscape(message.attachment_file_name) + '">' +
                  (message.message_type === "image" ? "查看图片" : message.message_type === "voice" ? "播放语音" : "下载文件") +
                  '</button></div>'
                : '';
              return '<article style="border:1px solid var(--border,#ddd);border-radius:10px;padding:12px;">' +
                '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
                '<strong>' + adminEscape(sender) + '</strong>' +
                '<span class="admin-footnote">' + adminEscape(adminDate(message.created_at)) + '</span></div>' +
                '<div class="admin-footnote" style="margin-top:4px;">' +
                adminEscape(messageTypeName(message.message_type)) +
                (message.recalled_at ? ' · 已撤回' : '') +
                ' · 消息 ID：' + adminEscape(message.id) + '</div>' +
                '<div style="margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;">' +
                adminEscape(message.body || (message.attachment_file_name ? "（附件消息）" : "（无文字内容）")) +
                '</div>' + attachment + '</article>';
            }).join("") : '<div class="admin-empty">该会话暂无消息</div>') +
            '</div><div class="admin-footnote" style="margin-top:12px;">消息按时间倒序排列。附件仅展示元数据，不提供文件下载。</div></div>';
        } catch (error) {
          alert(error.message || "读取聊天记录失败");
          reviewButton.disabled = false;
          reviewButton.textContent = "查看消息";
        }
      });

      modal.addEventListener("click", event => {
        if (event.target.closest("[data-review-back]")) {
          (modal._reviewObjectUrls || []).forEach(url => URL.revokeObjectURL(url));
          modal._reviewObjectUrls = [];
          renderConversations();
        }
      });
    }
  } catch (error) {
    adminNotice(error.message || "操作失败", true);
    alert(error.message || "操作失败");
  } finally {
    button.disabled = false;
  }
});


$("#makeInvite").onclick = async () => {
  const button = $("#makeInvite");
  button.disabled = true;
  button.textContent = "正在生成...";
  adminNotice("");

  try {
    const data = await api("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({ hours: 72 })
    });

    $("#adminInviteResult").innerHTML = `
      <div class="admin-invite-card">
        <div class="admin-invite-label">新邀请码</div>
        <div class="admin-invite-code" id="adminInviteCode">${adminEscape(data.invite)}</div>
        <button type="button" id="copyAdminInvite" class="primary admin-copy">复制邀请码</button>
        <div class="admin-invite-expiry">有效期至：${adminDate(Number(data.expiresAt) * 1000)}</div>
      </div>`;

    $("#copyAdminInvite").onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(data.invite));
        adminNotice("邀请码已复制");
      } catch {
        const field = document.createElement("textarea");
        field.value = String(data.invite);
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        adminNotice(copied ? "邀请码已复制" : "复制失败，请手动选择邀请码", !copied);
      }
    };
    adminNotice("邀请码生成成功，请及时复制并妥善保管");
  } catch (error) {
    $("#adminInviteResult").innerHTML =
      `<div class="admin-empty">${adminEscape(error.message)}</div>`;
    adminNotice(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "生成邀请码";
  }
};

function adminActionName(action) {
  const names = {
    VIEW_CHAT_HISTORY: "查看聊天记录",
    VIEW_USER_CONVERSATIONS: "查看用户会话",
    VIEW_CHAT_ATTACHMENT: "查看聊天附件",
    UPDATE_NICKNAME: "修改用户昵称",
    RESET_PASSWORD: "重置用户密码",
    SUSPEND_USER: "停用账户",
    ACTIVATE_USER: "恢复账户",
    SUSPEND_USER_FAILED: "停用账户失败",
    ACTIVATE_USER_FAILED: "恢复账户失败",
    UPDATE_NICKNAME_FAILED: "修改用户昵称失败",
    RESET_PASSWORD_FAILED: "重置用户密码失败",
    ANONYMIZE_USER_FAILED: "注销账户失败",
    ANONYMIZE_USER: "注销账户",
    DELETE_USER: "注销账户",
    CREATE_INVITE: "生成邀请码"
  };
  return names[action] || "管理员操作";
}

function adminAuditDetails(value, action) {
  const failed = String(action || "").endsWith("_FAILED");

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "操作结果：" + (failed ? "失败" : "成功");
    }

    const labels = {
      username: "用户账号",
      displayName: "用户昵称",
      fromNickname: "原昵称",
      toNickname: "新昵称",
      fromStatus: "原账户状态",
      toStatus: "变更后账户状态",
      accountStatus: "操作时账户状态",
      passwordReset: "密码已重置",
      passwordValueLogged: "记录密码明文",
      sessionsRevoked: "原登录会话已撤销",
      preservedHistory: "聊天记录及附件已保留",
      description: "操作说明",
      reason: "失败原因",
      conversationId: "会话编号",
      messageCount: "消息数量",
      attachmentCount: "附件数量"
    };

    const reasons = {
      target_missing_or_protected: "目标用户不存在或属于受保护账户",
      target_not_active: "目标账户当前不是正常状态",
      concurrent_status_change: "账户状态发生并发变化",
      invalid_nickname: "昵称格式不符合要求",
      concurrent_update: "用户信息发生并发变化",
      invalid_password_format: "密码格式不符合要求",
      self_anonymization_blocked: "禁止注销当前管理员自己的账户"
    };

    const statuses = {
      active: "正常",
      suspended: "已停用",
      pending: "待处理",
      deleted: "已注销",
      disabled: "已禁用"
    };

    function readable(key, value) {
      if (key === "reason") {
        return reasons[value] || "操作未成功，请检查目标账户及输入内容";
      }
      if (["fromStatus", "toStatus", "accountStatus"].includes(key)) {
        return statuses[value] || "其他状态";
      }
      if (typeof value === "boolean") return value ? "是" : "否";
      if (value === null || value === undefined || value === "") return "未提供";
      if (typeof value === "number") return String(value);
      if (typeof value === "string") return value;
      return "已记录";
    }

    const result = parsed.outcome === "failure" || failed ? "失败" : "成功";
    const lines = ["操作结果：" + result];

    for (const [key, value] of Object.entries(parsed)) {
      if (key === "outcome") continue;
      const label = labels[key];
      if (!label) continue;
      lines.push(label + "：" + readable(key, value));
    }

    return lines.join("\n");
  } catch {
    return "操作结果：" + (failed ? "失败" : "成功");
  }
}

async function loadAdminAudit() {
  const body = $("#adminAuditBody");
  const count = $("#auditResultCount");
  body.innerHTML = '<tr><td colspan="5" class="admin-empty">正在加载审计记录...</td></tr>';
  count.textContent = "正在查询...";
  adminNotice("");

  try {
    const params = new URLSearchParams();
    const admin = $("#auditAdminFilter").value.trim();
    const action = $("#auditActionFilter").value;
    const target = $("#auditTargetFilter").value.trim();
    const startDate = $("#auditStartDate").value;
    const endDate = $("#auditEndDate").value;

    if (admin) params.set("admin", admin);
    if (action) params.set("action", action);
    if (target) params.set("target", target);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    const query = params.toString();
    const data = await api("/api/admin/audit" + (query ? "?" + query : ""));
    const logs = Array.isArray(data.logs) ? data.logs : [];

    count.textContent = "查询结果：" + logs.length + " 条（最多显示 500 条）";

    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty">没有符合条件的审计记录</td></tr>';
      return;
    }

    body.innerHTML = logs.map(log => {
      return '<tr>' +
        '<td><strong>' + adminEscape(log.admin_name || log.admin_username || log.admin_id || "未知管理员") +
        '</strong><div class="admin-footnote">' + adminEscape(log.admin_username || log.admin_id || "") + '</div></td>' +
        '<td>' + adminEscape(adminActionName(log.action)) +
        '<div class="admin-footnote">' + adminEscape(log.action || "") + '</div></td>' +
        '<td style="overflow-wrap:anywhere;">' + adminEscape(log.target_id || "—") + '</td>' +
        '<td><div style="white-space:pre-line;overflow-wrap:anywhere;">' +
        adminEscape(adminAuditDetails(log.details, log.action)) + '</div></td>' +
        '<td>' + adminEscape(adminDate(log.created_at)) + '</td>' +
        '</tr>';
    }).join("");
  } catch (error) {
    body.innerHTML = '<tr><td colspan="5" class="admin-empty">' + adminEscape(error.message) + '</td></tr>';
    count.textContent = "查询失败";
    adminNotice(error.message, true);
  }
}

$("#filterAudit").onclick = loadAdminAudit;
$("#loadAudit").onclick = loadAdminAudit;

$("#resetAudit").onclick = () => {
  $("#auditAdminFilter").value = "";
  $("#auditActionFilter").value = "";
  $("#auditTargetFilter").value = "";
  $("#auditStartDate").value = "";
  $("#auditEndDate").value = "";
  loadAdminAudit();
};
$("#loadAudit").onclick = loadAdminAudit;
boot();

$("#clearChatBtn").onclick = async () => {
  if (!activeConversation) return;

  if (!confirm("确定清空当前聊天记录吗？这只会清空你自己的记录，对方不受影响。")) {
    return;
  }

  const button = $("#clearChatBtn");
  button.disabled = true;

  try {
    const conversationId = activeConversation;

    await api(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/bulk-delete`,
      { method: "POST" }
    );

    if (activeConversation === conversationId) {
      $("#messages").innerHTML = "";
    }

    loadContacts().catch(() => {});
    alert("当前聊天记录已清空");
  } catch (error) {
    alert(error.message || "清空失败");
  } finally {
    button.disabled = !activeConversation;
  }
};

// ========== 群聊创建界面 ==========
function initGroupUI() {
  const sideHead = document.querySelector(".sidebar .side-head");
  if (!sideHead || document.getElementById("newGroup")) return;

  const actions = document.createElement("div");
  actions.className = "side-head-actions";

  const addFriend = document.getElementById("newContact");

  const newGroup = document.createElement("button");
  newGroup.id = "newGroup";
  newGroup.type = "button";
  newGroup.textContent = "\u521b\u5efa\u7fa4\u804a";

  const trigger = document.createElement("button");
  trigger.id = "sideActionTrigger";
  trigger.type = "button";
  trigger.className = "side-action-trigger";
  trigger.textContent = "+";
  trigger.setAttribute("aria-label", "\u66f4\u591a\u529f\u80fd");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.id = "sideActionMenu";
  menu.className = "side-action-menu";
  menu.hidden = true;

  if (addFriend) {
    addFriend.type = "button";
    addFriend.className = "side-action-item";
    addFriend.textContent = "\u6dfb\u52a0\u597d\u53cb";
    menu.appendChild(addFriend);
  }

  newGroup.className = "side-action-item";
  menu.appendChild(newGroup);

  trigger.onclick = event => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
  };

  menu.addEventListener("click", event => {
    event.stopPropagation();
    if (event.target.closest("button")) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("click", event => {
    if (!actions.contains(event.target)) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  actions.append(trigger, menu);
  sideHead.appendChild(actions);

  const modal = document.createElement("div");
  modal.id = "groupModal";
  modal.className = "group-modal";
  modal.hidden = true;

  modal.innerHTML = `
    <div class="group-dialog" role="dialog" aria-modal="true">
      <h3>创建群聊</h3>
      <label for="groupNameInput">群聊名称</label>
      <input id="groupNameInput" maxlength="40" placeholder="请输入群聊名称">
      <div class="group-friend-title">选择好友（至少选择一位）</div>
      <div id="groupFriendChoices" class="group-friend-choices"></div>
      <div id="groupModalError" class="group-modal-error"></div>
      <div class="group-modal-actions">
        <button type="button" id="cancelGroup">取消</button>
        <button type="button" id="confirmGroup" class="primary">创建群聊</button>
      </div>
    </div>
  `;

  document.getElementById("chat").appendChild(modal);

  const closeModal = () => {
    modal.hidden = true;
    $("#groupModalError").textContent = "";
  };

  const refreshChoices = () => {
    const choices = $("#groupFriendChoices");
    choices.innerHTML = "";

    if (!contacts.length) {
      const empty = document.createElement("p");
      empty.className = "group-empty";
      empty.textContent = "目前还没有好友，请先添加好友。";
      choices.appendChild(empty);
      return;
    }

    contacts.forEach(contact => {
      const label = document.createElement("label");
      label.className = "group-choice";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = contact.id;

      const name = document.createElement("span");
      name.textContent =
        contact.display_name || contact.username || "好友";

      label.append(checkbox, name);
      choices.appendChild(label);
    });
  };

  newGroup.onclick = () => {
    $("#groupNameInput").value = "";
    $("#groupModalError").textContent = "";
    refreshChoices();
    modal.hidden = false;
    $("#groupNameInput").focus();
  };

  $("#cancelGroup").onclick = closeModal;

  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });

  $("#confirmGroup").onclick = async () => {
    const name = $("#groupNameInput").value.trim();

    const memberIds = [
      ...$("#groupFriendChoices").querySelectorAll(
        'input[type="checkbox"]:checked'
      )
    ].map(input => input.value);

    if (!name) {
      $("#groupModalError").textContent = "请输入群聊名称";
      return;
    }

    if (!memberIds.length) {
      $("#groupModalError").textContent = "请至少选择一位好友";
      return;
    }

    const button = $("#confirmGroup");
    button.disabled = true;
    $("#groupModalError").textContent = "";

    try {
      const result = await api("/api/conversations/group", {
        method: "POST",
        body: JSON.stringify({ name, memberIds })
      });

      closeModal();

      await loadContacts();

      await openGroup({
        id: result.id,
        name: result.name || name,
        group_name: result.name || name,
        member_count: result.memberCount || memberIds.length + 1
      });
    } catch (error) {
      $("#groupModalError").textContent =
        error.message || "创建群聊失败";
    } finally {
      button.disabled = false;
    }
  };
}

initGroupUI();

// ==========================================
// Group member management
// ==========================================
function initGroupMembersUI() {
  const title = document.getElementById("convTitle");
  if (!title) return;

  title.style.cursor = "pointer";
  title.title = "\u70b9\u51fb\u67e5\u770b\u7fa4\u6210\u5458";

  const modal = document.createElement("div");
  modal.id = "groupMembersModal";
  modal.className = "group-modal";
  modal.hidden = true;

  modal.innerHTML = `
    <div class="group-dialog" role="dialog" aria-modal="true">
      <h3>\u7fa4\u6210\u5458\u7ba1\u7406</h3>
      <div id="groupMembersSummary" class="group-members-summary"></div>

      <div id="groupProfileArea" class="group-profile-area" hidden>
        <label>群名称
          <input id="groupNameInput" maxlength="40" placeholder="请输入群名称">
        </label>
        <label>群公告
          <textarea id="groupAnnouncementInput" maxlength="500" rows="3"
            placeholder="填写群公告，最多 500 字"></textarea>
        </label>
        <button type="button" id="groupProfileSave" class="primary">保存群资料</button>
      </div>
      <div id="groupMembersList" class="group-members-list"></div>

      <div id="groupInviteArea" class="group-invite-area" hidden>
        <div class="group-friend-title">\u9080\u8bf7\u597d\u53cb\u52a0\u5165</div>
        <div id="groupInviteChoices" class="group-friend-choices"></div>
        <button type="button" id="groupInviteConfirm" class="primary">
          \u9080\u8bf7\u9009\u4e2d\u597d\u53cb
        </button>
      </div>

      <div id="groupMembersError" class="group-modal-error"></div>
      <div class="group-modal-actions">
        <button type="button" id="groupLeaveBtn">\u9000\u51fa\u7fa4\u804a</button>
        <button type="button" id="groupDissolveBtn" class="group-remove-button">
          \u89e3\u6563\u7fa4\u804a
        </button>
        <button type="button" id="groupMembersClose">\u5173\u95ed</button>
      </div>
    </div>
  `;

  document.getElementById("chat").appendChild(modal);

  let ownerId = null;
  let refreshing = false;
  let refreshTimer = null;

  const errorBox = document.getElementById("groupMembersError");

  const close = () => {
    modal.hidden = true;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  };

  document.getElementById("groupMembersClose").onclick = close;

  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });

  function resetGroupWindow() {
    if (messageRefreshTimer) clearInterval(messageRefreshTimer);
    messageRefreshTimer = null;

    if (socket) {
      try { socket.close(); } catch {}
      socket = null;
    }

    stopTyping();
    clearRemoteTyping();

    activeConversation = null;
    activeConversationType = null;
    setMobileChatView(false);

    document.getElementById("messages").innerHTML = "";
    document.getElementById("convTitle").textContent =
      "\u9009\u62e9\u8054\u7cfb\u4eba\u5f00\u59cb\u804a\u5929";
    document.getElementById("clearChatBtn").disabled = true;
    document.getElementById("messageInput").disabled = true;
    document.getElementById("sendButton").disabled = true;
    document.getElementById("typingIndicator").hidden = true;

    close();
  }

  async function refreshMembers() {
    if (refreshing || modal.hidden || !activeConversation ||
        activeConversationType !== "group") return;

    refreshing = true;
    const conversationId = activeConversation;

    try {
      const data = await api(
        `/api/conversations/${encodeURIComponent(conversationId)}/members`
      );

      if (activeConversation !== conversationId || modal.hidden) return;

      ownerId = data.ownerId;

      const list = document.getElementById("groupMembersList");
      const summary = document.getElementById("groupMembersSummary");
      const inviteArea = document.getElementById("groupInviteArea");
      const isOwner = me.id === ownerId;
      const selfMember = data.members.find(member => member.id === me.id);
      const isAdmin = !!selfMember && selfMember.role === "admin";
      const isManager = isOwner || isAdmin;

      const profileArea = document.getElementById("groupProfileArea");
      const groupNameInput = document.getElementById("groupNameInput");
      const groupAnnouncementInput = document.getElementById("groupAnnouncementInput");

      profileArea.hidden = !isManager;
      if (document.activeElement !== groupNameInput) {
        groupNameInput.value = data.name || "";
      }
      if (document.activeElement !== groupAnnouncementInput) {
        groupAnnouncementInput.value = data.announcement || "";
      }

      summary.textContent =
        `${data.name || "\u7fa4\u804a"} \u00b7 ${data.members.length} \u4f4d\u6210\u5458`;

      document.getElementById("groupLeaveBtn").hidden = isOwner;
      document.getElementById("groupDissolveBtn").hidden = !isOwner;

      list.innerHTML = "";

      data.members.forEach(member => {
        const row = document.createElement("div");
        row.className = "group-member-row";

        const info = document.createElement("div");
        info.className = "group-member-info";

        const name = document.createElement("b");
        name.textContent = member.display_name || member.username || "群成员";

        const account = document.createElement("small");
        account.textContent = "@" + (member.username || "");
        info.append(name, account);

        const actions = document.createElement("div");
        actions.className = "group-member-actions";

        const isMemberOwner = member.id === ownerId;
        const role = document.createElement("span");
        role.className = "group-role " +
          (member.role === "owner" ? "group-role-owner" :
           member.role === "admin" ? "group-role-admin" : "");
        role.textContent =
          member.role === "owner" ? "群主" :
          member.role === "admin" ? "管理员" : "成员";
        actions.appendChild(role);

        if (isOwner && !isMemberOwner) {
          const transfer = document.createElement("button");
          transfer.type = "button";
          transfer.textContent = "转让群主";
          transfer.onclick = async () => {
            if (!confirm("确定将群主转让给 " + name.textContent + " 吗？")) return;
            transfer.disabled = true;
            try {
              await api(
                "/api/conversations/" + encodeURIComponent(conversationId) + "/transfer-owner",
                { method: "POST", body: JSON.stringify({ newOwnerId: member.id }) }
              );
              await refreshMembers();
              await loadContacts();
            } catch (error) {
              errorBox.textContent = error.message || "转让失败";
              transfer.disabled = false;
            }
          };
          actions.appendChild(transfer);
        }

        const canRemove = !isMemberOwner && member.id !== me.id &&
          (isOwner || (isAdmin && member.role === "member"));

        if (canRemove) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "移除";
          remove.className = "group-remove-button";
          remove.onclick = async () => {
            if (!confirm("确定将 " + name.textContent + " 移出群聊吗？")) return;
            remove.disabled = true;
            try {
              await api(
                "/api/conversations/" + encodeURIComponent(conversationId) +
                "/members/" + encodeURIComponent(member.id),
                { method: "DELETE" }
              );
              await refreshMembers();
              await loadContacts();
            } catch (error) {
              errorBox.textContent = error.message || "移除失败";
              remove.disabled = false;
            }
          };
          actions.appendChild(remove);
        }

        if (isOwner && member.role === "member") {
          const appoint = document.createElement("button");
          appoint.type = "button";
          appoint.textContent = "设为管理员";
          appoint.onclick = async () => {
            if (!confirm("确定将 " + name.textContent + " 设为群管理员吗？")) return;
            appoint.disabled = true;
            try {
              await api(
                "/api/conversations/" + encodeURIComponent(conversationId) +
                "/admins/" + encodeURIComponent(member.id),
                { method: "POST" }
              );
              await refreshMembers();
            } catch (error) {
              errorBox.textContent = error.message || "设置管理员失败";
              appoint.disabled = false;
            }
          };
          actions.appendChild(appoint);
        }

        if (isOwner && member.role === "admin") {
          const revoke = document.createElement("button");
          revoke.type = "button";
          revoke.textContent = "撤销管理员";
          revoke.className = "group-remove-button";
          revoke.onclick = async () => {
            if (!confirm("确定撤销 " + name.textContent + " 的管理员身份吗？")) return;
            revoke.disabled = true;
            try {
              await api(
                "/api/conversations/" + encodeURIComponent(conversationId) +
                "/admins/" + encodeURIComponent(member.id),
                { method: "DELETE" }
              );
              await refreshMembers();
            } catch (error) {
              errorBox.textContent = error.message || "撤销管理员失败";
              revoke.disabled = false;
            }
          };
          actions.appendChild(revoke);
        }

        row.append(info, actions);
        list.appendChild(row);
      });

      inviteArea.hidden = !isManager;

      if (isManager) {
        const choices = document.getElementById("groupInviteChoices");
        choices.innerHTML = "";

        const currentIds = new Set(data.members.map(member => member.id));
        const available = contacts.filter(contact =>
          !currentIds.has(contact.id) && contact.id !== me.id
        );

        if (!available.length) {
          const empty = document.createElement("p");
          empty.className = "group-empty";
          empty.textContent = "\u6ca1\u6709\u53ef\u9080\u8bf7\u7684\u65b0\u597d\u53cb";
          choices.appendChild(empty);
        } else {
          available.forEach(contact => {
            const label = document.createElement("label");
            label.className = "group-choice";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = contact.id;

            const contactName = document.createElement("span");
            contactName.textContent =
              contact.display_name || contact.username || "\u597d\u53cb";

            label.append(checkbox, contactName);
            choices.appendChild(label);
          });
        }
      }

      errorBox.textContent = "";
    } catch (error) {
      if (activeConversation === conversationId) {
        errorBox.textContent = error.message || "\u52a0\u8f7d\u6210\u5458\u5931\u8d25";
      }
    } finally {
      refreshing = false;
    }
  }

  document.getElementById("groupProfileSave").onclick = async () => {
    const button = document.getElementById("groupProfileSave");
    const conversationId = activeConversation;
    if (!conversationId || activeConversationType !== "group") return;

    button.disabled = true;
    try {
      await api(
        "/api/conversations/" + encodeURIComponent(conversationId) + "/group",
        {
          method: "PATCH",
          body: JSON.stringify({
            name: document.getElementById("groupNameInput").value,
            announcement: document.getElementById("groupAnnouncementInput").value
          })
        }
      );
      errorBox.textContent = "群资料已保存";
      await refreshMembers();
      await loadContacts();
    } catch (error) {
      errorBox.textContent = error.message || "保存群资料失败";
    } finally {
      button.disabled = false;
    }
  };

  document.getElementById("groupInviteConfirm").onclick = async () => {
    const button = document.getElementById("groupInviteConfirm");
    const conversationId = activeConversation;

    const memberIds = [
      ...document.querySelectorAll(
        '#groupInviteChoices input[type="checkbox"]:checked'
      )
    ].map(input => input.value);

    if (!memberIds.length) {
      errorBox.textContent = "\u8bf7\u5148\u9009\u62e9\u8981\u9080\u8bf7\u7684\u597d\u53cb";
      return;
    }

    button.disabled = true;

    try {
      const result = await api(
        `/api/conversations/${encodeURIComponent(conversationId)}/members`,
        {
          method: "POST",
          body: JSON.stringify({ memberIds })
        }
      );

      errorBox.textContent =
        `\u6210\u529f\u9080\u8bf7 ${result.added} \u4f4d\u597d\u53cb`;

      await loadContacts();
      await refreshMembers();
    } catch (error) {
      errorBox.textContent = error.message || "\u9080\u8bf7\u5931\u8d25";
    } finally {
      button.disabled = false;
    }
  };

  document.getElementById("groupLeaveBtn").onclick = async () => {
    const conversationId = activeConversation;
    if (!conversationId || me.id === ownerId) return;

    if (!confirm(
      "\u786e\u5b9a\u9000\u51fa\u8fd9\u4e2a\u7fa4\u804a\u5417\uff1f"
    )) return;

    const button = document.getElementById("groupLeaveBtn");
    button.disabled = true;

    try {
      await api(
        `/api/conversations/${encodeURIComponent(conversationId)}/leave`,
        { method: "DELETE" }
      );

      resetGroupWindow();
      await loadContacts();
      alert("\u5df2\u9000\u51fa\u7fa4\u804a");
    } catch (error) {
      errorBox.textContent = error.message || "\u9000\u51fa\u5931\u8d25";
      button.disabled = false;
    }
  };

  document.getElementById("groupDissolveBtn").onclick = async () => {
    const conversationId = activeConversation;
    if (!conversationId || me.id !== ownerId) return;

    if (!confirm(
      "\u89e3\u6563\u540e\u6240\u6709\u6210\u5458\u90fd\u5c06\u65e0\u6cd5\u518d\u8bbf\u95ee\u7fa4\u804a\uff0c\u5e76\u5220\u9664\u7fa4\u804a\u5386\u53f2\u6d88\u606f\u3002\u786e\u5b9a\u89e3\u6563\uff1f"
    )) return;

    const button = document.getElementById("groupDissolveBtn");
    button.disabled = true;

    try {
      await api(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" }
      );

      resetGroupWindow();
      await loadContacts();
      alert("\u7fa4\u804a\u5df2\u89e3\u6563");
    } catch (error) {
      errorBox.textContent = error.message || "\u89e3\u6563\u5931\u8d25";
      button.disabled = false;
    }
  };

  title.addEventListener("click", async () => {
    if (!activeConversation || activeConversationType !== "group") return;

    await loadContacts();
    modal.hidden = false;
    await refreshMembers();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      refreshMembers().catch(() => {});
    }, 5000);
  });
}

initGroupMembersUI();


// CLOUDCHAT_MENTION_V1
(() => {
  const input = document.getElementById("messageInput");
  const form = document.getElementById("sendForm");
  if (!input || !form) return;

  const panel = document.createElement("div");
  panel.id = "mentionSuggestions";
  panel.className = "mention-suggestions";
  panel.hidden = true;
  form.appendChild(panel);

  let members = [];
  let cachedConversation = "";
  let loading = false;
  let activeIndex = 0;
  let matches = [];
  let requestId = 0;

  function hide() {
    panel.hidden = true;
    matches = [];
    activeIndex = 0;
  }

  async function loadMembers() {
    const id = activeConversation;

    if (!id || activeConversationType !== "group") {
      return [];
    }

    if (cachedConversation === id) return members;
    if (loading) return [];

    loading = true;
    const currentRequest = ++requestId;

    try {
      const data = await api(
        `/api/conversations/${encodeURIComponent(id)}/members`
      );

      if (
        currentRequest !== requestId ||
        activeConversation !== id ||
        activeConversationType !== "group"
      ) return [];

      members = Array.isArray(data.members) ? data.members : [];
      cachedConversation = id;
      return members;
    } catch (error) {
      console.error("加载 @ 成员失败：", error);
      return [];
    } finally {
      loading = false;
    }
  }

  function insertMember(member) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);

    const token = before.match(/(^|\s)@[^\s@]*$/);
    if (!token) return;

    const replacement =
      token[1] + "@" +
      (member.display_name || member.username || "群成员") + " ";

    input.value =
      before.slice(0, before.length - token[0].length) +
      replacement + after;

    const position = input.value.length - after.length;
    input.focus();
    input.setSelectionRange(position, position);

    hide();
  }

  function render(list) {
    panel.replaceChildren();
    matches = list;
    activeIndex = 0;

    if (!list.length) {
      hide();
      return;
    }

    list.forEach((member, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "mention-option";

      const name = document.createElement("span");
      name.textContent =
        member.display_name || member.username || "群成员";

      const account = document.createElement("small");
      account.textContent = "@" + (member.username || "");

      item.append(name, account);

      item.addEventListener("mousedown", event => {
        event.preventDefault();
        insertMember(member);
      });

      panel.appendChild(item);
    });

    panel.hidden = false;
  }

  async function update() {
    if (
      activeConversationType !== "group" ||
      !activeConversation
    ) {
      hide();
      return;
    }

    const cursor = input.selectionStart;
    const before = input.value.slice(0, cursor);
    const token = before.match(/(^|\s)@([^\s@]*)$/);

    if (!token) {
      hide();
      return;
    }

    const keyword = token[2].toLowerCase();
    const id = activeConversation;

    const list = await loadMembers();

    if (activeConversation !== id) return;

    const filtered = list.filter(member => {
      const name = String(member.display_name || "").toLowerCase();
      const username = String(member.username || "").toLowerCase();

      return !keyword ||
        name.includes(keyword) ||
        username.includes(keyword);
    });

    render(filtered);
  }

  input.addEventListener("input", update);

  input.addEventListener("keydown", event => {
    if (panel.hidden || !matches.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex =
        (activeIndex - 1 + matches.length) % matches.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      insertMember(matches[activeIndex]);
      return;
    } else if (event.key === "Escape") {
      hide();
      return;
    } else {
      return;
    }

    [...panel.children].forEach((item, index) => {
      item.classList.toggle("active", index === activeIndex);
    });
  });

  input.addEventListener("blur", () => {
    setTimeout(hide, 150);
  });

  document.addEventListener("click", event => {
    if (!form.contains(event.target)) hide();
  });

  const originalOpenGroup = window.openGroup;
  if (typeof originalOpenGroup === "function") {
    console.log("群聊 @ 成员功能已初始化");
  }

  console.log("CloudChat @ 成员选择功能已加载");
})();

