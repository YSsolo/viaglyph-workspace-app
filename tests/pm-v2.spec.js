const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const fixture = {
  projects: { p1: { id: 'p1', name: 'ViaGLYPH Garage', status: 'active', github: { owner: 'GandT', repo: 'vgl-developers' } } },
  milestones: { m1: { id: 'm1', projectId: 'p1', name: '初回デモ', dueDate: '2026-09-20', status: 'open', successCriteria: 'デモを実演できる' } },
  tasks: {
    t1: { id: 't1', projectId: 'p1', milestoneId: 'm1', title: 'デモ台本を作る', status: 'todo', assignees: ['山口'], dueDate: '2026-09-18', priority: 'high', syncStatus: 'synced', createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z' },
    t2: { id: 't2', projectId: 'p1', milestoneId: 'm1', title: 'API契約を確認する', status: 'blocked', assignees: ['村山'], dueDate: '2026-09-15', priority: 'high', syncStatus: 'error', lastError: 'GitHub token is not configured', createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' }
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__VG_TEST_AUTH__ = { short: '山口', emoji: '🌿' }; });
  await page.goto('/');
  await page.click('#login-btn');
  await page.evaluate((data) => {
    window.PM.state = { ...window.PM.state, ...data, settings: {}, ready: true };
    window.PM.renderAll();
  }, fixture);
});

test('Dashboard shows COO action buckets and project health', async ({ page }) => {
  await expect(page.locator('#pm-dashboard')).toContainText('PM Dashboard');
  await expect(page.locator('#pm-dashboard')).toContainText('期限超過');
  await expect(page.locator('#pm-dashboard')).toContainText('Blocked');
  await expect(page.locator('#pm-dashboard')).toContainText('Review 48h+');
  await expect(page.locator('#pm-dashboard')).toContainText('ViaGLYPH Garage');
  await expect(page.locator('#pm-dashboard')).toContainText('同期失敗');
});

test('Dashboard Blocked card filters Tasks and clearing it restores the full list', async ({ page }) => {
  await page.click('#pm-dashboard .pm-alert:has-text("Blocked")');
  await expect(page.locator('#pm-tasks .pm-task-list')).toContainText('API契約を確認する');
  await expect(page.locator('#pm-tasks .pm-task-list')).not.toContainText('デモ台本を作る');
  await page.click('#pm-tasks button:has-text("絞り込みを解除")');
  await expect(page.locator('#pm-tasks .pm-task-list')).toContainText('デモ台本を作る');
});

test('Task requires owner and due date after leaving backlog', async ({ page }) => {
  await page.click('#pm-dashboard button:has-text("＋ Task")');
  await page.fill('#pm-task-title', '新しい実行Task');
  await page.selectOption('#pm-task-project', 'p1');
  await page.selectOption('#pm-task-milestone', 'm1');
  await page.selectOption('#pm-task-status', 'todo');
  await page.click('#pm-task-modal button:has-text("保存してIssue化")');
  await expect(page.locator('#toast')).toContainText('Todo以降は担当者と期限が必須です');
});

test('Migration preview identifies projects, milestones and tasks without writing data', async ({ page }) => {
  await page.evaluate(() => {
    window.goals = [{ id: 1, name: '旧Project', bigGoals: [{ id: 2, name: '旧Milestone', midGoals: [{ id: 3, name: '旧グループ', tasks: [{ id: 4, name: '旧Task', done: false, assign: '山口' }] }] }] }];
    window.DATA = { dev: { tasks: [] }, biz: { tasks: [] } };
    window.localTasks = [];
    const legacy = { goals: window.goals, tasks: { dev: {}, biz: {} }, workLogs: {} };
    window.firebaseDb = { ref: path => ({ get: async () => ({ val: () => legacy[path] }) }) };
  });
  await page.evaluate(() => window.PM.openMigration());
  await expect(page.locator('#pm-migration-preview')).toContainText('1 Project、1 Milestone、1 Task');
});

test('Projects and Tasks screens preserve PM records and direct-mode status', async ({ page }) => {
  await page.evaluate(() => {
    window.WORKSPACE_SYNC_MODE = 'functions';
    localStorage.setItem('vg_session', JSON.stringify({ short: '山口', emoji: '🌿', sessionMode: 'direct' }));
    window.PM.renderAll();
  });
  await expect(page.locator('#pm-dashboard')).toContainText('GitHub連携を準備中');
  await expect(page.locator('#pm-dashboard button:has-text("接続を再試行")')).toBeVisible();
  await page.click('#pm-dashboard button:has-text("＋ Task")');
  await expect(page.locator('#pm-task-save-button')).toHaveText('保存（GitHub連携待ち）');
  await page.click('#pm-task-modal button:has-text("キャンセル")');

  await page.click('[data-view="goals"]');
  await expect(page.locator('#pm-projects')).toContainText('ViaGLYPH Garage');
  await page.click('#pm-projects button:has-text("詳細")');
  await expect(page.locator('#pm-project-detail')).toContainText('初回デモ');

  await page.click('[data-view="kanban"]');
  await expect(page.locator('#pm-tasks')).toContainText('デモ台本を作る');
  await expect(page.locator('#pm-tasks')).toContainText('API契約を確認する');
  await expect(page.locator('#pm-tasks')).toContainText('再同期');
});

