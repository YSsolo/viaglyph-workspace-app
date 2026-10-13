const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { mergeExternalRevision } = require('./sync-revision.cjs');
const { recordTransaction } = require('./record-transaction.cjs');
const ALLOWED_ORIGINS = new Set([
  'https://viaglyph-workspace.web.app',
  'https://viaglyph-workspace.firebaseapp.com'
]);

// Hosting is the production entrypoint. Local origins are intentionally kept for
// developer tooling only; arbitrary web origins must never receive API access.
const cors = require("cors")({
  origin(origin, callback) {
    const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    callback(null, !origin || ALLOWED_ORIGINS.has(origin) || localOrigin);
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 3600
});

if (!admin.apps.length) admin.initializeApp(process.env.WORKSPACE_DATABASE_URL ? { databaseURL: process.env.WORKSPACE_DATABASE_URL } : undefined);
const db = admin.database();

const slackBotToken = defineSecret("SLACK_BOT_TOKEN");
const githubTokenGandT = defineSecret("GITHUB_TOKEN_GANDT");
const githubTokenYSsolo = defineSecret("GITHUB_TOKEN_YSSOLO");
const githubTokenShota656 = defineSecret("GITHUB_TOKEN_SHOTA656");
const githubWebhookSecret = defineSecret("GITHUB_WEBHOOK_SECRET");

const GITHUB_MEMBERS = {
  '174987576': { short: '山口', login: 'YSsolo', emoji: '🌿' },
  '19548351': { short: '村山', login: 'GandT', emoji: '💎' },
  '286001688': { short: '市川', login: 'shota656', emoji: '🔥' }
};
const STATUS_LABELS = {
  backlog: 'workspace:backlog', todo: 'workspace:todo', in_progress: 'workspace:in-progress',
  review: 'workspace:review', blocked: 'workspace:blocked', done: 'workspace:done'
};
const LABEL_STATUS = Object.fromEntries(Object.entries(STATUS_LABELS).map(([status, label]) => [label, status]));

function getSlackToken() {
  try {
    if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
    const val = slackBotToken.value();
    if (val) return val;
  } catch (e) {
    // Secret is not available in local environment without params setup
  }
  return null;
}

/**
 * Validates webhook URLs to prevent Server-Side Request Forgery (SSRF).
 * Allows only secure HTTPS requests to trusted domains (Slack, Discord).
 */
function isValidWebhookUrl(webhookUrl) {
  if (typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
    return false;
  }
  try {
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();

    // Reject localhost and IP addresses (loopback, private, cloud metadata)
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname === '::1' ||
      hostname.startsWith('fe80:') ||
      hostname.startsWith('fc00:') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
    ) {
      return false;
    }

    const allowedDomains = [
      'hooks.slack.com',
      'discord.com',
      'discordapp.com'
    ];

    return allowedDomains.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch (err) {
    return false;
  }
}

/**
 * HTTP onRequest Endpoint: sendSlackMessage
 * Proxies messages to Slack Webhook / Slack API (chat.postMessage) or custom Webhook URLs (e.g. Discord).
 */
exports.sendSlackMessage = memberCors(async (req, res) => {
    await requireMember(req);

    const { channel, messagePayload, message, text, webhookUrl, payload } = req.body || {};
    const targetPayload = messagePayload || message || payload || text;

    // Webhook URL specified (Discord or custom Slack Webhook)
    if (webhookUrl) {
      if (!isValidWebhookUrl(webhookUrl)) {
        return res.status(400).json({ success: false, error: "Invalid or unauthorized webhook URL" });
      }
      try {
        const bodyContent = typeof targetPayload === 'string'
          ? { content: targetPayload, text: targetPayload }
          : (targetPayload || { text: "" });

        const fetchRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyContent)
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          return res.status(400).json({ success: false, error: `Webhook error: HTTP ${fetchRes.status}`, details: errText });
        }
        return res.json({ success: true, response: { ok: true } });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (!channel || !targetPayload) {
      return res.status(400).json({ success: false, error: "必要なパラメータが不足しています (channel, messagePayload)" });
    }

    try {
      const token = getSlackToken();
      if (!token) {
        return res.status(500).json({ success: false, error: "SLACK_BOT_TOKEN is not configured" });
      }
      const msgText = typeof targetPayload === 'string' ? targetPayload : (targetPayload.text || '');
      const msgBlocks = (typeof targetPayload === 'object' && targetPayload !== null) ? targetPayload.blocks : undefined;

      const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          channel: channel,
          text: msgText,
          blocks: msgBlocks
        })
      });

      const data = await slackRes.json();
      if (!data.ok) {
        return res.status(400).json({ success: false, error: data.error || 'Slack API error', response: data });
      }
      return res.json({ success: true, response: data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
}, [slackBotToken]);

