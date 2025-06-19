import { publish, setKey } from './momento.js';
import { sendAnswerInFragments } from './utils.js';
import { start } from './setup.js';

let activeCall = null;
let agentId;

const agentIdInput = document.getElementById('agentIdInput');
const setAgentIdBtn = document.getElementById('setAgentIdBtn');


setAgentIdBtn.onclick = async () => {
  agentId = agentIdInput.value;
  console.log('Agent ID updated to:', agentIdInput.value);
  await start(agentId);
}

const cacheName = import.meta.env.VITE_CACHE_NAME;

const answerButton = document.getElementById('answerButton');
const hangupButton = document.getElementById('hangupButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusCard = document.querySelector('.status-card');
const toggle = document.getElementById('onlineToggle');
const header = document.querySelector('.header-bar');

const offerFragments = new Map(); // Map<from, { totalParts, parts: Map<index, sdpFragment> }>

hangupButton.disabled = true;
answerButton.disabled = true;

toggle.addEventListener('change', updateHeaderColor);
// Set initial color

function updateHeaderColor() {
  if (toggle.checked) {
    setKey('agent', `${agentId}-online`,`true`)
    header.classList.add('header-online');
    header.classList.remove('header-offline');
  } else {
    setKey('agent', `${agentId}-online`,`false`)
    header.classList.add('header-offline');
    header.classList.remove('header-online');
  }
}

let pc;
let localStream;
let remoteCandidatesBuffer = [];
let remoteDescriptionSet = false;


answerButton.onclick = () => {
  if (!activeCall) {
    console.error("No active call to answer");
    return;
  }
  handleAnswerClick(activeCall);
};

hangupButton.onclick = () => {
  if (!activeCall) {
    console.error("No active call to hang up");
    return;
  }
  handleHangupClick(activeCall);
};


async function handleAnswerClick(call) {
  const visitorId = call.visitorId;
  if (!visitorId) {
    console.error("visitorId is not set before answering!");
    return;
  }

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = localStream;

  publish(cacheName, `visitor:${visitorId}:inbox`, createEventMessage('call-accepted', call));

  answerButton.disabled = true;
  hangupButton.disabled = false;
}

async function handleHangupClick(call) {
  const visitorId = call.visitorId;
  if (!visitorId) {
    console.error("visitorId is not set before answering!");
    return;
  }
  const message = createEventMessage('hangup', activeCall);
  await publish(cacheName, `visitor:${visitorId}:inbox`, message);

  await hangup();
}

function createEventMessage(type, data = {}) {
  if (!activeCall?.visitorId) {
    console.error("Missing visitorId in createEventMessage");
    return '{}';
  }

  return JSON.stringify({
    from: agentId,
    to: activeCall.visitorId,
    type,
    ...data,
  });
}

export async function onEvent(e) {
  console.log(`incoming event: ${e.type}`);

  switch (e.type) {
    case 'offer':
      statusCard.className = 'status-card on-call';
      statusCard.textContent = 'on call';
      await handleOfferEvent(e);
      break;
    case 'candidate':
      handleRemoteIceCandidate(e);
      break;
      case 'call':
        if (activeCall) {
          console.warn("Ignoring new call from", e.from, "because a call is already active.");
          return;
        }
      
        activeCall = {
          visitorId: e.from
        };
      
        console.log("Incoming call from", activeCall.visitorId);
      
        answerButton.onclick = () => handleAnswerClick(activeCall);
        hangupButton.onclick = () => handleHangupClick(activeCall);
      
        statusCard.className = 'status-card incoming';
        statusCard.textContent = 'incoming call...';
        answerButton.disabled = false;
        hangupButton.disabled = false;
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

  // lets use in memory cache for now
  // Initialize if not present
  if (!offerFragments.has(from)) {
    offerFragments.set(from, {
      totalParts,
      parts: new Map()
    });
  }

  const entry = offerFragments.get(from);
  entry.parts.set(part, sdpFragment);

  // Check if all parts are received
  if (entry.parts.size < totalParts) return;

  // Reassemble full SDP
  let fullSdp = "";
  for (let i = 1; i <= totalParts; i++) {
    const fragment = entry.parts.get(i);
    if (!fragment) {
      console.error(`Missing fragment ${i} from ${from}`);
      return;
    }
    fullSdp += fragment;
  }

  // Clean up
  offerFragments.delete(from);

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

  await sendAnswerInFragments(cacheName, agentId, activeCall.visitorId, answer.sdp);
  flushBufferedCandidates();
}

function setupRTC() {
 pc = new RTCPeerConnection({
  iceServers: [
    { 
      urls: 'stun:stun.l.google.com:19302' 
    },
    {
      urls: 'stun:relay1.expressturn.com:3478'
    },
    {
      urls: 'turn:relay1.expressturn.com:3478?transport=tcp',
      username: '174668951889717373',
      credential: 'ahP+p9uQNI0Ng7Sm6MNKCm5cDL0='
    }
  ]
});

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) {
      if (!activeCall?.visitorId) {
        console.error("Missing visitorId when publishing ICE candidate");
        return;
      }
      publish(cacheName, `visitor:${activeCall.visitorId}:inbox`, JSON.stringify({
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
  statusCard.className = 'status-card ended';
  statusCard.textContent = 'call ended';

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

  activeCall = null;

  answerButton.disabled = false;
  hangupButton.disabled = true;
}
