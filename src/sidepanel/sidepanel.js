import '../styles.css';

// ---- Normalize species labels UI ----
const normalizeCheckbox = document.getElementById('normalize');
const status = document.getElementById('status');
const defaultStatusText = 'Please verify any and all data processed by this extension.';
const readyStatusText = 'Ready';

const extractBtn = document.getElementById('extractLabTrends');
const storedTrendsEl = document.getElementById('storedTrends');
const clearTrendsBtn = document.getElementById('clearTrends');
const autoOpenTrends = document.getElementById('autoOpenTrends');

const tabTools = document.getElementById('tabTools');
const tabHowtos = document.getElementById('tabHowtos');
const tabButtons = document.querySelectorAll('[data-tab]');
if (tabButtons.length) {
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tab;
      tabButtons.forEach((el) => el.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      if (tabTools) tabTools.classList.toggle('hidden', name !== 'tools');
      if (tabHowtos) tabHowtos.classList.toggle('hidden', name !== 'howtos');
      if (location.hash !== `#${name}`) {
        history.replaceState(null, '', `#${name}`);
      }
    });
  });
}

const initialTab = location.hash === '#howtos' ? 'howtos' : 'tools';
const activeBtn = Array.from(tabButtons).find((btn) => btn.dataset.tab === initialTab);
if (activeBtn) activeBtn.click();
if (extractBtn) {
  extractBtn.addEventListener('click', async () => {
    status.textContent = 'Extracting lab trends...';
    extractBtn.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        status.textContent = 'No active tab';
        return;
      }
      const result = await sendMessageWithInjectRetry(tab.id, { type: 'EXTRACT_LAB_TRENDS' });
      if (!result.ok) {
        status.textContent = `Content script unavailable: ${formatSendError(result.error)}`;
        console.warn('sendMessage failed after retry:', result.error);
        return;
      }
      const payload = result.res;
      if (!payload || payload.ok === false) {
        status.textContent = payload?.error || 'Extraction failed';
        return;
      }
      const patientId = payload.patient?.id || null;
      const updatedAt = new Date().toISOString();
      let combinedPayload = { ...payload, updatedAt };
      if (patientId) {
        const localData = await chrome.storage.local.get({ labTrendsByPatient: {} });
        const store = localData.labTrendsByPatient || {};
        const existing = store[patientId]?.observations || [];
        const merged = mergeObservations(existing, payload.observations || []);
        store[patientId] = {
          patient: payload.patient,
          observations: merged,
          updatedAt
        };
        await chrome.storage.local.set({ labTrendsByPatient: store });
        combinedPayload = { ...payload, observations: merged, updatedAt };
      }
      const key = `labTrends:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await chrome.storage.session.set({ [key]: combinedPayload });
      const shouldOpen = autoOpenTrends ? autoOpenTrends.checked : true;
      if (shouldOpen) {
        status.textContent = `Lab trends found: ${payload.count}. Opening trends...`;
        const trendsUrl = chrome.runtime.getURL(`trends/index.html?key=${encodeURIComponent(key)}`);
        await chrome.tabs.create({ url: trendsUrl });
      } else {
        status.textContent = `Lab trends found: ${payload.count}. Cached.`;
      }
      console.log('Lab trends payload', combinedPayload);
      refreshStoredTrends();
    } finally {
      extractBtn.disabled = false;
    }
  });
}

if (status) {
  status.textContent = defaultStatusText;
  setTimeout(() => {
    if (status.textContent === defaultStatusText) status.textContent = readyStatusText;
  }, 4000);
}

// load saved settings
chrome.storage.sync.get({ normalizeSpecies: false, headerHidden: false, qtipPlaceholder: false }, (items) => {
  normalizeCheckbox.checked = items.normalizeSpecies;
  const headerCheckbox = document.getElementById('toggleHeader');
  if (headerCheckbox) headerCheckbox.checked = items.headerHidden;
  const qtipCheckbox = document.getElementById('toggleQtip');
  if (qtipCheckbox) qtipCheckbox.checked = items.qtipPlaceholder;
});

chrome.storage.sync.get({ autoOpenTrends: true }, (items) => {
  if (autoOpenTrends) autoOpenTrends.checked = items.autoOpenTrends;
});

if (autoOpenTrends) {
  autoOpenTrends.addEventListener('change', (e) => {
    chrome.storage.sync.set({ autoOpenTrends: !!e.target.checked });
  });
}

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
      status.textContent = enabled ? 'Pop-ups replaced' : 'Pop-ups restored';
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

function formatSendError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// when toggled, save and notify content script
normalizeCheckbox.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  chrome.storage.sync.set({ normalizeSpecies: enabled }, async () => {
    status.textContent = enabled ? 'Species labels fixed' : 'Species labels original - refresh page';
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

function renderStoredTrends(entries) {
  if (!storedTrendsEl) return;
  if (!entries.length) {
    storedTrendsEl.textContent = 'None stored yet.';
    if (clearTrendsBtn) clearTrendsBtn.disabled = true;
    return;
  }
  if (clearTrendsBtn) clearTrendsBtn.disabled = false;
  storedTrendsEl.innerHTML = '';
  entries.forEach(({ key, patient, updatedAt }) => {
    const row = document.createElement('div');
    const animal = patient?.name || 'Unknown';
    const owner = patient?.ownerLastName || 'Unknown';
    row.className = 'mb-2 flex items-start justify-between gap-2';
    const textWrap = document.createElement('div');
    const label = document.createElement('div');
    label.textContent = `"${animal}" ${owner}`;
    const meta = document.createElement('div');
    meta.className = 'text-[11px] text-gray-500 ml-1';
    meta.textContent = updatedAt ? `updated ${formatRelativeTime(updatedAt)}` : '';
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-xs';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', async () => {
      const store = await chrome.storage.local.get({ labTrendsByPatient: {} });
      const payload = store.labTrendsByPatient[key];
      if (!payload) {
        status.textContent = 'Stored trends not found';
        return;
      }
      const sessionKey = `labTrends:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await chrome.storage.session.set({ [sessionKey]: payload });
      const trendsUrl = chrome.runtime.getURL(`trends/index.html?key=${encodeURIComponent(sessionKey)}`);
      await chrome.tabs.create({ url: trendsUrl });
    });
    textWrap.appendChild(label);
    if (meta.textContent) textWrap.appendChild(meta);
    row.appendChild(textWrap);
    row.appendChild(openBtn);
    storedTrendsEl.appendChild(row);
  });
}

