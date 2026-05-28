const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "reveal-room";
const isGuest = false;

const els = {
  guestEntryPanel: document.getElementById("guestEntryPanel"),
  watchOnlyBtn: document.getElementById("watchOnlyBtn"),
  joinCameraBtn: document.getElementById("joinCameraBtn"),
  heroSection: document.getElementById("heroSection"),
  welcomeNextBtn: document.getElementById("welcomeNextBtn"),
  genderStep: document.getElementById("genderStep"),
  selectBoyBtn: document.getElementById("selectBoyBtn"),
  selectGirlBtn: document.getElementById("selectGirlBtn"),
  liveSection: document.getElementById("liveSection"),
  controlsCard: document.getElementById("controlsCard"),
  copyGuestLinkBtn: document.getElementById("copyGuestLinkBtn"),
  startCamBtnInline: document.getElementById("startCamBtnInline"),
  revealBtn: document.getElementById("revealBtn"),
  recordBtn: document.getElementById("recordBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  startupStatus: document.getElementById("startupStatus"),
  statusLabel: document.getElementById("statusLabel"),
  hostBadge: document.getElementById("hostBadge"),
  guestCount: document.getElementById("guestCount"),
  localVideo: document.getElementById("localVideo"),
  revealStage: document.getElementById("revealStage"),
  stageResult: document.getElementById("stageResult"),
  revealGif: document.getElementById("revealGif"),
  exitRevealBtn: document.getElementById("exitRevealBtn"),
  roomIdLabel: document.getElementById("roomIdLabel"),
  roleLabel: document.getElementById("roleLabel"),
  guestModal: document.getElementById("guestModal"),
  guestModalTitle: document.getElementById("guestModalTitle"),
  guestModalCopy: document.getElementById("guestModalCopy"),
  guestModalBody: document.getElementById("guestModalBody"),
  closeGuestModalBtn: document.getElementById("closeGuestModalBtn"),
};

const state = {
  step: "welcome",
  gender: null,
  selectedGif: null,
  revealActive: false,
  countdownRunning: false,
  localStream: null,
  recording: false,
  recorder: null,
  recordedChunks: [],
  guestMode: "watch",
  guestConnected: false,
  clientId: (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
  signalSource: null,
  signalStarted: false,
  peer: null,
  guestRequested: false,
  guestPeerId: null,
  guestVideoStream: null,
  iceServers: null,
  iceServersPromise: null,
};

async function loadIceServers() {
  if (state.iceServers) return state.iceServers;
  if (!state.iceServersPromise) {
    state.iceServersPromise = fetch("/api/turn")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("TURN unavailable"))))
      .then((data) => {
        state.iceServers = Array.isArray(data.iceServers) && data.iceServers.length
          ? data.iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }];
        return state.iceServers;
      })
      .catch(() => {
        state.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
        return state.iceServers;
      });
  }
  return state.iceServersPromise;
}

async function sendSignal(type, data = {}) {
  await fetch("/api/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomId, type, from: state.clientId, ...data }),
  });
}

function startSignalListener() {
  if (state.signalStarted) return;
  state.signalStarted = true;
  state.signalSource = new EventSource(`/api/events?room=${encodeURIComponent(roomId)}&client=${state.clientId}`);
  state.signalSource.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (!message || message.from === state.clientId) return;
    if (message.type === "guest-join") {
      state.guestRequested = true;
      state.guestPeerId = message.from;
      if (state.localStream && !state.peer) await createHostPeer(message.from);
      return;
    }
    if (message.type === "offer" && state.peer) {
      await state.peer.setRemoteDescription(message.sdp);
      const answer = await state.peer.createAnswer();
      await state.peer.setLocalDescription(answer);
      await sendSignal("answer", { to: message.from, sdp: answer });
      return;
    }
    if (message.type === "answer" && state.peer) {
      await state.peer.setRemoteDescription(message.sdp);
      return;
    }
    if (message.type === "ice" && state.peer && message.candidate) {
      try { await state.peer.addIceCandidate(message.candidate); } catch {}
    }
  });
}

