const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadWorker(data, recoveredMilestone = null, coldTransactions = false) {
  const writes = [];
  const requests = [];
  const bodies = [];
  const exported = {};
  const warmTargets = new Set();
  const listeners = new Set();
  const filename = path.resolve(__dirname, '../functions/index.js');
  const db = { ref: target => ({
    get: async () => ({ val: () => data[target] || null }),
    on: (event, callback) => { warmTargets.add(target); listeners.add(callback); queueMicrotask(() => callback({ val: () => data[target] || null })); },
    off: (event, callback) => { listeners.delete(callback); },
    update: async patch => { writes.push(target); Object.assign(data[target] ||= {}, patch); },
    transaction: async update => {
      const result = update(coldTransactions && !warmTargets.has(target) ? null : data[target]);
      if (result !== undefined) { writes.push(target); data[target] = result; }
    }
  }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports: exported, process: { env: { GITHUB_TOKEN_YSSOLO: 'synthetic', GITHUB_TOKEN_GANDT: 'synthetic' } },
    console, Date, URL, Buffer,
    fetch: async (url, options = {}) => {
      requests.push(url);
      if (options.body) bodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => !options.method
        ? (recoveredMilestone && url.includes('/milestones?') ? [recoveredMilestone] : [])
        : { number: url.endsWith('/milestones/17') ? 17 : 1, html_url: 'https://github.com/YSsolo/repo/issues/1', updated_at: '2026-10-13T00:00:00Z' } };
    },
    require: name => {
      if (name === 'firebase-functions/v2/https') return { onRequest: (_, handler) => handler };
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_, handler) => handler };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => null }) };
      if (name === 'firebase-admin') return { apps: [1], database: () => db };
      if (name === 'cors') return () => (_, __, callback) => callback();
      if (name === 'crypto') return require('node:crypto');
      return require(path.resolve(path.dirname(filename), name));
    }
  }, { filename });
  return { worker: exported.workspaceWorker, writes, requests, bodies, listeners };
}

test('external Issue and Milestone pulls populate transaction caches before guarded merging', async () => {
  const github = { number: 7, url: 'https://github.com/YSsolo/repo/issues/7' };
  const task = { id: 't1', projectId: 'p1', milestoneId: 'm1', title: 'Before', status: 'todo', dueDate: '2026-10-13',
    updatedAt: 'r1', syncStatus: 'synced', github };
  const milestone = { id: 'm1', projectId: 'p1', name: 'Before', status: 'open', successCriteria: 'LOCAL_ONLY',
    updatedAt: 'r1', syncStatus: 'synced', github: { number: 1 } };
  const data = { 'pm/tasks': { t1: task }, 'pm/tasks/t1': task, 'pm/milestones': { m1: milestone },
    'pm/milestones/m1': milestone, 'pm/projects': { p1: { github: { owner: 'YSsolo', repo: 'repo' } } } };
  const { worker, listeners } = loadWorker(data, null, true);
  await worker.applyIssueWebhook({ expectedRecordId: 't1', expectedUpdatedAt: 'r1', repository: { full_name: 'YSsolo/repo' },
    issue: { number: 7, html_url: github.url, title: 'After', state: 'closed', assignees: [{ login: 'YSsolo' }], milestone: { number: 1 }, updated_at: '2026-10-13T01:00:00Z' } });
  assert.equal(data['pm/tasks/t1'].title, 'After');
  assert.equal(data['pm/tasks/t1'].status, 'done');
  assert.equal(data['pm/tasks/t1'].dueDate, '2026-10-13');
  await worker.applyMilestoneWebhook({ expectedRecordId: 'm1', expectedUpdatedAt: 'r1', repository: { full_name: 'YSsolo/repo' },
    milestone: { number: 1, title: 'After', state: 'open', due_on: '2026-10-17T00:00:00Z', updated_at: '2026-10-13T01:00:00Z' } });
  assert.equal(data['pm/milestones/m1'].name, 'After');
  assert.equal(data['pm/milestones/m1'].dueDate, '2026-10-17');
  assert.equal(data['pm/milestones/m1'].status, 'open');
  assert.equal(data['pm/milestones/m1'].successCriteria, 'LOCAL_ONLY');
  assert.equal(listeners.size, 0);
});

test('Task synchronization rejects a foreign-Project Milestone before any external request or write', async () => {
  const milestone = { id: 'foreign', projectId: 'other', name: 'Other Milestone', status: 'open' };
  const data = {
    'pm/projects/selected': { github: { owner: 'YSsolo', repo: 'repo' } },
    'pm/projects/other': { github: { owner: 'GandT', repo: 'other' } },
    'pm/milestones/foreign': milestone
  };
  const { worker, writes, requests } = loadWorker(data);
  await assert.rejects(worker.syncTaskRecord({ id: 't1', projectId: 'selected', milestoneId: 'foreign', title: 'Task', status: 'backlog' }),
    /Task Milestone must belong to its Project/);
  assert.deepEqual(requests, []);
  assert.deepEqual(writes, []);
});

