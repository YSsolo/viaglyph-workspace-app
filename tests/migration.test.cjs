const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production migration functions, replacing only RTDB transport.
// Running a real migration against production is intentionally not a test step.
function migrationHarness({ goals = [], tasks = { dev: { tasks: [] }, biz: { tasks: [] } }, workLogs = [], database, failedRead, failBackup = false, afterBackup } = {}) {
  let sequence = 0;
  const writes = [];
  const reads = [];
  const operations = [];
  const toasts = [];
  const elements = new Map([['pm-migration-preview', { innerHTML: '' }]]);
  database ||= { goals, tasks: { dev: tasks.dev.tasks, biz: tasks.biz.tasks }, workLogs: Object.fromEntries(workLogs.map((log, index) => [log.id || String(index), log])) };
  const server = structuredClone(database);
  const listeners = new Set();
  const setPath = (key, value) => {
    if (!key) {
      for (const item of Object.keys(server)) delete server[item];
      Object.assign(server, structuredClone(value));
      return;
    }
    const parts = key.split('/');
    let parent = server;
    for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
    parent[parts.at(-1)] = structuredClone(value);
  };
  const sandbox = {
    window: {
      goals, DATA: tasks, workLogs, localTasks: [], WORKSPACE_SYNC_MODE: 'actions', getAllTasks: () => [],
      firebaseDb: { ref: databasePath => ({
        get: async () => { reads.push(databasePath); if (databasePath === failedRead) throw new Error('database unavailable'); return { val: () => structuredClone(server[databasePath] ?? null) }; },
        set: async value => {
          operations.push({ method: 'set', path: databasePath });
          if (failBackup && databasePath.startsWith('migrationBackups/')) throw new Error('backup unavailable');
          writes.push({ [databasePath]: structuredClone(value) });
          setPath(databasePath, value);
          if (databasePath.startsWith('migrationBackups/')) afterBackup?.(server);
        },
        update: async value => {
          operations.push({ method: 'update', path: databasePath }); writes.push(structuredClone(value));
          for (const [key, item] of Object.entries(value)) setPath(key, item);
        },
        on: (event, callback) => { listeners.add(callback); queueMicrotask(() => callback({ val: () => structuredClone(server) })); },
        off: (event, callback) => { listeners.delete(callback); },
        transaction: async (update, complete, applyLocally) => {
          operations.push({ method: 'transaction', path: databasePath, applyLocally });
          const result = update(structuredClone(server));
          if (result === undefined) return { committed: false };
          writes.push({ '': structuredClone(result) });
          setPath('', result);
          return { committed: true, snapshot: { val: () => structuredClone(server) } };
        }
      }) }
    },
    API: { getSession: () => ({ short: '山口' }) },
    firebase: { auth: () => ({ onAuthStateChanged() {}, getRedirectResult: async () => ({ user: null }) }) },
    currentUser: '山口',
    crypto: { randomUUID: () => `migration-${++sequence}` },
    document: { getElementById: id => elements.get(id) || null },
    toast: message => toasts.push(message), console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pm.js'), 'utf8'), sandbox);
  const pm = sandbox.window.PM;
  pm.closeModal = () => {};
  pm.openModal = () => {};
  return { pm, writes, reads, operations, elements, toasts, source: sandbox.window, server, listeners };
}

function legacyGoal(task) {
  return [{ id: 1, name: '旧Project', bigGoals: [{ id: 2, name: '旧Milestone', midGoals: [{ id: 3, name: '旧グループ', tasks: [task] }] }] }];
}

test('merging Goal and board Tasks preserves both Work Log references at actual log keys', async () => {
  const app = migrationHarness({
    goals: legacyGoal({ id: 100, name: '同じTask', assign: '山口', done: false, due: '2026-10-16' }),
    tasks: { dev: { tasks: [{ id: 10, title: '同じTask', assign: '山口', status: 'TODO', due: '2026-10-16' }] }, biz: { tasks: [] } },
    workLogs: [{ id: 'log-goal', taskId: 100, date: '2026-10-13', minutes: 15, user: '山口' }, { id: 'log-board', taskId: 10, date: '2026-10-13', minutes: 20, user: '山口' }]
  });
  const original = JSON.stringify({ goals: app.source.goals, tasks: app.source.DATA, logs: app.source.workLogs });
  assert.equal(app.pm.migrationPreview().tasks.length, 1);
  assert.equal(app.writes.length, 0);
  await app.pm.openMigration();
  const preview = app.pm.state.migration;
  await app.pm.confirmMigration();
  assert.equal(app.server.pm.schemaVersion, 2);
  assert.equal(app.server.workLogs['log-goal'].taskId, preview.tasks[0].id);
  assert.equal(app.server.workLogs['log-board'].taskId, preview.tasks[0].id);
  assert.deepEqual(Object.keys(app.server.workLogs), ['log-goal', 'log-board']);
  assert.equal(JSON.stringify({ goals: app.source.goals, tasks: app.source.DATA, logs: app.source.workLogs }), original);
});

test('migration preview reads authoritative RTDB nodes instead of seeded browser data', async () => {
  const app = migrationHarness({
    goals: [],
    database: {
      goals: { project: { name: '実データProject', bigGoals: { big: { name: '実データMilestone', midGoals: { mid: { name: '旧グループ', tasks: { 'goal-task-key': { name: '実データTask', assign: '山口', done: false } } } } } } } },
      tasks: { dev: {}, biz: {} },
      workLogs: { 'actual-log-key': { taskId: 'goal-task-key', date: '2026-10-13', minutes: 15, user: '山口' } }
    }
  });
  await app.pm.openMigration();
  assert.equal(app.pm.state.migration?.tasks[0]?.title, '実データTask');
  assert.equal(app.pm.state.migration.tasks[0].legacyTaskId, 'goal-task-key');
  assert.equal(app.pm.state.migration.projects[0].name, '実データProject');
  assert.deepEqual(app.reads.sort(), ['goals', 'tasks', 'workLogs']);
  assert.equal(app.writes.length, 0);
});

test('a failed legacy read clears the old preview without falling back to browser cache', async () => {
  const app = migrationHarness({ goals: legacyGoal({ id: 100, name: 'キャッシュTask', assign: '山口' }), failedRead: 'workLogs' });
  app.pm.state.migration = { tasks: [{ title: '古いプレビュー' }] };
  app.elements.get('pm-migration-preview').innerHTML = '古いプレビュー';
  await app.pm.openMigration();
  assert.equal(app.pm.state.migration, null);
  assert.equal(app.writes.length, 0);
  assert.equal(app.toasts.some(message => message.includes('移行データを取得できませんでした')), true);
  assert.equal(app.elements.get('pm-migration-preview').innerHTML.includes('古いプレビュー'), false);
});

function serverLegacy() {
  return {
    goals: legacyGoal({ id: 100, name: '実データTask', assign: '山口', done: false, due: '2026-10-16' }),
    tasks: { dev: { 10: { id: 10, title: '実データTask', assign: '山口', status: 'TODO', due: '2026-10-16' } }, biz: {} },
    workLogs: { 'real-storage-key': { id: 'misleading-embedded-id', taskId: 10, date: '2026-10-13', minutes: 20, user: '山口' } }
  };
}

test('the durable backup is written from the previewed server snapshot before PM changes', async () => {
  const database = serverLegacy();
  const app = migrationHarness({ database });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.operations[0].method, 'set');
  assert.match(app.operations[0].path, /^migrationBackups\//);
  const backup = Object.entries(app.writes[0])[0][1];
  assert.deepEqual(backup.tasks, database.tasks);
  assert.deepEqual(backup.goals, database.goals);
  assert.deepEqual(backup.workLogs, database.workLogs);
});

test('server Work Log paths take precedence over missing or misleading cached IDs', async () => {
  const app = migrationHarness({ database: serverLegacy() });
  await app.pm.openMigration();
  const taskId = app.pm.state.migration.tasks[0].id;
  await app.pm.confirmMigration();
  assert.equal(app.server.workLogs['real-storage-key'].taskId, taskId);
  assert.equal(app.server.workLogs['misleading-embedded-id'], undefined);
  assert.deepEqual(app.server.goals, serverLegacy().goals);
  assert.deepEqual(app.server.tasks, serverLegacy().tasks);
});

test('a backup failure cannot switch schema or write new PM records', async () => {
  const app = migrationHarness({ database: serverLegacy(), failBackup: true });
  await app.pm.openMigration();
  try { await app.pm.confirmMigration(); } catch (_) { /* Transport may reject. */ }
  assert.equal(app.server.pm, undefined);
});

test('a preview without an authoritative snapshot cannot be confirmed', async () => {
  const app = migrationHarness({ goals: legacyGoal({ id: 100, name: 'キャッシュTask', assign: '山口' }) });
  app.pm.state.migration = app.pm.migrationPreview();
  await app.pm.confirmMigration();
  assert.equal(app.writes.length, 0);
});

test('an unclassified board Task starts in Backlog despite an old active status', async () => {
  const app = migrationHarness({ database: { goals: {}, tasks: { dev: { 10: { title: '所属不明Task', assign: '山口', status: 'WIP', due: '2026-10-16' } }, biz: {} }, workLogs: {} } });
  await app.pm.openMigration();
  assert.equal(app.pm.state.migration.tasks[0].status, 'backlog');
});

test('unclassified development and business Tasks use one unclassified Project', async () => {
  const app = migrationHarness({ database: { goals: {}, tasks: { dev: { 10: { title: '開発Task', status: 'TODO' } }, biz: { 20: { title: '一般Task', status: 'TODO' } } }, workLogs: {} } });
  await app.pm.openMigration();
  const preview = app.pm.state.migration;
  assert.equal(preview.projects.length, 1);
  assert.equal(preview.projects[0].name, '未分類');
  assert.equal(preview.tasks[0].projectId, preview.tasks[1].projectId);
  assert.equal(preview.tasks[0].legacyContext, 'dev');
  assert.equal(preview.tasks[1].legacyContext, 'biz');
});

test('multiple matching Goal Tasks are not silently resolved to the last match', async () => {
  const goals = legacyGoal({ id: 100, name: '同じTask', assign: '山口', done: true, due: '2026-10-16' });
  goals[0].bigGoals[0].midGoals.push({ id: 4, name: '別グループ', tasks: [{ id: 200, name: '同じTask', assign: '山口', done: true, due: '2026-10-16' }] });
  const app = migrationHarness({ database: { goals, tasks: { dev: { 10: { title: '同じTask', assign: '山口', status: 'Done', due: '2026-10-16' } }, biz: {} }, workLogs: { log: { taskId: 10 } } } });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.writes.length, 0, 'an ambiguous match must not write or flip the schema');
  assert.match(app.elements.get('pm-migration-preview').innerHTML, /複数/);
  assert.equal(app.toasts.some(message => message.includes('重複候補')), true);
});

