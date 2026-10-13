const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordTransaction } = require('../functions/record-transaction.cjs');

function reference(failure) {
  const unrelated = () => {};
  const listeners = new Set([unrelated]);
  const events = [];
  let ready = false;
  return { listeners, unrelated, events, ref: {
    on: (event, listener, reject) => {
      assert.equal(event, 'value');
      listeners.add(listener);
      events.push('subscribe');
      if (failure === 'subscribe') throw new Error('SYNTHETIC_SUBSCRIBE_FAILURE');
      queueMicrotask(() => {
        if (failure === 'cancel') reject(new Error('SYNTHETIC_CANCEL_FAILURE'));
        else { ready = true; events.push('value'); listener(); }
      });
    },
    off: (event, listener) => { assert.equal(event, 'value'); listeners.delete(listener); events.push('unsubscribe'); },
    transaction: async (update, complete, applyLocally) => {
      assert.equal(ready, true);
      assert.equal(complete, undefined);
      assert.equal(applyLocally, false);
      events.push('transaction');
      if (failure === 'transaction') throw new Error('SYNTHETIC_TRANSACTION_FAILURE');
      return { committed: true, value: update({ revision: 'r1' }) };
    }
  } };
}

test('record transactions await cache population and preserve unrelated listeners', async () => {
  const sample = reference();
  const result = await recordTransaction(sample.ref, current => ({ ...current, status: 'error' }));
  assert.deepEqual(result, { committed: true, value: { revision: 'r1', status: 'error' } });
  assert.deepEqual(sample.events, ['subscribe', 'value', 'transaction', 'unsubscribe']);
  assert.deepEqual([...sample.listeners], [sample.unrelated]);
});

for (const failure of ['subscribe', 'cancel', 'transaction']) {
  test(`record transaction releases its listener after ${failure} failure`, async () => {
    const sample = reference(failure);
    await assert.rejects(recordTransaction(sample.ref, current => current), /SYNTHETIC_.*_FAILURE/);
    assert.deepEqual([...sample.listeners], [sample.unrelated]);
    assert.equal(sample.events.at(-1), 'unsubscribe');
    if (failure !== 'transaction') assert.equal(sample.events.includes('transaction'), false);
  });
}
