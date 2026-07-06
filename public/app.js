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

const userCountBadge = document.getElementById("userCountBadge");
const sharePanel = document.getElementById("sharePanel");
const shareLinkInput = document.getElementById("shareLinkInput");
const copyLinkBtn = document.getElementById("copyLinkBtn");

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
const pendingIceCandidates = new Map();
const peerStatus = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").trim();
}

function updateUrlWithRoom(room) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", room);
  window.history.replaceState({}, "", url.toString());
}

function buildShareLink(room) {
  const url = new URL(window.location.origin);
  url.searchParams.set("room", room);
  return url.toString();
}

function clearRoomError() {
  roomCodeInput.classList.remove("error");
  roomError.classList.add("hidden");
}

function showRoomError(message = "Please enter the code number") {
  roomCodeInput.classList.add("error");
  roomError.textContent = message;
  roomError.classList.remove("hidden");
}

function showConnectedCode(code) {
  roomBadge.textContent = `You are connected through code: ${code}`;
  roomBadge.classList.remove("hidden");
}

function showShareLink(code) {
  const link = buildShareLink(code);
  shareLinkInput.value = link;
  sharePanel.classList.remove("hidden");
}

function setUserCount(count) {
  userCountBadge.textContent = `Users: ${count}`;
  userCountBadge.classList.remove("hidden");
}

function showControlsTemporarily() {
  callControls.classList.remove("hidden");
  sharePanel.classList.remove("hidden");
  

  if (controlsTimer) clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    callControls.classList.add("hidden");
    sharePanel.classList.add("hidden");    
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
  if (remoteStreams.size > 0) {
    emptyState.classList.add("hidden");
    updateGridLayout();
    return;
  }

  if (peerConnections.size > 0) {
    emptyState.textContent = "Connecting to participants...";
  } else {
    emptyState.textContent = "Waiting for other participants...";
  }

  emptyState.classList.remove("hidden");
  updateGridLayout();
}

function getShortPeerId(peerId) {
  return String(peerId).slice(0, 5);
}

function setPeerStatus(peerId, statusText) {
  peerStatus.set(peerId, statusText);
  const label = document.querySelector(`#remote-wrap-${peerId} .video-label`);
  if (label) {
    label.textContent = `Participant ${getShortPeerId(peerId)} • ${statusText}`;
  }
}

async function getClientMetadata() {
  let location = null;

  if ("geolocation" in navigator) {
    try {
      location = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
        );
      });
    } catch {
      location = null;
    }
  }

  return {
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen: {
      width: window.screen.width,
      height: window.screen.height
    },
    location
  };
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
  label.textContent = `Participant ${getShortPeerId(peerId)} • Connecting`;

  card.appendChild(video);
  card.appendChild(label);
  videosGrid.appendChild(card);

  setPeerStatus(peerId, peerStatus.get(peerId) || "Connecting");
}

function removeRemoteVideoElement(peerId) {
  const card = document.getElementById(`remote-wrap-${peerId}`);
  if (card) card.remove();

  remoteStreams.delete(peerId);
  peerStatus.delete(peerId);
  pendingIceCandidates.delete(peerId);
  updateEmptyState();
}

function cleanupPeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
    peerConnections.delete(peerId);
  }
}

