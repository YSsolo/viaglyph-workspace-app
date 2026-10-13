const test = require('node:test');
const assert = require('node:assert/strict');

// Read-only acceptance checks against the named production project. No member
// tokens are obtained, stored, printed, or needed for these rejection checks.
const database = 'https://viaglyph-workspace-default-rtdb.firebaseio.com';

test('production RTDB rejects unauthenticated PM, Canvas and Work Log reads', async () => {
  for (const node of ['pm', 'canvases', 'workLogs']) {
    const response = await fetch(`${database}/${node}.json`, { signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    assert.ok([401, 403].includes(response.status), `${node}: unauthenticated HTTP ${response.status}`);
  }
});

test('production RTDB rejects an invalid authentication token', async () => {
  const response = await fetch(`${database}/pm.json?auth=invalid-test-token-not-a-credential`, { signal: AbortSignal.timeout(15000) });
  await response.body?.cancel();
  assert.ok([401, 403].includes(response.status), `invalid authentication: HTTP ${response.status}`);
});
