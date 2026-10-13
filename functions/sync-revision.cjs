// Returning undefined aborts a Firebase transaction instead of writing stale data.
function mergeExternalRevision(current, expectedUpdatedAt, patch, allowPullRetry = false) {
  const retryingPull = allowPullRetry && current?.syncStatus === 'error' && current?.lastSyncDirection === 'pull';
  if (!current || current.updatedAt !== expectedUpdatedAt || current.syncStatus === 'pending'
    || (current.syncStatus === 'error' && !retryingPull)) return undefined;
  return { ...current, ...patch };
}
module.exports = { mergeExternalRevision };
