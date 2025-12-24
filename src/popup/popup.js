import '../styles.css';

const pingBtn = document.getElementById('ping');
pingBtn.addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Pinging…';
  pingBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PING' });
    if (result?.type === 'PONG') {
      const t = result.time ? new Date(result.time).toLocaleTimeString() : '';
      statusEl.textContent = `SW replied: ${result.type} ${t}`;
    } else {
      statusEl.textContent = 'SW replied: (no payload)';
    }
  } catch (err) {
    const msg = err?.message || String(err);
    statusEl.textContent = 'Ping failed: ' + msg;
    console.error('ping error', err);
  } finally {
    pingBtn.disabled = false;
  }
});

document.getElementById('highlight').addEventListener('click', async () => {
  // Send message to the active tab's content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const result = await sendMessageWithInjectRetry(tab.id, { type: 'HIGHLIGHT', color: 'rgba(255,230,200,0.5)' });
    if (!result.ok) {
      status.textContent = 'No content script on active tab';
      console.warn('sendMessage failed after retry:', result.error);
      return;
    }
    console.log('Highlight response', result.res);
  }
});

// ---- Normalize species labels UI ----
const normalizeCheckbox = document.getElementById('normalize');
const status = document.getElementById('status');

// load saved settings
chrome.storage.sync.get({ normalizeSpecies: false, headerHidden: false, qtipPlaceholder: false }, (items) => {
  normalizeCheckbox.checked = items.normalizeSpecies;
  const headerCheckbox = document.getElementById('toggleHeader');
  if (headerCheckbox) headerCheckbox.checked = items.headerHidden;
  const qtipCheckbox = document.getElementById('toggleQtip');
  if (qtipCheckbox) qtipCheckbox.checked = items.qtipPlaceholder;
});

// header toggle UI
const headerCheckbox = document.getElementById('toggleHeader');
if (headerCheckbox) {
  headerCheckbox.addEventListener('change', async (e) => {
    const hidden = !!e.target.checked;
    chrome.storage.sync.set({ headerHidden: hidden }, async () => {
      status.textContent = hidden ? 'Header hidden' : 'Header visible';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const result = await sendMessageWithInjectRetry(tab.id, { type: 'HEADER_TOGGLE', hidden });
        if (!result.ok) {
          status.textContent = 'Header toggle failed';
          console.warn('sendMessage failed after retry:', result.error);
        }
      }
    });
  });
}

// q-tip toggle UI
const qtipCheckbox = document.getElementById('toggleQtip');
if (qtipCheckbox) {
  qtipCheckbox.addEventListener('change', async (e) => {
    const enabled = !!e.target.checked;
    chrome.storage.sync.set({ qtipPlaceholder: enabled }, async () => {
      status.textContent = enabled ? 'Q-tips replaced' : 'Q-tips restored';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const result = await sendMessageWithInjectRetry(tab.id, { type: 'QTIP_TOGGLE', enabled });
        if (!result.ok) {
          status.textContent = 'Q-tip toggle failed';
          console.warn('sendMessage failed after retry:', result.error);
        }
      }
    });
  });
}

// Helper: send message and if no receiver exists, inject the content script and retry
async function sendMessageWithInjectRetry(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, async (res) => {
      if (chrome.runtime.lastError && /Receiving end does not exist/.test(chrome.runtime.lastError.message || '')) {
        // Try to inject content script and retry
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
        } catch (err) {
          return resolve({ ok: false, error: err });
        }
        // give the injected script a moment to initialize
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, message, (res2) => {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError });
            return resolve({ ok: true, res: res2 });
          });
        }, 200);
        return;
      }
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError });
      return resolve({ ok: true, res });
    });
  });
}

// when toggled, save and notify content script
normalizeCheckbox.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  chrome.storage.sync.set({ normalizeSpecies: enabled }, async () => {
    status.textContent = enabled ? 'Normalize ON' : 'Normalize OFF';
    // notify active tab's content script to enable/disable and run immediately
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const result = await sendMessageWithInjectRetry(tab.id, { type: 'NORMALIZE_TOGGLE', enabled });
      if (!result.ok) {
        status.textContent = 'No content script on active tab';
        console.warn('sendMessage failed after retry:', result.error);
        return;
      }
      console.log('Normalize toggle response', result.res);
    }
  });
});

// also add a button via long-press or double-click for immediate run (optional)
normalizeCheckbox.addEventListener('dblclick', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const result = await sendMessageWithInjectRetry(tab.id, { type: 'NORMALIZE_NOW' });
    if (!result.ok) {
      status.textContent = 'No content script on active tab';
      console.warn('sendMessage failed after retry:', result.error);
      return;
    }
    console.log('Normalize-now response', result.res);
  }
});
