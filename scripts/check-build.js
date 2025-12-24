// Very small build/test sanity script: checks that dist/manifest.json exists
const fs = require('fs');
const path = require('path');
const manifest = path.join(__dirname, '..', 'dist', 'manifest.json');
if (!fs.existsSync(manifest)) {
  console.error('ERROR: dist/manifest.json not found — run `npm run build` first');
  process.exit(2);
}
console.log('dist/manifest.json found — build appears ok');
