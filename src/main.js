import { initMomento, subscribeToMessages, publish, setKey } from './momento.js';
import { allThere, pieceTogether, sendAnswerInFragments } from './utils.js';

const answerButton = document.getElementById('answerButton');
const hangupButton = document.getElementById('hangupButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let pc;
let localStream;
let remoteCandidatesBuffer = [];
let remoteDescriptionSet = false;

const cacheName = 'test';
const agentId = 'xyz';
const visitorId = 'abc';

await initMomento();
subscribeToMessages(cacheName, `agent:${agentId}:inbox`, onEvent);

answerButton.onclick = handleAnswerClick;
hangupButton.onclick = handleHangupClick;

async function handleAnswerClick() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = localStream;

  publish(cacheName, `visitor:${visitorId}:inbox`, createEventMessage('call-accepted'));

  answerButton.disabled = true;
  hangupButton.disabled = false;
}

async function handleHangupClick() {
  publish(cacheName, `visitor:${visitorId}:inbox`, createEventMessage('hangup'));
  await hangup();
}

function createEventMessage(type, data = {}) {
  return JSON.stringify({
    from: agentId,
    to: visitorId,
    type,
    ...data,
  });
}

async function onEvent(e) {
  console.log(`incoming event: ${e.type}`);

  switch (e.type) {
    case 'offer':
      await handleOfferEvent(e);
      break;
    case 'candidate':
      handleRemoteIceCandidate(e);
      break;
    case 'call':
      console.log("Visitor is calling...");
      break;
    case 'hangup':
      await hangup();
      break;
    default:
      console.log("Unhandled event:", e);
  }
}

async function handleOfferEvent(e) {
  const { part, totalParts, sdpFragment, from } = e;

  await setKey(cacheName, `${from}-${part}`, sdpFragment);

  const ready = await allThere(cacheName, from, totalParts);
  if (!ready) return;

  const fullSdp = await pieceTogether(cacheName, from, totalParts);

  // Ensure local stream is ready first
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
  }

  // Setup RTC now that we have both localStream and remote SDP
  setupRTC();

  const ok = await trySetRemoteDescription(fullSdp);
  if (!ok) return;

  const answer = await pc.createAnswer(); // create after remoteDescription is set
  await pc.setLocalDescription(answer);

  await sendAnswerInFragments(cacheName, agentId, visitorId, answer.sdp);
  flushBufferedCandidates();
}

function setupRTC() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) {
      publish(cacheName, `visitor:${visitorId}:inbox`, JSON.stringify({
        type: 'candidate',
        candidate: e.candidate.toJSON()
      }));
    }
  };

  pc.ontrack = e => {
    if (!remoteVideo.srcObject) {
      remoteVideo.srcObject = new MediaStream();
    }
    e.streams[0].getTracks().forEach(track => {
      remoteVideo.srcObject.addTrack(track);
    });
  };
}

async function trySetRemoteDescription(sdp) {
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp });
    remoteDescriptionSet = true;
    return true;
  } catch (err) {
    console.error("setRemoteDescription failed:", err);
    return false;
  }
}

function handleRemoteIceCandidate(e) {
  if (!e.candidate) return;
  const candidate = new RTCIceCandidate(e.candidate);
  if (remoteDescriptionSet) {
    pc.addIceCandidate(candidate).catch(console.error);
  } else {
    remoteCandidatesBuffer.push(candidate);
  }
}

function flushBufferedCandidates() {
  remoteCandidatesBuffer.forEach(candidate => {
    pc.addIceCandidate(candidate).catch(console.error);
  });
  remoteCandidatesBuffer = [];
}

async function hangup() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  remoteCandidatesBuffer = [];
  remoteDescriptionSet = false;

  answerButton.disabled = false;
  hangupButton.disabled = true;
}