function refreshStoredTrends() {
  if (!storedTrendsEl) return;
  chrome.storage.local.get({ labTrendsByPatient: {} }, (items) => {
    const store = items.labTrendsByPatient || {};
    const entries = Object.entries(store).map(([key, payload]) => ({
      key,
      patient: payload?.patient || null,
      updatedAt: payload?.updatedAt || null
    }));
    renderStoredTrends(entries);
  });
}

if (clearTrendsBtn) {
  clearTrendsBtn.addEventListener('click', () => {
    chrome.storage.local.remove('labTrendsByPatient', () => {
      chrome.storage.session.get(null, (items) => {
        const keys = Object.keys(items).filter((key) => key === 'labTrends' || key.startsWith('labTrends:'));
        if (!keys.length) {
          status.textContent = 'Stored lab trends cleared';
          return refreshStoredTrends();
        }
        chrome.storage.session.remove(keys, () => {
          status.textContent = 'Stored lab trends cleared';
          refreshStoredTrends();
        });
      });
    });
  });
}

refreshStoredTrends();

function formatRelativeTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const seconds = Math.max(1, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function mergeObservations(existing, incoming) {
  const seen = new Set();
  const deduped = [];
  const add = (obs) => {
    const sig = [
      obs.panel,
      obs.testName,
      obs.collectedAt,
      obs.valueRaw,
      obs.unit,
      obs.lowestValue,
      obs.highestValue,
      obs.qualifier
    ].join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    deduped.push(obs);
  };
  existing.forEach(add);
  incoming.forEach(add);
  return deduped;
}
