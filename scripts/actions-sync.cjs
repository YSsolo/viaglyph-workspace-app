// Credentials are supplied by GitHub Actions OIDC / Secrets, never by the browser.
const { workspaceWorker: worker } = require('../functions');
const { recordTransaction } = require('../functions/record-transaction.cjs');
const stamp = () => new Date().toISOString();

async function reconcile() {
  const projectId = process.env.WORKSPACE_SYNC_PROJECT_ID || '';
  if (projectId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error('Invalid acceptance Project ID');
    if (process.env.WORKSPACE_SEND_DIGEST === 'true') throw new Error('A scoped run cannot send a global digest');
    if (!(await worker.db.ref(`pm/projects/${projectId}`).get()).val()) throw new Error('Acceptance Project not found');
  }
  let failures = 0;
  for (const [collection, sync, pull] of [
    ['milestones', worker.syncMilestoneRecord, worker.applyMilestoneWebhook],
    ['tasks', worker.syncTaskRecord, worker.applyIssueWebhook]
  ]) {
    const records = (await worker.db.ref(`pm/${collection}`).get()).val() || {};
    for (const record of Object.values(records)) {
      if (projectId && record.projectId !== projectId) continue;
      const ref = worker.db.ref(`pm/${collection}/${record.id}`);
      const retryingPull = record.syncStatus === 'error' && record.lastSyncDirection === 'pull';
      const direction = record.syncStatus === 'pending' ? 'push'
        : record.syncStatus === 'error' ? (['pull', 'push'].includes(record.lastSyncDirection) ? record.lastSyncDirection : 'unknown') : 'pull';
      try {
        // A legacy failure has no reliable source-of-truth direction. Do not
        // infer it from timestamps or overwrite either side automatically.
        if (direction === 'unknown') throw new Error('Unknown synchronization direction');
        if (direction === 'push') {
          await sync(record);
          // A browser may edit while the network request is in flight. Preserve
          // that newer revision and leave it queued for the next run.
          await ref.transaction(current => current && current.updatedAt !== record.updatedAt
            ? { ...current, syncStatus: 'pending' } : current);
        } else if (record.github?.number) {
          const project = (await worker.db.ref(`pm/projects/${record.projectId}`).get()).val();
          const { owner, repo } = project.github;
          const external = await worker.github(owner, `/repos/${owner}/${repo}/${collection === 'tasks' ? 'issues' : 'milestones'}/${record.github.number}`);
          const latest = (await ref.get()).val();
          const latestPullRetry = retryingPull && latest?.syncStatus === 'error' && latest?.lastSyncDirection === 'pull';
          if (!latest || latest.updatedAt !== record.updatedAt || latest.syncStatus === 'pending'
            || (latest.syncStatus === 'error' && !latestPullRetry)) continue;
          if (retryingPull || !record.externalUpdatedAt || external.updated_at > record.externalUpdatedAt) {
            await pull({ [collection === 'tasks' ? 'issue' : 'milestone']: external, expectedRecordId: record.id, expectedUpdatedAt: record.updatedAt, allowPullRetry: retryingPull, repository: { full_name: `${owner}/${repo}` } });
          }
        }
      } catch (error) {
        failures++;
        // Transport exceptions may echo Authorization headers. Never persist
        // exception text into member-readable database records.
        await recordTransaction(ref, current => {
          if (!current) return undefined;
          if (current.updatedAt !== record.updatedAt) return current;
          return { ...current, syncStatus: 'error', lastSyncDirection: direction,
            lastError: direction === 'unknown'
              ? '旧同期エラーの方向が不明です。TaskとGitHubの内容を確認し、Workspaceの内容を反映する場合はTaskを保存してください。'
              : 'GitHub同期に失敗しました。連携設定を確認して再同期してください。', lastAttemptAt: stamp() };
        });
        // Do not print tokens, request headers, or remote response bodies.
        console.error(`Synchronization failed: ${collection}/${record.id}`);
      }
    }
  }
  // A bounded acceptance run is not evidence of whole-Workspace health.
  await worker.db.ref(projectId ? `pm/acceptanceRuns/${projectId}` : 'pm/integration')
    .update({ mode: 'actions', lastRunAt: stamp(), failures });
  if (failures) process.exitCode = 1;
}

async function digest() {
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const weekday = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' });
  if (['Sat', 'Sun'].includes(weekday)) return;
  const settings = (await worker.db.ref('pm/settings').get()).val() || {};
  if (!settings.slackChannel) return;
  if ((await worker.db.ref(`pm/digests/${date}`).get()).exists()) return;
  if (!process.env.SLACK_BOT_TOKEN) throw new Error('Slack credential is missing');
  const tasks = Object.values((await worker.db.ref('pm/tasks').get()).val() || {});
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const active = tasks.filter(task => task.status !== 'done');
  const groups = [
    ['期限超過', active.filter(t => t.dueDate && t.dueDate < date)],
    ['今日・明日', active.filter(t => t.dueDate >= date && t.dueDate <= tomorrow)],
    ['Blocked', active.filter(t => t.status === 'blocked')],
    ['Review停滞', active.filter(t => t.status === 'review' && Date.parse(t.updatedAt || t.createdAt) < Date.now() - 172800000)],
    ['同期失敗', tasks.filter(t => t.syncStatus === 'error')]
  ];
  const text = ['ViaGLYPH 日次要対応', ...groups.filter(([, rows]) => rows.length).map(([name, rows]) => `${name}\n${rows.map(t => `• ${t.title}`).join('\n')}`)].join('\n\n');
  if (!groups.some(([, rows]) => rows.length)) return;
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: settings.slackChannel, text })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Slack digest failed');
  await worker.db.ref(`pm/digests/${date}`).set({ sentAt: stamp(), messageTs: result.ts });
}

(async () => {
  try {
    await reconcile();
    if (process.env.WORKSPACE_SEND_DIGEST === 'true') await digest();
  } catch (_) { console.error('Workspace worker failed. Check credential and database configuration.'); process.exitCode = 1; }
  finally { await worker.shutdown(); }
})();