async function createHostPeer(remoteId) {
  const pc = new RTCPeerConnection({ iceServers: await loadIceServers() });
  state.peer = pc;
  state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  pc.ontrack = (event) => {
    state.guestConnected = true;
    if (els.guestCount) els.guestCount.textContent = "1 joined";
    const stream = event.streams?.[0];
    if (!stream) return;
    const strip = document.getElementById("guestStrip");
    if (!strip) return;
    state.guestVideoStream = stream;
    strip.innerHTML = `
      <article class="guest-tile">
        <video id="guestRemoteVideo" autoplay playsinline muted></video>
        <div class="guest-footer">
          <strong>Guest</strong>
          <span class="pill">Live</span>
        </div>
      </article>
    `;
    const video = document.getElementById("guestRemoteVideo");
    if (video) {
      video.srcObject = stream;
      video.play?.().catch(() => {});
    }
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal("ice", { to: remoteId, candidate: event.candidate });
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendSignal("offer", { to: remoteId, sdp: offer });
}

const guestEntryDefaultHTML = `
  <div>
    <p class="eyebrow">Guest entry</p>
    <h2>How do you want to join?</h2>
    <p class="lede">Choose watch-only if you just want to view, or join with camera if you want your reaction on the call.</p>
  </div>
  <div class="button-row">
    <button id="watchOnlyBtn" class="primary" type="button">Watch only</button>
    <button id="joinCameraBtn" class="secondary" type="button">Join with camera</button>
  </div>
`;

function renderGuestShell() {
  const shell = document.querySelector("main.shell");
  if (!shell) return;
  shell.innerHTML = `
    <section id="guestOnlyShell" class="guest-only-shell card">
      <p class="eyebrow">Guest entry</p>
      <h1>Welcome to the reveal</h1>
      <p class="lede">Choose how you want to join before the reveal starts.</p>
      <div id="guestEntryPanel" class="guest-entry card" data-view="default">
        <div>
          <p class="eyebrow">Guest entry</p>
          <h2>How do you want to join?</h2>
          <p class="lede">Choose watch-only if you just want to view, or join with camera if you want your reaction on the call.</p>
        </div>
        <div class="button-row">
          <button id="watchOnlyBtn" class="primary" type="button" onclick="window.__guestPick('watch')">Watch only</button>
          <button id="joinCameraBtn" class="secondary" type="button" onclick="window.__guestPick('camera')">Join with camera</button>
        </div>
      </div>
    </section>
  `;
}

function setStatus(text) {
  if (els.statusLabel) els.statusLabel.textContent = text;
}

function setStartupStatus(text) {
  if (els.startupStatus) els.startupStatus.textContent = text;
}

function setRevealText(text) {
  if (els.stageResult) els.stageResult.textContent = text;
}

function getGifForGender(gender) {
  return gender === "girl" ? "./assets/baby-girl.gif?v=1" : "./assets/baby-boy.gif?v=1";
}

function updateConnectionLabels() {
  if (els.roomIdLabel) els.roomIdLabel.textContent = roomId;
  if (els.roleLabel) els.roleLabel.textContent = "Host";
  if (els.hostBadge) els.hostBadge.textContent = state.localStream ? "Camera on" : "Offline";
  if (els.guestCount) els.guestCount.textContent = "0 joined";
}

function showOnly(step) {
  state.step = step;
  const isWelcome = step === "welcome";
  const isGender = step === "gender";
  const isLive = step === "live";

  if (els.heroSection) els.heroSection.hidden = !isWelcome;
  if (els.welcomeNextBtn) els.welcomeNextBtn.hidden = !isWelcome;
  if (els.genderStep) els.genderStep.hidden = !isGender;
  if (els.controlsCard) els.controlsCard.hidden = !isLive;
  if (els.liveSection) els.liveSection.hidden = !isLive;
  if (els.revealStage) els.revealStage.hidden = true;
  if (els.revealStage) els.revealStage.classList.remove("reveal-live");
  if (els.revealGif) els.revealGif.hidden = true;
  if (els.exitRevealBtn) els.exitRevealBtn.hidden = true;
  document.body.classList.remove("reveal-mode");

  if (els.copyGuestLinkBtn) els.copyGuestLinkBtn.hidden = !isLive;
  if (els.startCamBtnInline) els.startCamBtnInline.hidden = !isLive;
  if (els.revealBtn) els.revealBtn.hidden = !isLive;
  if (els.recordBtn) els.recordBtn.hidden = !isLive;
  if (els.downloadBtn) els.downloadBtn.hidden = !isLive;

  setStartupStatus(
    isWelcome ? "Welcome step" : isGender ? "Choose gender" : isLive ? "Live room ready" : ""
  );

  const target = isWelcome ? els.heroSection : isGender ? els.genderStep : isLive ? els.controlsCard : null;
  if (target?.scrollIntoView) {
    requestAnimationFrame(() => target.scrollIntoView({ behavior: "auto", block: "start" }));
  }
}

function showGuestOnly() {
  if (els.guestEntryPanel) els.guestEntryPanel.hidden = false;
  setStartupStatus("Guest mode");
  requestAnimationFrame(() => els.guestEntryPanel?.scrollIntoView({ behavior: "auto", block: "start" }));
}

function renderRevealPreview() {
  if (!els.revealStage) return;
  els.revealStage.classList.toggle("reveal-boy", state.gender === "boy");
  els.revealStage.classList.toggle("reveal-girl", state.gender === "girl");
  setRevealText(state.gender === "girl" ? "It's a girl!" : "It's a boy!");
}

function exitRevealMode() {
  document.body.classList.remove("reveal-mode");
  state.revealActive = false;
  state.countdownRunning = false;
  if (els.exitRevealBtn) els.exitRevealBtn.hidden = true;
  if (els.revealStage) {
    els.revealStage.hidden = true;
    els.revealStage.classList.remove("reveal-live");
  }
  if (els.revealGif) {
    els.revealGif.hidden = true;
    els.revealGif.removeAttribute("src");
  }
  renderRevealPreview();
  showOnly("live");
  setStatus("Back to room");
  sendSignal("reveal-reset", { gender: state.gender });
}

function chooseGender(gender) {
  state.gender = gender;
  state.selectedGif = getGifForGender(gender);
  els.selectBoyBtn?.classList.toggle("selected", gender === "boy");
  els.selectGirlBtn?.classList.toggle("selected", gender === "girl");
  renderRevealPreview();
  setStatus(`${gender === "boy" ? "Boy" : "Girl"} selected`);
  showOnly("live");
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }
  if (state.localStream) return state.localStream;
  state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  els.localVideo.srcObject = state.localStream;
  if (els.startCamBtnInline) els.startCamBtnInline.textContent = "Disable camera";
  if (els.hostBadge) els.hostBadge.textContent = "Camera on";
  setStatus("Camera on");
  startSignalListener();
  if (state.guestRequested && !state.peer && state.guestPeerId) {
    await createHostPeer(state.guestPeerId);
  }
  return state.localStream;
}

