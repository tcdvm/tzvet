const disablePanels = document.getElementById('disablePanels');
const disableTests = document.getElementById('disableTests');
const status = document.getElementById('status');

function toLines(value) {
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'string') return value;
  return '';
}

function fromLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

chrome.storage.sync.get({ trendsDisablePanels: [], trendsDisableTests: [] }, (items) => {
  disablePanels.value = toLines(items.trendsDisablePanels);
  disableTests.value = toLines(items.trendsDisableTests);
});

document.getElementById('save').addEventListener('click', () => {
  const panels = fromLines(disablePanels.value);
  const tests = fromLines(disableTests.value);
  chrome.storage.sync.set({ trendsDisablePanels: panels, trendsDisableTests: tests }, () => {
    status.textContent = 'Saved!';
    setTimeout(() => (status.textContent = ''), 1500);
  });
});
