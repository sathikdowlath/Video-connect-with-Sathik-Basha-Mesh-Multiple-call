const socket = io();

const welcomeModal = document.getElementById("welcomeModal");
const roomCodeInput = document.getElementById("roomCode");
const roomError = document.getElementById("roomError");
const connectBtn = document.getElementById("connectBtn");

const videoStage = document.getElementById("videoStage");
const localVideo = document.getElementById("localVideo");
const roomBadge = document.getElementById("roomBadge");
const videosGrid = document.getElementById("videosGrid");
const emptyState = document.getElementById("emptyState");

const muteBtn = document.getElementById("muteBtn");
const muteBtnText = document.getElementById("muteBtnText");
const muteIcon = document.getElementById("muteIcon");
const endCallBtn = document.getElementById("endCallBtn");
const callControls = document.getElementById("callControls");
const switchCameraBtn = document.getElementById("switchCameraBtn");

let localStream = null;
let currentRoom = "";
let isMuted = false;
let currentFacingMode = "user";
let controlsTimer = null;

const peerConnections = new Map();
const remoteStreams = new Map();

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function clearRoomError() {
  roomCodeInput.classList.remove("error");
  roomError.classList.add("hidden");
}

function showRoomError() {
  roomCodeInput.classList.add("error");
  roomError.classList.remove("hidden");
}

function showConnectedCode(code) {
  roomBadge.textContent = `You are connected through code: ${code}`;
  roomBadge.classList.remove("hidden");
}

function showControlsTemporarily() {
  callControls.classList.remove("hidden");

  if (controlsTimer) clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    callControls.classList.add("hidden");
  }, 5000);
}

function updateGridLayout() {
  const totalParticipants = 1 + remoteStreams.size;
  const safeCount = Math.min(Math.max(totalParticipants, 1), 9);

  videosGrid.classList.remove(
    "layout-1",
    "layout-2",
    "layout-3",
    "layout-4",
    "layout-5",
    "layout-6",
    "layout-7",
    "layout-8",
    "layout-9"
  );

  videosGrid.classList.add(`layout-${safeCount}`);
}

function updateEmptyState() {
  emptyState.classList.toggle("hidden", remoteStreams.size > 0);
  updateGridLayout();
}

async function initLocalMedia(facingMode = currentFacingMode) {
  if (localStream) return localStream;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: isMobileDevice() ? { facingMode } : true
  });

  localStream = stream;
  localVideo.srcObject = localStream;
  currentFacingMode = facingMode;

  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !isMuted;
  }

  if (isMobileDevice()) {
    switchCameraBtn.classList.remove("hidden");
  }

  return localStream;
}

function stopLocalMedia() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
}

function createRemoteVideoElement(peerId) {
  if (document.getElementById(`remote-wrap-${peerId}`)) return;

  const card = document.createElement("div");
  card.className = "video-card";
  card.id = `remote-wrap-${peerId}`;

  const video = document.createElement("video");
  video.id = `remote-video-${peerId}`;
  video.className = "video-el";
  video.autoplay = true;
  video.playsInline = true;

  const label = document.createElement("div");
  label.className = "video-label";
  label.textContent = `Participant ${peerId.slice(0, 5)}`;

  card.appendChild(video);
  card.appendChild(label);
  videosGrid.appendChild(card);
}

function removeRemoteVideoElement(peerId) {
  const card = document.getElementById(`remote-wrap-${peerId}`);
  if (card) card.remove();
  remoteStreams.delete(peerId);
  updateEmptyState();
}

function cleanupPeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    peerConnections.delete(peerId);
  }
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: peerId,
        sender: socket.id,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    createRemoteVideoElement(peerId);
    const video = document.getElementById(`remote-video-${peerId}`);
    if (video) {
      video.srcObject = event.streams[0];
      remoteStreams.set(peerId, event.streams[0]);
      updateEmptyState();
    }
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected" ||
      pc.connectionState === "closed"
    ) {
      cleanupPeerConnection(peerId);
      removeRemoteVideoElement(peerId);
    }
  };

  peerConnections.set(peerId, pc);
  return pc;
}

async function createOfferForPeer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", {
    target: peerId,
    caller: socket.id,
    sdp: offer
  });
}

