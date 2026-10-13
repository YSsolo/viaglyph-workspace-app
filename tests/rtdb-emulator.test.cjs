const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Never fall back to the production database or to real cloud credentials.
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9000', 'Start the isolated demo RTDB emulator first');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const projectId = 'demo-viaglyph-pm-tests';
let environment;
const github = id => ({ firebase: { sign_in_provider: 'github.com', identities: { 'github.com': [id] } } });
const memberDb = id => environment.authenticatedContext(`github-${id}`, github(id)).database();

test.before(async () => {
  environment = await initializeTestEnvironment({ projectId, database: {
    host: '127.0.0.1', port: 9000,
    rules: fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')
  } });
});
test.beforeEach(async () => { await environment.clearDatabase(); });
test.after(async () => { await environment?.cleanup(); });

function legacy() {
  return {
    goals: [{ id: 1, name: 'SDK検証Project', bigGoals: [{ id: 2, name: 'SDK検証Milestone', midGoals: [{ id: 3, name: '旧グループ', tasks: [{ id: 100, name: 'SDK検証Task', assign: '山口', done: false }] }] }] }],
    tasks: { dev: { 10: { id: 10, title: 'SDK検証Task', assign: '山口', status: 'TODO' } } },
    workLogs: { log: { taskId: 10, date: '2026-10-13', minutes: 1, user: '山口' } },
    canvases: { meeting: { title: '保存対象', blocks: { block: { text: '既存メモ' } } } }
  };
}
const seed = value => environment.withSecurityRulesDisabled(context => context.database().ref().set(value));

function nativeWorker(db) {
  const exported = {};
  const filename = path.resolve(__dirname, '../functions/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports: exported, process: { env: {} }, console, Date, Buffer,
    require: name => {
      if (name === 'firebase-admin') return { apps: [1], database: () => db };
      if (name === 'firebase-functions/v2/https') return { onRequest: (_, handler) => handler };
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_, handler) => handler };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => null }) };
      if (name === 'cors') return () => (_, __, callback) => callback();
      if (name === 'crypto') return crypto;
      return require(path.resolve(path.dirname(filename), name));
    } }, { filename });
  return exported.workspaceWorker;
}