test('a Work Log with a colliding development/business legacy ID blocks migration', async () => {
  const app = migrationHarness({ database: { goals: {}, tasks: { dev: { 10: { title: '開発Task' } }, biz: { 10: { title: '一般Task' } } }, workLogs: { log: { taskId: 10 } } } });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.writes.length, 0, 'the Work Log has no context to disambiguate the two source Tasks');
  assert.equal(app.toasts.some(message => message.includes('作業記録')), true);
});

test('a Work Log changed after preview is never overwritten by stale migration', async () => {
  const app = migrationHarness({ database: serverLegacy() });
  await app.pm.openMigration();
  app.server.workLogs['real-storage-key'].taskId = 20;
  await app.pm.confirmMigration();
  assert.equal(app.server.pm, undefined);
  assert.equal(app.server.workLogs['real-storage-key'].taskId, 20);
  assert.equal(app.toasts.some(message => message.includes('再取得')), true);
});

test('a concurrent change after the backup is acknowledged aborts the atomic migration', async () => {
  const app = migrationHarness({ database: serverLegacy(), afterBackup: server => { server.workLogs['real-storage-key'].taskId = 20; } });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.server.pm, undefined);
  assert.equal(app.server.workLogs['real-storage-key'].taskId, 20);
  assert.equal(app.writes.length, 1, 'only the verified legacy backup may be written');
});

