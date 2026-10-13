const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dashboardAt(instant, tasks) {
  const timestamp = Date.parse(instant);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  }
  const context = {
    Date: Clock, crypto: { randomUUID: () => 'test-id' }, console,
    window: { getAllTasks: () => [], WORKSPACE_SYNC_MODE: 'actions' },
    API: { getSession: () => null },
    document: { getElementById: () => null },
    firebase: { auth: () => ({ onAuthStateChanged() {}, getRedirectResult: async () => ({ user: null }) }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pm.js'), 'utf8'), context);
  const pm = context.window.PM;
  pm.state.tasks = Object.fromEntries(tasks.map(task => [task.id, { status: 'todo', projectId: 'p1', ...task }]));
  return pm;
}

const ids = tasks => Array.from(tasks, task => task.id);

test('Review residence is not reset by a recent Task edit', () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [{ id: 'review', status: 'review',
    reviewStartedAt: '2026-10-11T03:00:00Z', updatedAt: '2026-10-13T02:59:00Z' }]);
  assert.deepEqual(ids(pm.alerts().review), ['review']);
  assert.equal(pm.projectHealth({ id: 'p1' }), 'yellow');
});

test('Review transitions start a residence clock, retain it and clear it on leaving', async () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [{ id: 'task', status: 'todo', assignees: ['山口'], dueDate: '2026-10-13' }]);
  pm.metadata = () => ({ updatedAt: '2026-10-13T03:00:00Z', updatedBy: '山口' });
  pm.update = async (_path, patch) => Object.assign(pm.state.tasks.task, patch);
  pm.syncTask = async () => {};
  await pm.updateTaskStatus('task', 'review');
  assert.equal(pm.task('task').reviewStartedAt, '2026-10-13T03:00:00.000Z');
  pm.task('task').reviewStartedAt = '2026-10-11T03:00:00Z';
  await pm.updateTaskStatus('task', 'review');
  assert.equal(pm.task('task').reviewStartedAt, '2026-10-11T03:00:00Z');
  await pm.updateTaskStatus('task', 'todo');
  assert.equal(pm.task('task').reviewStartedAt, null);
});

test('Task editing retains Review residence until the Task leaves Review', async () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', []);
  pm.state.projects.p1 = { github: { owner: 'YSsolo', repo: 'viaglyph-workspace-app' } };
  pm.metadata = () => ({ updatedAt: '2026-10-13T03:00:00Z', updatedBy: '山口' });
  pm.write = async (_path, record) => { pm.state.tasks[record.id] = record; };
  pm.syncTask = async () => {};
  const input = { id: 'task', projectId: 'p1', milestoneId: 'm1', title: 'Review', status: 'review', assignees: ['山口'], dueDate: '2026-10-13', silent: true };
  await pm.persistTask(input);
  assert.equal(pm.task('task').reviewStartedAt, '2026-10-13T03:00:00.000Z');
  pm.task('task').reviewStartedAt = '2026-10-11T03:00:00Z';
  await pm.persistTask({ ...input, title: '編集' });
  assert.equal(pm.task('task').reviewStartedAt, '2026-10-11T03:00:00Z');
  await pm.persistTask({ ...input, status: 'todo' });
  assert.equal(pm.task('task').reviewStartedAt, null);
});

test('Task editing records completion, preserves it on edits and clears it on reopen', async () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', []);
  pm.state.projects.p1 = { github: { owner: 'YSsolo', repo: 'viaglyph-workspace-app' } };
  pm.metadata = () => ({ updatedAt: '2026-10-13T03:00:00Z', updatedBy: '山口' });
  pm.write = async (_path, record) => { pm.state.tasks[record.id] = record; };
  pm.syncTask = async () => {};
  const input = { id: 'task', projectId: 'p1', milestoneId: 'm1', title: '完了', status: 'done', assignees: ['山口'], dueDate: '2026-10-13', silent: true };
  await pm.persistTask(input);
  assert.equal(pm.task('task').completedAt, '2026-10-13T03:00:00.000Z');
  pm.state.tasks.task.completedAt = '2026-10-12T03:00:00Z';
  await pm.persistTask({ ...input, title: '編集' });
  assert.equal(pm.task('task').completedAt, '2026-10-12T03:00:00Z');
  await pm.persistTask({ ...input, status: 'todo' });
  assert.equal(pm.task('task').completedAt, null);
  pm.state.tasks.task.status = 'done';
  delete pm.state.tasks.task.completedAt;
  await pm.persistTask(input);
  assert.equal(pm.task('task').completedAt, null, 'legacy Done edits must not invent a completion time');
});

test('Workspace status transitions record completion once and clear it on reopen', async () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [
    { id: 'task', status: 'todo', assignees: ['山口'], dueDate: '2026-10-13' }
  ]);
  pm.metadata = () => ({ updatedAt: '2026-10-13T03:00:00Z', updatedBy: '山口' });
  pm.update = async (_path, patch) => Object.assign(pm.state.tasks.task, patch);
  pm.syncTask = async () => {};
  await pm.updateTaskStatus('task', 'done');
  assert.equal(pm.task('task').completedAt, '2026-10-13T03:00:00.000Z');
  pm.state.tasks.task.completedAt = '2026-10-12T03:00:00Z';
  await pm.updateTaskStatus('task', 'done');
  assert.equal(pm.task('task').completedAt, '2026-10-12T03:00:00Z');
  await pm.updateTaskStatus('task', 'todo');
  assert.equal(pm.task('task').completedAt, null);
});

