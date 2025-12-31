const { defineConfig } = require('vite');
const fs = require('fs');
const path = require('path');
const { crx } = require('@crxjs/vite-plugin');

// Prefer src/manifest.json during development so edits in src/ are the single source of truth.
const SRC_MANIFEST = path.resolve(__dirname, 'src', 'manifest.json');
const PUBLIC_MANIFEST = path.resolve(__dirname, 'public', 'manifest.json');
const manifestPath = fs.existsSync(SRC_MANIFEST) ? SRC_MANIFEST : PUBLIC_MANIFEST;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

module.exports = defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [
    crx({ manifest }),
    // Watch manifest file and restart dev server when it changes so CRX reloads the extension
    {
      name: 'watch-manifest',
      configureServer(server) {
        // add to the watcher
        server.watcher.add(manifestPath);

        const ensureIcons = async () => {
          try {
            const icons = manifest.icons || {};
            for (const sizeKey of Object.keys(icons)) {
              const iconRel = icons[sizeKey];
              if (!iconRel) continue;
              const absSrc1 = path.resolve(__dirname, 'src', iconRel);
              const absSrc2 = path.resolve(__dirname, 'public', iconRel);
              if (fs.existsSync(absSrc1) || fs.existsSync(absSrc2)) continue;

              // try to find an SVG with the same base name
              const base = path.basename(iconRel, path.extname(iconRel));
              const svgCandidates = [
                path.resolve(__dirname, 'public', 'icons', base + '.svg'),
                path.resolve(__dirname, 'src', 'icons', base + '.svg')
              ];
              const found = svgCandidates.find((p) => fs.existsSync(p));
              if (found) {
                let sharp;
                try { sharp = require('sharp'); } catch (e) { console.warn('[watch-manifest] sharp not installed; skip generating PNG icons'); }
                if (!sharp) continue;
                const px = Number(sizeKey) || (base.match(/\d+/) ? Number(base.match(/\d+/)[0]) : 128);
                const outPath = path.resolve(__dirname, 'public', 'icons', base + '.png');
                if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
                await sharp(found).png().resize(px).toFile(outPath);
                console.log(`[watch-manifest] generated ${outPath} from ${found}`);
              }
            }
          } catch (err) {
            console.error('[watch-manifest] error generating icons', err);
          }
        };

        // ensure icons exist at startup
        ensureIcons();

        server.watcher.on('change', async (p) => {
          if (path.resolve(p) === path.resolve(manifestPath)) {
            console.log('[watch-manifest] manifest changed, generating icons and restarting dev server...');
            Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
            await ensureIcons();
            server.restart();
          }
        });
      }
    }
  ],
  // Dev server needs to allow chrome-extension requests when CRX loads service worker from localhost
  server: {
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    // Ensure HMR client knows where to connect from extension pages (port must be explicit)
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'src/sidepanel/index.html'),
        options: path.resolve(__dirname, 'src/options/options.html'),
        trends: path.resolve(__dirname, 'src/trends/index.html'),
        'content-script': path.resolve(__dirname, 'src/content-script.js'),
        'service-worker': path.resolve(__dirname, 'src/service-worker.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  publicDir: path.resolve(__dirname, 'public')
});
