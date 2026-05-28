const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "reveal-room";
const clientId = crypto.randomUUID();

const panel = document.getElementById("guestEntryPanel");

const state = {
  mode: null,
  peer: null,
  localStream: null,
  name: "",
  revealGender: null,
  revealGif: null,
  revealCount: null,
  revealVisible: false,
  revealStarted: false,
  hostStream: null,
  revealTimer: null,
};

function attachHostStream(stream) {
  state.hostStream = stream;
  const hostVideo = document.getElementById("hostVideo");
  if (hostVideo) {
    hostVideo.srcObject = stream;
    hostVideo.play?.().catch(() => {});
  }
}

function attachGuestStream(stream) {
  const guestVideo = document.getElementById("guestVideo");
  if (guestVideo) {
    guestVideo.srcObject = stream;
    guestVideo.play?.().catch(() => {});
  }
}

function clearRevealTimer() {
  if (state.revealTimer) {
    clearTimeout(state.revealTimer);
    state.revealTimer = null;
  }
}

function exitRevealPresentation() {
  clearRevealTimer();
  document.body.classList.remove("reveal-mode");
  const reveal = document.getElementById("revealArea");
  const label = document.getElementById("revealLabel");
  const gif = document.getElementById("revealGif");
  if (reveal) reveal.hidden = true;
  if (gif) {
    gif.hidden = true;
    gif.removeAttribute("src");
  }
  if (label) label.textContent = "Waiting for reveal";
}

async function sendSignal(type, data = {}) {
  await fetch("/api/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomId, type, from: clientId, ...data }),
  });
}

function startSignalListener() {
  const source = new EventSource(`/api/events?room=${encodeURIComponent(roomId)}&client=${clientId}`);
  source.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (!message || message.from === clientId) return;
    if (message.type === "offer" && state.peer) {
      await state.peer.setRemoteDescription(message.sdp);
      const answer = await state.peer.createAnswer();
      await state.peer.setLocalDescription(answer);
      await sendSignal("answer", { to: message.from, sdp: answer });
    }
    if (message.type === "answer" && state.peer) {
      await state.peer.setRemoteDescription(message.sdp);
    }
    if (message.type === "ice" && state.peer && message.candidate) {
      try {
        await state.peer.addIceCandidate(message.candidate);
      } catch {}
    }
    if (message.type === "reveal-count") {
      state.revealStarted = true;
      state.revealCount = message.count;
      const label = document.getElementById("revealLabel");
      if (label) label.textContent = message.count;
      const reveal = document.getElementById("revealArea");
      if (reveal) reveal.hidden = false;
    }
    if (message.type === "reveal-start") {
      clearRevealTimer();
      state.revealStarted = true;
      state.revealCount = "5";
      state.revealGender = message.gender || state.revealGender;
      state.revealGif = message.gif || state.revealGif;
      const reveal = document.getElementById("revealArea");
      const label = document.getElementById("revealLabel");
      const gif = document.getElementById("revealGif");
      if (reveal) reveal.hidden = false;
      if (label) label.textContent = "5";
      if (gif) {
        gif.hidden = true;
        if (state.revealGif) gif.src = state.revealGif;
      }
    }
    if (message.type === "reveal-final") {
      clearRevealTimer();
      state.revealGender = message.gender;
      state.revealGif = message.gif;
      state.revealVisible = true;
      document.body.classList.add("reveal-mode");
      const reveal = document.getElementById("revealArea");
      if (reveal) {
        reveal.hidden = false;
        const img = document.getElementById("revealGif");
        if (img) {
          img.src = message.gif;
          img.hidden = false;
        }
        const label = document.getElementById("revealLabel");
        if (label) label.textContent = message.gender === "girl" ? "It's a girl!" : "It's a boy!";
      }
      state.revealTimer = setTimeout(() => {
        state.revealVisible = false;
        exitRevealPresentation();
      }, 4500);
    }
    if (message.type === "reveal-reset") {
      exitRevealPresentation();
      state.revealCount = null;
      state.revealVisible = false;
      state.revealStarted = false;
      state.revealGender = null;
      state.revealGif = null;
      const reveal = document.getElementById("revealArea");
      const label = document.getElementById("revealLabel");
      const gif = document.getElementById("revealGif");
      if (reveal) reveal.hidden = true;
      if (gif) {
        gif.hidden = true;
        gif.removeAttribute("src");
      }
      if (label) label.textContent = "Waiting for reveal";
    }
  });
}

