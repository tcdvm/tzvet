# TZVet Chrome Extension Template ✅

A minimal Chrome Extension template using Manifest V3. Includes:

- service worker (background)
- content script
- popup UI
- options page
- small build script to copy `src/` → `dist/`

---

## Quick start

1. Install node (if you don't have it).
2. In the project root:

   npm install

3. Development (hot-reload):

   npm run dev

   - **Edit `src/manifest.json`** (takes precedence over `public/manifest.json` during dev). The dev server will restart and CRX will reload your extension when the manifest changes.

4. Build:

   npm run build

4. Open Chrome and go to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `dist/` folder

5. Try the popup and options page.

---

## Files

- `src/manifest.json` — extension manifest (v3)
- `src/service-worker.js` — background service worker
- `src/content-script.js` — sample content script
- `src/popup/*` — popup UI
- `src/options/*` — options page
- `scripts/build.js` — copies `src/` into `dist/` for loading into Chrome

---

## Development tips 💡

- For rapid local testing, you can run `npx http-server ./src -p 3000` and open pages via that server to exercise content scripts (not a full replacement for loading the extension).
- To publish: increment `version` in `src/manifest.json`, build, zip the `dist` folder, and upload to the Chrome Web Store.

---

Enjoy! 🎯