test('native server SDK applies external changes from a cold transaction cache', { timeout: 20000 }, async () => {
  const task = { id: 't1', projectId: 'p1', milestoneId: 'm1', title: 'Before', status: 'todo', assignees: ['山口'],
    dueDate: '2026-10-13', updatedAt: 'r1', syncStatus: 'synced', github: { number: 7, url: 'https://github.com/YSsolo/repo/issues/7' } };
  const milestone = { id: 'm1', projectId: 'p1', name: 'Before', status: 'open', updatedAt: 'r1', syncStatus: 'synced',
    successCriteria: 'LOCAL_ONLY', github: { number: 1 } };
  await seed({ pm: { tasks: { t1: task }, milestones: { m1: milestone }, projects: { p1: { github: { owner: 'YSsolo', repo: 'repo' } } } } });
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com`,
    credential: { getAccessToken: async () => { throw new Error('REAL_CREDENTIALS_FORBIDDEN'); } } }, 'cold-cache-server');
  try {
    const db = app.database();
    const worker = nativeWorker(db);
    await worker.applyIssueWebhook({ expectedRecordId: 't1', expectedUpdatedAt: 'r1', repository: { full_name: 'YSsolo/repo' },
      issue: { number: 7, html_url: task.github.url, title: 'After', state: 'closed', assignees: [{ login: 'YSsolo' }], milestone: { number: 1 }, updated_at: '2026-10-13T01:00:00Z' } });
    await worker.applyMilestoneWebhook({ expectedRecordId: 'm1', expectedUpdatedAt: 'r1', repository: { full_name: 'YSsolo/repo' },
      milestone: { number: 1, title: 'After', state: 'open', due_on: '2026-10-17T00:00:00Z', updated_at: '2026-10-13T01:00:00Z' } });
    const result = (await db.ref('pm').get()).val();
    assert.equal(result.tasks.t1.title, 'After');
    assert.equal(result.tasks.t1.status, 'done');
    assert.equal(result.tasks.t1.dueDate, '2026-10-13');
    assert.equal(result.milestones.m1.name, 'After');
    assert.equal(result.milestones.m1.dueDate, '2026-10-17');
    assert.equal(result.milestones.m1.status, 'open');
    assert.equal(result.milestones.m1.successCriteria, 'LOCAL_ONLY');
  } finally { await app.delete(); }
});

for (const scenario of ['edit-during-push', 'delete-during-pull', 'delete-on-pull-failure', 'edit-on-pull-failure']) {
  test(`native Actions preserves concurrent data: ${scenario}`, { timeout: 20000 }, async () => {
    const task = { id: 't1', projectId: 'p1', milestoneId: 'm1', title: 'Before', status: 'todo', assignees: ['山口'],
      dueDate: '2026-10-13', updatedAt: 'r1', syncStatus: scenario === 'edit-during-push' ? 'pending' : 'synced',
      github: { number: 7, url: 'https://github.com/YSsolo/repo/issues/7' }, externalUpdatedAt: '2026-10-13T00:00:00Z' };
    await seed({ pm: { tasks: { t1: task }, projects: { p1: { github: { owner: 'YSsolo', repo: 'repo' } } },
      milestones: { m1: { id: 'm1', projectId: 'p1', name: 'Milestone', status: 'open', syncStatus: 'synced', updatedAt: 'r1',
        github: { number: 1 }, externalUpdatedAt: '2026-10-13T01:00:00Z' } } } });
    const admin = require('../functions/node_modules/firebase-admin');
    const app = admin.initializeApp({ projectId, databaseURL: `https://${projectId}.firebaseio.com`,
      credential: { getAccessToken: async () => { throw new Error('REAL_CREDENTIALS_FORBIDDEN'); } } }, `actions-${scenario}`);
    try {
      const db = app.database();
      const revisions = [];
      const reference = db.ref.bind(db);
      db.ref = (...args) => {
        const ref = reference(...args);
        if (args[0] === 'pm/tasks/t1') {
          const transact = ref.transaction.bind(ref);
          ref.transaction = (update, ...options) => transact(current => {
            revisions.push(current?.updatedAt || null);
            return update(current);
          }, ...options);
        }
        return ref;
      };
      const edit = () => environment.withSecurityRulesDisabled(context => context.database().ref('pm/tasks/t1')
        .update({ title: 'Newer edit', updatedAt: 'r-next', syncStatus: 'pending' }));
      let finish;
      const finished = new Promise(resolve => { finish = resolve; });
      const worker = { ...nativeWorker(db), shutdown: async () => finish(),
        syncTaskRecord: async () => {
          assert.equal(scenario, 'edit-during-push');
          await edit();
          await db.ref('pm/tasks/t1').update({ syncStatus: 'synced' });
        },
        github: async (_, resource) => {
          if (resource.includes('/milestones/')) return { updated_at: '2026-10-13T01:00:00Z' };
          if (scenario.startsWith('delete')) {
            await environment.withSecurityRulesDisabled(context => context.database().ref('pm/tasks/t1').remove());
          } else if (scenario === 'edit-on-pull-failure') await edit();
          if (scenario.endsWith('failure')) throw new Error('SYNTHETIC_TRANSPORT_FAILURE');
          return { number: 7, html_url: task.github.url, title: 'External title', state: 'open', assignees: [{ login: 'YSsolo' }],
            milestone: { number: 1 }, updated_at: '2026-10-13T01:00:00Z' };
        }
      };
      const runtimeProcess = { env: { WORKSPACE_SYNC_PROJECT_ID: 'p1', WORKSPACE_SEND_DIGEST: 'false' }, exitCode: 0 };
      const filename = path.resolve(__dirname, '../scripts/actions-sync.cjs');
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { process: runtimeProcess, console: { error() {} }, Date,
        require: name => name === '../functions' ? { workspaceWorker: worker }
          : require(path.resolve(path.dirname(filename), name)) }, { filename });
      await finished;
      let state;
      await environment.withSecurityRulesDisabled(async context => {
        state = (await context.database().ref('pm').get()).val();
      });
      if (scenario.startsWith('delete')) assert.equal(state.tasks?.t1, undefined);
      else {
        assert.equal(state.tasks.t1.title, 'Newer edit');
        assert.equal(state.tasks.t1.updatedAt, 'r-next');
        assert.equal(state.tasks.t1.syncStatus, 'pending');
        assert.equal(state.tasks.t1.dueDate, '2026-10-13');
        assert.equal(state.tasks.t1.lastError, undefined);
        assert.ok(revisions.includes('r-next'), 'the actual native transaction must evaluate the newer revision');
      }
      const failures = scenario.endsWith('failure') ? 1 : 0;
      assert.equal(state.acceptanceRuns.p1.failures, failures);
      assert.equal(runtimeProcess.exitCode, failures);
      assert.equal(state.integration, undefined);
    } finally { await app.delete(); }
  });
}

