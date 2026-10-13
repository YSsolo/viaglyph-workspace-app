const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function configFor(hostname) {
  const sandbox = { window: { addEventListener() {} }, location: { hostname } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8'), sandbox);
  return sandbox.window.FIREBASE_CONFIG;
}

test('web.app uses its own Hosting domain for redirect authentication', () => {
  assert.equal(configFor('viaglyph-workspace.web.app').authDomain, 'viaglyph-workspace.web.app');
});

test('firebaseapp.com retains its existing same-origin authentication domain', () => {
  assert.equal(configFor('viaglyph-workspace.firebaseapp.com').authDomain, 'viaglyph-workspace.firebaseapp.com');
});

test('development and unknown hosts do not become OAuth callback domains', () => {
  for (const hostname of ['localhost', '127.0.0.1', 'other.web.app', 'viaglyph-workspace.web.app.example.com']) {
    assert.equal(configFor(hostname).authDomain, 'viaglyph-workspace.firebaseapp.com');
  }
});
