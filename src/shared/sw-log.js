export function swLog(...args) {
  try {
    chrome.runtime.sendMessage({ type: 'LOG', args }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[swLog] sendMessage failed:', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.warn('[swLog] sendMessage threw:', e);
  }
}
