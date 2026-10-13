const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function application() {
  const API = { getSession: () => ({ short: '山口' }) };
  const messages = []; const writes = [];
  const context = { API, Date, console, crypto: { randomUUID: () => 'new-id' },
    window: { WORKSPACE_SYNC_MODE: 'actions', getAllTasks: () => [] },
    document: { getElementById: () => null }, toast: message => messages.push(message),
    firebase: { auth: () => ({ onAuthStateChanged() {}, getRedirectResult: async () => ({ user: null }) }) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pm.js'), 'utf8'), context);
  const pm = context.window.PM;
  const record = id => ({ id, title: 'Local data', status: 'todo', updatedAt: 'r1', syncStatus: 'error', lastSyncDirection: 'pull' });
  pm.state.tasks = { t1: record('t1') };
  pm.state.milestones = { m1: record('m1') };
  const authority = { 'pm/tasks/t1': structuredClone(pm.task('t1')), 'pm/milestones/m1': structuredClone(pm.milestone('m1')) };
  const listeners = new Set();
  context.window.firebaseDb = { ref: target => ({
    on: (_event, observer) => { listeners.add(observer); queueMicrotask(() => observer({ val: () => authority[target] || null })); },
    off: (_event, observer) => listeners.delete(observer),
    transaction: async (update, _completion, applyLocally) => {
      assert.equal(applyLocally, false);
      const result = update(structuredClone(authority[target] || null));
      if (result === undefined) return { committed: false };
      writes.push({ target, patch: result });
      authority[target] = result;
      const [, collection, id] = target.split('/');
      Object.assign(pm.state[collection][id], result);
      return { committed: true };
    }
  }) };
  pm.update = async (target, patch) => {
    writes.push({ target, patch });
    Object.assign(authority[target] ||= {}, patch);
    const [, collection, id] = target.split('/');
    Object.assign(pm.state[collection][id], patch);
  };
  return { pm, API, messages, writes, authority, listeners };
}

for (const [collection, id, retry] of [['tasks', 't1', 'syncPmTask'], ['milestones', 'm1', 'syncPmMilestone']]) {
  test(`stale ${collection} retry cannot replace a newer revision or changed intent`, async () => {
    for (const change of [
      { updatedAt: 'r2', syncStatus: 'pending', lastSyncDirection: 'push' },
      { syncStatus: 'pending', lastSyncDirection: 'push' },
      { lastSyncDirection: 'push' }
    ]) {
      const { API, authority, writes, listeners } = application();
      const target = `pm/${collection}/${id}`;
      const current = { ...authority[target], title: 'New authoritative edit', ...change };
      authority[target] = structuredClone(current);
      await API[retry](id);
      assert.deepEqual(authority[target], current);
      assert.equal(writes.length, 0);
      assert.equal(listeners.size, 0);
    }
  });
  test(`stale ${collection} retry cannot recreate a deleted record`, async () => {
    const { API, authority, writes, listeners } = application();
    const target = `pm/${collection}/${id}`;
    delete authority[target];
    await API[retry](id);
    assert.equal(authority[target], undefined);
    assert.equal(writes.length, 0);
    assert.equal(listeners.size, 0);
  });
}

test('release CI runs the manual retry intent regression', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/firebase-release.yml'), 'utf8');
  assert.ok(/-\s*run:\s*node --test tests\/sync-retry-intent\.test\.cjs/.test(source), 'CI must run the manual retry regression');
});

test('public manual retry APIs preserve incoming Task and Milestone direction', async () => {
  const { pm, API, writes } = application();
  await API.syncPmTask('t1');
  await API.syncPmMilestone('m1');
  assert.equal(pm.task('t1').syncStatus, 'error');
  assert.equal(pm.milestone('m1').syncStatus, 'error');
  assert.equal(pm.task('t1').lastSyncDirection, 'pull');
  assert.equal(pm.milestone('m1').lastSyncDirection, 'pull');
  assert.equal(writes.length, 2);
  assert.match(pm.taskRow(pm.task('t1')), /PM\.retryRecord\('tasks','t1'\)/);
});

test('bulk retry does not guess a legacy direction or overwrite local intent', async () => {
  const { pm, writes } = application();
  delete pm.task('t1').lastSyncDirection;
  await pm.retryWorkspaceSession();
  assert.equal(writes.some(write => write.target === 'pm/tasks/t1'), false);
  assert.equal(pm.task('t1').syncStatus, 'error');
  assert.equal(pm.task('t1').title, 'Local data');
  assert.equal(pm.milestone('m1').syncStatus, 'error');
  assert.equal(pm.milestone('m1').lastSyncDirection, 'pull');
});

test('explicit local sync queues outgoing intent even after an incoming failure', async () => {
  const { pm } = application();
  await pm.syncTask('t1');
  await pm.syncMilestone('m1');
  assert.equal(pm.task('t1').syncStatus, 'pending');
  assert.equal(pm.task('t1').lastSyncDirection, 'push');
  assert.equal(pm.milestone('m1').syncStatus, 'pending');
  assert.equal(pm.milestone('m1').lastSyncDirection, 'push');
});

test('bulk retry does not claim success when all directions are unknown', async () => {
  const { pm, writes, messages } = application();
  delete pm.task('t1').lastSyncDirection;
  delete pm.milestone('m1').lastSyncDirection;
  await pm.retryWorkspaceSession();
  assert.equal(writes.length, 0);
  assert.match(messages.at(-1), /再同期できる項目はありません/);
  assert.doesNotMatch(messages.at(-1), /予約しました/);
});
