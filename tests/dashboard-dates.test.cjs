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
