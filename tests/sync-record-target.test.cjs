const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadWorker(data) {
  const writes = [];
  const requests = [];
  const exported = {};
  const filename = path.resolve(__dirname, '../functions/index.js');
  const db = { ref: target => ({
    get: async () => ({ val: () => data[target] || null }),
    update: async patch => { writes.push(target); Object.assign(data[target] ||= {}, patch); },
    transaction: async update => {
      const result = update(data[target]);
      if (result !== undefined) { writes.push(target); data[target] = result; }
    }
  }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports: exported, process: { env: { GITHUB_TOKEN_YSSOLO: 'synthetic', GITHUB_TOKEN_GANDT: 'synthetic' } },
    console, Date, URL, Buffer,
    fetch: async (url, options = {}) => {
      requests.push(url);
      return { ok: true, json: async () => !options.method ? []
        : { number: 1, html_url: 'https://github.com/YSsolo/repo/issues/1', updated_at: '2026-10-13T00:00:00Z' } };
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
  return { worker: exported.workspaceWorker, writes, requests };
}

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
