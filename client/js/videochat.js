requireLogin();

const els = {
  remoteVideo: document.getElementById('remoteVideo'),
  localVideo: document.getElementById('localVideo'),
  searchState: document.getElementById('searchState'),
  coinPill: document.getElementById('coinPill'),
  giftBadge: document.getElementById('giftBadge'),
  swipeHint: document.getElementById('swipeHint'),
  giftSheetBackdrop: document.getElementById('giftSheetBackdrop'),
  giftSheetBalance: document.getElementById('giftSheetBalance'),
  reportSheetBackdrop: document.getElementById('reportSheetBackdrop'),
  videoScreen: document.getElementById('videoScreen'),
  muteBtn: document.getElementById('muteBtn'),
  cameraBtn: document.getElementById('cameraBtn'),
};

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
// NOTE: for production, add a TURN server here too (STUN alone fails behind many
// mobile/carrier NATs). e.g. { urls: 'turn:your-turn-server', username, credential }

let socket, localStream, pc, currentRoom = null, peerId = null, myUserId = null;
let isMuted = false, isCameraOn = true, giftSessionActive = false;

async function init() {
  const { user } = await api('/api/user/me');
  myUserId = user.id;
  els.coinPill.textContent = '🪙 ' + fmtCoins(user.spendable_coins);
  window.__spendable = user.spendable_coins;

  if (user.account_status === 'banned') { window.location.href = '/banned.html'; return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    els.localVideo.srcObject = localStream;
  } catch (err) {
    toast('Camera/mic permission needed to start a video chat.');
    return;
  }

  connectSocket();
}

function connectSocket() {
  socket = io({ auth: { token: Session.getToken() } });

  socket.on('connect', () => socket.emit('find_match'));
  socket.on('searching', () => showSearching(true));
  socket.on('banned', () => window.location.href = '/banned.html');

  socket.on('matched', async ({ roomId, initiator, peerId: pId }) => {
    currentRoom = roomId; peerId = pId;
    showSearching(false);
    await setupPeerConnection(initiator);
  });

  socket.on('signal', async ({ data }) => {
    if (!pc) return;
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { roomId: currentRoom, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
    }
  });

  socket.on('partner_left', () => {
    toast('Partner left. Finding someone new...');
    cleanupPeer();
    showSearching(true);
  });

  socket.on('balance_update', ({ spendable_coins }) => {
    window.__spendable = spendable_coins;
    els.coinPill.textContent = '🪙 ' + fmtCoins(spendable_coins);
  });

  socket.on('gift_started', ({ amount }) => {
    giftSessionActive = true;
    els.giftBadge.classList.remove('hidden');
    els.giftBadge.textContent = `🎁 ${amount}`;
  });

  socket.on('gift_tick', ({ remaining }) => {
    els.giftBadge.textContent = `🎁 ${remaining}`;
  });

  socket.on('gift_ended', () => {
    giftSessionActive = false;
    els.giftBadge.classList.add('hidden');
  });

  socket.on('gift_error', ({ error }) => {
    toast('Gift error: ' + error.replace(/_/g, ' '));
  });

  socket.on('presence_update', () => {});
}

function showSearching(show) {
  els.searchState.classList.toggle('hidden', !show);
  els.swipeHint.classList.toggle('hidden', show);
  els.remoteVideo.srcObject = show ? null : els.remoteVideo.srcObject;
}

async function setupPeerConnection(initiator) {
  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    els.remoteVideo.srcObject = event.streams[0];
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { roomId: currentRoom, data: { candidate: event.candidate } });
    }
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { roomId: currentRoom, data: { sdp: pc.localDescription } });
  }
}

function cleanupPeer() {
  if (pc) { pc.close(); pc = null; }
  els.remoteVideo.srcObject = null;
  currentRoom = null; peerId = null;
  giftSessionActive = false;
  els.giftBadge.classList.add('hidden');
}

// ---- Swipe up for next ----
let touchStartY = null;
els.videoScreen.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
els.videoScreen.addEventListener('touchend', (e) => {
  if (touchStartY === null) return;
  const deltaY = touchStartY - e.changedTouches[0].clientY;
  if (deltaY > 80 && currentRoom) {
    swipeNext();
  }
  touchStartY = null;
});

function swipeNext() {
  socket.emit('swipe_next');
  cleanupPeer();
  showSearching(true);
}

// ---- Mute / Camera toggle ----
els.muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  els.muteBtn.classList.toggle('active', isMuted);
});
els.cameraBtn.addEventListener('click', () => {
  isCameraOn = !isCameraOn;
  localStream.getVideoTracks().forEach(t => t.enabled = isCameraOn);
  els.cameraBtn.classList.toggle('active', !isCameraOn);
});
document.getElementById('chatBtn').addEventListener('click', () => {
  toast('Text chat panel — hook up your chat UI/socket events here.');
});

// ---- Gift sheet ----
document.getElementById('giftBtn').addEventListener('click', () => {
  if (!currentRoom) return toast('Wait until you are connected to someone.');
  if (giftSessionActive) return toast('A gift is already active in this call.');
  els.giftSheetBalance.textContent = 'Balance: ' + fmtCoins(window.__spendable) + ' 🪙';
  els.giftSheetBackdrop.classList.remove('hidden');
});
document.getElementById('closeGiftSheet').addEventListener('click', () => els.giftSheetBackdrop.classList.add('hidden'));
document.querySelectorAll('.gift-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    const amt = Number(opt.dataset.amt);
    if (amt > window.__spendable) { toast('Insufficient balance for this gift.'); return; }
    socket.emit('send_gift', { amount: amt });
    els.giftSheetBackdrop.classList.add('hidden');
  });
});

// ---- Report flow: capture 5s clip of remote video as evidence ----
document.getElementById('reportBtn').addEventListener('click', () => {
  if (!currentRoom) return toast('You are not in a call.');
  els.reportSheetBackdrop.classList.remove('hidden');
});
document.getElementById('closeReportSheet').addEventListener('click', () => els.reportSheetBackdrop.classList.add('hidden'));

document.querySelectorAll('.reason-opt').forEach(opt => {
  opt.addEventListener('click', async () => {
    const reason = opt.dataset.reason;
    els.reportSheetBackdrop.classList.add('hidden');
    await submitReportWithEvidence(reason);
  });
});

async function submitReportWithEvidence(reason) {
  const reportedUserId = peerId;
  const sessionId = currentRoom;
  toast('Capturing evidence...');

  let blob = null;
  try {
    blob = await captureClip(els.remoteVideo, 5000);
  } catch (e) {
    console.warn('Evidence capture failed', e);
  }

  const form = new FormData();
  form.append('reported_user_id', reportedUserId || '');
  form.append('reason', reason);
  form.append('session_id', sessionId || '');
  if (blob) form.append('clip', blob, 'evidence.webm');

  try {
    const res = await api('/api/reports', { method: 'POST', body: form, isForm: true });
    toast('Report submitted. Ending call.');
  } catch (e) {
    toast('Report failed to submit.');
  }

  // Immediately end the current session regardless of evidence capture outcome.
  socket.emit('leave_room');
  cleanupPeer();
  socket.emit('find_match');
  showSearching(true);
}

function captureClip(videoEl, durationMs) {
  return new Promise((resolve, reject) => {
    const stream = videoEl.srcObject;
    if (!stream) return reject(new Error('no_stream'));
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.onerror = reject;
    recorder.start();
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, durationMs);
  });
}

window.addEventListener('beforeunload', () => {
  if (socket) socket.emit('leave_room');
});

init();
