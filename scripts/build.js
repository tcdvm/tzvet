// scripts/build.js — simple build: copies everything from src/ to dist/
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const dest = path.join(__dirname, '..', 'dist');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// remove dist
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

copyRecursiveSync(src, dest);

console.log('Built extension into', dest);
console.log('To load the extension: open chrome://extensions, enable Developer mode, click "Load unpacked" and select the dist/ folder.');