async function switchCamera() {
  if (!localStream) return;

  const currentAudioTrack = localStream.getAudioTracks()[0];
  const oldVideoTrack = localStream.getVideoTracks()[0];
  const nextFacingMode = currentFacingMode === "user" ? "environment" : "user";

  const newVideoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: nextFacingMode },
    audio: false
  });

  const newVideoTrack = newVideoStream.getVideoTracks()[0];

  for (const [, pc] of peerConnections) {
    const videoSender = pc.getSenders().find(
      sender => sender.track && sender.track.kind === "video"
    );

    if (videoSender && newVideoTrack) {
      await videoSender.replaceTrack(newVideoTrack);
    }
  }

  if (oldVideoTrack) {
    oldVideoTrack.stop();
  }

  const rebuiltTracks = [];
  if (newVideoTrack) rebuiltTracks.push(newVideoTrack);
  if (currentAudioTrack) {
    currentAudioTrack.enabled = !isMuted;
    rebuiltTracks.push(currentAudioTrack);
  }

  localStream = new MediaStream(rebuiltTracks);
  localVideo.srcObject = localStream;
  currentFacingMode = nextFacingMode;

  showControlsTemporarily();
}

async function joinRoom() {
  const roomValue = roomCodeInput.value.trim();

  if (!roomValue) {
    showRoomError();
    roomCodeInput.focus();
    setTimeout(() => roomCodeInput.blur(), 150);
    return;
  }

  clearRoomError();
  currentRoom = roomValue;

  await initLocalMedia();
  showConnectedCode(currentRoom);
  updateGridLayout();

  welcomeModal.classList.remove("active");
  roomCodeInput.blur();

  socket.emit("join-room", currentRoom);
  showControlsTemporarily();
}

function leaveCall() {
  if (currentRoom) {
    socket.emit("leave-room");
  }

  for (const peerId of [...peerConnections.keys()]) {
    cleanupPeerConnection(peerId);
  }

  for (const peerId of [...remoteStreams.keys()]) {
    removeRemoteVideoElement(peerId);
  }

  stopLocalMedia();

  currentRoom = "";
  currentFacingMode = "user";
  isMuted = false;

  muteIcon.textContent = "🎤";
  muteBtnText.textContent = "Mute";

  roomBadge.classList.add("hidden");
  callControls.classList.add("hidden");
  welcomeModal.classList.add("active");
  updateGridLayout();
  updateEmptyState();
}

connectBtn.addEventListener("click", joinRoom);

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

roomCodeInput.addEventListener("input", clearRoomError);

muteBtn.addEventListener("click", () => {
  if (!localStream) return;

  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });

  muteIcon.textContent = isMuted ? "🔇" : "🎤";
  muteBtnText.textContent = isMuted ? "Unmute" : "Mute";
  showControlsTemporarily();
});

endCallBtn.addEventListener("click", () => {
  leaveCall();
});

if (switchCameraBtn) {
  switchCameraBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await switchCamera();
    } catch (error) {
      console.error("Camera switch failed:", error);
    }
  });
}

if (videoStage) {
  videoStage.addEventListener("click", (event) => {
    if (
      event.target.closest(".control-btn") ||
      event.target.closest(".switch-camera-btn")
    ) {
      return;
    }

    showControlsTemporarily();
  });
}

socket.on("existing-peers", async (peerIds) => {
  for (const peerId of peerIds) {
    await createOfferForPeer(peerId);
  }
});

socket.on("peer-joined", async (peerId) => {
  createPeerConnection(peerId);
});

socket.on("offer", async ({ caller, sdp }) => {
  const pc = createPeerConnection(caller);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", {
    target: caller,
    responder: socket.id,
    sdp: answer
  });
});

socket.on("answer", async ({ responder, sdp }) => {
  const pc = peerConnections.get(responder);
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on("ice-candidate", async ({ sender, candidate }) => {
  const pc = peerConnections.get(sender);
  if (!pc || !candidate) return;

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error("ICE candidate error:", error);
  }
});

socket.on("peer-left", (peerId) => {
  cleanupPeerConnection(peerId);
  removeRemoteVideoElement(peerId);
});

updateGridLayout();
updateEmptyState();