/**
 * HTTP onRequest Endpoint: createSlackCanvas
 * Creates a Slack Canvas document and notifies the channel.
 */
exports.createSlackCanvas = memberCors(async (req, res) => {
    await requireMember(req);

    const { channel, channel_id, title, markdown, content } = req.body || {};
    const targetChannel = channel || channel_id;
    const targetMarkdown = markdown || content;

    if (!targetChannel || !title || !targetMarkdown) {
      return res.status(400).json({ success: false, error: "必要なパラメータが不足しています (channel, title, markdown)" });
    }

    try {
      const token = getSlackToken();
      if (!token) {
        return res.status(500).json({ success: false, error: "SLACK_BOT_TOKEN is not configured" });
      }

      // 1. Call Slack Canvas creation API
      const canvasRes = await fetch("https://slack.com/api/canvases.create", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          title: title,
          document_content: {
            type: "markdown",
            markdown: targetMarkdown
          },
          channel_id: targetChannel
        })
      });

      const parsed = await canvasRes.json();
      if (!parsed.ok) {
        return res.status(400).json({ success: false, error: parsed.error || 'Slack Canvas作成に失敗しました', response: parsed });
      }

      // 2. Send notification to the channel
      try {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({
            channel: targetChannel,
            text: `✨ 新しい会議キャンバス「${title}」を作成しました！\nチャンネル上部のタブから確認してください。`
          })
        });
      } catch (notifyErr) {
        console.warn("Canvas created but notification failed:", notifyErr);
      }

      return res.json({
        success: true,
        canvasId: parsed.canvas_id || (parsed.canvas && parsed.canvas.id),
        response: parsed
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
}, [slackBotToken]);

// ─── PM v2: authenticated GitHub synchronization ───
function getGitHubToken(owner) {
  try {
    if (owner === 'GandT') return process.env.GITHUB_TOKEN_GANDT || githubTokenGandT.value();
    if (owner === 'YSsolo') return process.env.GITHUB_TOKEN_YSSOLO || githubTokenYSsolo.value();
    if (owner === 'shota656') return process.env.GITHUB_TOKEN_SHOTA656 || githubTokenShota656.value();
  } catch (_) {}
  return null;
}

async function requireMember(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new Error('Authentication required');
  const decoded = await admin.auth().verifyIdToken(header.slice(7));
  if (decoded.workspaceMember !== true) throw new Error('Workspace membership is required');
  return decoded;
}

async function github(owner, path, options = {}) {
  const token = getGitHubToken(owner);
  if (!token) throw new Error(`GitHub token is not configured for ${owner}`);
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub API HTTP ${response.status}`);
  return data;
}

function githubAssignees(task) {
  return (task.assignees || []).map(short => Object.values(GITHUB_MEMBERS).find(member => member.short === short)?.login).filter(Boolean);
}

async function ensureStatusLabels(owner, repo) {
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    try {
      await github(owner, `/repos/${owner}/${repo}/labels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label, color: status === 'blocked' ? 'b91c1c' : status === 'done' ? '166534' : '2563eb', description: 'Managed by ViaGLYPH Workspace' })
      });
    } catch (error) {
      if (!String(error.message).includes('already_exists') && !String(error.message).includes('Validation Failed')) throw error;
    }
  }
}

