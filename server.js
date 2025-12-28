const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === REDIS SETUP (Upstash) ===
const redisUrl = process.env.UPSTASH_REDIS_URL; // rediss://default:TOKEN@host:6379
const pub = new Redis(redisUrl);
const sub = new Redis(redisUrl);

// Online user tracking (per office, super admin sees all)
const onlineUsers = new Map(); // userId => { officeId, socketId, role }

// Subscribe to notifications channel
sub.subscribe("notifications", (err, count) => {
  if (err) console.error("Redis subscribe error:", err);
  else console.log(`Subscribed to ${count} channel(s)`);
});

sub.on("message", (_, message) => {
  try {
    const data = JSON.parse(message);

    // Chat / notifications logic
    if (data.userId) io.to(`user:${data.userId}`).emit(data.type, data);
    if (data.officeId) io.to(`office:${data.officeId}`).emit(data.type, data);
    if (data.role === "super_admin") io.to("admins").emit(data.type, data);
  } catch (e) {
    console.error("Invalid message format:", message);
  }
});

// === SOCKET.IO LOGIC ===
io.on("connection", (socket) => {
  const { userId, officeId, role } = socket.handshake.auth;

  if (!userId || !officeId || !role) return socket.disconnect(true);

  // Save online user
  onlineUsers.set(userId, { officeId, socketId: socket.id, role });

  // Join rooms
  socket.join(`user:${userId}`);
  socket.join(`office:${officeId}`);
  if (role === "super_admin") socket.join("admins");

  console.log(`Connected user=${userId} office=${officeId} role=${role}`);

  // Emit initial online user count
  updateOnlineCounts();

  // Receive chat from client
  socket.on("chat_message", (data) => {
    const { toUserId, toOfficeId, message } = data;

    if (toUserId)
      io.to(`user:${toUserId}`).emit("chat_message", {
        from: userId,
        message,
      });

    if (toOfficeId)
      io.to(`office:${toOfficeId}`).emit("chat_message", {
        from: userId,
        message,
      });

    if (role === "super_admin")
      io.emit("chat_message", {
        from: userId,
        message,
      });
  });

  // Ping/pong test
  socket.on("ping", () => socket.emit("pong", { time: Date.now() }));

  socket.on("disconnect", () => {
    console.log(`Disconnected user=${userId}`);
    onlineUsers.delete(userId);
    updateOnlineCounts();
  });
});

// === Helper: Send online counts to rooms / super admin
function updateOnlineCounts() {
  const officeCounts = {}; // officeId => count
  onlineUsers.forEach((u) => {
    officeCounts[u.officeId] = (officeCounts[u.officeId] || 0) + 1;
  });

  // Send count to each office room
  Object.entries(officeCounts).forEach(([officeId, count]) => {
    io.to(`office:${officeId}`).emit("online_count", { officeId, count });
  });

  // Super admin sees all users
  const allUsers = Array.from(onlineUsers.entries()).map(([uid, info]) => ({
    userId: uid,
    officeId: info.officeId,
    role: info.role,
  }));
  io.to("admins").emit("online_users", allUsers);
}

// === START SERVER ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("WS server listening on", PORT);
});
