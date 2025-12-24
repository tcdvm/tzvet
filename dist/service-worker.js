function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'utcvm.use1.ezyvet.com';
  } catch {
    return false;
  }
}

// Disable action by default for safety
chrome.action.disable();

// Enable/disable for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab?.url;
  if (!url) return;
  if (isAllowedUrl(url)) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
});

// Also check when a tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (isAllowedUrl(tab.url)) chrome.action.enable(tab.id);
  else chrome.action.disable(tab.id);
});

// On install, enforce across open tabs
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (isAllowedUrl(t.url)) chrome.action.enable(t.id);
    else chrome.action.disable(t.id);
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