test('weekly completion summary uses completion instants in JST, not latest edit dates', () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [
    { id: 'start', title: '月曜完了', status: 'done', completedAt: '2026-10-11T15:00:00Z' },
    { id: 'before', title: '前週完了', status: 'done', completedAt: '2026-10-11T14:59:59Z', updatedAt: '2026-10-13T01:00:00Z' },
    { id: 'unknown', title: '日時不明', status: 'done', updatedAt: '2026-10-13T01:00:00Z' },
    { id: 'invalid', title: '不正日時', status: 'done', completedAt: 'not-a-date' },
    { id: 'future', title: '未来', status: 'done', completedAt: '2026-10-13T03:00:01Z' },
    { id: 'reopened', title: '再開', status: 'todo', completedAt: '2026-10-13T01:00:00Z' }
  ]);
  assert.deepEqual(ids(pm.alerts().completedWeek || []), ['start']);
  assert.match(pm.makeSummary(pm.alerts()), /今週完了したTask: 月曜完了/);
});

test('weekly completed Tasks switch at Monday JST and exclude unknown historical completion', () => {
  const tasks = [
    { id: 'sunday', title: '日曜', status: 'done', completedAt: '2026-10-18T14:59:59Z' },
    { id: 'monday', title: '月曜', status: 'done', completedAt: '2026-10-18T15:00:00Z' }
  ];
  assert.deepEqual(ids(dashboardAt('2026-10-18T15:00:00Z', tasks).alerts().completedWeek || []), ['monday']);
  const empty = dashboardAt('2026-10-13T03:00:00Z', [{ id: 'unknown', status: 'done' }]);
  assert.match(empty.makeSummary(empty.alerts()), /今週完了したTask: 完了日時を確認できるTaskはありません/);
});

test('Dashboard uses the JST date after Japanese midnight, not the previous UTC date', () => {
  const pm = dashboardAt('2026-10-12T16:00:00Z', [
    { id: 'yesterday', dueDate: '2026-10-12' },
    { id: 'today', dueDate: '2026-10-13' },
    { id: 'tomorrow', dueDate: '2026-10-14' }
  ]);
  assert.deepEqual(ids(pm.alerts().overdue), ['yesterday']);
  assert.deepEqual(ids(pm.alerts().soon), ['today', 'tomorrow']);
});

test('this week includes today and tomorrow but excludes the next Monday', () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [
    { id: 'monday', dueDate: '2026-10-12' },
    { id: 'today', dueDate: '2026-10-13' },
    { id: 'tomorrow', dueDate: '2026-10-14' },
    { id: 'sunday', dueDate: '2026-10-18' },
    { id: 'next-week', dueDate: '2026-10-19' },
    { id: 'done', dueDate: '2026-10-16', status: 'done' }
  ]);
  assert.deepEqual(ids(pm.alerts().week), ['monday', 'today', 'tomorrow', 'sunday']);
});

test('a recent Review without another risk does not make a Project yellow', () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [
    { id: 'review', status: 'review', updatedAt: '2026-10-13T02:00:00Z' }
  ]);
  assert.equal(pm.projectHealth({ id: 'p1' }), 'green');
  assert.deepEqual(ids(pm.alerts().review), []);
});

test('Review at exactly 48 hours is stalled and makes its Project yellow', () => {
  const pm = dashboardAt('2026-10-13T03:00:00Z', [
    { id: 'review', status: 'review', updatedAt: '2026-10-11T03:00:00Z' }
  ]);
  assert.deepEqual(ids(pm.alerts().review), ['review']);
  assert.equal(pm.projectHealth({ id: 'p1' }), 'yellow');
});

test('Sunday and Monday JST boundaries choose different calendar weeks', () => {
  const tasks = [{ id: 'sunday', dueDate: '2026-10-18' }, { id: 'monday', dueDate: '2026-10-19' }];
  assert.deepEqual(ids(dashboardAt('2026-10-18T14:59:59Z', tasks).alerts().week), ['sunday']);
  assert.deepEqual(ids(dashboardAt('2026-10-18T15:00:00Z', tasks).alerts().week), ['monday']);
});

test('JST year rollover keeps yesterday overdue and includes New Year in this week', () => {
  const pm = dashboardAt('2026-12-31T15:00:00Z', [
    { id: 'yesterday', dueDate: '2026-12-31' }, { id: 'today', dueDate: '2027-01-01' },
    { id: 'tomorrow', dueDate: '2027-01-02' }, { id: 'next-week', dueDate: '2027-01-04' }
  ]);
  assert.deepEqual(ids(pm.alerts().overdue), ['yesterday']);
  assert.deepEqual(ids(pm.alerts().soon), ['today', 'tomorrow']);
  assert.deepEqual(ids(pm.alerts().week), ['yesterday', 'today', 'tomorrow']);
});