async function createGuestPeer() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  state.peer = pc;
  if (state.mode === "camera" && state.localStream) {
    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  }
  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) attachHostStream(stream);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal("ice", { candidate: event.candidate });
  };
  await sendSignal("guest-join");
}

function setDefaultView() {
  panel.dataset.view = "default";
  panel.innerHTML = `
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
  wireButtons();
}

function showLiveView() {
  const hasCamera = state.mode === "camera";
  panel.dataset.view = "live";
  panel.innerHTML = `
    <div class="guest-live-shell">
      <div class="guest-live-header">
        <div>
          <p class="eyebrow">Guest live</p>
          <h2>${state.name ? `Welcome, ${state.name}` : "You're in"}</h2>
          <p class="lede">${hasCamera ? "Your camera is on." : "Watch-only mode."}</p>
        </div>
      </div>
      <section id="revealArea" class="card reveal-stage" hidden>
        <img id="revealGif" class="reveal-gif" alt="Selected reveal GIF" hidden />
        <div class="result" id="revealLabel">Waiting for reveal</div>
      </section>
      <div class="guest-live-grid">
        <article class="card studio-panel">
          <header>
            <h2>Host video</h2>
            <span class="pill">Live</span>
          </header>
          <video id="hostVideo" autoplay playsinline></video>
        </article>
        <article class="card studio-panel" ${hasCamera ? "" : 'hidden'}>
          <header>
            <h2>Your camera</h2>
            <span class="pill">On</span>
          </header>
          <video id="guestVideo" autoplay playsinline muted></video>
        </article>
      </div>
    </div>
  `;
  document.body.classList.remove("reveal-mode");
  if (state.hostStream) attachHostStream(state.hostStream);
  const reveal = document.getElementById("revealArea");
  const label = document.getElementById("revealLabel");
  const gif = document.getElementById("revealGif");
  if (state.revealCount && reveal && label) {
    reveal.hidden = false;
    label.textContent = state.revealCount;
  }
  if (state.revealStarted && reveal && label) {
    reveal.hidden = false;
    label.textContent = state.revealCount || "5";
  }
  if (state.revealVisible && reveal && gif) {
    reveal.hidden = false;
    if (state.revealGif) {
      gif.src = state.revealGif;
      gif.hidden = false;
    }
    if (label) label.textContent = state.revealGender === "girl" ? "It's a girl!" : "It's a boy!";
  }
  if (hasCamera) {
    navigator.mediaDevices?.getUserMedia?.({ video: true, audio: true }).then((stream) => {
      state.localStream = stream;
      attachGuestStream(stream);
    }).catch(() => {});
  }
}

function showNameStep(mode) {
  state.mode = mode;
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
  panel.querySelector("#guestBackBtn")?.addEventListener("click", setDefaultView);
  panel.querySelector("#guestContinueBtn")?.addEventListener("click", async () => {
    const name = input?.value.trim();
    if (!name) {
      input?.focus();
      return;
    }
    state.name = name;
    if (state.mode === "camera" && !state.localStream && navigator.mediaDevices?.getUserMedia) {
      try {
        state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        attachGuestStream(state.localStream);
      } catch {
        state.localStream = null;
      }
    }
    await createGuestPeer();
    showLiveView();
  });
}

function wireButtons() {
  panel.querySelector("#watchOnlyBtn")?.addEventListener("click", () => showNameStep("watch"));
  panel.querySelector("#joinCameraBtn")?.addEventListener("click", () => showNameStep("camera"));
}

startSignalListener();
setDefaultView();
