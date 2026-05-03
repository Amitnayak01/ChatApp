/* ═══════════════════════════════════════════════
   NEXUS CHAT — Frontend Application
═══════════════════════════════════════════════ */
(function () {
  "use strict";

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

  const joinScreen     = $("#join-screen");
  const chatScreen     = $("#chat-screen");
  const usernameInput  = $("#username");
  const charCount      = $("#char-count");
  const joinBtn        = $("#join-user");
  const messagesEl     = $("#messages");
  const messagesInner  = $("#messages-inner");
  const messageInput   = $("#message-input");
  const sendBtn        = $("#send-message");
  const exitBtn        = $("#exit-chat");
  const userListEl     = $("#user-list");
  const onlineCount    = $("#online-count");
  const userSearch     = $("#user-search");
  const emojiBtn       = $("#emoji-btn");
  const emojiPicker    = $("#emoji-picker");
  const emojiGrid      = $("#emoji-grid");
  const typingBar      = $("#typing-bar");
  const typingText     = $("#typing-text");
  const chatHeaderName = $("#chat-header-name");
  const chatHeaderSub  = $("#chat-header-sub");
  const chatHeaderAvatar = $("#chat-header-avatar");
  const myAvatarSidebar  = $("#my-avatar-sidebar");
  const myNameSidebar    = $("#my-name-sidebar");
  const themeToggle    = $("#theme-toggle");
  const menuBtn        = $("#menu-btn");
  const sidebar        = $("#sidebar");
  const sidebarOverlay = $("#sidebar-overlay");
  const sidebarClose   = $("#sidebar-close");
  const backToGeneral  = $("#back-to-general");
  const reactionPopup  = $("#reaction-popup");
  const reactionList   = $("#reaction-list");
  const notifSound     = $("#notif-sound");
  const generalUnread  = $("#general-unread");
  const channelItemGeneral = $('[data-room="general"]');

  // ─── State ────────────────────────────────────────────────────────────────
  const socket = io();
  let myUsername    = "";
  let currentMode   = "general";
  let currentPeer   = null;
  let typingTimeout = null;
  let typingUsers   = new Set();
  let reactions     = {};
  let unreadGeneral = 0;
  let unreadDM      = {};
  let lastMsgDate   = "";
  let messageEls    = {};
  let theme         = localStorage.getItem("nexus-theme") || "dark";

  const EMOJIS = ["😀","😂","😍","🥰","😎","🤔","😤","🥺","😭","🔥","💯","👏","🙌","❤️","💔","✨","🎉","🎊","👍","👎","🤝","💪","🙏","👀","💀","🤯","😱","🥳","😴","🤣","💬","📎","🔗","⚡","🌟","💡","🎯","🚀","🌈","🦄"];
  const REACTION_EMOJIS = ["❤️","👍","😂","😮","😢","🔥","👀","🎉"];

  // ─── Theme ────────────────────────────────────────────────────────────────
  function applyTheme(t) {
    theme = t;
    document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "");
    localStorage.setItem("nexus-theme", t);
  }
  applyTheme(theme);
  themeToggle.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));

  // ─── Auto-rejoin on refresh ───────────────────────────────────────────────
  // If a username was saved from a previous session, skip the join screen
  const savedUsername = localStorage.getItem("nexus-username");
  if (savedUsername) {
    myUsername = savedUsername;
    joinScreen.classList.remove("active");
    chatScreen.classList.add("active");
    messageInput.focus();
    setupMyProfile();
    // newuser is emitted inside socket.on("connect") below
  }

  // ─── Join ─────────────────────────────────────────────────────────────────
  usernameInput.addEventListener("input", () => {
    const len = usernameInput.value.length;
    charCount.textContent = `${len}/24`;
    charCount.style.color = len > 20 ? "var(--accent)" : "";
  });

  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) return;
    myUsername = username;
    localStorage.setItem("nexus-username", myUsername);
    socket.emit("newuser", myUsername);
    joinScreen.classList.remove("active");
    chatScreen.classList.add("active");
    messageInput.focus();
    setupMyProfile();
  });

  function setupMyProfile() {
    const color = stringToColor(myUsername);
    myAvatarSidebar.textContent = getInitials(myUsername);
    myAvatarSidebar.style.background = color;
    myNameSidebar.textContent = myUsername;
  }

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  menuBtn.addEventListener("click", openSidebar);
  sidebarClose.addEventListener("click", closeSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);

  function openSidebar()  { sidebar.classList.add("open"); sidebarOverlay.classList.add("active"); }
  function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("active"); }

  // ─── Messaging ────────────────────────────────────────────────────────────
  sendBtn.addEventListener("click", sendMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  messageInput.addEventListener("input", () => {
    handleTyping();
    sendBtn.disabled = messageInput.textContent.trim().length === 0;
  });

  function sendMessage() {
    const text = messageInput.textContent.trim();
    if (!text) return;

    const msg = {
      id: genId(),
      type: "text",
      sender: { id: socket.id, username: myUsername, color: stringToColor(myUsername) },
      text,
      timestamp: new Date().toISOString(),
      status: "sent",
    };

    renderMessage("my", msg);

    if (currentMode === "general") {
      socket.emit("chat", { username: myUsername, text });
    } else {
      socket.emit("private_message", { toId: currentMode, text });
    }

    messageInput.textContent = "";
    sendBtn.disabled = true;
    stopTypingEmit();
    scrollToBottom();
  }

  // ─── Typing ───────────────────────────────────────────────────────────────
  function handleTyping() {
    if (typingTimeout) clearTimeout(typingTimeout);
    socket.emit("typing", {
      room: currentMode === "general" ? "general" : null,
      toId: currentMode === "general" ? null : currentMode,
    });
    typingTimeout = setTimeout(stopTypingEmit, 2500);
  }

  function stopTypingEmit() {
    if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
    socket.emit("stop_typing", {
      room: currentMode === "general" ? "general" : null,
      toId: currentMode === "general" ? null : currentMode,
    });
  }

  // ─── Exit — clears saved session so logout works properly ─────────────────
  exitBtn.addEventListener("click", () => {
    localStorage.removeItem("nexus-username");
    socket.emit("exituser", myUsername);
    window.location.reload();
  });

  // ─── Emoji Picker ─────────────────────────────────────────────────────────
  EMOJIS.forEach(emoji => {
    const btn = document.createElement("button");
    btn.className = "emoji-btn-item";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      insertAtCursor(emoji);
      emojiPicker.style.display = "none";
      messageInput.focus();
    });
    emojiGrid.appendChild(btn);
  });

  emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
  });

  document.addEventListener("click", (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.style.display = "none";
    }
    if (!reactionPopup.contains(e.target)) {
      reactionPopup.style.display = "none";
    }
  });

  function insertAtCursor(text) {
    messageInput.focus();
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(document.createTextNode(text));
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      messageInput.textContent += text;
    }
    messageInput.dispatchEvent(new Event("input"));
  }

  // ─── Channel / DM Switching ───────────────────────────────────────────────
  if (channelItemGeneral) channelItemGeneral.addEventListener("click", switchToGeneral);
  if (backToGeneral) backToGeneral.addEventListener("click", switchToGeneral);

  function switchToGeneral() {
    currentMode = "general";
    currentPeer = null;
    chatHeaderName.textContent = "general";
    chatHeaderSub.textContent = "global channel";
    chatHeaderAvatar.innerHTML = `<span class="channel-hash-lg">#</span>`;
    chatHeaderAvatar.style.background = "";
    messageInput.dataset.placeholder = "Message #general";
    backToGeneral.style.display = "none";
    $$(".user-item").forEach(el => el.classList.remove("active"));
    $$(".channel-item").forEach(el => el.classList.add("active"));
    unreadGeneral = 0;
    generalUnread.style.display = "none";
    generalUnread.textContent = "";
    clearMessages();
    appendWelcomeGeneral();
    socket.emit("get_user_list");
    scrollToBottom();
    closeSidebar();
  }

  function appendWelcomeGeneral() {
    messagesInner.innerHTML = `
      <div class="welcome-banner">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z"/>
            <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <h3>Welcome to #general</h3>
        <p>The beginning of the nexus. Say hello!</p>
      </div>`;
  }

  function openDM(user) {
    if (!user || user.id === socket.id) return;
    currentMode = user.id;
    currentPeer = user;
    chatHeaderName.innerHTML = `<span class="dm-indicator"><span class="dm-dot"></span>${escHtml(user.username)}</span>`;
    chatHeaderSub.textContent = "direct message";
    chatHeaderAvatar.textContent = getInitials(user.username);
    chatHeaderAvatar.style.background = user.color;
    messageInput.dataset.placeholder = `Message ${user.username}`;
    backToGeneral.style.display = "flex";
    $$(".channel-item").forEach(el => el.classList.remove("active"));
    $$(".user-item").forEach(el => el.classList.remove("active"));
    const userEl = $(`.user-item[data-id="${user.id}"]`);
    if (userEl) userEl.classList.add("active");
    clearMessages();
    messagesInner.innerHTML = `
      <div class="welcome-banner">
        <div class="welcome-icon" style="font-size:1.6rem;display:flex;align-items:center;justify-content:center;">${getInitials(user.username)}</div>
        <h3>DM with ${escHtml(user.username)}</h3>
        <p>Only the two of you can see this.</p>
      </div>`;
    socket.emit("get_private_history", user.id);
    delete unreadDM[user.id];
    const badge = $(`.user-item[data-id="${user.id}"] .badge`);
    if (badge) badge.style.display = "none";
    closeSidebar();
    scrollToBottom();
  }

  function clearMessages() {
    messagesInner.innerHTML = "";
    lastMsgDate = "";
    messageEls = {};
  }

  // ─── User List ────────────────────────────────────────────────────────────
  userSearch.addEventListener("input", () => {
    const q = userSearch.value.toLowerCase();
    $$(".user-item").forEach(el => {
      const name = el.querySelector(".u-name").textContent.toLowerCase();
      el.style.display = name.includes(q) ? "" : "none";
    });
  });

  function renderUserList(users) {
    const others = users.filter(u => u.id !== socket.id);
    onlineCount.textContent = others.filter(u => u.status === "online").length;
    userListEl.innerHTML = "";
    others.forEach(u => {
      const el = document.createElement("div");
      el.className = "user-item";
      el.dataset.id = u.id;
      const unread = unreadDM[u.id] || 0;
      el.innerHTML = `
        <div class="user-avatar-wrap">
          <div class="user-av" style="background:${u.color}">${getInitials(u.username)}</div>
          <div class="av-status ${u.status !== 'online' ? 'offline' : ''}"></div>
        </div>
        <div class="user-info">
          <span class="u-name">${escHtml(u.username)}</span>
          <span class="u-status">${u.status === 'online' ? '● Online' : 'Away'}</span>
        </div>
        <span class="badge" style="${unread ? '' : 'display:none'}">${unread || ''}</span>
      `;
      el.addEventListener("click", () => openDM(u));
      if (currentMode === u.id) el.classList.add("active");
      userListEl.appendChild(el);
    });
  }

  // ─── Render Message ───────────────────────────────────────────────────────
  function renderMessage(type, msg) {
    if (!msg || typeof msg !== "object") return;

    if (msg.timestamp) {
      const dateStr = new Date(msg.timestamp).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      if (dateStr !== lastMsgDate) {
        lastMsgDate = dateStr;
        const divider = document.createElement("div");
        divider.className = "date-divider";
        divider.innerHTML = `<span>${dateStr}</span>`;
        messagesInner.appendChild(divider);
      }
    }

    if (type === "update") {
      const el = document.createElement("div");
      el.className = "msg-update";
      el.textContent = typeof msg === "string" ? msg : (msg.text || "");
      messagesInner.appendChild(el);
      scrollToBottom();
      return;
    }

    const isMe = type === "my";
    const group = document.createElement("div");
    group.className = `msg-group ${isMe ? "my-group" : "other-group"}`;
    if (msg.id) group.dataset.msgId = msg.id;

    const avatarEl = document.createElement("div");
    avatarEl.className = "msg-av";
    avatarEl.style.background = msg.sender?.color || stringToColor(msg.sender?.username || "?");
    avatarEl.textContent = getInitials(msg.sender?.username || "?");

    const bodyEl = document.createElement("div");
    bodyEl.className = "msg-body";

    if (!isMe) {
      const senderEl = document.createElement("div");
      senderEl.className = "msg-sender";
      senderEl.style.color = msg.sender?.color || "var(--accent)";
      senderEl.textContent = msg.sender?.username || "";
      bodyEl.appendChild(senderEl);
    }

    const bubble = document.createElement("div");
    bubble.className = `bubble ${isMe ? "my-bubble" : "other-bubble"}`;
    bubble.textContent = msg.text || "";

    let pressTimer;
    bubble.addEventListener("contextmenu", (e) => { e.preventDefault(); showReactionPicker(e, msg.id); });
    bubble.addEventListener("touchstart", () => { pressTimer = setTimeout(() => showReactionPicker(null, msg.id, bubble), 500); }, { passive: true });
    bubble.addEventListener("touchend", () => clearTimeout(pressTimer));

    bodyEl.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `
      <span class="msg-time">${formatTime(msg.timestamp)}</span>
      ${isMe ? `<span class="msg-status" id="status-${msg.id}">✓</span>` : ""}
    `;
    bodyEl.appendChild(meta);

    const reactionsEl = document.createElement("div");
    reactionsEl.className = "msg-reactions";
    reactionsEl.id = `reactions-${msg.id}`;
    bodyEl.appendChild(reactionsEl);

    group.appendChild(avatarEl);
    group.appendChild(bodyEl);
    messagesInner.appendChild(group);

    if (msg.id) messageEls[msg.id] = { group, bubble, meta };
    if (!isMe && document.hidden) playNotif();
    scrollToBottom();
  }

  // ─── Reactions ────────────────────────────────────────────────────────────
  function showReactionPicker(e, msgId, refEl) {
    reactionList.innerHTML = "";
    REACTION_EMOJIS.forEach(emoji => {
      const btn = document.createElement("button");
      btn.className = "reaction-item";
      btn.textContent = emoji;
      btn.addEventListener("click", () => {
        sendReaction(msgId, emoji);
        reactionPopup.style.display = "none";
      });
      reactionList.appendChild(btn);
    });
    if (e) {
      reactionPopup.style.top = `${e.clientY - 60}px`;
      reactionPopup.style.left = `${Math.min(e.clientX, window.innerWidth - 300)}px`;
    } else if (refEl) {
      const r = refEl.getBoundingClientRect();
      reactionPopup.style.top = `${r.top - 60}px`;
      reactionPopup.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
    }
    reactionPopup.style.display = "flex";
  }

  function sendReaction(msgId, emoji) {
    if (!msgId) return;
    if (!reactions[msgId]) reactions[msgId] = {};
    if (!reactions[msgId][emoji]) reactions[msgId][emoji] = { count: 0, mine: false };
    reactions[msgId][emoji].mine = !reactions[msgId][emoji].mine;
    reactions[msgId][emoji].count += reactions[msgId][emoji].mine ? 1 : -1;
    renderReactions(msgId);
    socket.emit("react", {
      messageId: msgId,
      emoji,
      room: currentMode === "general" ? "general" : null,
      peerId: currentMode !== "general" ? currentMode : null,
    });
  }

  function renderReactions(msgId) {
    const el = $(`#reactions-${msgId}`);
    if (!el) return;
    el.innerHTML = "";
    const r = reactions[msgId] || {};
    Object.entries(r).forEach(([emoji, data]) => {
      if (data.count <= 0) return;
      const chip = document.createElement("div");
      chip.className = `reaction-chip${data.mine ? " mine" : ""}`;
      chip.innerHTML = `${emoji} <span class="r-count">${data.count}</span>`;
      chip.addEventListener("click", () => sendReaction(msgId, emoji));
      el.appendChild(chip);
    });
  }

  // ─── Socket Events ────────────────────────────────────────────────────────
  socket.on("connect", () => {
    // Always re-register on (re)connect — handles page refresh & socket reconnects
    if (myUsername) {
      socket.emit("newuser", myUsername);
    }
    socket.emit("get_user_list");
  });

  socket.on("update", (msg) => {
    if (currentMode === "general") renderMessage("update", { text: msg });
  });

  socket.on("chat", (data) => {
    if (currentMode !== "general") {
      unreadGeneral++;
      generalUnread.textContent = unreadGeneral;
      generalUnread.style.display = "";
      playNotif();
      return;
    }
    const msg = typeof data === "string"
      ? { text: data, sender: { username: "?" }, timestamp: new Date().toISOString() }
      : {
          id: data.id || genId(),
          type: "text",
          sender: data.sender || { username: data.username || "?", color: stringToColor(data.username || "?") },
          text: data.text,
          timestamp: data.timestamp || new Date().toISOString(),
        };
    renderMessage("other", msg);
    playNotif();
  });

  socket.on("message_sent", (msg) => {
    const el = $(`#status-${msg.id}`);
    if (el) { el.textContent = "✓✓"; el.className = "msg-status delivered"; }
  });

  socket.on("history", (msgs) => {
    if (currentMode !== "general") return;
    msgs.forEach(msg => renderMessage(msg.sender?.id === socket.id ? "my" : "other", msg));
  });

  socket.on("private_message", (msg) => {
    if (currentMode === msg.sender.id) {
      renderMessage("other", msg);
      socket.emit("message_seen", { messageId: msg.id, senderId: msg.sender.id });
    } else {
      unreadDM[msg.sender.id] = (unreadDM[msg.sender.id] || 0) + 1;
      const badge = $(`.user-item[data-id="${msg.sender.id}"] .badge`);
      if (badge) {
        badge.textContent = unreadDM[msg.sender.id];
        badge.style.display = "";
      }
      playNotif();
    }
  });

  socket.on("private_history", ({ peerId, messages: msgs }) => {
    if (currentMode !== peerId) return;
    msgs.forEach(msg => renderMessage(msg.sender?.id === socket.id ? "my" : "other", msg));
    scrollToBottom();
  });

  socket.on("user_list", renderUserList);

  socket.on("user_joined", ({ user }) => {
    if (currentMode === "general") renderMessage("update", { text: `${user.username} joined` });
  });

  socket.on("user_left", ({ username }) => {
    if (currentMode === "general") renderMessage("update", { text: `${username} left` });
  });

  socket.on("typing", ({ userId, username, toId }) => {
    const relevant = toId ? currentMode === userId : currentMode === "general";
    if (!relevant) return;
    typingUsers.add(username);
    updateTypingBar();
  });

  socket.on("stop_typing", ({ userId, username, toId }) => {
    const relevant = toId ? currentMode === userId : currentMode === "general";
    if (!relevant) return;
    typingUsers.delete(username);
    updateTypingBar();
  });

  socket.on("message_seen", ({ messageId }) => {
    const el = $(`#status-${messageId}`);
    if (el) { el.textContent = "✓✓"; el.className = "msg-status seen"; }
  });

  socket.on("react", ({ messageId, emoji, userId }) => {
    if (!reactions[messageId]) reactions[messageId] = {};
    if (!reactions[messageId][emoji]) reactions[messageId][emoji] = { count: 0, mine: false };
    if (userId !== socket.id) {
      reactions[messageId][emoji].count++;
      renderReactions(messageId);
    }
  });

  function updateTypingBar() {
    const arr = Array.from(typingUsers);
    if (arr.length === 0) {
      typingBar.style.display = "none";
    } else {
      typingBar.style.display = "flex";
      const names = arr.slice(0, 3).join(", ");
      typingText.textContent = `${names} ${arr.length === 1 ? "is" : "are"} typing…`;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
    });
  }

  function formatTime(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  }

  function genId() { return Math.random().toString(36).slice(2, 10); }
  function getInitials(name) { return name ? name.slice(0, 2).toUpperCase() : "??"; }
  function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function stringToColor(str) {
    const colors = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF6FC8","#A78BFA","#34D399","#F97316","#06B6D4","#EC4899"];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function playNotif() {
    try { notifSound.currentTime = 0; notifSound.play().catch(() => {}); } catch (e) {}
  }

})();