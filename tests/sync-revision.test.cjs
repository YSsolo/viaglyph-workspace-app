const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeExternalRevision } = require('../functions/sync-revision.cjs');

test('an external change cannot overwrite a newer local edit', () => {
  const current = { title: 'new local title', updatedAt: 'revision-2', syncStatus: 'pending' };
  assert.equal(mergeExternalRevision(current, 'revision-1', { title: 'GitHub title' }), undefined);
});
test('an external change cannot resurrect a deleted record', () => {
  assert.equal(mergeExternalRevision(null, 'revision-1', { title: 'GitHub title' }), undefined);
});
test('a clean matching revision accepts external fields and retains local-only fields', () => {
  const current = { title: 'old', updatedAt: 'revision-1', dueDate: '2026-10-20', priority: 'high', syncStatus: 'synced' };
  assert.deepEqual(mergeExternalRevision(current, 'revision-1', { title: 'GitHub title' }), { ...current, title: 'GitHub title' });
});
test('a queued retry wins over an external pull even when its revision is unchanged', () => {
  assert.equal(mergeExternalRevision({ updatedAt: 'revision-1', syncStatus: 'error' }, 'revision-1', { title: 'GitHub title' }), undefined);
});

test('only an explicitly requested incoming retry can merge a matching pull-error revision', () => {
  const current = { title: 'old', updatedAt: 'r1', syncStatus: 'error', lastSyncDirection: 'pull', dueDate: '2026-10-20' };
  const patch = { title: 'GitHub title', syncStatus: 'synced', lastSyncDirection: null };
  assert.deepEqual(mergeExternalRevision(current, 'r1', patch, true), { ...current, ...patch });
  assert.equal(mergeExternalRevision(current, 'r1', patch), undefined);
  assert.equal(mergeExternalRevision({ ...current, lastSyncDirection: 'push' }, 'r1', patch, true), undefined);
  assert.equal(mergeExternalRevision({ ...current, syncStatus: 'pending' }, 'r1', patch, true), undefined);
  assert.equal(mergeExternalRevision({ ...current, updatedAt: 'r2' }, 'r1', patch, true), undefined);
  assert.equal(mergeExternalRevision(null, 'r1', patch, true), undefined);
});
