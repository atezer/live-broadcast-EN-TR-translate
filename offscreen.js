// ─── Offscreen Document: Tab Audio Capture + STT ────────────────────────────

let mediaStream = null;
let audioCtx = null;
let recorder = null;
let isCapturing = false;
let apiKey = '';
let pendingChunks = [];
let processingChunk = false;
let recordingCycleTimer = null;

const CHUNK_DURATION_MS = 5000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'start-capture':
      startCapture(message.streamId, message.apiKey);
      sendResponse({ ok: true });
      break;
    case 'stop-capture':
      stopCapture();
      sendResponse({ ok: true });
      break;
  }
  return true;
});

async function startCapture(streamId, key) {
  if (isCapturing) return;
  apiKey = key;
  isCapturing = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(audioCtx.destination);

    startRecordingCycle();

    chrome.runtime.sendMessage({
      type: 'TAB_CAPTURE_STATUS',
      status: 'capturing'
    }).catch(() => {});

  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'TAB_CAPTURE_STATUS',
      status: 'error',
      error: err.message
    }).catch(() => {});
    isCapturing = false;
  }
}

function startRecordingCycle() {
  if (!mediaStream || !isCapturing) return;

  const audioTracks = mediaStream.getAudioTracks();
  if (!audioTracks.length) return;

  const audioStream = new MediaStream(audioTracks);
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  recorder = new MediaRecorder(audioStream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.onstop = () => {
    if (chunks.length > 0 && isCapturing) {
      const completeBlob = new Blob(chunks, { type: mimeType });
      pendingChunks.push(completeBlob);
      processNextChunk();
    }
    if (isCapturing) {
      startRecordingCycle();
    }
  };

  recorder.onerror = () => {
    if (isCapturing) {
      setTimeout(() => startRecordingCycle(), 500);
    }
  };

  recorder.start();

  recordingCycleTimer = setTimeout(() => {
    if (recorder && recorder.state === 'recording') {
      try { recorder.stop(); } catch (e) {}
    }
  }, CHUNK_DURATION_MS);
}

async function processNextChunk() {
  if (processingChunk || pendingChunks.length === 0) return;
  processingChunk = true;

  if (pendingChunks.length > 2) {
    pendingChunks.splice(0, pendingChunks.length - 1);
  }

  const chunk = pendingChunks.shift();

  try {
    const text = await transcribeWithRetry(chunk);
    if (text && text.trim()) {
      chrome.runtime.sendMessage({
        type: 'TAB_TRANSCRIPTION',
        text: text.trim()
      }).catch(() => {});
    }
  } catch (err) {
    const errMsg = err.message || 'Bilinmeyen hata';
    if (errMsg.includes('401')) {
      sendCaptureError('API anahtari gecersiz');
    } else if (errMsg.includes('413')) {
      sendCaptureError('Ses dosyasi cok buyuk');
    } else if (errMsg.includes('400')) {
      sendCaptureError('Ses formati hatasi');
    } else {
      sendCaptureError('Transkripsiyon hatasi: ' + errMsg);
    }
  }

  processingChunk = false;
  if (pendingChunks.length > 0 && isCapturing) {
    processNextChunk();
  }
}

async function transcribeWithRetry(audioBlob, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await transcribeAudio(audioBlob);
    } catch (err) {
      const is429 = err.message && err.message.includes('429');
      if (is429 && attempt < maxRetries - 1 && isCapturing) {
        const waitMs = (attempt + 1) * 2000;
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

function sendCaptureError(error) {
  chrome.runtime.sendMessage({
    type: 'TAB_CAPTURE_STATUS',
    status: 'error',
    error
  }).catch(() => {});
}

async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'en');
  formData.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} - ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.text || '';
}

function stopCapture() {
  isCapturing = false;

  clearTimeout(recordingCycleTimer);
  recordingCycleTimer = null;

  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (e) {}
  }
  recorder = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  pendingChunks = [];
  processingChunk = false;

  chrome.runtime.sendMessage({
    type: 'TAB_CAPTURE_STATUS',
    status: 'stopped'
  }).catch(() => {});
}
