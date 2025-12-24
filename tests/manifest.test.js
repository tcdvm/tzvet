const fs = require('fs');
const path = require('path');

test('manifest exists and has required keys', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'manifest.json'), 'utf8'));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBeTruthy();
  expect(manifest.version).toBeTruthy();
});
