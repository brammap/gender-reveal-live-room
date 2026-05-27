const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "reveal-room";
const isGuest = params.has("guest");

const el = {
  contextBanner: document.getElementById("contextBanner"),
  guestModal: document.getElementById("guestModal"),
  guestModalTitle: document.getElementById("guestModalTitle"),
  guestModalCopy: document.getElementById("guestModalCopy"),
  guestModalBody: document.getElementById("guestModalBody"),
  closeGuestModalBtn: document.getElementById("closeGuestModalBtn"),
  stepDotName: document.getElementById("stepDotName"),
  stepDotEntry: document.getElementById("stepDotEntry"),
  stepDotPoll: document.getElementById("stepDotPoll"),
  stepDotNote: document.getElementById("stepDotNote"),
  guestEntryPanel: document.getElementById("guestEntryPanel"),
  watchOnlyBtn: document.getElementById("watchOnlyBtn"),
  joinCameraBtn: document.getElementById("joinCameraBtn"),
  roomIdLabel: document.getElementById("roomIdLabel"),
  roleLabel: document.getElementById("roleLabel"),
  statusLabel: document.getElementById("statusLabel"),
  resultText: document.getElementById("resultText"),
  guestCount: document.getElementById("guestCount"),
  hostBadge: document.getElementById("hostBadge"),
  guestStrip: document.getElementById("guestStrip"),
  localVideo: document.getElementById("localVideo"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  copyGuestLinkBtn: document.getElementById("copyGuestLinkBtn"),
  startCamBtn: document.getElementById("startCamBtn"),
  revealBtn: document.getElementById("revealBtn"),
  recordBtn: document.getElementById("recordBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  guestTemplate: document.getElementById("guestTemplate"),
};

const peers = new Map();
const guests = new Map();

const state = {
  localStream: null,
  recording: false,
  recorder: null,
  recordedChunks: [],
  revealActive: false,
  countdown: false,
  audio: null,
  eventSource: null,
  clientId: sessionStorage.peerId || crypto.randomUUID(),
  guestMode: params.get("mode") || null,
  guestStep: "name",
  guestName: sessionStorage.guestName || "",
  guestPoll: sessionStorage.guestPoll || "",
  guestSuggestion: sessionStorage.guestSuggestion || "",
  guestNote: sessionStorage.guestNote || "",
  guestDeferredNote: sessionStorage.guestDeferredNote === "1",
};

sessionStorage.peerId = state.clientId;

el.roomIdLabel.textContent = roomId;
el.roleLabel.textContent = isGuest ? "Guest" : "Host";
el.statusLabel.textContent = isGuest ? "Joining" : "Hosting";
el.hostBadge.textContent = isGuest ? "Guest mode" : "Ready";
el.contextBanner.hidden = window.isSecureContext;
document.body.classList.toggle("guest-view", isGuest);
el.closeGuestModalBtn.onclick = hideGuestModal;

if (isGuest) {
  el.guestEntryPanel.hidden = !!state.guestMode;
  el.copyLinkBtn.textContent = "Guest link";
  el.copyGuestLinkBtn.hidden = true;
  el.startCamBtn.textContent = "Join camera";
  el.revealBtn.hidden = true;
  el.recordBtn.hidden = true;
  el.downloadBtn.hidden = true;

  const controlsTitle = document.querySelector(".controls h2");
  const controlsText = document.querySelector(".controls p");
  const heroTitle = document.querySelector(".hero-copy h1");
  const heroText = document.querySelector(".hero-copy .lede");
  const audienceTitle = document.querySelector(".studio-grid .studio-panel:first-child h2");
  const revealTitle = document.querySelector(".studio-grid .studio-panel:last-child h2");
  if (controlsTitle) controlsTitle.textContent = "Live view";
  if (controlsText) controlsText.textContent = "You are watching the reveal room live.";
  if (heroTitle) heroTitle.textContent = "You're in the live reveal.";
  if (heroText) heroText.textContent = "Watch the countdown, see the reveal, and join the call as a guest.";
  if (audienceTitle) audienceTitle.textContent = "Audience";
  if (revealTitle) revealTitle.textContent = "Reveal";
}

function selfId() {
  return state.clientId;
}

function joinUrl() {
  const url = new URL(location.origin + "/");
  url.searchParams.set("room", roomId);
  return url.toString();
}

function guestUrl() {
  const url = new URL(joinUrl());
  url.searchParams.set("guest", "1");
  return url.toString();
}

function setStatus(text) {
  el.statusLabel.textContent = text;
}

function updateGuestCount() {
  el.guestCount.textContent = `${guests.size} joined`;
  if (!guests.size) {
    el.guestStrip.innerHTML = `<div class="empty-state">Waiting for guests to join the room.</div>`;
  }
}

function setRevealText(text) {
  el.resultText.textContent = text;
}

function paintTheme() {
  document.documentElement.style.setProperty("--accent", state.revealActive ? "#ff6fb2" : "#6c7cff");
}

function syncLocalVideo() {
  el.localVideo.srcObject = state.localStream;
  el.localVideo.muted = true;
}

function ensureGuestTile(id, label) {
  let tile = document.getElementById(`peer-${id}`);
  if (!tile) {
    const node = el.guestTemplate.content.cloneNode(true);
    tile = node.querySelector(".guest-tile");
    tile.id = `peer-${id}`;
    tile.querySelector(".guest-name").textContent = label;
    el.guestStrip.innerHTML = "";
    el.guestStrip.appendChild(tile);
  }
  return tile;
}

function attachGuestStream(id, stream, label = "Guest") {
  const tile = ensureGuestTile(id, label);
  tile.querySelector("video").srcObject = stream;
  guests.set(id, { id, stream, label });
  updateGuestCount();
}

function removeGuest(id) {
  guests.delete(id);
  peers.delete(id);
  document.getElementById(`peer-${id}`)?.remove();
  updateGuestCount();
}

async function postMessage(message) {
  await fetch("/api/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}

function postGuestProfile() {
  return postMessage({
    type: "guest-profile",
    room: roomId,
    from: selfId(),
    name: state.guestName,
    poll: state.guestPoll,
    suggestion: state.guestSuggestion,
  });
}

function postGuestNote() {
  return postMessage({
    type: "guest-note",
    room: roomId,
    from: selfId(),
    name: state.guestName,
    note: state.guestNote,
  });
}

function hideGuestModal() {
  el.guestModal.hidden = true;
}

function setWizardStep(step) {
  state.guestStep = step;
  const steps = {
    name: el.stepDotName,
    entry: el.stepDotEntry,
    poll: el.stepDotPoll,
    note: el.stepDotNote,
  };
  Object.values(steps).forEach((node) => node?.classList.remove("active"));
  steps[step]?.classList.add("active");
}

function showGuestFlow(step) {
  setWizardStep(step);
  el.guestModal.hidden = false;

  if (step === "name") {
    el.guestModalTitle.textContent = "Enter your name";
    el.guestModalCopy.textContent = "We’ll use your name during the live reveal room.";
    el.guestModalBody.innerHTML = `
      <input id="guestNameInput" type="text" placeholder="Your name" value="${state.guestName}" />
      <div class="button-row">
        <button id="guestNameNextBtn" class="primary" type="button">Continue</button>
      </div>
    `;
    document.getElementById("guestNameNextBtn").onclick = () => {
      const value = document.getElementById("guestNameInput").value.trim();
      if (!value) return setStatus("Please enter your name");
      state.guestName = value;
      sessionStorage.guestName = value;
      showGuestFlow("entry");
    };
    return;
  }

  if (step === "entry") {
    el.guestModalTitle.textContent = "How do you want to join?";
    el.guestModalCopy.textContent = "Choose watch only or join with camera.";
    el.guestModalBody.innerHTML = `
      <div class="button-row">
        <button id="guestWatchBtn" class="primary" type="button">Watch only</button>
        <button id="guestCameraBtn" class="secondary" type="button">Join with camera</button>
      </div>
    `;
    document.getElementById("guestWatchBtn").onclick = () => enterGuestMode("watch");
    document.getElementById("guestCameraBtn").onclick = () => enterGuestMode("camera");
    return;
  }

  if (step === "poll") {
    el.guestModalTitle.textContent = "Your guess";
    el.guestModalCopy.textContent = "Vote boy or girl, then optionally suggest a baby name.";
    el.guestModalBody.innerHTML = `
      <div class="choice-grid">
        <button id="guestBoyBtn" class="choice-card ${state.guestPoll === "boy" ? "selected" : ""}" type="button">
          <span class="choice-emoji">👶</span>
          <span class="choice-title">Boy</span>
        </button>
        <button id="guestGirlBtn" class="choice-card ${state.guestPoll === "girl" ? "selected" : ""}" type="button">
          <span class="choice-emoji">👶</span>
          <span class="choice-title">Girl</span>
        </button>
      </div>
      <label>Optional baby name suggestion</label>
      <input id="guestSuggestionInput" type="text" placeholder="Optional name suggestion" value="${state.guestSuggestion}" />
      <div class="button-row">
        <button id="guestPollNextBtn" class="primary" type="button">Next</button>
        <button id="guestSkipNoteBtn" class="secondary" type="button">Skip note for now</button>
      </div>
    `;
    const boyBtn = document.getElementById("guestBoyBtn");
    const girlBtn = document.getElementById("guestGirlBtn");
    const setPollChoice = (choice) => {
      state.guestPoll = choice;
      boyBtn.classList.toggle("selected", choice === "boy");
      girlBtn.classList.toggle("selected", choice === "girl");
    };
    boyBtn.onclick = () => setPollChoice("boy");
    girlBtn.onclick = () => setPollChoice("girl");
    document.getElementById("guestPollNextBtn").onclick = () => {
      const poll = state.guestPoll;
      const suggestion = document.getElementById("guestSuggestionInput").value.trim();
      if (!poll) return setStatus("Choose boy or girl");
      state.guestPoll = poll;
      state.guestSuggestion = suggestion;
      sessionStorage.guestPoll = poll;
      sessionStorage.guestSuggestion = suggestion;
      postGuestProfile();
      showGuestFlow("note");
    };
    document.getElementById("guestSkipNoteBtn").onclick = () => {
      state.guestDeferredNote = true;
      sessionStorage.guestDeferredNote = "1";
      postGuestProfile();
      hideGuestModal();
    };
    return;
  }

  if (step === "note") {
    el.guestModalTitle.textContent = "Note to parents";
    el.guestModalCopy.textContent = state.revealActive
      ? "You can leave a note now, or close this window."
      : "You can leave a note now, or choose to do it after reveal.";
    el.guestModalBody.innerHTML = `
      <textarea id="guestNoteInput" placeholder="Write a note to the parents...">${state.guestNote}</textarea>
      <div class="button-row">
        <button id="guestNoteSendBtn" class="primary" type="button">Send note</button>
        <button id="guestNoteLaterBtn" class="secondary" type="button">Do it after reveal</button>
      </div>
    `;
    const sendBtn = document.getElementById("guestNoteSendBtn");
    const laterBtn = document.getElementById("guestNoteLaterBtn");
    sendBtn.addEventListener("click", () => {
      state.guestNote = document.getElementById("guestNoteInput").value.trim();
      sessionStorage.guestNote = state.guestNote;
      postGuestNote();
      hideGuestModal();
    });
    laterBtn.addEventListener("click", () => {
      state.guestDeferredNote = true;
      sessionStorage.guestDeferredNote = "1";
      hideGuestModal();
    });
  }
}

function openDeferredNotePrompt() {
  if (isGuest && state.guestDeferredNote && !state.guestNote) {
    showGuestFlow("note");
  }
}

function startEventStream() {
  state.eventSource?.close();
  state.eventSource = new EventSource(`/api/events?room=${encodeURIComponent(roomId)}&client=${encodeURIComponent(selfId())}`);

  state.eventSource.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (!msg || msg.room !== roomId || msg.from === selfId()) return;

    if (msg.type === "join") {
      if (!peers.has(msg.from)) createPeer(msg.from);
      if (!isGuest) {
        const pc = peers.get(msg.from);
        if (pc && state.localStream) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await postMessage({ type: "offer", room: roomId, from: selfId(), to: msg.from, sdp: pc.localDescription });
        }
      }
    }

    if (msg.type === "offer" && msg.to === selfId()) {
      const pc = peers.get(msg.from) || createPeer(msg.from);
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postMessage({ type: "answer", room: roomId, from: selfId(), to: msg.from, sdp: pc.localDescription });
    }

    if (msg.type === "answer" && msg.to === selfId()) {
      const pc = peers.get(msg.from);
      if (pc) await pc.setRemoteDescription(msg.sdp);
    }

    if (msg.type === "candidate" && msg.to === selfId()) {
      const pc = peers.get(msg.from);
      if (pc && msg.candidate) await pc.addIceCandidate(msg.candidate);
    }

    if (msg.type === "countdown") {
      setRevealText(msg.value);
      setStatus(`Reveal in ${msg.value}`);
    }

    if (msg.type === "reveal") {
      revealMain();
      openDeferredNotePrompt();
    }

    if (msg.type === "guest-profile") {
      const tile = ensureGuestTile(msg.from, msg.name || "Guest");
      const footer = tile.querySelector(".guest-footer");
      if (footer) {
        const summary = `${msg.name || "Guest"}${msg.poll ? ` · ${msg.poll}` : ""}${msg.suggestion ? ` · ${msg.suggestion}` : ""}`;
        footer.querySelector(".guest-name").textContent = summary;
      }
    }

    if (msg.type === "guest-note") {
      const tile = ensureGuestTile(msg.from, msg.name || "Guest");
      const footer = tile.querySelector(".guest-footer");
      if (footer) footer.querySelector(".guest-name").textContent = `${msg.name || "Guest"} · note received`;
    }
  };
}

async function startCamera() {
  if (!window.isSecureContext) {
    el.contextBanner.hidden = false;
    setStatus("Open via localhost to use camera");
    throw new Error("Camera requires secure context");
  }
  if (state.localStream) return state.localStream;
  state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  syncLocalVideo();
  setStatus("Camera on");
  el.startCamBtn.textContent = "Disable camera";
  await postMessage({ type: "join", room: roomId, from: selfId(), role: isGuest ? "guest" : "host" });
  for (const pc of peers.values()) {
    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  }
  return state.localStream;
}

async function enterGuestMode(mode) {
  state.guestMode = mode;
  el.guestEntryPanel.hidden = true;
  hideGuestModal();
  if (mode === "watch") {
    setStatus("Watch only");
    await postMessage({ type: "join", room: roomId, from: selfId(), role: "guest", mode: "watch" });
    return;
  }
  await startCamera();
  await postMessage({ type: "join", room: roomId, from: selfId(), role: "guest", mode: "camera" });
  showGuestFlow("poll");
}

function stopCamera() {
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  syncLocalVideo();
  el.startCamBtn.textContent = "Enable camera";
  setStatus("Camera off");
}

function ensureAudio() {
  if (state.audio) return state.audio;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = 740;
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  state.audio = { ctx, gain };
  return state.audio;
}

function playRevealSound() {
  const { ctx, gain } = ensureAudio();
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.15, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
}

function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.className = "confetti-layer";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#ff6fb2", "#6c7cff", "#ffc94d", "#6ee7b7", "#ffffff"];
  const pieces = Array.from({ length: 180 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.2,
    vx: -2 + Math.random() * 4,
    vy: 2 + Math.random() * 5,
    size: 5 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.vy += 0.03;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    if (performance.now() - start < 5000) requestAnimationFrame(tick);
    else canvas.remove();
  }
  tick();
}

function revealMain() {
  state.revealActive = true;
  paintTheme();
  setRevealText("It's a girl!");
  setStatus("Reveal live");
  playRevealSound();
  launchConfetti();
}

function resetReveal() {
  state.revealActive = false;
  paintTheme();
  setRevealText("It's time to reveal.");
}

async function runCountdown() {
  if (state.countdown) return;
  state.countdown = true;
  for (const step of ["5", "4", "3", "2", "1"]) {
    await postMessage({ type: "countdown", room: roomId, from: selfId(), value: step });
    setRevealText(step);
    setStatus(`Reveal in ${step}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await postMessage({ type: "reveal", room: roomId, from: selfId() });
  revealMain();
  state.countdown = false;
}

function createPeer(id) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  peers.set(id, pc);
  pc.onicecandidate = (event) => {
    if (event.candidate) postMessage({ type: "candidate", room: roomId, from: selfId(), to: id, candidate: event.candidate });
  };
  pc.ontrack = (event) => attachGuestStream(id, event.streams[0]);
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) removeGuest(id);
  };
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  }
  return pc;
}

async function startRecording() {
  if (state.recording) return;
  if (!state.localStream) await startCamera();

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const canvasStream = canvas.captureStream(30);
  const audioTracks = state.localStream?.getAudioTracks() || [];
  for (const track of audioTracks) canvasStream.addTrack(track);

  state.recordedChunks = [];
  state.recorder = new MediaRecorder(canvasStream, { mimeType: "video/webm;codecs=vp8,opus" });
  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.recordedChunks.push(event.data);
  };
  state.recorder.onstop = () => {
    const blob = new Blob(state.recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    el.downloadBtn.disabled = false;
    el.downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = `reveal-room-${roomId}.webm`;
      a.click();
    };
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff8f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    roundRect(ctx, 20, 20, 840, 680, 28);
    ctx.fill();
    ctx.fillStyle = "#27181f";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText("Audience Reaction", 50, 70);
    drawVideoBox(ctx, 50, 100, 385, 250, "Host");
    drawGuests(ctx, 50, 380, 790, 290);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRect(ctx, 880, 20, 380, 680, 28);
    ctx.fill();
    ctx.fillStyle = "#27181f";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText("Reveal", 900, 70);
    drawRevealCard(ctx, 900, 100, 320, 250);
    drawVideoBox(ctx, 900, 380, 320, 220, isGuest ? "Audience" : "Host Cam");
    if (state.revealActive) {
      ctx.fillStyle = "#ff6fb2";
      ctx.font = "800 52px Fraunces, serif";
      ctx.fillText("It's a girl!", 940, 665);
    }
    requestAnimationFrame(draw);
  };
  draw();

  state.recorder.start();
  state.recording = true;
  el.recordBtn.classList.add("recording-state");
  el.recordBtn.innerHTML = `<span class="record-dot"></span> Recording started`;
}

function stopRecording() {
  if (!state.recording) return;
  state.recorder?.stop();
  state.recording = false;
  el.recordBtn.classList.remove("recording-state");
  el.recordBtn.textContent = "Start recording";
}

function drawVideoBox(ctx, x, y, w, h, label) {
  ctx.fillStyle = "#1f1020";
  roundRect(ctx, x, y, w, h, 20);
  ctx.fill();
  if (el.localVideo.readyState >= 2 && state.localStream?.active) {
    ctx.drawImage(el.localVideo, x, y, w, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 20px Inter, sans-serif";
  ctx.fillText(label, x + 18, y + 32);
}

function drawGuests(ctx, x, y, w, h) {
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = "#f9eef3";
  ctx.fill();
  ctx.fillStyle = "#27181f";
  ctx.font = "700 22px Inter, sans-serif";
  ctx.fillText("Guest tiles", x + 20, y + 34);
  const items = [...guests.values()].slice(0, 4);
  if (!items.length) {
    ctx.font = "500 18px Inter, sans-serif";
    ctx.fillText("Waiting for guests to join.", x + 20, y + 80);
    return;
  }
  items.forEach((item, index) => {
    const gx = x + 20 + (index % 2) * 380;
    const gy = y + 60 + Math.floor(index / 2) * 115;
    roundRect(ctx, gx, gy, 355, 100, 16);
    ctx.fillStyle = "#fff";
    ctx.fill();
    const tile = document.getElementById(`peer-${item.id}`);
    const video = tile?.querySelector("video");
    if (video && video.readyState >= 2) ctx.drawImage(video, gx, gy, 355, 100);
    ctx.fillStyle = "#27181f";
    ctx.fillText(item.label, gx + 16, gy + 28);
    ctx.fillStyle = "#6c5963";
    ctx.fillText("live reaction", gx + 16, gy + 56);
  });
}

function drawRevealCard(ctx, x, y, w, h) {
  roundRect(ctx, x, y, w, h, 22);
  ctx.fillStyle = state.revealActive ? "#ffecf4" : "#eef2ff";
  ctx.fill();
  ctx.fillStyle = state.revealActive ? "#ff6fb2" : "#6c7cff";
  ctx.font = "800 28px Fraunces, serif";
  ctx.fillText(state.revealActive ? "Reveal complete" : "Countdown live", x + 20, y + 42);
  ctx.font = "600 48px Fraunces, serif";
  ctx.fillText(el.resultText.textContent, x + 20, y + 115);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

el.copyLinkBtn.onclick = async () => {
  await navigator.clipboard.writeText(joinUrl());
  el.copyLinkBtn.textContent = "Link copied";
  setTimeout(() => (el.copyLinkBtn.textContent = "Copy join link"), 1200);
};

el.copyGuestLinkBtn.onclick = async () => {
  await navigator.clipboard.writeText(guestUrl());
  el.copyGuestLinkBtn.textContent = "Guest link copied";
  setTimeout(() => (el.copyGuestLinkBtn.textContent = "Copy guest link"), 1200);
};

el.startCamBtn.onclick = async () => {
  if (state.localStream) {
    stopCamera();
    return;
  }
  try {
    await startCamera();
  } catch (error) {
    if (!window.isSecureContext) setStatus("Use localhost to enable camera");
    else setStatus(error?.name === "NotAllowedError" ? "Camera permission denied" : "Camera blocked");
  }
};

el.revealBtn.onclick = async () => {
  resetReveal();
  await runCountdown();
};

el.recordBtn.onclick = async () => {
  if (state.recording) stopRecording();
  else await startRecording();
};

el.watchOnlyBtn.onclick = () => enterGuestMode("watch");
el.joinCameraBtn.onclick = () => enterGuestMode("camera");

startEventStream();
updateGuestCount();
resetReveal();

if (!isGuest) {
  postMessage({ type: "join", room: roomId, from: selfId(), role: "host" });
} else if (state.guestMode) {
  enterGuestMode(state.guestMode);
} else {
  showGuestFlow("name");
}

window.addEventListener("beforeunload", () => {
  state.eventSource?.close();
  stopRecording();
  stopCamera();
});