async function flushPendingIceCandidates(peerId) {
  const pc = peerConnections.get(peerId);
  const queue = pendingIceCandidates.get(peerId);

  if (!pc || !queue || !queue.length) return;
  if (!pc.remoteDescription) return;

  while (queue.length > 0) {
    const candidate = queue.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(`Failed to add queued ICE candidate for ${peerId}:`, error);
    }
  }
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  createRemoteVideoElement(peerId);
  setPeerStatus(peerId, "Connecting");

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
      setPeerStatus(peerId, "Connected");
      updateEmptyState();
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setPeerStatus(peerId, "Connected");
    } else if (pc.connectionState === "connecting" || pc.connectionState === "new") {
      setPeerStatus(peerId, "Connecting");
    } else if (pc.connectionState === "failed") {
      setPeerStatus(peerId, "Connection failed");
      cleanupPeerConnection(peerId);
      removeRemoteVideoElement(peerId);
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
      setPeerStatus(peerId, "Disconnected");
      cleanupPeerConnection(peerId);
      removeRemoteVideoElement(peerId);
    }

    updateEmptyState();
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`iceConnectionState [${peerId}]:`, pc.iceConnectionState);
  };

  peerConnections.set(peerId, pc);
  updateEmptyState();
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

  try {
    await initLocalMedia();
  } catch (error) {
    console.error("Failed to access camera/microphone:", error);
    showRoomError("Camera or microphone permission denied");
    return;
  }

  const metadata = await getClientMetadata();

  showConnectedCode(currentRoom);
  showShareLink(currentRoom);
  updateUrlWithRoom(currentRoom);
  updateGridLayout();

  welcomeModal.classList.remove("active");
  roomCodeInput.blur();

  socket.emit("join-room", {
    roomCode: currentRoom,
    ...metadata
  });

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

  peerConnections.clear();
  remoteStreams.clear();
  pendingIceCandidates.clear();
  peerStatus.clear();

  stopLocalMedia();

  currentRoom = "";
  currentFacingMode = "user";
  isMuted = false;

  muteIcon.textContent = "🎤";
  muteBtnText.textContent = "Mute";

  roomBadge.classList.add("hidden");
  userCountBadge.classList.add("hidden");
  sharePanel.classList.add("hidden");
  callControls.classList.add("hidden");
  welcomeModal.classList.add("active");
  updateGridLayout();
  updateEmptyState();
}

connectBtn.addEventListener("click", joinRoom);

copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    copyLinkBtn.textContent = "Copied";
    setTimeout(() => {
      copyLinkBtn.textContent = "Copy Link";
    }, 1500);
  } catch {
    shareLinkInput.select();
    document.execCommand("copy");
  }
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

roomCodeInput.addEventListener("input", () => {
  roomError.textContent = "Please enter the code number";
  clearRoomError();
});

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
      event.target.closest(".switch-camera-btn") ||
      event.target.closest(".share-panel")
    ) {
      return;
    }

    showControlsTemporarily();
  });
}

socket.on("existing-peers", async (peerIds) => {
  for (const peerId of peerIds) {
    try {
      await createOfferForPeer(peerId);
    } catch (error) {
      console.error(`Failed to create offer for ${peerId}:`, error);
    }
  }
});

socket.on("peer-joined", (peerId) => {
  createRemoteVideoElement(peerId);
  setPeerStatus(peerId, "Joining");
  updateEmptyState();
});

socket.on("room-user-count", (count) => {
  setUserCount(count);
});

socket.on("offer", async ({ caller, sdp }) => {
  try {
    const pc = createPeerConnection(caller);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates(caller);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", {
      target: caller,
      responder: socket.id,
      sdp: answer
    });
  } catch (error) {
    console.error(`Error handling offer from ${caller}:`, error);
  }
});

socket.on("answer", async ({ responder, sdp }) => {
  try {
    const pc = peerConnections.get(responder);
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates(responder);
  } catch (error) {
    console.error(`Error handling answer from ${responder}:`, error);
  }
});

socket.on("ice-candidate", async ({ sender, candidate }) => {
  try {
    if (!candidate) return;

    const pc = peerConnections.get(sender);
    if (!pc) {
      if (!pendingIceCandidates.has(sender)) {
        pendingIceCandidates.set(sender, []);
      }
      pendingIceCandidates.get(sender).push(candidate);
      return;
    }

    if (!pc.remoteDescription) {
      if (!pendingIceCandidates.has(sender)) {
        pendingIceCandidates.set(sender, []);
      }
      pendingIceCandidates.get(sender).push(candidate);
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error(`ICE candidate error from ${sender}:`, error);
  }
});

socket.on("peer-left", (peerId) => {
  cleanupPeerConnection(peerId);
  removeRemoteVideoElement(peerId);
});

const roomFromUrl = getRoomFromUrl();
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl;
}

updateGridLayout();
updateEmptyState();