// ─── Background Service Worker ──────────────────────────────────────────────

// Forward transcript updates from content script to popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TRANSCRIPT_UPDATE' || msg.type === 'RECOGNITION_STOPPED') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }

  // Tab audio: transcription from offscreen → forward to content script
  if (msg.type === 'TAB_TRANSCRIPTION') {
    chrome.storage.local.get(['activeTab'], (data) => {
      if (data.activeTab) {
        chrome.tabs.sendMessage(data.activeTab, {
          type: 'EXTERNAL_TRANSCRIPTION',
          text: msg.text
        }).catch(() => {});
      }
    });
    return false;
  }

  // Tab audio: status updates from offscreen → forward to popup AND content script
  if (msg.type === 'TAB_CAPTURE_STATUS') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    chrome.storage.local.get(['activeTab'], (data) => {
      if (data.activeTab) {
        chrome.tabs.sendMessage(data.activeTab, {
          type: 'TAB_CAPTURE_STATUS',
          status: msg.status,
          error: msg.error
        }).catch(() => {});
      }
    });
    return false;
  }

  // Start tab audio capture (from popup)
  if (msg.type === 'START_TAB_CAPTURE') {
    handleStartTabCapture(msg.tabId, msg.apiKey);
    sendResponse({ ok: true });
    return true;
  }

  // Stop tab audio capture (from popup)
  if (msg.type === 'STOP_TAB_CAPTURE') {
    handleStopTabCapture();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function handleStartTabCapture(tabId, apiKey) {
  try {
    // Ensure offscreen document exists
    const existingContexts = await chrome.runtime.getContexts({});
    const hasOffscreen = existingContexts.some(
      c => c.contextType === 'OFFSCREEN_DOCUMENT'
    );

    if (!hasOffscreen) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Tab audio capture for speech recognition'
      });
    }

    // Get media stream ID for the target tab
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(new Error(chrome.runtime.lastError?.message || 'Stream ID alınamadı'));
            return;
          }
          resolve(id);
        }
      );
    });

    // Send stream ID to offscreen document
    chrome.runtime.sendMessage({
      type: 'start-capture',
      target: 'offscreen',
      streamId: streamId,
      apiKey: apiKey
    }).catch(() => {});

  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'TAB_CAPTURE_STATUS',
      status: 'error',
      error: err.message
    }).catch(() => {});
  }
}

async function handleStopTabCapture() {
  try {
    chrome.runtime.sendMessage({
      type: 'stop-capture',
      target: 'offscreen'
    }).catch(() => {});

    // Close offscreen document after a short delay
    setTimeout(async () => {
      try {
        const contexts = await chrome.runtime.getContexts({});
        const hasOffscreen = contexts.some(
          c => c.contextType === 'OFFSCREEN_DOCUMENT'
        );
        if (hasOffscreen) {
          await chrome.offscreen.closeDocument();
        }
      } catch (e) {}
    }, 500);
  } catch (e) {}
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['activeTab'], (data) => {
    if (data.activeTab === tabId) {
      chrome.storage.local.set({ isActive: false, activeTab: null });
      handleStopTabCapture();
    }
  });
});
