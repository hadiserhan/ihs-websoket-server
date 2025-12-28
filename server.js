const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

let redis;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);

  redis.subscribe("notifications");
  redis.on("message", (_, message) => {
    const data = JSON.parse(message);
    io.to(`user:${data.userId}`).emit(data.type, data);
  });
} else {
  console.log("Redis disabled (local mode)");
}

// Simple health check
app.get("/", (req, res) => {
  res.send("WebSocket server running");
});

// WebSocket connection
io.on("connection", (socket) => {
  const userId = socket.handshake.auth?.userId || "guest";
  socket.join(`user:${userId}`);

  console.log("User connected:", userId);

  socket.emit("connected", { message: "Connected to WS server" });

  // receive from client
  socket.on("client_message", (data) => {
    console.log("From client:", data);

    // respond back
    socket.emit("server_message", {
      message: "Server received: " + data.message,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WS server listening on ${PORT}`);
});
