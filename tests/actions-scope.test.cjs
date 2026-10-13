const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function runWorker(projectId, sendDigest = false, clean = false, deleteDuringPull = false, failPull = false, editDuringFailure = false, options = {}) {
  const writes = [];
  const synced = [];
  const pulled = [];
  const listeners = new Set();
  const process = { env: { WORKSPACE_SYNC_PROJECT_ID: projectId, WORKSPACE_SEND_DIGEST: String(sendDigest) }, exitCode: 0 };
  const data = options.data ? structuredClone(options.data) : {
    'pm/projects/acceptance': { id: 'acceptance', github: { owner: 'YSsolo', repo: 'viaglyph-workspace-app' } },
    'pm/tasks': {
      t1: { id: 't1', projectId: 'acceptance', syncStatus: 'pending', updatedAt: 'r1' },
      t2: { id: 't2', projectId: 'real-project', syncStatus: 'pending', updatedAt: 'r2' }
    },
    'pm/milestones': {
      m1: { id: 'm1', projectId: 'acceptance', syncStatus: 'pending', updatedAt: 'r1' },
      m2: { id: 'm2', projectId: 'real-project', syncStatus: 'pending', updatedAt: 'r2' }
    }
  };
  for (const collection of ['tasks', 'milestones']) {
    for (const record of Object.values(data[`pm/${collection}`])) {
      if (clean) Object.assign(record, { syncStatus: 'synced', github: { number: 1 } });
      data[`pm/${collection}/${record.id}`] = record;
    }
  }
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const worker = {
    shutdown: async () => { finish(); },
    db: { ref: target => ({
      get: async () => ({ val: () => structuredClone(data[target] || null) }),
      on: (_, listener) => { listeners.add(listener); queueMicrotask(() => listener({ val: () => structuredClone(data[target] || null) })); },
      off: (_, listener) => { listeners.delete(listener); },
      update: async patch => {
        writes.push({ target, patch });
        Object.assign(data[target] ||= {}, patch);
        const [, collection, id] = target.split('/');
        if (id && data[`pm/${collection}`]) data[`pm/${collection}`][id] = data[target];
      },
      transaction: async update => {
        const [,,id] = target.split('/');
        const collection = target.split('/')[1];
        const patch = update(structuredClone(data[target] || null));
        if (patch !== undefined) {
          writes.push({ target, patch });
          if (patch === null) {
            delete data[target];
            if (data[`pm/${collection}`]) delete data[`pm/${collection}`][id];
          } else {
            data[target] = patch;
            if (data[`pm/${collection}`]) data[`pm/${collection}`][id] = patch;
          }
        }
        return { committed: patch !== undefined };
      }
    }) },
    syncMilestoneRecord: async record => { synced.push(record.id); },
    syncTaskRecord: async record => { synced.push(record.id); },
    github: async (_, resource) => {
      if (options.failCleanPull && resource.includes('/issues/')) throw new Error('SYNTHETIC_TRANSPORT_FAILURE');
      if (editDuringFailure && resource.includes('/issues/')) {
        Object.assign(data['pm/tasks/t1'], { title: 'Newer edit', updatedAt: 'r-next', syncStatus: 'pending' });
        throw new Error('SYNTHETIC_TRANSPORT_FAILURE');
      }
      if (deleteDuringPull && resource.includes('/issues/')) {
        delete data['pm/tasks/t1'];
        delete data['pm/tasks'].t1;
        if (failPull) throw new Error('SYNTHETIC_TRANSPORT_FAILURE');
      }
      return { updated_at: '2026-10-13T00:00:00Z' };
    },
    applyIssueWebhook: async payload => { pulled.push(payload); },
    applyMilestoneWebhook: async payload => { pulled.push(payload); }
  };
  const filename = path.resolve(__dirname, '../scripts/actions-sync.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === '../functions' ? { workspaceWorker: worker }
      : name === 'firebase-admin' ? { app: () => ({ delete: async () => { finish(); } }) }
      : require(path.resolve(path.dirname(filename), name)),
    process, console: { error() {} }, Date
  }, { filename });
  await finished;
  return { writes, synced, pulled, data, listeners, exitCode: process.exitCode };
}

