// Returning undefined aborts a Firebase transaction instead of writing stale data.
function mergeExternalRevision(current, expectedUpdatedAt, patch) {
  if (!current || current.updatedAt !== expectedUpdatedAt || ['pending', 'error'].includes(current.syncStatus)) return undefined;
  return { ...current, ...patch };
}
module.exports = { mergeExternalRevision };