test('Task form creates one formal Task with Project, Milestone and meeting source', async ({ page }) => {
  await page.evaluate(() => {
    window.__pmWrites = [];
    window.firebaseDb = {
      ref(path) {
        return {
          set: async value => window.__pmWrites.push({ method: 'set', path, value }),
          update: async value => window.__pmWrites.push({ method: 'update', path, value })
        };
      }
    };
    window.PM.syncTask = async () => {};
  });
  await page.evaluate(() => window.PM.openTaskModal());
  await page.fill('#pm-task-title', '会議から作る正式Task');
  await page.selectOption('#pm-task-project', 'p1');
  await page.selectOption('#pm-task-milestone', 'm1');
  await page.selectOption('#pm-task-status', 'todo');
  await page.locator('#pm-task-assignees [data-member="山口"]').click();
  await page.fill('#pm-task-due', '2026-09-25');
  await page.fill('#pm-task-description', '受入確認を行う');
  await page.evaluate(() => window.PM.saveTask({
    title: '会議から作る正式Task', projectId: 'p1', milestoneId: 'm1', status: 'todo',
    assignees: ['山口'], dueDate: '2026-09-25', priority: 'high',
    description: '受入確認を行う', sourceMeetingId: 'meeting-001', silent: true
  }));

  const write = await page.evaluate(() => window.__pmWrites.find(item => item.path.startsWith('pm/tasks/')));
  expect(write.method).toBe('set');
  expect(write.value).toMatchObject({
    projectId: 'p1', milestoneId: 'm1', title: '会議から作る正式Task',
    status: 'todo', assignees: ['山口'], dueDate: '2026-09-25', sourceMeetingId: 'meeting-001'
  });
});

test('Duplicate clicks while a Task save is pending write one formal Task', async ({ page }) => {
  await page.evaluate(() => {
    window.__writes = [];
    window.firebaseDb = { ref: path => ({ set: value => {
      window.__writes.push({ path, value });
      return new Promise(resolve => { window.__finishTaskSave = resolve; });
    } }) };
    window.PM.syncTask = async () => {};
    window.PM.openTaskModal(null, 'p1', 'm1');
  });
  await page.fill('#pm-task-title', '二重保存の確認');
  await page.evaluate(() => {
    document.getElementById('pm-task-save-button').click();
    document.getElementById('pm-task-save-button').click();
  });
  expect(await page.evaluate(() => window.__writes.length)).toBe(1);
  await expect(page.locator('#pm-task-save-button')).toBeDisabled();
  await page.evaluate(() => window.__finishTaskSave());
  await expect(page.locator('#pm-task-modal')).not.toHaveClass(/open/);
  await expect(page.locator('#pm-task-save-button')).toBeEnabled();
});

test('Retry after a lost Task save acknowledgement retains the creation ID', async ({ page }) => {
  await page.evaluate(() => {
    window.__writePaths = [];
    window.firebaseDb = { ref: path => ({ set: async () => {
      window.__writePaths.push(path);
      if (window.__writePaths.length === 1) throw new Error('acknowledgement lost');
    } }) };
    window.PM.syncTask = async () => {};
    window.PM.openTaskModal(null, 'p1', 'm1');
  });
  await page.fill('#pm-task-title', '再試行しても同じTask');
  await page.click('#pm-task-save-button');
  await expect(page.locator('#toast')).toContainText('Taskを保存できませんでした');
  await expect(page.locator('#pm-task-save-button')).toBeEnabled();
  await page.click('#pm-task-save-button');
  const paths = await page.evaluate(() => window.__writePaths);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toBe(paths[1]);
});

test('Milestone approval stays blocked until every Task is done', async ({ page }) => {
  await page.evaluate(() => {
    window.__pmWrites = [];
    window.firebaseDb = { ref: path => ({ update: async value => window.__pmWrites.push({ path, value }) }) };
    window.PM.syncMilestone = async () => {};
  });
  await page.evaluate(() => window.PM.approveMilestone('m1'));
  await expect(page.locator('#toast')).toContainText('すべてのTaskを完了してから承認してください');

  await page.evaluate(() => {
    window.PM.state.tasks.t1.status = 'done';
    window.PM.state.tasks.t2.status = 'done';
    return window.PM.approveMilestone('m1');
  });
  const update = await page.evaluate(() => window.__pmWrites[0]);
  expect(update.path).toBe('pm/milestones/m1');
  expect(update.value.status).toBe('closed');
  expect(update.value.approvedBy).toBe('山口');
});

