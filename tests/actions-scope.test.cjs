const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function runWorker(projectId, sendDigest = false, clean = false) {
  const writes = [];
  const synced = [];
  const pulled = [];
  const process = { env: { WORKSPACE_SYNC_PROJECT_ID: projectId, WORKSPACE_SEND_DIGEST: String(sendDigest) }, exitCode: 0 };
  const data = {
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
      get: async () => ({ val: () => data[target] || null }),
      update: async patch => { writes.push({ target, patch }); },
      transaction: async update => {
        const [,,id] = target.split('/');
        const collection = target.split('/')[1];
        writes.push({ target, patch: update(data[`pm/${collection}`]?.[id]) });
      }
    }) },
    syncMilestoneRecord: async record => { synced.push(record.id); },
    syncTaskRecord: async record => { synced.push(record.id); },
    github: async () => ({ updated_at: '2026-10-13T00:00:00Z' }),
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
  return { writes, synced, pulled, exitCode: process.exitCode };
}

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
