const SEI_UUID = [
  0x92,0x4b,0xa7,0x5e,0xe1,0x2f,0x4a,0x3b,
  0x98,0x6d,0x43,0x19,0x18,0x4a,0xf0,0x77
];

let pc = null;
let rendered = 0;
let encoded = 0;
let seiCount = 0;

const el = {
  status: document.getElementById('status'),
  signal: document.getElementById('signal'),
  connect: document.getElementById('connect'),
  disconnect: document.getElementById('disconnect'),
  encodedSupport: document.getElementById('encodedSupport'),
  renderedFrames: document.getElementById('renderedFrames'),
  encodedFrames: document.getElementById('encodedFrames'),
  seiCount: document.getElementById('seiCount'),
  frameId: document.getElementById('frameId'),
  cropX: document.getElementById('cropX'),
  cropY: document.getElementById('cropY'),
  cropW: document.getElementById('cropW'),
  cropH: document.getElementById('cropH'),
  captureTs: document.getElementById('captureTs'),
  updatedAt: document.getElementById('updatedAt'),
  video: document.getElementById('stream')
};

function setStatus(text, cls) {
  el.status.textContent = text;
  el.status.className = cls || '';
}

function readU32BE(a, off) {
  return ((a[off] << 24) >>> 0) + (a[off + 1] << 16) + (a[off + 2] << 8) + a[off + 3];
}

function readU64BE(a, off) {
  const hi = BigInt(readU32BE(a, off));
  const lo = BigInt(readU32BE(a, off + 4));
  return (hi << 32n) | lo;
}

function unescapeRbsp(nalu) {
  const out = [];
  let zeros = 0;
  for (let i = 0; i < nalu.length; i++) {
    const b = nalu[i];
    if (zeros >= 2 && b === 0x03) {
      zeros = 0;
      continue;
    }
    out.push(b);
    zeros = (b === 0) ? (zeros + 1) : 0;
  }
  return out;
}

function findAnnexBNalus(data) {
  const nalus = [];
  let i = 0;
  while (i + 3 < data.length) {
    let start = -1;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) start = i + 3;
    else if (i + 4 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) start = i + 4;
    if (start < 0) { i++; continue; }

    let j = start;
    while (j + 3 < data.length) {
      if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (j + 3 < data.length && data[j + 2] === 0 && data[j + 3] === 1))) {
        break;
      }
      j++;
    }

    nalus.push(data.slice(start, j));
    i = j;
  }

  return nalus;
}

function parseSeiFromFrame(frameData) {
  const u8 = frameData instanceof ArrayBuffer
    ? new Uint8Array(frameData)
    : new Uint8Array(frameData.buffer, frameData.byteOffset || 0, frameData.byteLength || 0);

  const nalus = findAnnexBNalus(u8);

  for (const nalu of nalus) {
    if (!nalu.length) continue;
    const nalType = nalu[0] & 0x1f;
    if (nalType !== 6) continue;

    const rbsp = unescapeRbsp(nalu.slice(1));
    let off = 0;
    while (off + 1 < rbsp.length) {
      let payloadType = 0;
      while (off < rbsp.length && rbsp[off] === 0xff) { payloadType += 255; off++; }
      if (off >= rbsp.length) break;
      payloadType += rbsp[off++];

      let payloadSize = 0;
      while (off < rbsp.length && rbsp[off] === 0xff) { payloadSize += 255; off++; }
      if (off >= rbsp.length) break;
      payloadSize += rbsp[off++];

      if (off + payloadSize > rbsp.length) break;
      const payload = rbsp.slice(off, off + payloadSize);
      off += payloadSize;

      if (payloadType !== 5 || payload.length < 52) continue;

      let uuidMatch = true;
      for (let i = 0; i < 16; i++) {
        if (payload[i] !== SEI_UUID[i]) { uuidMatch = false; break; }
      }
      if (!uuidMatch) continue;

      const msg = payload.slice(16);
      if (!(msg[0] === 0x43 && msg[1] === 0x53 && msg[2] === 0x4d && msg[3] === 0x31)) continue;

      const frameId = readU64BE(msg, 4);
      const x = readU32BE(msg, 12) >> 0;
      const y = readU32BE(msg, 16) >> 0;
      const width = readU32BE(msg, 20);
      const height = readU32BE(msg, 24);
      const captureTsUs = readU64BE(msg, 28);
      return { frameId, x, y, width, height, captureTsUs };
    }
  }

  return null;
}

