const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// An unapproved real user's credentials are not available. This harness drives
// the SDK observer boundary; real OAuth and RTDB authorization are separate gates.
function harness(session, options = {}) {
  const values = new Map(session ? [['vg_session', JSON.stringify(session)]] : []);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const elements = {
    app: { style: { display: 'flex' } },
    'login-screen': { classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } },
    'user-display': { textContent: '古い表示' },
    'login-error': { textContent: '', style: {} },
    'pm-task-modal': { classList: { open: true, remove() { this.open = false; } } }
  };
  let observer;
  let subscriptions = 0;
  let signOuts = 0;
  const errors = [];
  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) { observer = callback; },
    getRedirectResult: async () => { if (options.redirectError) throw options.redirectError; return { user: null }; },
    signOut: async () => { signOuts++; auth.currentUser = null; }
  };
  const sandbox = {
    window: { WORKSPACE_SYNC_MODE: options.mode || 'actions', getAllTasks: () => [], firebaseDb: { ref: () => ({ on() { subscriptions++; }, off() {} }) } },
    API: { getSession: () => JSON.parse(storage.getItem('vg_session') || 'null') },
    firebase: { auth: () => auth },
    document: { getElementById: id => elements[id] || null, querySelectorAll: () => [elements['pm-task-modal']] },
    localStorage: storage,
    sessionStorage: { getItem: () => null, removeItem() {} },
    currentUser: '市川',
    crypto: { randomUUID: () => 'unused' },
    fetch: async () => ({ ok: true, json: async () => ({ success: true }) }),
    console: { error(...args) { errors.push(args); }, warn() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pm.js'), 'utf8'), sandbox);
  return {
    elements, storage, errors,
    get subscriptions() { return subscriptions; },
    get signOuts() { return signOuts; },
    async observe(user) { auth.currentUser = user; await observer(user); }
  };
}

const signedUser = githubId => ({ uid: 'firebase-user-' + githubId, providerData: [{ providerId: 'github.com', uid: githubId }] });

test('sign-out clears cached member identity and hides the Workspace', async () => {
  const app = harness({ githubId: '174987576', short: '山口' });
  await app.observe(null);
  assert.equal(app.storage.getItem('vg_session'), null);
  assert.equal(app.elements.app.style.display, 'none');
  assert.equal(app.elements['login-screen'].classList.hidden, false);
});

test('an unapproved signed identity cannot resume a cached approved member session', async () => {
  const app = harness({ githubId: '174987576', short: '山口' });
  await app.observe(signedUser('999999999'));
  assert.equal(app.subscriptions, 0);
  assert.equal(app.storage.getItem('vg_session'), null);
  assert.equal(app.elements.app.style.display, 'none');
  assert.equal(app.signOuts, 1);
});

test('resume derives the displayed member from signed GitHub ID, not cached short name', async () => {
  const app = harness({ githubId: '286001688', short: '市川', emoji: '🔥' });
  await app.observe(signedUser('174987576'));
  const session = JSON.parse(app.storage.getItem('vg_session'));
  assert.equal(session.githubId, '174987576');
  assert.equal(session.short, '山口');
  assert.equal(app.elements['user-display'].textContent, '🌿 山口');
  assert.equal(app.elements.app.style.display, 'flex');
  assert.equal(app.subscriptions, 4);
});

test('a sign-out during session establishment cannot reopen the previous Workspace', async () => {
  const app = harness(null, { mode: 'functions' });
  let releaseToken;
  let calls = 0;
  const user = signedUser('174987576');
  user.getIdToken = async () => ++calls === 1 ? new Promise(resolve => { releaseToken = resolve; }) : 'test-token';
  const login = app.observe(user);
  await app.observe(null);
  releaseToken('test-token');
  await login;
  assert.equal(app.storage.getItem('vg_session'), null);
  assert.equal(app.elements.app.style.display, 'none');
  assert.equal(app.subscriptions, 0);
});

test('OAuth error diagnostics do not print or display provider error payloads', async () => {
  const secret = 'sensitive-provider-payload-for-test-only';
  const error = Object.assign(new Error(secret), { code: 'auth/invalid-credential', customData: { token: secret } });
  const app = harness(null, { redirectError: error });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(app.errors).includes(secret), false);
  assert.equal(app.elements['login-error'].textContent.includes(secret), false);
});

test('auth loss hides Task edit modals outside the main app container', async () => {
  const app = harness({ githubId: '174987576', short: '山口' });
  await app.observe(null);
  assert.equal(app.elements['pm-task-modal'].classList.open, false);
});

test('an older failed login cannot clear the newly authenticated member', async () => {
  const app = harness(null, { mode: 'functions' });
  let rejectToken;
  const oldUser = signedUser('174987576');
  oldUser.getIdToken = () => new Promise((_, reject) => { rejectToken = reject; });
  const newUser = signedUser('19548351');
  newUser.getIdToken = async () => 'test-token';
  const oldLogin = app.observe(oldUser);
  await app.observe(newUser);
  assert.equal(JSON.parse(app.storage.getItem('vg_session')).short, '村山');
  rejectToken(new Error('old session expired'));
  await oldLogin;
  assert.equal(JSON.parse(app.storage.getItem('vg_session') || 'null')?.short, '村山');
  assert.equal(app.elements.app.style.display, 'flex');
});
