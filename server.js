const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const roomMembers = new Map();
const socketToRoom = new Map();
const sessionLogs = new Map();

const GOOGLE_SCRIPT_URL =
  process.env.GOOGLE_SCRIPT_URL || "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL";

async function sendLogToGoogleSheet(entry) {
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL")) {
    console.log("Google Script URL not configured. Skipping log.");
    return;
  }

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(entry),
      redirect: "follow"
    });
  } catch (error) {
    console.error("Failed to send log to Google Sheet:", error);
  }
}

io.on("connection", (socket) => {
  socket.on("join-room", async (payload) => {
    try {
      const room = String(payload?.roomCode || "").trim();
      if (!room) return;

      if (!roomMembers.has(room)) {
        roomMembers.set(room, new Set());
      }

      const members = roomMembers.get(room);
      const existingPeers = [...members];

      members.add(socket.id);
      socketToRoom.set(socket.id, room);
      socket.join(room);

      const joinedAt = new Date().toISOString();

      sessionLogs.set(socket.id, {
        socketId: socket.id,
        roomCode: room,
        joinedAt,
        leftAt: "",
        durationSeconds: "",
        userAgent: payload?.userAgent || "",
        platform: payload?.platform || "",
        language: payload?.language || "",
        timezone: payload?.timezone || "",
        screenWidth: payload?.screen?.width || "",
        screenHeight: payload?.screen?.height || "",
        latitude: payload?.location?.latitude || "",
        longitude: payload?.location?.longitude || "",
        accuracy: payload?.location?.accuracy || "",
        ip:
          socket.handshake.headers["x-forwarded-for"] ||
          socket.handshake.address ||
          ""
      });

      socket.emit("existing-peers", existingPeers);
      socket.emit("room-user-count", members.size);
      socket.to(room).emit("peer-joined", socket.id);
      io.to(room).emit("room-user-count", members.size);

      await sendLogToGoogleSheet({
        event: "join",
        ...sessionLogs.get(socket.id)
      });
    } catch (error) {
      console.error("join-room error:", error);
    }
  });

  socket.on("offer", ({ target, caller, sdp }) => {
    io.to(target).emit("offer", { caller, sdp });
  });

  socket.on("answer", ({ target, responder, sdp }) => {
    io.to(target).emit("answer", { responder, sdp });
  });

  socket.on("ice-candidate", ({ target, sender, candidate }) => {
    io.to(target).emit("ice-candidate", { sender, candidate });
  });

  socket.on("leave-room", async () => {
    await removeSocketFromRoom(socket);
  });

  socket.on("disconnect", async () => {
    await removeSocketFromRoom(socket);
  });
});

async function removeSocketFromRoom(socket) {
  const room = socketToRoom.get(socket.id);
  if (!room) return;

  const members = roomMembers.get(room);

  if (members) {
    members.delete(socket.id);
    socket.to(room).emit("peer-left", socket.id);

    if (members.size === 0) {
      roomMembers.delete(room);
    } else {
      io.to(room).emit("room-user-count", members.size);
    }
  }

  socket.leave(room);
  socketToRoom.delete(socket.id);

  const session = sessionLogs.get(socket.id);

  if (session) {
    const leftAt = new Date().toISOString();
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(leftAt) - new Date(session.joinedAt)) / 1000)
    );

    const finalEntry = {
      ...session,
      leftAt,
      durationSeconds
    };

    await sendLogToGoogleSheet({
      event: "leave",
      ...finalEntry
    });

    sessionLogs.delete(socket.id);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});