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