async function syncMilestoneRecord(milestone) {
  const projectSnap = await db.ref(`pm/projects/${milestone.projectId}`).get();
  const project = projectSnap.val();
  if (!project?.github?.owner || !project?.github?.repo) throw new Error('Project repository is not configured');
  const { owner, repo } = project.github;
  const payload = { title: milestone.name, due_on: milestone.dueDate ? `${milestone.dueDate}T23:59:59Z` : null, state: milestone.status === 'closed' ? 'closed' : 'open' };
  if (!milestone.github?.number) {
    const marker = `<!-- viaglyph-milestone:${milestone.id} -->`;
    payload.description = marker;
    for (let page = 1; ; page++) {
      const items = await github(owner, `/repos/${owner}/${repo}/milestones?state=all&per_page=100&page=${page}`);
      const recovered = items.find(item => (item.description || '').includes(marker));
      if (recovered) {
        milestone = { ...milestone, github: { number: recovered.number } };
        delete payload.description;
        break;
      }
      if (items.length < 100) break;
    }
  }
  const result = milestone.github?.number
    ? await github(owner, `/repos/${owner}/${repo}/milestones/${milestone.github.number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    : await github(owner, `/repos/${owner}/${repo}/milestones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await recordTransaction(db.ref(`pm/milestones/${milestone.id}`), current => current
    ? { ...current, github: { number: result.number, url: result.html_url }, syncStatus: 'synced', lastSyncedAt: new Date().toISOString(), lastError: null }
    : undefined);
  return result;
}

async function syncTaskRecord(task) {
  const [projectSnap, milestoneSnap] = await Promise.all([db.ref(`pm/projects/${task.projectId}`).get(), db.ref(`pm/milestones/${task.milestoneId}`).get()]);
  const project = projectSnap.val(); let milestone = milestoneSnap.val();
  if (!project?.github?.owner || !project?.github?.repo) throw new Error('Project repository is not configured');
  if (milestone && milestone.projectId !== task.projectId) throw new Error('Task Milestone must belong to its Project');
  const { owner, repo } = project.github;
  if (milestone && !milestone.github?.number) { await syncMilestoneRecord(milestone); milestone = (await db.ref(`pm/milestones/${task.milestoneId}`).get()).val(); }
  await ensureStatusLabels(owner, repo);
  const existing = task.github?.number ? await github(owner, `/repos/${owner}/${repo}/issues/${task.github.number}`) : null;
  const labels = [...(existing?.labels || []).map(label => label.name).filter(name => !name.startsWith('workspace:')), STATUS_LABELS[task.status] || STATUS_LABELS.backlog];
  const payload = { title: task.title, body: task.description || '', assignees: githubAssignees(task), labels, milestone: milestone?.github?.number || null, state: task.status === 'done' ? 'closed' : 'open' };
  // Recover an Issue created before an interrupted RTDB write. The marker is
  // stable across retries and is never based on the Task title.
  const marker = `<!-- viaglyph-task:${task.id} -->`;
  payload.body = `${task.description || ''}\n\n${marker}`;
  if (!task.github?.number) {
    for (let page = 1; ; page++) {
      const issues = await github(owner, `/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`);
      const recovered = issues.find(issue => !issue.pull_request && (issue.body || '').includes(marker));
      if (recovered) { task = { ...task, github: { number: recovered.number } }; break; }
      if (issues.length < 100) break;
    }
  }
  const result = task.github?.number
    ? await github(owner, `/repos/${owner}/${repo}/issues/${task.github.number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    : await github(owner, `/repos/${owner}/${repo}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await recordTransaction(db.ref(`pm/tasks/${task.id}`), current => current
    ? { ...current, github: { number: result.number, url: result.html_url }, syncStatus: 'synced', lastSyncedAt: new Date().toISOString(), lastError: null, externalUpdatedAt: result.updated_at }
    : undefined);
  return result;
}

function memberCors(handler, secrets) {
  return onRequest({ secrets }, (req, res) => cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    try {
      await handler(req, res);
    } catch (error) {
      const message = String(error?.message || 'Workspace API error');
      const forbidden = message === 'Authentication required' || message === 'Workspace membership is required' || message.includes('not allowed');
      const unavailable = message.includes('is not configured');
      return res.status(forbidden ? 403 : unavailable ? 503 : 400).json({
        error: unavailable ? 'A required Workspace integration is not configured.'
          : forbidden ? 'Workspace access is not permitted.'
          : 'Workspace request failed. Check integration settings and retry.',
        code: forbidden ? 'WORKSPACE_FORBIDDEN' : unavailable ? 'WORKSPACE_INTEGRATION_UNAVAILABLE' : 'WORKSPACE_REQUEST_INVALID'
      });
    }
  }));
}

/** Establishes the Firebase custom claim after GitHub OAuth login. */
exports.establishWorkspaceSession = memberCors(async (req, res) => {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new Error('Authentication required');
  const decoded = await admin.auth().verifyIdToken(header.slice(7));
  const githubId = String(decoded.firebase?.identities?.['github.com']?.[0] || '');
  const member = GITHUB_MEMBERS[githubId];
  if (!member || req.body?.githubId !== githubId) throw new Error('This GitHub account is not allowed');
  await admin.auth().setCustomUserClaims(decoded.uid, { workspaceMember: true, githubId, short: member.short });
  return res.json({ success: true, member: { short: member.short, login: member.login } });
}, []);

