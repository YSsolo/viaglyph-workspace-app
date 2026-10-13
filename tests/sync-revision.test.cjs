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