test('an Issue pull targets the selected record even when another Project links the same Issue', async () => {
  const github = { number: 1, url: 'https://github.com/YSsolo/repo/issues/1' };
  const other = { id: 'other-task', projectId: 'other', title: 'Other', updatedAt: 'r1', syncStatus: 'synced', github };
  const selected = { id: 'selected-task', projectId: 'selected', title: 'Selected', updatedAt: 'r1', syncStatus: 'synced', github };
  const data = {
    'pm/tasks': { 'other-task': other, 'selected-task': selected },
    'pm/tasks/other-task': other, 'pm/tasks/selected-task': selected,
    'pm/projects': { other: { github: { owner: 'YSsolo', repo: 'repo' } }, selected: { github: { owner: 'YSsolo', repo: 'repo' } } },
    'pm/milestones': {}
  };
  const { worker, writes } = loadWorker(data);
  await worker.applyIssueWebhook({ expectedRecordId: 'selected-task', expectedUpdatedAt: 'r1',
    repository: { full_name: 'YSsolo/repo' }, issue: { ...github, html_url: github.url, title: 'Updated', state: 'open', labels: [{ name: 'workspace:backlog' }], updated_at: '2026-10-13T00:00:00Z' } });
  assert.deepEqual(writes, ['pm/tasks/selected-task']);
  assert.equal(data['pm/tasks/other-task'].title, 'Other');
  assert.equal(data['pm/tasks/selected-task'].title, 'Updated');
});

test('a Milestone pull targets its selected record when Projects share a repository', async () => {
  const other = { id: 'other-ms', projectId: 'other', name: 'Other', updatedAt: 'r1', syncStatus: 'synced', github: { number: 1 } };
  const selected = { id: 'selected-ms', projectId: 'selected', name: 'Selected', updatedAt: 'r1', syncStatus: 'synced', github: { number: 1 } };
  const data = {
    'pm/milestones': { 'other-ms': other, 'selected-ms': selected },
    'pm/milestones/other-ms': other, 'pm/milestones/selected-ms': selected,
    'pm/projects': { other: { github: { owner: 'YSsolo', repo: 'repo' } }, selected: { github: { owner: 'YSsolo', repo: 'repo' } } }
  };
  const { worker, writes } = loadWorker(data);
  await worker.applyMilestoneWebhook({ expectedRecordId: 'selected-ms', expectedUpdatedAt: 'r1',
    repository: { full_name: 'YSsolo/repo' }, milestone: { number: 1, title: 'Updated', state: 'open', updated_at: '2026-10-13T00:00:00Z' } });
  assert.deepEqual(writes, ['pm/milestones/selected-ms']);
  assert.equal(data['pm/milestones/other-ms'].name, 'Other');
});

test('Workspace-only completion criteria never enter a GitHub Milestone payload', async () => {
  for (const github of [undefined, { number: 1 }]) {
    const data = { 'pm/projects/selected': { github: { owner: 'YSsolo', repo: 'repo' } } };
    const { worker, bodies } = loadWorker(data);
    await worker.syncMilestoneRecord({ id: 'm1', projectId: 'selected', name: 'Milestone', status: 'open',
      successCriteria: 'WORKSPACE_ONLY_CRITERIA', github });
    assert.equal(JSON.stringify(bodies).includes('WORKSPACE_ONLY_CRITERIA'), false);
    if (github) assert.equal(Object.hasOwn(bodies[0], 'description'), false);
    else assert.equal(bodies[0].description, '<!-- viaglyph-milestone:m1 -->');
  }
});

test('marker recovery preserves the existing GitHub Milestone description and does not create a duplicate', async () => {
  const data = { 'pm/projects/selected': { github: { owner: 'YSsolo', repo: 'repo' } } };
  const { worker, bodies, requests } = loadWorker(data, {
    number: 17, description: 'Human-maintained description\n<!-- viaglyph-milestone:m1 -->'
  });
  await worker.syncMilestoneRecord({ id: 'm1', projectId: 'selected', name: 'Milestone', status: 'open', successCriteria: 'WORKSPACE_ONLY_CRITERIA' });
  assert.equal(Object.hasOwn(bodies[0], 'description'), false);
  assert.equal(JSON.stringify(bodies).includes('WORKSPACE_ONLY_CRITERIA'), false);
  assert.equal(requests.at(-1), 'https://api.github.com/repos/YSsolo/repo/milestones/17');
  assert.equal(data['pm/milestones/m1'].github.number, 17);
});