test('legacy errors without a direction never automatically overwrite either side', async () => {
  const original = await runWorker('acceptance', false, true);
  const task = original.data['pm/tasks/t1'];
  Object.assign(task, { title: 'Unresolved local data', syncStatus: 'error' });
  delete task.lastSyncDirection;
  const retry = await runWorker('acceptance', false, false, false, false, false, { data: original.data });
  assert.deepEqual(retry.synced, [], 'an ambiguous legacy failure is not an outgoing instruction');
  assert.equal(retry.pulled.some(payload => payload.expectedRecordId === 't1'), false);
  assert.equal(retry.data['pm/tasks/t1'].title, 'Unresolved local data');
  assert.equal(retry.data['pm/tasks/t1'].syncStatus, 'error');
  assert.equal(retry.exitCode, 1);
});

test('a failed incoming pull retries incoming rather than pushing stale Workspace fields to GitHub', async () => {
  const failed = await runWorker('acceptance', false, true, false, false, false, { failCleanPull: true });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.data['pm/tasks/t1'].syncStatus, 'error');
  const retry = await runWorker('acceptance', false, false, false, false, false, { data: failed.data });
  assert.deepEqual(retry.synced, [], 'incoming failure must not turn into an outgoing overwrite');
  assert.ok(retry.pulled.some(payload => payload.expectedRecordId === 't1'));
});

test('a scoped acceptance run syncs only its Project and does not report global health', async () => {
  const result = await runWorker('acceptance');
  assert.deepEqual(result.synced, ['m1', 't1']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.writes.some(item => item.target === 'pm/integration'), false);
  assert.ok(result.writes.some(item => item.target === 'pm/acceptanceRuns/acceptance'));
});

test('unknown or invalid acceptance Project scope fails before any sync or write', async () => {
  for (const projectId of ['missing', '../projects', 'bad.key']) {
    const result = await runWorker(projectId);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.synced, []);
    assert.deepEqual(result.writes, []);
  }
});

test('a Project-scoped run cannot send the global Slack digest', async () => {
  const result = await runWorker('acceptance', true);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.synced, []);
  assert.deepEqual(result.writes, []);
});

test('an ordinary unscoped run continues reconciling all Projects', async () => {
  const result = await runWorker('');
  assert.deepEqual(result.synced, ['m1', 'm2', 't1', 't2']);
  assert.equal(result.exitCode, 0);
  assert.ok(result.writes.some(item => item.target === 'pm/integration'));
});

test('clean record pulls bind the exact selected IDs, not merely an external Issue or Milestone', async () => {
  const result = await runWorker('acceptance', false, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pulled.map(payload => payload.expectedRecordId), ['m1', 't1']);
  assert.deepEqual(result.pulled.map(payload => payload.expectedUpdatedAt), ['r1', 'r1']);
});

test('a Task deleted during a GitHub pull is not recreated as an error record', async () => {
  const result = await runWorker('acceptance', false, true, true);
  assert.equal(result.data['pm/tasks/t1'], undefined);
  assert.equal(result.writes.some(write => write.target === 'pm/tasks/t1'), false);
  assert.equal(result.pulled.some(payload => payload.expectedRecordId === 't1'), false);
  assert.equal(result.exitCode, 0);
});

test('a GitHub failure after concurrent deletion does not recreate the deleted Task', async () => {
  const result = await runWorker('acceptance', false, true, true, true);
  assert.equal(result.data['pm/tasks/t1'], undefined);
  assert.equal(result.writes.some(write => write.target === 'pm/tasks/t1'), false);
  assert.equal(result.listeners.size, 0);
  assert.equal(result.exitCode, 1);
});

test('an old GitHub failure does not mark a newer queued edit as failed', async () => {
  const result = await runWorker('acceptance', false, true, false, false, true);
  assert.equal(result.data['pm/tasks/t1'].title, 'Newer edit');
  assert.equal(result.data['pm/tasks/t1'].syncStatus, 'pending');
  assert.equal(result.data['pm/tasks/t1'].lastError, undefined);
  assert.equal(result.listeners.size, 0);
  assert.equal(result.exitCode, 1);
});
