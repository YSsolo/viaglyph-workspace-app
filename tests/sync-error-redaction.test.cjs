const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Actions stores a safe failure, never the transport exception or credential', async () => {
  const credential = 'SYNTHETIC_SECRET_DO_NOT_PERSIST';
  const writes = [];
  const logs = [];
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const worker = {
    db: { ref: target => ({
      get: async () => ({ val: () => target === 'pm/tasks'
        ? { t1: { id: 't1', syncStatus: 'pending' } } : {} }),
      update: async patch => { writes.push({ target, patch }); }
    }) },
    syncMilestoneRecord: async () => {},
    syncTaskRecord: async () => { throw new TypeError(`Invalid header: Bearer ${credential}`); }
  };
  const filename = path.resolve(__dirname, '../scripts/actions-sync.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === '../functions' ? { workspaceWorker: worker }
      : name === 'firebase-admin' ? { app: () => ({ delete: async () => { finish(); } }) }
      : require(path.resolve(path.dirname(filename), name)),
    process: { env: {}, exitCode: 0 },
    console: { error: message => logs.push(message) }, Date
  }, { filename });
  await finished;
  assert.equal(writes.find(item => item.target === 'pm/tasks/t1').patch.syncStatus, 'error');
  assert.equal(JSON.stringify({ writes, logs }).includes(credential), false);
  assert.equal(writes.find(item => item.target === 'pm/tasks/t1').patch.lastError,
    'GitHub同期に失敗しました。連携設定を確認して再同期してください。');
});

test('Functions redact transport errors from scheduled writes and HTTP responses', async () => {
  const credential = 'SYNTHETIC_SECRET_DO_NOT_PERSIST';
  const writes = [];
  const exported = {};
  const filename = path.resolve(__dirname, '../functions/index.js');
  const db = { ref: target => ({
    get: async () => {
      if (target.startsWith('pm/projects/')) throw new Error(`Transport failed: Bearer ${credential}`);
      return { val: () => target === 'pm/tasks/t1'
        ? { id: 't1', projectId: 'p1' }
        : target === 'pm/tasks' ? { t1: { id: 't1', projectId: 'p1', syncStatus: 'pending' } } : {} };
    },
    update: async patch => { writes.push({ target, patch }); }
  }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports: exported, process: { env: {} }, console, Date, URL, Buffer,
    require: name => {
      if (name === 'firebase-functions/v2/https') return { onRequest: (_, handler) => handler };
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_, handler) => handler };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => null }) };
      if (name === 'firebase-admin') return { apps: [1], database: () => db,
        auth: () => ({ verifyIdToken: async () => ({ workspaceMember: true }) }) };
      if (name === 'cors') return () => (_, __, callback) => callback();
      if (name === 'crypto') return require('node:crypto');
      return require(path.resolve(path.dirname(filename), name));
    }
  }, { filename });
  await exported.reconcileGitHub();
  const response = { status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
  await exported.syncTaskToGitHub({ method: 'POST', headers: { authorization: 'Bearer synthetic' },
    body: { taskId: 't1' } }, response);
  assert.equal(JSON.stringify({ writes, response }).includes(credential), false);
  assert.equal(response.body.code, 'WORKSPACE_REQUEST_INVALID');
  assert.equal(response.body.error, 'Workspace request failed. Check integration settings and retry.');
  assert.equal(writes[0].patch.lastError,
    'GitHub同期に失敗しました。連携設定を確認して再同期してください。');
});