function stopCamera() {
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  if (els.localVideo) els.localVideo.srcObject = null;
  if (els.startCamBtnInline) els.startCamBtnInline.textContent = "Enable camera";
  if (els.hostBadge) els.hostBadge.textContent = "Offline";
  setStatus("Camera off");
  state.peer?.close();
  state.peer = null;
  state.guestRequested = false;
  state.guestPeerId = null;
  state.signalSource?.close?.();
  state.signalSource = null;
  state.signalStarted = false;
}

function copyGuestLink() {
  const url = new URL(location.origin + "/");
  url.searchParams.set("room", roomId);
  url.searchParams.set("guest", "1");
  navigator.clipboard.writeText(url.toString());
  const label = els.copyGuestLinkBtn.textContent;
  els.copyGuestLinkBtn.textContent = "Guest link copied";
  setTimeout(() => (els.copyGuestLinkBtn.textContent = label), 1200);
}

function startConfetti() {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.className = "confetti-layer";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#ff6fb2", "#6c7cff", "#ffc94d", "#6ee7b7", "#ffffff", "#ff9f43", "#ffd166"];
  const pieces = Array.from({ length: 260 }, () => {
    const isStrip = Math.random() > 0.45;
    return {
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.7,
      vx: -4 + Math.random() * 8,
      vy: 2 + Math.random() * 6,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: -0.2 + Math.random() * 0.4,
      size: isStrip ? 6 + Math.random() * 6 : 3 + Math.random() * 4,
      width: isStrip ? 4 + Math.random() * 5 : 3 + Math.random() * 3,
      height: isStrip ? 10 + Math.random() * 18 : 3 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      strip: isStrip,
      sway: -1 + Math.random() * 2,
    };
  });
  const start = performance.now();
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.x += p.vx + Math.sin((performance.now() / 250) + p.rotation) * p.sway * 0.25;
      p.y += p.vy;
      p.vy += 0.03;
      p.rotation += p.rotationSpeed;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      if (p.strip) {
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (performance.now() - start < 6500) requestAnimationFrame(tick);
    else canvas.remove();
  }
  tick();
}