function onMetadata(meta) {
  seiCount += 1;
  el.seiCount.textContent = String(seiCount);
  el.frameId.textContent = String(meta.frameId);
  el.cropX.textContent = String(meta.x);
  el.cropY.textContent = String(meta.y);
  el.cropW.textContent = String(meta.width);
  el.cropH.textContent = String(meta.height);
  el.captureTs.textContent = String(meta.captureTsUs);
  el.updatedAt.textContent = new Date().toLocaleTimeString();
}

function startRenderedCounter() {
  if (typeof el.video.requestVideoFrameCallback !== 'function') return;
  const tick = () => {
    rendered += 1;
    el.renderedFrames.textContent = String(rendered);
    el.video.requestVideoFrameCallback(tick);
  };
  el.video.requestVideoFrameCallback(tick);
}

function setupEncodedTransform(receiver) {
  const supported = typeof receiver.createEncodedStreams === 'function';
  el.encodedSupport.textContent = supported ? 'yes (active)' : 'no';
  el.encodedSupport.className = supported ? 'ok' : 'warn';
  if (!supported) return;

  const streams = receiver.createEncodedStreams();
  const ts = new TransformStream({
    transform(frame, controller) {
      encoded += 1;
      el.encodedFrames.textContent = String(encoded);
      try {
        const meta = parseSeiFromFrame(frame.data);
        if (meta) onMetadata(meta);
      } catch (e) {
        console.log('SEI parse error:', e);
      }
      controller.enqueue(frame);
    }
  });

  streams.readable.pipeThrough(ts).pipeTo(streams.writable).catch((e) => {
    setStatus('Encoded transform failed: ' + e, 'err');
  });
}

async function connect() {
  if (pc) {
    pc.close();
    pc = null;
  }

  rendered = 0;
  encoded = 0;
  seiCount = 0;
  el.renderedFrames.textContent = '0';
  el.encodedFrames.textContent = '0';
  el.seiCount.textContent = '0';

  const signalUrl = el.signal.value.trim();
  if (!signalUrl) {
    setStatus('Signal URL is empty', 'err');
    return;
  }

  setStatus('Requesting offer...', 'warn');

  const offerResp = await fetch(signalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'request', keepAlive: true, iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] })
  });
  if (!offerResp.ok) throw new Error('Offer failed: HTTP ' + offerResp.status);
  const offer = await offerResp.json();

  pc = new RTCPeerConnection({
    sdpSemantics: 'unified-plan',
    iceServers: offer.iceServers,
    encodedInsertableStreams: true
  });

  pc.remote_pc_id = offer.id;

  pc.addEventListener('datachannel', (e) => {
    if (e.channel.label === 'keepalive') {
      e.channel.addEventListener('message', () => e.channel.send('pong'));
    }
  });

  pc.addTransceiver('video', { direction: 'recvonly' });

  pc.addEventListener('track', async (evt) => {
    if (evt.receiver) {
      setupEncodedTransform(evt.receiver);
    }

    if (evt.streams && evt.streams[0]) {
      el.video.srcObject = evt.streams[0];
      try {
        await el.video.play();
      } catch (e) {
        console.log('video.play() failed:', e);
      }
      startRenderedCounter();
      setStatus('Video connected', 'ok');
    }
  });

  pc.addEventListener('icecandidate', (e) => {
    if (!e.candidate) return;
    fetch(signalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'remote_candidate', id: pc.remote_pc_id, candidates: [e.candidate] })
    }).catch((err) => console.log('ICE send failed:', err));
  });

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  const finalResp = await fetch(signalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: pc.localDescription.type, id: pc.remote_pc_id, sdp: pc.localDescription.sdp })
  });
  if (!finalResp.ok) throw new Error('Answer failed: HTTP ' + finalResp.status);
}

el.connect.addEventListener('click', () => {
  connect().catch((e) => {
    setStatus('Connect failed: ' + e.message, 'err');
    console.log(e);
  });
});

el.disconnect.addEventListener('click', () => {
  if (pc) {
    pc.close();
    pc = null;
  }
  setStatus('Disconnected', 'warn');
});