exports.syncTaskToGitHub = memberCors(async (req, res) => {
  await requireMember(req);
  const taskId = String(req.body?.taskId || '');
  const task = (await db.ref(`pm/tasks/${taskId}`).get()).val();
  if (!task) throw new Error('Task not found');
  const result = await syncTaskRecord(task);
  return res.json({ success: true, issue: { number: result.number, url: result.html_url } });
}, [githubTokenGandT, githubTokenYSsolo, githubTokenShota656]);

exports.syncMilestoneToGitHub = memberCors(async (req, res) => {
  await requireMember(req);
  const milestoneId = String(req.body?.milestoneId || '');
  const milestone = (await db.ref(`pm/milestones/${milestoneId}`).get()).val();
  if (!milestone) throw new Error('Milestone not found');
  const result = await syncMilestoneRecord(milestone);
  return res.json({ success: true, milestone: { number: result.number, url: result.html_url } });
}, [githubTokenGandT, githubTokenYSsolo, githubTokenShota656]);

function validWebhook(req) {
  let secret = null; try { secret = process.env.GITHUB_WEBHOOK_SECRET || githubWebhookSecret.value(); } catch (_) {}
  const signature = String(req.headers['x-hub-signature-256'] || '');
  if (!secret || !signature || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function applyExternalRevision(ref, expectedUpdatedAt, patch, allowPullRetry = false) {
  return recordTransaction(ref, current => mergeExternalRevision(current, expectedUpdatedAt, patch, allowPullRetry));
}

async function applyIssueWebhook(payload) {
  const issue = payload.issue; const repository = payload.repository;
  const tasks = (await db.ref('pm/tasks').get()).val() || {};
  const task = Object.values(tasks).find(item =>
    (payload.expectedRecordId === undefined || item?.id === payload.expectedRecordId)
    && item?.github?.number === issue.number && item?.github?.url === issue.html_url);
  if (!task) return;
  const labels = (issue.labels || []).map(label => label.name);
  let status = labels.map(label => LABEL_STATUS[label]).find(Boolean);
  if (issue.state === 'closed') status = 'done';
  if (issue.state === 'open' && (!status || status === 'done')) status = labels.map(label => LABEL_STATUS[label]).find(value => value && value !== 'done') || 'todo';
  const assignees = (issue.assignees || []).map(person => Object.values(GITHUB_MEMBERS).find(member => member.login === person.login)?.short).filter(Boolean);
  const projects = (await db.ref('pm/projects').get()).val() || {};
  const milestones = (await db.ref('pm/milestones').get()).val() || {};
  const project = projects[task.projectId];
  const milestone = Object.values(milestones).find(item => item?.projectId === task.projectId && item?.github?.number === issue.milestone?.number);
  const sameRepository = project && `${project.github?.owner}/${project.github?.repo}`.toLowerCase() === repository.full_name.toLowerCase();
  if (!sameRepository) return;
  const patch = { title: issue.title, status, assignees, milestoneId: milestone?.id || task.milestoneId, externalUpdatedAt: issue.updated_at, syncStatus: 'synced', lastSyncedAt: new Date().toISOString(), lastError: null, updatedAt: new Date().toISOString(), updatedBy: `GitHub/${repository.full_name}` };
  patch.completedAt = status === 'done'
    ? (task.status === 'done' ? task.completedAt || null
      : (typeof issue.closed_at === 'string' && Number.isFinite(Date.parse(issue.closed_at)) ? issue.closed_at : null)) : null;
  // GitHub exposes no label-entry instant; track first observed Review residence.
  patch.reviewStartedAt = status === 'review'
    ? (task.status === 'review' ? task.reviewStartedAt || new Date().toISOString() : new Date().toISOString()) : null;
  patch.lastSyncDirection = null;
  if (payload.expectedUpdatedAt !== undefined) {
    await applyExternalRevision(db.ref(`pm/tasks/${task.id}`), payload.expectedUpdatedAt, patch, payload.allowPullRetry === true);
  } else {
    await db.ref(`pm/tasks/${task.id}`).update(patch);
  }
}

async function applyMilestoneWebhook(payload) {
  const milestone = payload.milestone; const repository = payload.repository;
  const milestones = (await db.ref('pm/milestones').get()).val() || {};
  const projects = (await db.ref('pm/projects').get()).val() || {};
  const record = Object.values(milestones).find(item =>
    (payload.expectedRecordId === undefined || item?.id === payload.expectedRecordId)
    && item?.github?.number === milestone.number && `${projects[item.projectId]?.github?.owner}/${projects[item.projectId]?.github?.repo}`.toLowerCase() === repository.full_name.toLowerCase());
  if (!record) return;
  const patch = { name: milestone.title, dueDate: milestone.due_on ? milestone.due_on.slice(0,10) : '', status: milestone.state === 'closed' ? 'closed' : 'open', externalUpdatedAt: milestone.updated_at, syncStatus: 'synced', updatedAt: new Date().toISOString(), updatedBy: `GitHub/${repository.full_name}` };
  patch.lastSyncDirection = null;
  patch.lastError = null;
  if (payload.expectedUpdatedAt !== undefined) {
    await applyExternalRevision(db.ref(`pm/milestones/${record.id}`), payload.expectedUpdatedAt, patch, payload.allowPullRetry === true);
  } else {
    await db.ref(`pm/milestones/${record.id}`).update(patch);
  }
}

/** Receives GitHub issue and milestone webhooks with signature and delivery de-duplication. */
exports.githubWebhook = onRequest({ secrets: [githubWebhookSecret] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (!validWebhook(req)) return res.status(401).send('Invalid signature');
  const delivery = String(req.headers['x-github-delivery'] || '');
  if (!delivery) return res.status(400).send('Missing delivery id');
  const ref = db.ref(`pm/webhookDeliveries/${delivery}`);
  if ((await ref.get()).exists()) return res.status(202).json({ duplicate: true });
  await ref.set({ receivedAt: new Date().toISOString(), event: req.headers['x-github-event'] || '' });
  try {
    if (req.headers['x-github-event'] === 'issues') await applyIssueWebhook(req.body);
    if (req.headers['x-github-event'] === 'milestone') await applyMilestoneWebhook(req.body);
    return res.json({ success: true });
  } catch (error) { await ref.update({ error: error.message }); return res.status(400).json({ error: error.message }); }
});

// Shared server-only operations used by the Spark-compatible Actions worker.
exports.workspaceWorker = { db, github, syncTaskRecord, syncMilestoneRecord, applyIssueWebhook, applyMilestoneWebhook, shutdown: () => admin.app().delete() };

/** Reconciles pending and failed synchronization records every fifteen minutes. */
exports.reconcileGitHub = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Tokyo', secrets: [githubTokenGandT, githubTokenYSsolo, githubTokenShota656] }, async () => {
  const [tasksSnap, milestonesSnap] = await Promise.all([db.ref('pm/tasks').get(), db.ref('pm/milestones').get()]);
  for (const milestone of Object.values(milestonesSnap.val() || {})) if (['pending','error'].includes(milestone.syncStatus)) { try { await syncMilestoneRecord(milestone); } catch (error) { await db.ref(`pm/milestones/${milestone.id}`).update({ syncStatus: 'error', lastError: 'GitHub同期に失敗しました。連携設定を確認して再同期してください。' }); } }
  for (const task of Object.values(tasksSnap.val() || {})) if (['pending','error'].includes(task.syncStatus)) { try { await syncTaskRecord(task); } catch (error) { await db.ref(`pm/tasks/${task.id}`).update({ syncStatus: 'error', lastError: 'GitHub同期に失敗しました。連携設定を確認して再同期してください。' }); } }
});