test('uses same-tab GitHub redirect and permits the Functions origin in CSP', () => {
  const root = path.resolve(__dirname, '..');
  const pmSource = fs.readFileSync(path.join(root, 'pm.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const functions = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8');
  expect(pmSource).toContain('signInWithRedirect(provider)');
  expect(pmSource).not.toContain('signInWithPopup(provider)');
  expect(pmSource).toContain('getRedirectResult()');
  expect(html).toContain('https://*.cloudfunctions.net');
  expect(html).toContain('runtime-config.js');
  expect(functions).toContain('exports.sendSlackMessage = memberCors');
  expect(functions).toContain('exports.createSlackCanvas = memberCors');
  expect(functions).toContain("Authorization', 'Content-Type'");
  expect(rules).toContain("firebase.identities['github.com'][0]");
  expect(rules).toContain('174987576');
  expect(html).toContain('legacy-insecure-integrations');
});

test('Settings exposes only the server-managed PM notification configuration', async ({ page }) => {
  await page.evaluate(() => window.setView('settings'));
  await expect(page.locator('#pm-settings-card')).toContainText('共通SlackチャンネルID');
  await expect(page.locator('#setting-slack-bot-token')).toHaveCount(0);
  await expect(page.locator('#setting-slack-webhook')).toHaveCount(0);
  await expect(page.locator('#setting-discord-webhook')).toHaveCount(0);
});

test('unavailable GitHub sync preserves the Task and records a recoverable error', async ({ page }) => {
  await page.evaluate(async () => {
    window.WORKSPACE_SYNC_MODE = 'functions';
    window.__pmWrites = [];
    window.firebaseDb = {
      ref: path => ({ update: async value => window.__pmWrites.push({ path, value }) })
    };
    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await window.PM.syncTask('t1');
  });
  const result = await page.evaluate(() => ({
    task: window.PM.state.tasks.t1,
    writes: window.__pmWrites
  }));
  expect(result.task.title).toBe('デモ台本を作る');
  expect(result.writes).toContainEqual(expect.objectContaining({
    path: 'pm/tasks/t1',
    value: expect.objectContaining({ syncStatus: 'error' })
  }));
  expect(result.writes[0].value.lastError).toContain('Workspace APIに接続できません');
});

test('Actions mode queues a retry without calling an unavailable HTTP API', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.WORKSPACE_SYNC_MODE = 'actions';
    const writes = [];
    window.firebaseDb = { ref: path => ({ update: async value => writes.push({ path, value }) }) };
    window.fetch = async () => { throw new Error('Actions mode must not call HTTP Functions'); };
    await window.PM.syncTask('t1');
    await window.PM.syncMilestone('m1');
    return writes;
  });
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ path: 'pm/tasks/t1', value: { syncStatus: 'pending', lastError: null } });
  expect(result[1]).toMatchObject({ path: 'pm/milestones/m1', value: { syncStatus: 'pending' } });
});

test('missing Workspace API is classified separately from an authorization failure', async ({ page }) => {
  const code = await page.evaluate(async () => {
    window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    try {
      await window.PM.callFunction('establishWorkspaceSession', {});
    } catch (error) {
      return error.code;
    }
    return null;
  });
  expect(code).toBe('workspace/api-not-deployed');
});

test('Canvas task flow selects a PM Project and Milestone before creating a formal Task', async ({ page }) => {
  await page.evaluate(() => {
    canvasCurrentId = 'meeting-001';
    canvasBlocks = [{ key: 'block-001', type: 'text', text: '', order: 0 }];
    window.__canvasTask = null;
    window.PM.saveTask = payload => {
      window.__canvasTask = payload;
      return Promise.resolve(null);
    };
    window.showTaskModal(0);
  });
  await expect(page.locator('#canvas-task-modal')).toContainText('正式Task');
  await expect(page.locator('#c-task-goal')).toHaveValue('p1:m1');
  await page.fill('#c-task-title', '会議からのTask');
  await page.selectOption('#c-task-goal', 'p1:m1');
  await page.locator('#c-task-assign-tags [data-member="山口"]').click();
  await page.fill('#c-task-due', '2026-09-25');
  await page.evaluate(() => window.submitCanvasTask());
  const task = await page.evaluate(() => window.__canvasTask);
  expect(task).toMatchObject({
    title: '会議からのTask', projectId: 'p1', milestoneId: 'm1',
    assignees: ['山口'], dueDate: '2026-09-25', status: 'todo'
  });
});