function startCountdownAndReveal() {
  if (state.countdownRunning || !state.gender) return;
  state.countdownRunning = true;
  document.body.classList.add("reveal-mode");
  if (els.revealStage) els.revealStage.hidden = false;
  if (els.revealStage) els.revealStage.classList.add("reveal-live");
  const gif = state.selectedGif || getGifForGender(state.gender);
  const count = ["5", "4", "3", "2", "1"];
  sendSignal("reveal-start", { gender: state.gender, gif });
  let index = 0;
  const step = () => {
    if (index < count.length) {
      const current = count[index];
      setRevealText(current);
      sendSignal("reveal-count", { count: current, gender: state.gender });
      setStatus(`Reveal in ${count[index]}`);
      index += 1;
      setTimeout(step, 1000);
      return;
    }
    state.revealActive = true;
    if (els.revealGif) {
      els.revealGif.src = gif;
      els.revealGif.hidden = false;
    }
    sendSignal("reveal-final", { gender: state.gender, gif });
    setRevealText(state.gender === "girl" ? "It's a girl!" : "It's a boy!");
    setStatus("Reveal live");
    startConfetti();
    state.countdownRunning = false;
    if (els.exitRevealBtn) {
      els.exitRevealBtn.hidden = false;
      els.exitRevealBtn.onclick = () => exitRevealMode();
    }
  };
  step();
}

function startRecording() {
  if (state.recording) return;
  const begin = async () => {
    if (!state.localStream) await startCamera();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    state.localStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    state.recordedChunks = [];
    state.recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    state.recorder.ondataavailable = (e) => e.data.size && state.recordedChunks.push(e.data);
    state.recorder.onstop = () => {
      const blob = new Blob(state.recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      els.downloadBtn.disabled = false;
      els.downloadBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = `reveal-room-${roomId}.webm`;
        a.click();
      };
      setStatus("Recording ready");
    };

    const draw = () => {
      ctx.fillStyle = "#fff8f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#27181f";
      ctx.font = "700 40px Fraunces, serif";
      ctx.fillText("Gender Reveal Live Room", 40, 70);
      ctx.font = "600 28px Inter, sans-serif";
      ctx.fillText(`Room: ${roomId}`, 40, 120);
      ctx.fillText(`Gender: ${state.gender || "not selected"}`, 40, 160);
      ctx.fillText(`Status: ${state.revealActive ? "Reveal live" : "Ready"}`, 40, 200);
      ctx.fillStyle = "#1f1020";
      ctx.fillRect(40, 250, 540, 360);
      if (els.localVideo?.readyState >= 2 && state.localStream?.active) {
        ctx.drawImage(els.localVideo, 40, 250, 540, 360);
      }
      if (state.revealActive) {
        const img = new Image();
        img.src = gif;
        img.onload = () => ctx.drawImage(img, 620, 250, 600, 360);
      } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(620, 250, 600, 360);
        ctx.fillStyle = "#27181f";
        ctx.fillText("Reveal hidden until host starts", 660, 430);
      }
      requestAnimationFrame(draw);
    };
    draw();
    state.recorder.start();
    state.recording = true;
    els.recordBtn.classList.add("recording-state");
    els.recordBtn.innerHTML = `<span class="record-dot"></span> Stop recording`;
    setStatus("Recording started");
  };
  begin().catch((err) => {
    setStatus(err?.name === "NotAllowedError" ? "Camera permission denied" : "Camera blocked");
  });
}

