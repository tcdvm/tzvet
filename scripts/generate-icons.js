// scripts/generate-icons.js
// Convert SVG icons in public/icons to PNGs in dist/icons using sharp
const fs = require('fs');
const path = require('path');

async function generate() {
  const sharp = require('sharp');
  const root = path.resolve(__dirname, '..');
  const srcIcons = path.join(root, 'public', 'icons');
  const distIcons = path.join(root, 'dist', 'icons');
  if (!fs.existsSync(srcIcons)) {
    console.error('No source icons found at', srcIcons);
    process.exit(1);
  }
  if (!fs.existsSync(distIcons)) {
    fs.mkdirSync(distIcons, { recursive: true });
  }

  const sources = fs.readdirSync(srcIcons).filter((f) => f.endsWith('.svg'));
  for (const file of sources) {
    const src = path.join(srcIcons, file);
    const base = path.basename(file, '.svg');
    const png48 = path.join(distIcons, base + '.png');
    try {
      // Render at 128px by default; let chrome scale if needed
      await sharp(src).png().resize(128).toFile(path.join(distIcons, base + '.png'));
      await sharp(src).png().resize(48).toFile(path.join(distIcons, base + '@48.png'));
      await sharp(src).png().resize(16).toFile(path.join(distIcons, base + '@16.png'));
      console.log('Generated PNGs for', file);
    } catch (err) {
      console.error('Error generating PNG for', file, err);
    }
  }
}

generate().catch((e) => {
  console.error('Icon generation failed:', e);
  process.exit(1);
});