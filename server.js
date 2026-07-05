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

io.on("connection", (socket) => {
  socket.on("join-room", (roomCode) => {
    const room = String(roomCode || "").trim();
    if (!room) return;

    if (!roomMembers.has(room)) {
      roomMembers.set(room, new Set());
    }

    const members = roomMembers.get(room);
    const existingPeers = [...members];

    members.add(socket.id);
    socketToRoom.set(socket.id, room);
    socket.join(room);

    socket.emit("existing-peers", existingPeers);
    socket.to(room).emit("peer-joined", socket.id);
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

  socket.on("leave-room", () => {
    removeSocketFromRoom(socket);
  });

  socket.on("disconnect", () => {
    removeSocketFromRoom(socket);
  });
});

function removeSocketFromRoom(socket) {
  const room = socketToRoom.get(socket.id);
  if (!room) return;

  const members = roomMembers.get(room);
  if (members) {
    members.delete(socket.id);
    socket.to(room).emit("peer-left", socket.id);

    if (members.size === 0) {
      roomMembers.delete(room);
    }
  }

  socket.leave(room);
  socketToRoom.delete(socket.id);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});