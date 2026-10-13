const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildHosting, files } = require('../scripts/build-hosting.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-hosting-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of files) fs.writeFileSync(path.join(dir, file), '// fixture');
  return dir;
}
test('Hosting copies only application assets, excluding development files', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'gas'));
  fs.writeFileSync(path.join(dir, 'gas', 'Code.gs'), 'private development source');
  const output = buildHosting(dir);
  assert.deepEqual(fs.readdirSync(output).sort(), [...files].sort());
});
test('Hosting refuses unexpected files already in the public directory', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'hosting-public'));
  fs.writeFileSync(path.join(dir, 'hosting-public', 'secret.txt'), 'fixture');
  assert.throws(() => buildHosting(dir), /Unexpected Hosting output/);
});
test('Hosting rejects a token inside an otherwise allowed JavaScript asset', t => {
  const dir = fixture(t);
  // Synthetic test value only; no real credential is used.
  fs.writeFileSync(path.join(dir, 'api.js'), 'xoxb-' + 'a'.repeat(24));
  assert.throws(() => buildHosting(dir), /Credential-like content/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'hosting-public')), []);
});