function stopRecording() {
  if (!state.recording) return;
  state.recorder?.stop();
  state.recording = false;
  els.recordBtn.classList.remove("recording-state");
  els.recordBtn.textContent = "Start recording";
}

function init() {
  document.body.classList.toggle("guest-view", isGuest);
  updateConnectionLabels();
  renderRevealPreview();
  if (isGuest) {
    renderGuestShell();
    els.guestEntryPanel = document.getElementById("guestEntryPanel");
    window.__guestPick = (mode) => {
      state.guestMode = mode;
      const panel = document.getElementById("guestEntryPanel");
      if (!panel) return;
      panel.dataset.view = "name";
      panel.innerHTML = `
        <div class="guest-entry-step">
          <div>
            <p class="eyebrow">${mode === "camera" ? "Join with camera" : "Watch only"}</p>
            <h2>Enter your name</h2>
            <p class="lede">${
              mode === "camera"
                ? "You will join the room with camera on."
                : "You can watch the reveal without joining on camera."
            }</p>
          </div>
          <label class="guest-field">
            <span class="hint">Your name</span>
            <input id="guestNameInput" type="text" placeholder="Type your name" />
          </label>
          <div class="button-row">
            <button id="guestContinueBtn" class="primary" type="button">Continue</button>
            <button id="guestBackBtn" class="secondary" type="button">Back</button>
          </div>
        </div>
      `;
      const input = panel.querySelector("#guestNameInput");
      input?.focus();
      panel.querySelector("#guestBackBtn")?.addEventListener("click", () => {
        panel.dataset.view = "default";
        panel.innerHTML = guestEntryDefaultHTML;
      });
      panel.querySelector("#guestContinueBtn")?.addEventListener("click", () => {
        const name = input?.value.trim();
        if (!name) {
          input?.focus();
          return;
        }
        panel.dataset.view = "done";
        panel.innerHTML = `
          <div class="guest-entry-step">
            <div>
              <p class="eyebrow">Guest ready</p>
              <h2>Thanks, ${name}</h2>
              <p class="lede">You are set to ${mode === "camera" ? "join with camera" : "watch only"}.</p>
            </div>
            <div class="button-row">
              <button id="guestDoneBtn" class="primary" type="button">Done</button>
            </div>
          </div>
        `;
        panel.querySelector("#guestDoneBtn")?.addEventListener("click", () => {
          panel.dataset.view = "default";
          panel.innerHTML = guestEntryDefaultHTML;
        });
      });
    };
    showGuestOnly();
    return;
  }
  showOnly("welcome");
  setStartupStatus("Room ready");
  if (els.guestModal) els.guestModal.hidden = true;

  els.welcomeNextBtn.onclick = () => showOnly("gender");
  els.selectBoyBtn.onclick = () => chooseGender("boy");
  els.selectGirlBtn.onclick = () => chooseGender("girl");
  els.copyGuestLinkBtn.onclick = copyGuestLink;
  els.startCamBtnInline.onclick = async () => {
    els.startCamBtnInline.disabled = true;
    try {
      if (state.localStream) stopCamera();
      else await startCamera();
    } catch (err) {
      setStatus(err?.name === "NotAllowedError" ? "Camera permission denied" : "Camera blocked");
    } finally {
      els.startCamBtnInline.disabled = false;
    }
  };
  els.revealBtn.onclick = () => {
    els.revealBtn.disabled = true;
    startCountdownAndReveal();
    setTimeout(() => (els.revealBtn.disabled = false), 2500);
  };
  els.recordBtn.onclick = () => {
    els.recordBtn.disabled = true;
    if (state.recording) stopRecording();
    else startRecording();
    setTimeout(() => (els.recordBtn.disabled = false), 400);
  };
  els.closeGuestModalBtn.onclick = () => (els.guestModal.hidden = true);
  if (els.exitRevealBtn) els.exitRevealBtn.onclick = exitRevealMode;

  window.addEventListener("beforeunload", () => {
    stopRecording();
    stopCamera();
  });
}

init();