test('Canvas saves one formal Task and durably links its source block', async ({ page }) => {
  await page.evaluate(() => {
    canvasCurrentId = 'meeting-001';
    canvasBlocks = [{ key: 'block-001', type: 'text', text: '', order: 0 }];
    window.__canvasWrites = [];
    window.__canvasAlerts = [];
    window.alert = message => window.__canvasAlerts.push(message);
    window.firebaseDb = { ref: path => ({
      set: value => {
        window.__canvasWrites.push({ path, value, method: 'set' });
        return new Promise(resolve => { window.__finishCanvasTaskSave = resolve; });
      },
      update: async value => window.__canvasWrites.push({ path, value, method: 'update' })
    }) };
    window.PM.syncTask = async () => {};
    // A stale value in the separate Task form must not be used by Canvas.
    document.getElementById('pm-task-id').value = 't1';
    window.showTaskModal(0);
  });
  await page.fill('#c-task-title', '会議の正式アクション');
  await page.evaluate(() => {
    document.querySelector('#canvas-task-modal button.btn-submit').click();
    document.querySelector('#canvas-task-modal button.btn-submit').click();
  });
  expect(await page.evaluate(() => window.__canvasWrites.filter(w => w.path.startsWith('pm/tasks/')).length)).toBe(1);
  await page.evaluate(() => window.__finishCanvasTaskSave());
  await expect.poll(() => page.evaluate(() => window.__canvasWrites.some(w => w.path === 'canvases/meeting-001/blocks/block-001'))).toBe(true);
  const result = await page.evaluate(() => ({ writes: window.__canvasWrites, alerts: window.__canvasAlerts }));
  const task = result.writes.find(w => w.path.startsWith('pm/tasks/'));
  expect(task.path).not.toBe('pm/tasks/t1');
  expect(task.value).toMatchObject({ sourceMeetingId: 'meeting-001', status: 'backlog', title: '会議の正式アクション' });
  expect(result.writes.find(w => w.path === 'canvases/meeting-001/blocks/block-001').value).toMatchObject({ type: 'goal-task', meta: { taskId: task.value.id, pm: true } });
  expect(result.alerts).toEqual([]);
  await expect(page.locator('#toast')).toContainText('正式Taskを作成し、GitHub同期を開始しました');
});

test('Canvas link retry keeps the Task ID after a block write fails', async ({ page }) => {
  await page.evaluate(() => {
    canvasCurrentId = 'meeting-001';
    canvasBlocks = [{ key: 'block-001', type: 'text', text: '', order: 0 }];
    window.__canvasTaskPaths = [];
    window.__canvasBlockAttempts = 0;
    window.firebaseDb = { ref: path => ({
      set: async () => window.__canvasTaskPaths.push(path),
      update: async () => {
        window.__canvasBlockAttempts++;
        if (window.__canvasBlockAttempts === 1) throw new Error('block acknowledgement lost');
      }
    }) };
    window.PM.syncTask = async () => {};
    window.showTaskModal(0);
  });
  await page.fill('#c-task-title', '参照の保存を再試行する');
  await page.locator('#canvas-task-modal button.btn-submit').click();
  await expect(page.locator('#toast')).toContainText('Taskは保持される');
  await expect(page.locator('#canvas-task-modal button.btn-submit')).toBeEnabled();
  await page.locator('#canvas-task-modal button.btn-submit').click();
  await expect(page.locator('#canvas-task-modal')).not.toHaveClass(/open/);
  const paths = await page.evaluate(() => window.__canvasTaskPaths);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toBe(paths[1]);
  expect(await page.evaluate(() => window.__canvasBlockAttempts)).toBe(2);
});

test('clicking /task in the Canvas slash menu opens the formal Task modal', async ({ page }) => {
  await page.evaluate(() => {
    canvasCurrentId = 'meeting-001';
    canvasBlocks = [{ key: 'block-001', type: 'text', text: '/task', order: 0 }];
    window.firebaseDb = { ref: () => ({ set: async () => {} }) };
    const block = document.createElement('div');
    block.dataset.key = 'block-001';
    block.dataset.idx = '0';
    block.textContent = '/task';
    document.body.appendChild(block);
    window.showSlashPopup(block);
  });
  await page.locator('#slash-command-popup [data-cmd="/task"]').dispatchEvent('mousedown');
  await expect(page.locator('#canvas-task-modal')).toHaveClass(/open/);
  await expect(page.locator('#c-task-goal')).toHaveValue('p1:m1');
});
