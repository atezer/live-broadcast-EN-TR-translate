// ─── Live Turkish Subtitle Content Script ───────────────────────────────────

if (window.__subtitleCleanup) {
  try { window.__subtitleCleanup(); } catch (e) {}
}

(function () {
  // ── State ──────────────────────────────────────────────────────────────────
  let recognition = null;
  let overlay = null;
  let autoHideTimer = null;
  let isRunning = false;
  let audioStream = null;
  let audioAnalyser = null;
  let audioCtx = null;
  let levelAnimFrame = null;
  let noSpeechCount = 0;
  let currentSettings = {
    position: 'bottom',
    fontSize: 22,
    showEnglish: true,
    autoHide: true,
    source: 'tab'
  };

  const translationCache = new Map();
  let finalAbortController = null;
  let interimAbortController = null;
  let displaySeq = 0;

  // ── Fetch with timeout ────────────────────────────────────────────────────
  async function fetchWithTimeout(url, externalSignal, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException('Aborted', 'AbortError');
      }
      externalSignal.addEventListener('abort', onAbort);
    }

    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  // ── Translation Engine ────────────────────────────────────────────────────
  async function translateGoogle(text, signal) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(url, signal, 3000);
    const data = await res.json();
    if (data && data[0]) {
      let result = '';
      for (const seg of data[0]) {
        if (seg && seg[0]) result += seg[0];
      }
      return result || null;
    }
    return null;
  }

  async function translateMyMemory(text, signal) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|tr`;
    const res = await fetchWithTimeout(url, signal, 3000);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData) {
      let t = data.responseData.translatedText;
      return t.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n));
    }
    return null;
  }

  async function translateToTurkish(text, signal) {
    if (!text || text.trim().length < 2) return '';

    const key = text.trim().toLowerCase();
    if (translationCache.has(key)) return translationCache.get(key);

    try {
      const result = await translateGoogle(text, signal);
      if (result) {
        translationCache.set(key, result);
        learnWordPairs(text, result);
        trimCache();
        return result;
      }
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }

    try {
      const result = await translateMyMemory(text, signal);
      if (result) {
        translationCache.set(key, result);
        learnWordPairs(text, result);
        trimCache();
        return result;
      }
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }

    return text;
  }

  // ── Smart Cache ───────────────────────────────────────────────────────────
  function learnWordPairs(english, turkish) {
    const en = english.trim().split(/\s+/);
    const tr = turkish.trim().split(/\s+/);
    if (en.length === tr.length && en.length >= 2 && en.length <= 8) {
      for (let i = 0; i < en.length; i++) {
        const k = en[i].toLowerCase();
        if (k.length >= 2 && !translationCache.has(k)) {
          translationCache.set(k, tr[i]);
        }
      }
    }
  }

  function trimCache() {
    while (translationCache.size > 500) {
      const firstKey = translationCache.keys().next().value;
      translationCache.delete(firstKey);
    }
  }

  function quickTranslateFromCache(text) {
    if (!text) return null;
    const key = text.trim().toLowerCase();
    if (translationCache.has(key)) return translationCache.get(key);

    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return null;

    let partial = [];
    let hitCount = 0;
    for (const word of words) {
      const wKey = word.toLowerCase();
      if (translationCache.has(wKey)) {
        partial.push(translationCache.get(wKey));
        hitCount++;
      } else {
        partial.push(word);
      }
    }
    return hitCount > 0 ? partial.join(' ') : null;
  }

  // ── Audio Level Monitor ────────────────────────────────────────────────────
  function startAudioMonitor(stream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      audioAnalyser = audioCtx.createAnalyser();
      audioAnalyser.fftSize = 256;
      audioAnalyser.smoothingTimeConstant = 0.5;
      source.connect(audioAnalyser);

      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

      function updateLevel() {
        if (!audioAnalyser || !isRunning) return;
        audioAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const level = Math.min(avg / 80, 1);

        const levelBar = document.getElementById('__sub-level__');
        if (levelBar) {
          levelBar.style.width = Math.max(level * 100, 2) + '%';
          levelBar.style.backgroundColor = level > 0.1 ? '#00d68f' : 'rgba(255,255,255,0.2)';
        }

        levelAnimFrame = requestAnimationFrame(updateLevel);
      }
      updateLevel();
    } catch (e) {
    }
  }

  function stopAudioMonitor() {
    if (levelAnimFrame) {
      cancelAnimationFrame(levelAnimFrame);
      levelAnimFrame = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    audioAnalyser = null;
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      audioStream = null;
    }
  }

  // ── Overlay UI ────────────────────────────────────────────────────────────
  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = '__live-subtitle-overlay__';
    overlay.innerHTML = `
      <div class="sub-container">
        <div class="sub-level-wrap"><div class="sub-level-bar" id="__sub-level__"></div></div>
        <div class="sub-en" id="__sub-en__"></div>
        <div class="sub-tr" id="__sub-tr__">Mikrofon bağlanıyor...</div>
      </div>
    `;

    const style = document.createElement('style');
    style.id = '__subtitle-styles__';
    style.textContent = `
      #__live-subtitle-overlay__ {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        pointer-events: none;
        width: 90%;
        max-width: 900px;
        transition: opacity 0.25s ease;
      }
      #__live-subtitle-overlay__.pos-bottom { bottom: 40px; }
      #__live-subtitle-overlay__.pos-top { top: 40px; }
      #__live-subtitle-overlay__.pos-center { top: 50%; transform: translate(-50%, -50%); }
      #__live-subtitle-overlay__.hidden { opacity: 0; }
      #__live-subtitle-overlay__ .sub-container {
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 12px;
        padding: 14px 22px;
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        text-align: center;
      }
      #__live-subtitle-overlay__ .sub-level-wrap {
        height: 3px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        margin-bottom: 8px;
        overflow: hidden;
      }
      #__live-subtitle-overlay__ .sub-level-bar {
        height: 100%;
        width: 2%;
        border-radius: 2px;
        background: rgba(255,255,255,0.2);
        transition: width 0.1s ease, background-color 0.2s ease;
      }
      #__live-subtitle-overlay__ .sub-en {
        font-family: 'DM Mono', 'Courier New', monospace;
        font-size: 13px;
        color: rgba(255,255,255,0.45);
        line-height: 1.5;
        margin-bottom: 4px;
        display: none;
      }
      #__live-subtitle-overlay__ .sub-en.visible { display: block; }
      #__live-subtitle-overlay__ .sub-tr {
        font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
        font-weight: 600;
        color: #ffffff;
        line-height: 1.45;
        text-shadow: 0 1px 4px rgba(0,0,0,0.8);
        letter-spacing: 0.2px;
      }
      #__live-subtitle-overlay__ .sub-tr .interim {
        color: rgba(255,255,255,0.55);
      }
      #__live-subtitle-overlay__ .sub-tr .status-msg {
        color: rgba(255,255,255,0.35);
        font-weight: 400;
        font-size: 0.9em;
      }
      #__live-subtitle-overlay__ .sub-indicator {
        display: inline-block;
        width: 6px; height: 6px;
        background: #00d68f;
        border-radius: 50%;
        margin-left: 8px;
        vertical-align: middle;
        animation: sub-blink 1s infinite;
      }
      @keyframes sub-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    applyOverlaySettings();
  }

  function applyOverlaySettings() {
    if (!overlay) return;
    overlay.className = `pos-${currentSettings.position}`;
    const trEl = overlay.querySelector('.sub-tr');
    if (trEl) trEl.style.fontSize = currentSettings.fontSize + 'px';
    const enEl = overlay.querySelector('.sub-en');
    if (enEl) enEl.classList.toggle('visible', currentSettings.showEnglish);
  }

  function setStatusMessage(text) {
    const trEl = document.getElementById('__sub-tr__');
    if (trEl) {
      trEl.innerHTML = `<span class="status-msg">${escapeHtml(text)}</span><span class="sub-indicator"></span>`;
      trEl.style.fontSize = currentSettings.fontSize + 'px';
    }
  }

  function updateSubtitle(english, turkish, isInterim, seq) {
    if (seq < displaySeq) return;
    displaySeq = seq;

    if (!overlay) createOverlay();

    const enEl = document.getElementById('__sub-en__');
    const trEl = document.getElementById('__sub-tr__');

    overlay.classList.remove('hidden');
    clearTimeout(autoHideTimer);

    if (enEl && currentSettings.showEnglish) {
      enEl.textContent = english || '';
      enEl.classList.add('visible');
    } else if (enEl) {
      enEl.classList.remove('visible');
    }

    if (trEl) {
      if (isInterim) {
        trEl.innerHTML = `<span class="interim">${escapeHtml(turkish || '...')}</span><span class="sub-indicator"></span>`;
      } else {
        trEl.innerHTML = escapeHtml(turkish || '') + '<span class="sub-indicator"></span>';
      }
      trEl.style.fontSize = currentSettings.fontSize + 'px';
    }

    if (currentSettings.autoHide && !isInterim) {
      autoHideTimer = setTimeout(() => {
        if (overlay) overlay.classList.add('hidden');
      }, 5000);
    }
  }

  function notifyPopup(english, turkish) {
    try {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        english,
        turkish
      }).catch(() => {});
    } catch (e) {}
  }

  function removeOverlay() {
    clearTimeout(autoHideTimer);
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    const styles = document.getElementById('__subtitle-styles__');
    if (styles) styles.remove();
  }

  // ── Speech Recognition ────────────────────────────────────────────────────
  let hasEverReceivedResult = false;

  async function ensureMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream = stream;
      return stream;
    } catch (err) {
      throw err;
    }
  }

  async function startRecognition(isRestart) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showError('Web Speech API desteklenmiyor');
      return;
    }

    if (recognition) {
      try { recognition.abort(); } catch (e) {}
      recognition = null;
    }

    if (!isRestart) {
      createOverlay();
      setStatusMessage('Mikrofon bağlanıyor...');

      try {
        const stream = await ensureMicPermission();
        startAudioMonitor(stream);
        setStatusMessage('Dinleniyor — konuşmaya başlayın...');
      } catch (err) {
        setStatusMessage('Mikrofon izni verilmedi!');
        showError('Mikrofon izni verilmedi');
        return;
      }

      noSpeechCount = 0;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let interimDebounceTimer = null;
    let lastInterimText = '';

    recognition.onstart = () => {
      isRunning = true;
      if (!overlay) createOverlay();
      lastInterimText = '';

      if (!isRestart) {
        setStatusMessage('Dinleniyor — konuşmaya başlayın...');
      }
    };

    recognition.onaudiostart = () => {
      if (!hasEverReceivedResult) {
        setStatusMessage('Mikrofon aktif — konuşun...');
      }
    };

    recognition.onspeechstart = () => {
      noSpeechCount = 0;
      if (!hasEverReceivedResult) {
        setStatusMessage('Konuşma algılandı...');
      }
    };

    recognition.onspeechend = () => {
      if (!hasEverReceivedResult) {
        setStatusMessage('Dinleniyor — konuşmaya başlayın...');
      }
    };

    recognition.onresult = (event) => {
      hasEverReceivedResult = true;
      noSpeechCount = 0;

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text + ' ';
        } else {
          interimTranscript += text;
        }
      }

      // ── Final result ──────────────────────────────────────────────────
      if (finalTranscript.trim()) {
        clearTimeout(interimDebounceTimer);
        lastInterimText = '';

        if (interimAbortController) {
          interimAbortController.abort();
          interimAbortController = null;
        }

        const finalText = finalTranscript.trim();
        const seq = ++displaySeq;

        const cached = translationCache.get(finalText.toLowerCase());
        if (cached) {
          updateSubtitle(finalText, cached, false, seq);
          notifyPopup(finalText, cached);
        } else {
          const quick = quickTranslateFromCache(finalText);
          if (quick) {
            updateSubtitle(finalText, quick, false, seq);
          }

          if (finalAbortController) finalAbortController.abort();
          const ctrl = new AbortController();
          finalAbortController = ctrl;

          translateToTurkish(finalText, ctrl.signal).then(translated => {
            if (translated === null) return;
            if (finalAbortController !== ctrl) return;
            finalAbortController = null;
            updateSubtitle(finalText, translated, false, seq);
            notifyPopup(finalText, translated);
          });
        }
      }

      // ── Interim result ────────────────────────────────────────────────
      if (interimTranscript && interimTranscript !== lastInterimText) {
        lastInterimText = interimTranscript;
        const interimText = interimTranscript.trim();
        if (!interimText) return;

        const seq = ++displaySeq;

        const cached = translationCache.get(interimText.toLowerCase());
        if (cached) {
          updateSubtitle(interimText, cached, true, seq);
        } else {
          const quick = quickTranslateFromCache(interimText);
          if (quick) {
            updateSubtitle(interimText, quick, true, seq);
          }

          clearTimeout(interimDebounceTimer);
          interimDebounceTimer = setTimeout(() => {
            if (interimAbortController) interimAbortController.abort();
            const ctrl = new AbortController();
            interimAbortController = ctrl;

            translateToTurkish(interimText, ctrl.signal).then(translated => {
              if (translated === null) return;
              if (interimAbortController !== ctrl) return;
              interimAbortController = null;
              updateSubtitle(interimText, translated, true, seq);
            });
          }, 80);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;

      if (event.error === 'no-speech') {
        noSpeechCount++;
        if (noSpeechCount <= 3) {
          setStatusMessage('Ses algılanamadı — tekrar dinleniyor...');
        } else {
          setStatusMessage('Ses algılanamıyor — mikrofonu kontrol edin');
        }
        return;
      }

      if (event.error === 'not-allowed') {
        setStatusMessage('Mikrofon izni gerekiyor!');
        showError('Mikrofon izni gerekiyor');
        stopRecognition();
      } else if (event.error === 'network') {
        setStatusMessage('Ağ bağlantı hatası — tekrar deneniyor...');
        showError('Bağlantı hatası');
      } else if (event.error === 'audio-capture') {
        setStatusMessage('Mikrofon bulunamadı!');
        showError('Mikrofon bulunamadı');
        stopRecognition();
      } else if (event.error === 'service-not-allowed') {
        setStatusMessage('Konuşma servisi kullanılamıyor');
        showError('Konuşma servisi kullanılamıyor');
        stopRecognition();
      }
    };

    recognition.onend = () => {
      if (isRunning) {
        recognition = null;
        const delay = noSpeechCount > 5 ? 1000 : 100;
        setTimeout(() => {
          if (isRunning) {
            startRecognition(true);
          }
        }, delay);
      } else {
        try {
          chrome.runtime.sendMessage({ type: 'RECOGNITION_STOPPED' }).catch(() => {});
        } catch (e) {}
      }
    };

    try {
      recognition.start();
    } catch (e) {
      setStatusMessage('Başlatılamadı: ' + e.message);
      showError('Başlatılamadı: ' + e.message);
    }
  }

  function stopRecognition() {
    isRunning = false;
    hasEverReceivedResult = false;
    noSpeechCount = 0;
    if (finalAbortController) {
      finalAbortController.abort();
      finalAbortController = null;
    }
    if (interimAbortController) {
      interimAbortController.abort();
      interimAbortController = null;
    }
    if (recognition) {
      try { recognition.abort(); } catch (e) {}
      recognition = null;
    }
    stopAudioMonitor();
    removeOverlay();
  }

  function showError(msg) {
    try {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        error: msg
      }).catch(() => {});
    } catch (e) {}
  }

  // ── External Transcription (tab audio mode) ────────────────────────────────
  async function handleExternalTranscription(englishText) {
    if (!englishText || !englishText.trim()) return;
    const text = englishText.trim();
    const seq = ++displaySeq;

    const cached = translationCache.get(text.toLowerCase());
    if (cached) {
      updateSubtitle(text, cached, false, seq);
      notifyPopup(text, cached);
      return;
    }

    const quick = quickTranslateFromCache(text);
    if (quick) {
      updateSubtitle(text, quick, false, seq);
    }

    if (finalAbortController) finalAbortController.abort();
    const ctrl = new AbortController();
    finalAbortController = ctrl;

    const translated = await translateToTurkish(text, ctrl.signal);
    if (translated === null) return;
    if (finalAbortController !== ctrl) return;
    finalAbortController = null;
    updateSubtitle(text, translated, false, seq);
    notifyPopup(text, translated);
  }

  // ── Message Listener ──────────────────────────────────────────────────────
  function messageHandler(msg, sender, sendResponse) {
    if (!chrome?.runtime?.id) return;
    switch (msg.type) {
      case 'START_SUBTITLES':
        currentSettings = { ...currentSettings, ...(msg.settings || {}) };
        stopRecognition();
        if (msg.source === 'tab') {
          isRunning = true;
          createOverlay();
          setStatusMessage('Sekme sesi bekleniyor...');
        } else {
          startRecognition();
        }
        sendResponse({ ok: true });
        break;
      case 'STOP_SUBTITLES':
        stopRecognition();
        sendResponse({ ok: true });
        break;
      case 'UPDATE_SETTINGS':
        currentSettings = { ...currentSettings, ...(msg.settings || {}) };
        applyOverlaySettings();
        sendResponse({ ok: true });
        break;
      case 'EXTERNAL_TRANSCRIPTION':
        handleExternalTranscription(msg.text);
        sendResponse({ ok: true });
        break;
      case 'TAB_CAPTURE_STATUS':
        if (msg.status === 'capturing') {
          setStatusMessage('Sekme sesi yakalandı — çeviri başlıyor...');
        } else if (msg.status === 'error') {
          setStatusMessage('Hata: ' + (msg.error || 'Bilinmeyen hata'));
        }
        sendResponse({ ok: true });
        break;
      case 'PING':
        sendResponse({ ok: true, isRunning });
        break;
    }
    return true;
  }
  chrome.runtime.onMessage.addListener(messageHandler);

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 's') {
      if (isRunning) stopRecognition();
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Cleanup for extension reload ──────────────────────────────────────────
  window.__subtitleCleanup = () => {
    isRunning = false;
    try { chrome.runtime.onMessage.removeListener(messageHandler); } catch (e) {}
    if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
    if (finalAbortController) { finalAbortController.abort(); finalAbortController = null; }
    if (interimAbortController) { interimAbortController.abort(); interimAbortController = null; }
    stopAudioMonitor();
    removeOverlay();
  };

})();
