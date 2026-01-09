const ALLOWED_ORIGIN = 'https://utcvm.use1.ezyvet.com';
const DEFAULT_TRENDS_DISABLE_PANELS = ['Urinalysis', 'Urinalalysis'];
const DEFAULT_TRENDS_DISABLE_TESTS = [
  'Lipemic Serum Index',
  'Hemolytic Serum Index',
  'Icteric Serum Index'
];

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === ALLOWED_ORIGIN;
  } catch {
    return false;
  }
}

// Disable action by default for safety
chrome.action.disable();

// Enable/disable for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab?.url;
  if (!url) return;
  const allowed = isAllowedUrl(url);
  // if (allowed) chrome.action.enable(tabId);
  // else chrome.action.disable(tabId);
  try {
    if (allowed) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel/index.html',
        enabled: true
      });
    } else {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false
      });
    }
  } catch (e) {
    console.warn('Failed to set side panel options:', e);
  }
});

// Also check when a tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (isAllowedUrl(tab.url)) chrome.action.enable(tab.id);
  else chrome.action.disable(tab.id);
});

async function ensureDefaultTrendSettings() {
  try {
    const stored = await chrome.storage.sync.get(['trendsDisablePanels', 'trendsDisableTests']);
    const nextPanels = Array.isArray(stored.trendsDisablePanels) && stored.trendsDisablePanels.length
      ? stored.trendsDisablePanels
      : DEFAULT_TRENDS_DISABLE_PANELS;
    const nextTests = Array.isArray(stored.trendsDisableTests) && stored.trendsDisableTests.length
      ? stored.trendsDisableTests
      : DEFAULT_TRENDS_DISABLE_TESTS;
    await chrome.storage.sync.set({
      trendsDisablePanels: nextPanels,
      trendsDisableTests: nextTests
    });
  } catch (e) {
    console.warn('Failed to set default trends options:', e);
  }
}

// On install, enforce across open tabs
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const allowed = isAllowedUrl(t.url);
    if (allowed) chrome.action.enable(t.id);
    else chrome.action.disable(t.id);
    try {
      await chrome.sidePanel.setOptions({
        tabId: t.id,
        path: 'sidepanel/index.html',
        enabled: allowed
      });
    } catch (e) {
      console.warn('Failed to set side panel options:', e);
    }
  }
  try {
    await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn('Failed to set side panel behavior:', e);
  }
  await ensureDefaultTrendSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn('Failed to set side panel behavior on startup:', e);
  }
  await ensureDefaultTrendSettings();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isAllowedUrl(tab.url)) return;
  try {
    await chrome.sidePanel?.open({ tabId: tab.id });
  } catch (e) {
    console.warn('Failed to open side panel:', e);
  }
});

// Listen for simple runtime messages (PING) and provide visible feedback
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  console.log('SW received message:', msg);
  if (msg?.type === 'PING') {
    const now = Date.now();
    try {
      chrome.action.setBadgeBackgroundColor?.({ color: '#16a34a' });
      chrome.action.setBadgeText?.({ text: 'PONG' });
      // Try to clear the badge shortly after; service worker may be suspended, but this often runs.
      setTimeout(() => {
        try { chrome.action.setBadgeText?.({ text: '' }); } catch (e) { /* ignore */ }
      }, 1500);
    } catch (e) {
      console.warn('Failed to set badge text for PING:', e);
    }
    reply({ type: 'PONG', time: now });
  }
});
