import { initMomento, subscribeToMessages, publish, getKey, setKey, deleteKey, valueExists } from './momento.js';
import { allThere, pieceTogether, sendAnswerInFragments } from './utils.js';

const answerButton = document.getElementById('answerButton');
const hangupButton = document.getElementById('hangupButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let pc;
let localStream;
let remoteCandidatesBuffer = [];
let remoteDescriptionSet = false;

initMomento();
subscribeToMessages('cache', 'agent:xyz:inbox', onEvent);

answerButton.onclick = handleAnswerClick;
hangupButton.onclick = handleHangupClick;

async function handleAnswerClick() {

    // 1. Setup local stream and get user media
    localStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
    localVideo.srcObject = localStream;
  
    // 2. Build call-accepted message and set it to visitor
    let message = createEventMessage('call-accepted');
    publish('cache','visitor:abc:inbox', message)
  
    // 3. Debounce so agent can't spam the answer button
    answerButton.disabled = true;
    hangupButton.disabled = false;
}

async function handleHangupClick() {
    hangupButton.disabled = true;
    answerButton.disabled = false;
  
    // Notify remote peer you're hanging up
    const message = createEventMessage('hangup');
    await publish('cache', 'visitor:abc:inbox', message);
  
    await hangup();
}
  
function createEventMessage(type, data = {}) {
  const from = 'xyz'; // TODO: make dynamic
  const to = 'abc';   // TODO: make dynamic

  return JSON.stringify({
    from,
    to,
    type,
    ...data,
  });
}

function setupRTC(){
  if (pc) {
    console.error('cannot create RTC connection if there is existing one');
    return;
  }
  console.log(`setting up RTC Peerconnection`);
  pc = new RTCPeerConnection();
  
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // RTC Connection event handlers:
  // - Ice candidate event:
  pc.onicecandidate = e => {
    const message = {
      type: 'candidate',
      candidate: null,
    };
    if (e.candidate) {
      message.candidate = e.candidate.candidate;
      message.sdpMid = e.candidate.sdpMid;
      message.sdpMLineIndex = e.candidate.sdpMLineIndex;
    }
    publish('cache', 'visitor:abc:inbox', JSON.stringify(message));
  };
  // - Track event:
  pc.ontrack = (e) => {
    try { remoteVideo.srcObject = e.streams[0]; } 
    catch (error) { console.error('Error setting remote video source:', error); }
  }
}

async function trySetRemoteDescription(sdp) {
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp });
    console.log("Remote description set.");
    return true;
  } catch (err) {
    console.error("Failed to set remote description:", err);
    return false;
  }
}

async function createAndSetAnswer() {
  try {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log("Local description set with answer.");
    return answer;
  } catch (err) {
    console.error("Failed to create/set local description:", err);
    return null;
  }
}

function flushBufferedCandidates() {
  remoteDescriptionSet = true;
  for (const candidate of remoteCandidatesBuffer) {
    pc.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(e => console.error("Error adding buffered ICE candidate:", e));
  }
  remoteCandidatesBuffer = [];
}

async function handleOfferEvent(e) {
  const { part, totalParts, sdpFragment, from } = e;

  // 1. Save the received SDP fragment
  await setKey("cache", `${from}-${part}`, sdpFragment);

  // 2 . Wait until all parts are received
  const ready = await allThere(from, totalParts);
  if (!ready) {
    console.log("Waiting for all SDP parts to arrive...");
    return;
  }

  // 3. Reconstruct full SDP offer
  const fullSdp = await pieceTogether(from, totalParts);

  // 4. Set up the peer connection and handle RTC logic
  await setupRTC();
  const setOk = await trySetRemoteDescription(fullSdp);
  if (!setOk) {
    console.error("Failed to set remote description.");
    return;
  }

  // 5. Create, set, and send the answer
  const answer = await createAndSetAnswer();
  await sendAnswerInFragments(answer.sdp);

  // 6. Apply buffered ICE candidates
  flushBufferedCandidates();
}
// MAIN EVENT HANDLER
async function onEvent(e){

  // we only care about the type, too much detail in the rest
  console.log(`incoming event: ${e.type}`);
  
  switch (e.type) {
    case 'offer':
      // offers are tricky!
      // we have to jump through a few hoops to get the offer
      // and respond to it with an answer.
      await handleOfferEvent(e);
      break;
    case 'candidate':
      handleRemoteIceCandidate(e);
      break;
    case 'call':
      // A visitor is calling
      console.log('Visitor is calling');
      break;
    case 'hangup':
      console.log('Remote hung up');
      await hangup();
      break;
    default:
      console.log('unhandled', e);
      break;
  }
}

async function hangup() {
  if (pc) {
    pc.close();
    pc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  remoteVideo.srcObject = null;
  localVideo.srcObject = null;

  remoteCandidatesBuffer = [];
  remoteDescriptionSet = false;

  hangupButton.disabled = true;
  answerButton.disabled = false;
}

function handleRemoteIceCandidate(candidate) {
  if (remoteDescriptionSet) {
    pc.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(e => console.error("Error adding ICE candidate:", e));
  } else {
    remoteCandidatesBuffer.push(candidate);
  }
}
  