test('successful migration preserves unrelated live nodes and cannot be repeated', async () => {
  const database = serverLegacy();
  database.canvases = { meeting: { title: '保存する会議', blocks: [{ text: '議事録' }] } };
  database.pm = { settings: { slackChannel: 'C_TEST' }, tasks: { existing: { id: 'existing', title: '既存正式Task' } } };
  const app = migrationHarness({ database });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.deepEqual(app.server.canvases, database.canvases);
  assert.deepEqual(app.server.pm.settings, database.pm.settings);
  assert.deepEqual(app.server.pm.tasks.existing, database.pm.tasks.existing);
  assert.equal(app.operations.find(item => item.method === 'transaction')?.applyLocally, false);
  assert.equal(app.listeners.size, 0);
  const committed = JSON.stringify(app.server);
  const writes = app.writes.length;
  await app.pm.confirmMigration();
  assert.equal(JSON.stringify(app.server), committed);
  assert.equal(app.writes.length, writes);
  assert.equal(app.listeners.size, 0);
});

test('an orphan Work Log cannot silently survive a schema switch with a dangling Task ID', async () => {
  const database = serverLegacy();
  database.workLogs.orphan = { taskId: 404, minutes: 15 };
  const app = migrationHarness({ database });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.server.pm, undefined);
  assert.equal(app.writes.length, 0);
  assert.equal(app.toasts.some(message => message.includes('作業記録')), true);
});

test('a legacy alias colliding with an existing formal Task ID cannot relink its Work Log', async () => {
  const database = serverLegacy();
  database.pm = { tasks: { 10: { id: '10', title: '既存正式Task' } } };
  const app = migrationHarness({ database });
  await app.pm.openMigration();
  await app.pm.confirmMigration();
  assert.equal(app.server.workLogs['real-storage-key'].taskId, 10);
  assert.equal(app.server.pm.schemaVersion, undefined);
  assert.equal(app.writes.length, 0);
  assert.equal(app.toasts.some(message => message.includes('作業記録')), true);
});
