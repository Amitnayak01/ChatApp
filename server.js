const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 5e6, // 5MB for file uploads
});

app.use(express.static(path.join(__dirname)));

// ─── In-Memory Storage ────────────────────────────────────────────────────────
const users = new Map();       // socketId → { id, username, avatar, color, status, lastSeen }
const rooms = new Map();       // roomName → Set of socketIds
const messages = [];           // Global chat history (last 100)
const privateMessages = new Map(); // "uid1:uid2" → [msgs]
const typingUsers = new Map(); // socketId → timeout

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF6FC8","#A78BFA","#34D399","#F97316"];
const getColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
const getAvatar = (name) => name.slice(0, 2).toUpperCase();
const generateId = () => Math.random().toString(36).slice(2, 10);
const roomKey = (a, b) => [a, b].sort().join(":");

function getUserList() {
  return Array.from(users.values()).map(u => ({
    id: u.id, username: u.username, avatar: u.avatar,
    color: u.color, status: u.status, lastSeen: u.lastSeen
  }));
}

function saveMessage(msg) {
  messages.push(msg);
  if (messages.length > 100) messages.shift();
  return msg;
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {

  // ── Join ────────────────────────────────────────────────────────────────────
  socket.on("newuser", (username) => {
    const user = {
      id: socket.id,
      username: username.trim().slice(0, 24),
      avatar: getAvatar(username),
      color: getColor(),
      status: "online",
      lastSeen: new Date().toISOString(),
    };
    users.set(socket.id, user);

    socket.join("general");
    if (!rooms.has("general")) rooms.set("general", new Set());
    rooms.get("general").add(socket.id);

    // Send history to new user
    socket.emit("history", messages.slice(-50));
    // Broadcast join notification (keep "update" event for backward compat)
    socket.broadcast.emit("update", `${user.username} joined the conversation`);
    // New structured event
    io.emit("user_list", getUserList());
    io.emit("user_joined", { user, message: `${user.username} joined` });
  });

  // ── Global Chat (keep "chat" event for backward compat) ─────────────────────
  socket.on("chat", (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const msg = saveMessage({
      id: generateId(),
      type: "text",
      room: "general",
      sender: { id: user.id, username: user.username, avatar: user.avatar, color: user.color },
      text: data.text || data,
      timestamp: new Date().toISOString(),
      status: "delivered",
    });
    socket.broadcast.emit("chat", msg);
    socket.emit("message_sent", msg);
  });

  // ── Private Message ─────────────────────────────────────────────────────────
  socket.on("private_message", ({ toId, text, fileData }) => {
    const from = users.get(socket.id);
    const to = users.get(toId);
    if (!from || !to) return;
    const key = roomKey(socket.id, toId);
    if (!privateMessages.has(key)) privateMessages.set(key, []);

    const msg = {
      id: generateId(),
      type: fileData ? "file" : "text",
      room: key,
      sender: { id: from.id, username: from.username, avatar: from.avatar, color: from.color },
      text: text || "",
      fileData: fileData || null,
      timestamp: new Date().toISOString(),
      status: "delivered",
    };
    privateMessages.get(key).push(msg);
    if (privateMessages.get(key).length > 100) privateMessages.get(key).shift();

    socket.to(toId).emit("private_message", msg);
    socket.emit("private_message_sent", msg);
  });

  // ── Fetch Private History ───────────────────────────────────────────────────
  socket.on("get_private_history", (peerId) => {
    const key = roomKey(socket.id, peerId);
    socket.emit("private_history", {
      peerId,
      messages: (privateMessages.get(key) || []).slice(-50)
    });
  });

  // ── Typing ───────────────────────────────────────────────────────────────────
  socket.on("typing", ({ room, toId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (typingUsers.has(socket.id)) clearTimeout(typingUsers.get(socket.id));
    const timeout = setTimeout(() => {
      stopTyping(socket, user, room, toId);
    }, 3000);
    typingUsers.set(socket.id, timeout);
    const payload = { userId: socket.id, username: user.username, room, toId };
    if (toId) socket.to(toId).emit("typing", payload);
    else socket.to("general").emit("typing", payload);
  });

  socket.on("stop_typing", ({ room, toId }) => {
    const user = users.get(socket.id);
    stopTyping(socket, user, room, toId);
  });

  function stopTyping(socket, user, room, toId) {
    if (typingUsers.has(socket.id)) {
      clearTimeout(typingUsers.get(socket.id));
      typingUsers.delete(socket.id);
    }
    if (!user) return;
    const payload = { userId: socket.id, username: user.username, room, toId };
    if (toId) socket.to(toId).emit("stop_typing", payload);
    else socket.to("general").emit("stop_typing", payload);
  }

  // ── Message Seen ─────────────────────────────────────────────────────────────
  socket.on("message_seen", ({ messageId, senderId }) => {
    socket.to(senderId).emit("message_seen", { messageId, seenBy: socket.id });
  });

  // ── React to Message ─────────────────────────────────────────────────────────
  socket.on("react", ({ messageId, emoji, room, peerId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const payload = { messageId, emoji, userId: socket.id, username: user.username };
    if (peerId) {
      socket.to(peerId).emit("react", payload);
    } else {
      socket.to("general").emit("react", payload);
    }
    socket.emit("react", payload);
  });

  // ── Request User List ─────────────────────────────────────────────────────────
  socket.on("get_user_list", () => {
    socket.emit("user_list", getUserList());
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;
    user.status = "offline";
    user.lastSeen = new Date().toISOString();
    users.delete(socket.id);
    if (typingUsers.has(socket.id)) {
      clearTimeout(typingUsers.get(socket.id));
      typingUsers.delete(socket.id);
    }
    socket.broadcast.emit("update", `${user.username} left the conversation`);
    io.emit("user_list", getUserList());
    io.emit("user_left", { userId: socket.id, username: user.username });
  });

  // ── Exit user (backward compat) ───────────────────────────────────────────────
  socket.on("exituser", (username) => {
    socket.broadcast.emit("update", `${username} left the conversation`);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});