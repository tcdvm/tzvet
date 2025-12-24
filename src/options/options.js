const colorInput = document.getElementById('color');
const status = document.getElementById('status');

// Load saved value
chrome.storage.sync.get({ favoriteColor: '#ff0000' }, (items) => {
  colorInput.value = items.favoriteColor;
});

document.getElementById('save').addEventListener('click', () => {
  const color = colorInput.value;
  chrome.storage.sync.set({ favoriteColor: color }, () => {
    status.textContent = 'Saved!';
    setTimeout(() => (status.textContent = ''), 1500);
  });
});
