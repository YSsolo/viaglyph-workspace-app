// Populate the native transaction cache before applying a guarded update.
async function recordTransaction(ref, update) {
  let listener;
  try {
    await new Promise((resolve, reject) => {
      listener = () => resolve();
      ref.on('value', listener, reject);
    });
    return await ref.transaction(update, undefined, false);
  } finally {
    ref.off('value', listener);
  }
}

module.exports = { recordTransaction };
