// Build sanity checks for the packaged extension output.
const fs = require('fs');
const path = require('path');
const manifest = path.join(__dirname, '..', 'dist', 'manifest.json');
if (!fs.existsSync(manifest)) {
  console.error('ERROR: dist/manifest.json not found — run `npm run build` first');
  process.exit(2);
}

const serviceWorkerLoader = path.join(__dirname, '..', 'dist', 'service-worker-loader.js');
if (!fs.existsSync(serviceWorkerLoader)) {
  console.error('ERROR: dist/service-worker-loader.js not found — build is incomplete');
  process.exit(2);
}

const loaderSource = fs.readFileSync(serviceWorkerLoader, 'utf8');
if (/https?:\/\/localhost:\d+/i.test(loaderSource)) {
  console.error('ERROR: dist contains a dev service worker loader and is not installable');
  process.exit(2);
}

console.log('dist build output looks installable');