// Only DOM/session boundaries are stubbed. Database callbacks, commits,
// authentication claims and Rules validation use the real Firebase SDK/emulator.
function application(db) {
  const toasts = [];
  const elements = new Map([['pm-migration-preview', { innerHTML: '' }]]);
  const context = {
    crypto, console, currentUser: '山口',
    window: { firebaseDb: db, getAllTasks: () => [], WORKSPACE_SYNC_MODE: 'actions' },
    API: { getSession: () => ({ short: '山口' }) },
    document: { getElementById: id => elements.get(id) || null },
    toast: message => toasts.push(message),
    firebase: { auth: () => ({ onAuthStateChanged() {}, getRedirectResult: async () => ({ user: null }) }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pm.js'), 'utf8'), context);
  const pm = context.window.PM;
  pm.openModal = () => {};
  pm.closeModal = () => {};
  return { pm, toasts };
}

test('native Rules reject anonymous, non-allowlisted GitHub and Google identities', { timeout: 20000 }, async () => {
  await seed(legacy());
  const contexts = [environment.unauthenticatedContext(), environment.authenticatedContext('outsider', github('1')),
    environment.authenticatedContext('google', { firebase: { sign_in_provider: 'google.com', identities: { 'github.com': ['174987576'] } } })];
  for (const context of contexts) {
    const db = context.database();
    for (const node of ['pm', 'canvases', 'workLogs']) {
      await assertFails(db.ref(node).get());
      await assertFails(db.ref(`${node}/unauthorized`).set({ attempted: true }));
    }
  }
});

test('native Rules allow exactly the three GitHub identities and reject unscheduled Todo', { timeout: 20000 }, async () => {
  for (const id of ['174987576', '19548351', '286001688']) {
    const db = memberDb(id);
    await assertSucceeds(db.ref('pm/settings/slackChannel').set('C_EMULATOR_TEST'));
    await assertSucceeds(db.ref('pm/settings').get());
  }
  const task = {
    id: 'validation', projectId: 'p', milestoneId: 'm', title: '担当期限の検証', status: 'todo', dueDate: '', priority: 'medium',
    createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', updatedBy: '山口'
  };
  const ref = memberDb('174987576').ref('pm/tasks/validation');
  await assertFails(ref.set(task));
  await assertFails(ref.set({ ...task, dueDate: '2026-10-14' }));
  await assertFails(ref.set({ ...task, assignees: ['山口'] }));
  await assertSucceeds(ref.set({ ...task, dueDate: '2026-10-14', assignees: ['山口'] }));
});

test('production migration commits through native SDK and Rules while preserving the old data', { timeout: 20000 }, async () => {
  await seed(legacy());
  const db = memberDb('174987576');
  const app = application(db);
  const before = (await db.ref().get()).val();
  await app.pm.openMigration();
  assert.ok(app.pm.state.migration);
  const id = app.pm.state.migration.tasks[0].id;
  await app.pm.confirmMigration();
  const after = (await db.ref().get()).val();
  assert.equal(after.pm.schemaVersion, 2);
  assert.equal(after.workLogs.log.taskId, id);
  assert.deepEqual(after.goals, before.goals);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.canvases, before.canvases);
  const backup = Object.values(after.migrationBackups)[0];
  assert.deepEqual(backup.workLogs, before.workLogs);
  const repeated = JSON.stringify(after);
  await app.pm.confirmMigration();
  assert.equal(JSON.stringify((await db.ref().get()).val()), repeated);
});

test('another native client changing a Work Log after backup prevents the schema switch', { timeout: 20000 }, async () => {
  await seed(legacy());
  const db = memberDb('174987576');
  const other = memberDb('19548351');
  const app = application(db);
  await app.pm.openMigration();
  const write = app.pm.write.bind(app.pm);
  app.pm.write = async (databasePath, value) => {
    await write(databasePath, value);
    if (databasePath.startsWith('migrationBackups/')) await other.ref('workLogs/log/taskId').set(20);
  };
  await app.pm.confirmMigration();
  const after = (await other.ref().get()).val();
  assert.equal(after.pm?.schemaVersion, undefined);
  assert.equal(after.workLogs.log.taskId, 20);
  assert.equal(Object.keys(after.migrationBackups).length, 1);
});

test('two native clients cannot both migrate the same legacy snapshot', { timeout: 20000 }, async () => {
  await seed(legacy());
  const db = memberDb('174987576');
  const first = application(db);
  const other = memberDb('19548351');
  const second = application(other);
  let backedUp = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const attempts = [0, 0];
  const callbacks = [0, 0];
  [first, second].forEach((app, index) => {
    const write = app.pm.write.bind(app.pm);
    app.pm.write = async (databasePath, value) => {
      await write(databasePath, value);
      if (databasePath.startsWith('migrationBackups/')) {
        if (++backedUp === 2) release();
        await barrier;
      }
    };
    // Count, but do not replace, the native transaction/retry machinery.
    const client = [db, other][index];
    const reference = client.ref.bind(client);
    client.ref = (...args) => {
      const result = reference(...args);
      if (!args.length) {
        const transact = result.transaction.bind(result);
        result.transaction = (update, ...options) => {
          attempts[index]++;
          return transact(current => { callbacks[index]++; return update(current); }, ...options);
        };
      }
      return result;
    };
  });
  await Promise.all([first.pm.openMigration(), second.pm.openMigration()]);
  try {
    await Promise.all([first.pm.confirmMigration(), second.pm.confirmMigration()]);
  } finally {
    release();
  }
  const root = (await db.ref().get()).val();
  assert.equal(backedUp, 2);
  assert.deepEqual(attempts, [1, 1]);
  assert.ok(callbacks.every(count => count >= 1));
  assert.ok(callbacks[0] + callbacks[1] >= 3, 'a competing native transaction must re-evaluate after a conflict');
  assert.equal(root.pm.schemaVersion, 2);
  assert.equal(Object.keys(root.pm.tasks).length, 1);
  assert.equal(Object.keys(root.pm.projects).length, 1);
  assert.ok(root.pm.tasks[root.workLogs.log.taskId]);
});
