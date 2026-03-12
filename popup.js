// State
let isActive = false;
let settings = {
  source: 'tab',
  position: 'bottom',
  fontSize: 22,
  showEnglish: true,
  autoHide: true
};

// DOM refs
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const mainBtn = document.getElementById('mainBtn');
const preview = document.getElementById('preview');
const previewEn = document.getElementById('previewEn');
const previewTr = document.getElementById('previewTr');
const apiKeySection = document.getElementById('apiKeySection');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyToggle = document.getElementById('apiKeyToggle');
const groqLink = document.getElementById('groqLink');

// Load saved settings
chrome.storage.local.get(['settings', 'isActive', 'groqApiKey'], (data) => {
  if (data.settings) {
    settings = { ...settings, ...data.settings };
    applySettingsToUI();
  }
  if (data.groqApiKey) {
    apiKeyInput.value = data.groqApiKey;
  }
  if (data.isActive) {
    isActive = true;
    updateUI();
  }
  toggleApiKeyVisibility();
});

function applySettingsToUI() {
  document.querySelectorAll('.source-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.source === settings.source);
  });
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === settings.position);
  });
  document.getElementById('fontSizeSlider').value = settings.fontSize;
  document.getElementById('fontSizeVal').textContent = settings.fontSize + 'px';
  document.getElementById('toggleEn').classList.toggle('on', settings.showEnglish);
  document.getElementById('toggleAutoHide').classList.toggle('on', settings.autoHide);
}

function saveSettings() {
  chrome.storage.local.set({ settings });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'UPDATE_SETTINGS',
        settings
      }).catch(() => {});
    }
  });
}

function toggleApiKeyVisibility() {
  apiKeySection.style.display = settings.source === 'tab' ? 'block' : 'none';
}

// Source tabs
document.querySelectorAll('.source-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (isActive) return;
    settings.source = tab.dataset.source;
    document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    toggleApiKeyVisibility();
    saveSettings();
  });
});

// Position buttons
document.querySelectorAll('.pos-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    settings.position = btn.dataset.pos;
    document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    saveSettings();
  });
});

// Font size slider
document.getElementById('fontSizeSlider').addEventListener('input', (e) => {
  settings.fontSize = parseInt(e.target.value);
  document.getElementById('fontSizeVal').textContent = settings.fontSize + 'px';
  saveSettings();
});

// Toggles
document.getElementById('toggleEn').addEventListener('click', () => {
  settings.showEnglish = !settings.showEnglish;
  document.getElementById('toggleEn').classList.toggle('on', settings.showEnglish);
  saveSettings();
});

document.getElementById('toggleAutoHide').addEventListener('click', () => {
  settings.autoHide = !settings.autoHide;
  document.getElementById('toggleAutoHide').classList.toggle('on', settings.autoHide);
  saveSettings();
});

// API key input
apiKeyInput.addEventListener('change', () => {
  chrome.storage.local.set({ groqApiKey: apiKeyInput.value.trim() });
});

apiKeyToggle.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

groqLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://console.groq.com/keys' });
});

// Main button
mainBtn.addEventListener('click', async () => {
  if (!isActive) {
    await startSubtitles();
  } else {
    await stopSubtitles();
  }
});

async function startSubtitles() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (settings.source === 'tab') {
      await startTabAudio(tab);
    } else {
      await startMicrophone(tab);
    }
  } catch (err) {
    setStatus('error', 'Başlatılamadı: ' + err.message);
  }
}

async function startMicrophone(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { window.__subtitleReady = true; }
  }).catch(() => {});

  chrome.tabs.sendMessage(tab.id, {
    type: 'START_SUBTITLES',
    settings,
    source: 'microphone'
  }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('error', 'Sayfa yenilenmeli');
      return;
    }
    isActive = true;
    chrome.storage.local.set({ isActive: true, activeTab: tab.id });
    updateUI();
  });
}

async function startTabAudio(tab) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus('error', 'Groq API anahtarı gerekli');
    return;
  }

  chrome.storage.local.set({ groqApiKey: apiKey });

  // Tell content script to prepare overlay (tab audio mode)
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { window.__subtitleReady = true; }
  }).catch(() => {});

  chrome.tabs.sendMessage(tab.id, {
    type: 'START_SUBTITLES',
    settings,
    source: 'tab'
  }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('error', 'Sayfa yenilenmeli');
      return;
    }
  });

  // Start tab capture via background
  chrome.runtime.sendMessage({
    type: 'START_TAB_CAPTURE',
    tabId: tab.id,
    apiKey: apiKey
  }, () => {
    isActive = true;
    chrome.storage.local.set({ isActive: true, activeTab: tab.id });
    updateUI();
    setStatus('active', 'Sekme sesi dinleniyor...');
  });
}

async function stopSubtitles() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (settings.source === 'tab') {
    chrome.runtime.sendMessage({ type: 'STOP_TAB_CAPTURE' }).catch(() => {});
  }

  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_SUBTITLES' }).catch(() => {});
  }

  isActive = false;
  chrome.storage.local.set({ isActive: false, activeTab: null });
  updateUI();
  preview.classList.remove('visible');
}

function updateUI() {
  if (isActive) {
    const label = settings.source === 'tab' ? 'Sekme sesi dinleniyor...' : 'Dinleniyor...';
    setStatus('active', label);
    mainBtn.className = 'action-btn stop';
    mainBtn.innerHTML = '<span>■</span> Durdur';
    preview.classList.add('visible');
  } else {
    setStatus('idle', 'Başlatmak için hazır');
    mainBtn.className = 'action-btn start';
    mainBtn.innerHTML = '<span>▶</span> Altyazıyı Başlat';
  }
}

function setStatus(state, text) {
  statusDot.className = 'status-dot' + (state === 'active' ? ' active' : state === 'error' ? ' error' : '');
  statusText.className = 'status-text' + (state === 'active' ? ' active' : state === 'error' ? ' error' : '');
  statusText.textContent = text;
}

// Listen for messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TRANSCRIPT_UPDATE') {
    if (msg.english) previewEn.textContent = msg.english;
    if (msg.turkish) previewTr.textContent = msg.turkish;
    if (msg.error) {
      setStatus('error', msg.error);
    }
  }
  if (msg.type === 'RECOGNITION_STOPPED') {
    if (isActive) {
      setStatus('error', 'Bağlantı kesildi');
      isActive = false;
      chrome.storage.local.set({ isActive: false });
      mainBtn.className = 'action-btn start';
      mainBtn.innerHTML = '<span>▶</span> Altyazıyı Başlat';
    }
  }
  if (msg.type === 'TAB_CAPTURE_STATUS') {
    if (msg.status === 'capturing') {
      setStatus('active', 'Sekme sesi yakalandı — çeviri başlıyor...');
    } else if (msg.status === 'error') {
      setStatus('error', msg.error || 'Sekme sesi yakalanamadı');
    } else if (msg.status === 'stopped') {
      if (isActive) {
        setStatus('idle', 'Başlatmak için hazır');
        isActive = false;
        chrome.storage.local.set({ isActive: false });
        updateUI();
      }
    }
  }
});