/** Sends one weekday morning digest for all team PM alerts. */
exports.sendPmDigest = onSchedule({ schedule: '0 9 * * 1-5', timeZone: 'Asia/Tokyo', secrets: [slackBotToken] }, async () => {
  const [tasksSnap, settingsSnap] = await Promise.all([db.ref('pm/tasks').get(), db.ref('pm/settings').get()]);
  const channel = settingsSnap.val()?.slackChannel; if (!channel) return;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const tasks = Object.values(tasksSnap.val() || {}).filter(task => task.status !== 'done');
  const reviewLimit = Date.now() - 48 * 60 * 60 * 1000;
  const groups = [['期限超過', tasks.filter(t => t.dueDate && t.dueDate < today)], ['今日・明日', tasks.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= tomorrow)], ['Blocked', tasks.filter(t => t.status === 'blocked')], ['Review停滞', tasks.filter(t => t.status === 'review' && new Date(t.updatedAt || t.createdAt).getTime() < reviewLimit)], ['同期失敗', tasks.filter(t => t.syncStatus === 'error')]];
  if (!groups.some(([, items]) => items.length)) return;
  const text = ['📌 ViaGLYPH PM 日次要対応', ...groups.filter(([,items]) => items.length).map(([label, items]) => `\n*${label}*\n${items.map(t => `• ${t.title}${t.dueDate ? `（${t.dueDate}）` : ''}`).join('\n')}`)].join('\n');
  const token = getSlackToken(); if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');
  const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, text }) });
  const data = await response.json(); if (!data.ok) throw new Error(data.error || 'Slack API error');
});
