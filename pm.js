/* ViaGLYPH Workspace PM v2: Project -> Milestone -> Task */
(function () {
  const MEMBERS = {
    '山口': { github: 'YSsolo', emoji: '🌿' },
    '村山': { github: 'GandT', emoji: '💎' },
    '市川': { github: 'shota656', emoji: '🔥' }
  };
  const ALLOWED_GITHUB_IDS = {
    '174987576': '山口', '19548351': '村山', '286001688': '市川'
  };
  const STATUS = {
    backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', review: 'Review', blocked: 'Blocked', done: 'Done'
  };
  const FUNCTION_BASE = window.FUNCTIONS_BASE_URL || 'https://us-central1-viaglyph-workspace.cloudfunctions.net';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `pm_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const now = () => new Date().toISOString();
  const esc = (value) => String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
  const dateOnly = (offsetDays = 0) => new Date(Date.now() + (9 + offsetDays * 24) * 60 * 60 * 1000).toISOString().slice(0, 10);

  const PM = window.PM = {
    state: { projects: {}, milestones: {}, tasks: {}, settings: {}, ready: false, migration: null },
    listeners: [],
    get projects() { return Object.values(this.state.projects || {}); },
    get milestones() { return Object.values(this.state.milestones || {}); },
    get tasks() { return Object.values(this.state.tasks || {}); },
    user() { return API.getSession?.() || null; },
    actor() { return this.user()?.short || currentUser || '山口'; },
    project(id) { return this.state.projects[id]; },
    milestone(id) { return this.state.milestones[id]; },
    task(id) { return this.state.tasks[id]; },
    taskList(projectId) { return this.tasks.filter(t => !projectId || t.projectId === projectId); },
    milestonesFor(projectId) { return this.milestones.filter(m => m.projectId === projectId); },
    taskCount(milestoneId) { return this.tasks.filter(t => t.milestoneId === milestoneId); },
    hasGitHub(project) { return Boolean(project?.github?.owner && project?.github?.repo); },

    async authHeader() {
      const user = firebase.auth?.().currentUser;
      return user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
    },
    async callFunction(path, body) {
      const headers = { 'Content-Type': 'application/json', ...(await this.authHeader()) };
      let response;
      try {
        response = await fetch(`${FUNCTION_BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
      } catch (_) {
        const error = new Error('Workspace APIに接続できません。デプロイまたはネットワーク状態を確認してください。');
        error.code = 'workspace/api-unreachable';
        throw error;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.code = data.code || (response.status === 404 ? 'workspace/api-not-deployed' : response.status === 403 ? 'workspace/forbidden' : 'workspace/api-error');
        throw error;
      }
      return data;
    },
    async write(path, value) {
      if (!window.firebaseDb) throw new Error('Realtime Databaseに接続できません。');
      await window.firebaseDb.ref(path).set(value);
    },
    async update(path, value) {
      if (!window.firebaseDb) throw new Error('Realtime Databaseに接続できません。');
      await window.firebaseDb.ref(path).update(value);
    },
    detach() { this.listeners.forEach(({ path, cb }) => window.firebaseDb?.ref(path).off('value', cb)); this.listeners = []; },
    attach() {
      if (!window.firebaseDb || this.listeners.length) return;
      ['projects','milestones','tasks','settings'].forEach(key => {
        const path = `pm/${key}`;
        const cb = snap => { this.state[key] = snap.val() || {}; this.state.ready = true; this.renderAll(); };
        window.firebaseDb.ref(path).on('value', cb); this.listeners.push({ path, cb });
      });
    },
    metadata() { return { updatedAt: now(), updatedBy: this.actor() }; },
    async saveProject() {
      const id = document.getElementById('pm-project-id').value || uid();
      const name = document.getElementById('pm-project-name').value.trim();
      const owner = document.getElementById('pm-project-owner').value.trim();
      const repo = document.getElementById('pm-project-repo').value.trim();
      if (!name || !owner || !repo) return toast('Project名とGitHub owner/repositoryを入力してください');
      const previous = this.project(id);
      const project = { ...(previous || {}), id, name, status: previous?.status || 'active', github: { owner, repo }, createdAt: previous?.createdAt || now(), ...this.metadata() };
      await this.write(`pm/projects/${id}`, project);
      this.closeModal('pm-project-modal'); toast('Projectを保存しました');
    },
    async saveMilestone() {
      const id = document.getElementById('pm-milestone-id').value || uid();
      const projectId = document.getElementById('pm-milestone-project').value;
      const name = document.getElementById('pm-milestone-name').value.trim();
      if (!projectId || !name) return toast('ProjectとMilestone名を入力してください');
      const previous = this.milestone(id);
      const milestone = { ...(previous || {}), id, projectId, name, dueDate: document.getElementById('pm-milestone-due').value || '', successCriteria: document.getElementById('pm-milestone-criteria').value.trim(), status: previous?.status || 'open', createdAt: previous?.createdAt || now(), syncStatus: previous?.syncStatus || 'pending', ...this.metadata() };
      await this.write(`pm/milestones/${id}`, milestone);
      this.closeModal('pm-milestone-modal');
      this.syncMilestone(id).catch(() => {}); toast('Milestoneを保存しました');
    },
    saveTask(options) {
      if (options) return this.persistTask(options);
      if (this.taskSavePromise) return this.taskSavePromise;
      const button = document.getElementById('pm-task-save-button');
      if (button) button.disabled = true;
      this.taskSavePromise = this.persistTask().catch(() => {
        toast('Taskを保存できませんでした。再試行してください。');
      }).finally(() => {
        this.taskSavePromise = null;
        if (button) button.disabled = false;
      });
      return this.taskSavePromise;
    },
    async persistTask(options) {
      const source = options || {};
      const id = source.id || (!options && document.getElementById('pm-task-id').value) || uid();
      const projectId = source.projectId || document.getElementById('pm-task-project').value;
      const milestoneId = source.milestoneId || document.getElementById('pm-task-milestone').value;
      const title = source.title || document.getElementById('pm-task-title').value.trim();
      const status = source.status || document.getElementById('pm-task-status').value;
      const assignees = source.assignees || Array.from(document.querySelectorAll('#pm-task-assignees .selected')).map(el => el.dataset.member);
      const dueDate = source.dueDate ?? document.getElementById('pm-task-due').value;
      const priority = source.priority || (options ? 'medium' : document.getElementById('pm-task-priority').value);
      const description = source.description ?? (options ? '' : document.getElementById('pm-task-description').value.trim());
      if (!projectId || !milestoneId || !title) return toast('タイトル、Project、Milestoneは必須です');
      if (status !== 'backlog' && (!assignees.length || !dueDate)) return toast('Todo以降は担当者と期限が必須です');
      if (!this.hasGitHub(this.project(projectId))) return toast('ProjectにGitHub repositoryを設定してください');
      // Keep the creation ID across retries if a database acknowledgement is lost.
      if (!options) document.getElementById('pm-task-id').value = id;
      const previous = this.task(id);
      const task = { ...(previous || {}), id, projectId, milestoneId, title, description, status, assignees, dueDate: dueDate || '', priority, sourceMeetingId: source.sourceMeetingId || previous?.sourceMeetingId || '', sourceMeetingDeleted: Boolean(previous?.sourceMeetingDeleted), createdAt: previous?.createdAt || now(), syncStatus: previous?.syncStatus === 'synced' ? 'pending' : (previous?.syncStatus || 'pending'), ...this.metadata() };
      task.completedAt = status === 'done'
        ? (previous?.status === 'done' ? previous.completedAt || null : now()) : null;
      await this.write(`pm/tasks/${id}`, task);
      if (!source.silent) this.closeModal('pm-task-modal');
      this.syncTask(id).catch(() => {});
      return task;
    },
    async updateTaskStatus(id, status) {
      const task = this.task(id); if (!task) return;
      if (status !== 'backlog' && (!task.assignees?.length || !task.dueDate)) {
        this.renderTasks();
        this.openTaskModal(task.id);
        document.getElementById('pm-task-status').value = status;
        return;
      }
      const completedAt = status === 'done'
        ? (task.status === 'done' ? task.completedAt || null : now()) : null;
      await this.update(`pm/tasks/${id}`, { status, completedAt, syncStatus: 'pending', ...this.metadata() });
      this.syncTask(id).catch(() => {});
    },
    async approveMilestone(id) {
      const tasks = this.taskCount(id);
      if (!tasks.length || tasks.some(t => t.status !== 'done')) return toast('すべてのTaskを完了してから承認してください');
      await this.update(`pm/milestones/${id}`, { status: 'closed', approvedAt: now(), approvedBy: this.actor(), syncStatus: 'pending', ...this.metadata() });
      this.syncMilestone(id).catch(() => {});
    },
    async syncTask(id) {
      if (window.WORKSPACE_SYNC_MODE === 'actions') {
        await this.update(`pm/tasks/${id}`, { syncStatus: 'pending', lastError: null, ...this.metadata() });
        return;
      }
      try {
        await this.callFunction('syncTaskToGitHub', { taskId: id });
        await this.update(`pm/tasks/${id}`, { syncStatus: 'synced', lastSyncedAt: now(), lastError: null });
      } catch (error) {
        await this.update(`pm/tasks/${id}`, { syncStatus: 'error', lastError: error.message, ...this.metadata() }).catch(() => {});
      }
    },
    async syncMilestone(id) {
      if (window.WORKSPACE_SYNC_MODE === 'actions') {
        await this.update(`pm/milestones/${id}`, { syncStatus: 'pending', lastError: null, ...this.metadata() });
        return;
      }
      try {
        await this.callFunction('syncMilestoneToGitHub', { milestoneId: id });
        await this.update(`pm/milestones/${id}`, { syncStatus: 'synced', lastSyncedAt: now(), lastError: null });
      } catch (error) {
        await this.update(`pm/milestones/${id}`, { syncStatus: 'error', lastError: error.message, ...this.metadata() }).catch(() => {});
      }
    },
    async retryWorkspaceSession() {
      if (window.WORKSPACE_SYNC_MODE === 'actions') {
        await Promise.all([
          ...this.tasks.filter(task => ['pending', 'error'].includes(task.syncStatus)).map(task => this.syncTask(task.id)),
          ...this.milestones.filter(item => ['pending', 'error'].includes(item.syncStatus)).map(item => this.syncMilestone(item.id))
        ]);
        toast('再同期を予約しました。次回の同期処理で反映されます。');
        return;
      }
      const session = this.user();
      const user = firebase.auth?.().currentUser;
      if (!session || session.sessionMode !== 'direct' || !user) return;
      try {
        await API.establishWorkspaceSession({ githubId: session.githubId });
        await user.getIdToken(true);
        const upgraded = { ...session, sessionMode: 'server' };
        localStorage.setItem('vg_session', JSON.stringify(upgraded));
        this.renderAll();
        await Promise.all(this.tasks.filter(task => ['pending', 'error'].includes(task.syncStatus)).map(task => this.syncTask(task.id)));
        toast('GitHub連携を再開しました。保留中Taskを同期しています。');
      } catch (error) {
        toast('GitHub連携はまだ準備中です。しばらくしてから再試行してください。');
      }
    },
    projectHealth(project) {
      const today = dateOnly(); const nearDate = dateOnly(7);
      const tasks = this.taskList(project.id);
      if (tasks.some(t => t.status === 'blocked' || (t.dueDate && t.dueDate < today && t.status !== 'done'))) return 'red';
      if (tasks.some(t => (t.dueDate && t.dueDate <= nearDate && t.status !== 'done') || t.syncStatus === 'error') || this.alerts().review.some(t => t.projectId === project.id)) return 'yellow';
      return 'green';
    },
    alerts() {
      const today = dateOnly(); const tomorrowDate = dateOnly(1);
      const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      const weekStart = dateOnly(-weekday); const weekDate = dateOnly(6 - weekday);
      const weekStartInstant = Date.parse(`${weekStart}T00:00:00+09:00`);
      const reviewLimit = Date.now() - 48 * 60 * 60 * 1000;
      const active = this.tasks.filter(t => t.status !== 'done');
      return {
        overdue: active.filter(t => t.dueDate && t.dueDate < today),
        soon: active.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= tomorrowDate),
        week: active.filter(t => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekDate),
        blocked: active.filter(t => t.status === 'blocked'),
        review: active.filter(t => t.status === 'review' && new Date(t.updatedAt || t.createdAt).getTime() <= reviewLimit),
        sync: this.tasks.filter(t => t.syncStatus === 'error'),
        // Old records without a completion instant are not fabricated from edits.
        completedWeek: this.tasks.filter(t => t.status === 'done' && t.completedAt
          && Date.parse(t.completedAt) >= weekStartInstant && Date.parse(t.completedAt) <= Date.now())
      };
    },
    milestoneProgress(milestone) { const tasks = this.taskCount(milestone.id); return { total: tasks.length, done: tasks.filter(t => t.status === 'done').length }; },
    renderDashboard() {
      const el = document.getElementById('pm-dashboard'); if (!el) return;
      const a = this.alerts();
      const boxes = [['期限超過',a.overdue,'is-danger'],['今日・明日',a.soon,'is-warning'],['今週',a.week,'is-info'],['Blocked',a.blocked,'is-danger'],['Review 48h+',a.review,'is-warning'],['同期失敗',a.sync,'is-danger']];
      const summary = this.makeSummary(a);
      const directMode = window.WORKSPACE_SYNC_MODE !== 'actions' && this.user()?.sessionMode === 'direct';
      const integrationNotice = directMode ? '<div class="pm-integration-notice"><strong>GitHub連携を準備中</strong><span>Taskの保存・共有は利用できます。Issue作成と同期はWorkspace APIの配備後に自動再試行されます。</span><button class="pm-btn" onclick="PM.retryWorkspaceSession()">接続を再試行</button></div>' : '';
      el.innerHTML = `<div class="pm-page"><div class="pm-page-header"><div><h2>PM Dashboard</h2><p>チームを前に進めるための要対応と進捗</p></div><div class="pm-actions"><button class="pm-btn" onclick="PM.openMigration()">旧データ移行</button><button class="pm-btn pm-btn-primary" onclick="PM.openTaskModal()">＋ Task</button></div></div>${integrationNotice}<div class="pm-alert-grid">${boxes.map(([label,items,klass]) => `<button class="pm-alert ${klass}" onclick="PM.showTaskFilter('${label}')"><span>${label}</span><strong>${items.length}</strong></button>`).join('')}</div><div class="pm-section"><div class="pm-section-title"><h3>事業・進捗サマリー</h3></div><div class="pm-summary">${esc(summary)}</div></div><div class="pm-section"><div class="pm-section-title"><h3>Projectの状態</h3><button class="pm-btn" onclick="setView('goals')">すべて見る</button></div>${this.projectCards()}</div></div>`;
    },
    makeSummary(a) {
      const completed = this.milestones.filter(m => m.status === 'closed').map(m => m.name);
      const completedTasks = (a.completedWeek || []).map(t => t.title);
      const next = this.tasks.filter(t => t.status !== 'done' && t.dueDate).sort((x,y) => x.dueDate.localeCompare(y.dueDate)).slice(0,3).map(t => `${t.title}（${t.dueDate}）`);
      return `完了したMilestone: ${completed.length ? completed.join('、') : 'まだありません'}\n今週完了したTask: ${completedTasks.length ? completedTasks.join('、') : '完了日時を確認できるTaskはありません'}\n次の期限: ${next.length ? next.join(' / ') : '期限設定済みのTaskはありません'}\n判断・対応待ち: Blocked ${a.blocked.length}件、Review停滞 ${a.review.length}件、同期失敗 ${a.sync.length}件`;
    },
    projectCards() {
      if (!this.projects.length) return '<div class="pm-empty">Projectを作成すると、ここで期限・Blocker・Milestone進捗を確認できます。</div>';
      return `<div class="pm-project-grid">${this.projects.map(p => {
        const health = this.projectHealth(p); const milestones = this.milestonesFor(p.id); const closed = milestones.filter(m => m.status === 'closed').length; const current = milestones.filter(m => m.status !== 'closed'); const pct = milestones.length ? Math.round(closed / milestones.length * 100) : 0;
        return `<article class="pm-project-card"><div class="pm-project-head"><div><div class="pm-project-name">${esc(p.name)}</div><div class="pm-repo">${esc(p.github?.owner || '未設定')}/${esc(p.github?.repo || '')}</div></div><span class="pm-health ${health}" title="${health}"></span></div><div class="pm-project-metrics"><span>完了 Milestone ${closed}/${milestones.length}</span><span>進行中 ${current.length}</span></div><div class="pm-progress"><span style="width:${pct}%"></span></div><div class="pm-card-actions"><button class="pm-btn" onclick="PM.openProjectDetail('${p.id}')">詳細</button><button class="pm-btn" onclick="PM.openMilestoneModal(null,'${p.id}')">＋ Milestone</button></div></article>`;
      }).join('')}</div>`;
    },
    renderProjects() {
      const el = document.getElementById('pm-projects'); if (!el) return;
      el.innerHTML = `<div class="pm-page"><div class="pm-page-header"><div><h2>Projects</h2><p>ProjectごとのMilestoneと完了条件を管理</p></div><div class="pm-actions"><button class="pm-btn" onclick="PM.openProjectModal()">＋ Project</button><button class="pm-btn pm-btn-primary" onclick="PM.openMilestoneModal()">＋ Milestone</button></div></div>${this.projectCards()}<div id="pm-project-detail" class="pm-project-detail"></div></div>`;
    },
    openProjectDetail(id) {
      const p = this.project(id); const el = document.getElementById('pm-project-detail'); if (!p || !el) return;
      const milestones = this.milestonesFor(id);
      el.innerHTML = `<div class="pm-section"><div class="pm-section-title"><h3>${esc(p.name)}</h3><button class="pm-btn" onclick="PM.openProjectModal('${id}')">編集</button></div>${milestones.length ? milestones.map(m => { const progress = this.milestoneProgress(m); const complete = progress.total && progress.done === progress.total; return `<div class="pm-milestone"><div class="pm-milestone-head"><div><div class="pm-milestone-title">${esc(m.name)}</div><div class="pm-task-meta">${m.dueDate ? `期限 ${esc(m.dueDate)} · ` : ''}${progress.done}/${progress.total} Task · ${m.status === 'closed' ? '完了' : complete ? '完了候補' : '進行中'}</div></div><div class="pm-actions">${complete && m.status !== 'closed' ? `<button class="pm-btn pm-btn-primary" onclick="PM.approveMilestone('${m.id}')">完了承認</button>` : ''}<button class="pm-btn" onclick="PM.openMilestoneModal('${m.id}')">編集</button><button class="pm-btn" onclick="PM.openTaskModal(null,'${p.id}','${m.id}')">＋ Task</button></div></div>${m.successCriteria ? `<p class="pm-muted">完了条件: ${esc(m.successCriteria)}</p>` : ''}</div>`; }).join('') : '<div class="pm-empty">Milestoneを追加してください。</div>'}</div>`;
    },
    renderTasks() {
      const el = document.getElementById('pm-tasks'); if (!el) return;
      const bucket = ({ '期限超過': 'overdue', '今日・明日': 'soon', '今週': 'week', 'Blocked': 'blocked', 'Review 48h+': 'review', '同期失敗': 'sync' })[this.filterAlert];
      const source = bucket ? this.alerts()[bucket] : this.tasks;
      const rows = source.slice().sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      const activeFilter = bucket ? `<span class="pm-muted">${esc(this.filterAlert)}</span><button class="pm-btn" onclick="PM.filterAlert='';PM.renderTasks()">絞り込みを解除</button>` : '';
      el.innerHTML = `<div class="pm-page"><div class="pm-page-header"><div><h2>Tasks</h2><p>会議・Project・Work Logから共通で参照する唯一のTask一覧</p></div><button class="pm-btn pm-btn-primary" onclick="PM.openTaskModal()">＋ Task</button></div><div class="pm-task-toolbar"><select class="form-select" onchange="PM.filterProject=this.value;PM.renderTasks()"><option value="">全Project</option>${this.projects.map(p => `<option value="${p.id}" ${this.filterProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${activeFilter}</div><div class="pm-task-list">${rows.filter(t => !this.filterProject || t.projectId === this.filterProject).map(t => this.taskRow(t)).join('') || '<div class="pm-empty">該当するTaskはありません。</div>'}</div></div>`;
    },
    taskRow(t) {
      const project = this.project(t.projectId); const milestone = this.milestone(t.milestoneId); const overdue = t.dueDate && t.dueDate < dateOnly() && t.status !== 'done';
      return `<div class="pm-task-row"><select class="form-select pm-status ${t.status}" onchange="PM.updateTaskStatus('${t.id}',this.value)">${Object.entries(STATUS).map(([k,v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select><div><div class="pm-task-title" onclick="PM.openTaskModal('${t.id}')">${esc(t.title)}</div><div class="pm-task-meta">${esc(project?.name || '未分類')} / ${esc(milestone?.name || 'Milestone未設定')}</div>${t.lastError ? `<div class="pm-sync-error">同期: ${esc(t.lastError)}</div>` : ''}</div><div class="pm-task-meta">${(t.assignees || []).map(a => `${MEMBERS[a]?.emoji || ''}${esc(a)}`).join(' ') || '担当未設定'}</div><div class="pm-task-meta pm-due ${overdue ? 'overdue' : ''}">${t.dueDate ? esc(t.dueDate) : '期限未設定'}</div><div><span class="pm-status ${esc(t.syncStatus || 'pending')}">${esc(t.syncStatus || 'pending')}</span>${t.github?.url ? `<a class="pm-task-meta" href="${esc(t.github.url)}" target="_blank" rel="noreferrer"> Issue #${esc(t.github.number)}</a>` : ''}${t.syncStatus === 'error' ? `<button class="pm-btn" onclick="PM.syncTask('${t.id}')">再同期</button>` : ''}</div></div>`;
    },
    showTaskFilter(label) { this.filterProject = ''; this.filterAlert = label; setView('kanban'); this.renderTasks(); },
    renderAll() { if (!this.state.ready) return; this.renderDashboard(); this.renderProjects(); this.renderTasks(); this.ensureSettings(); },
    openModal(id) { document.getElementById(id)?.classList.add('open'); },
    closeModal(id) { document.getElementById(id)?.classList.remove('open'); },
    fillProjectOptions(selectId, selected) { const sel = document.getElementById(selectId); if (sel) sel.innerHTML = `<option value="">選択してください</option>${this.projects.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`; },
    populateMilestones(projectId, selected) { const sel = document.getElementById('pm-task-milestone'); if (sel) sel.innerHTML = `<option value="">選択してください</option>${this.milestonesFor(projectId).filter(m => m.status !== 'closed').map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`; },
    openProjectModal(id) { const p = id ? this.project(id) : null; document.getElementById('pm-project-modal-title').textContent = p ? 'Projectを編集' : 'Projectを追加'; document.getElementById('pm-project-id').value = p?.id || ''; document.getElementById('pm-project-name').value = p?.name || ''; document.getElementById('pm-project-owner').value = p?.github?.owner || ''; document.getElementById('pm-project-repo').value = p?.github?.repo || ''; this.openModal('pm-project-modal'); },
    openMilestoneModal(id, projectId) { const m = id ? this.milestone(id) : null; document.getElementById('pm-milestone-modal-title').textContent = m ? 'Milestoneを編集' : 'Milestoneを追加'; document.getElementById('pm-milestone-id').value = m?.id || ''; this.fillProjectOptions('pm-milestone-project', m?.projectId || projectId); document.getElementById('pm-milestone-name').value = m?.name || ''; document.getElementById('pm-milestone-criteria').value = m?.successCriteria || ''; document.getElementById('pm-milestone-due').value = m?.dueDate || ''; this.openModal('pm-milestone-modal'); },
    openTaskModal(id, projectId, milestoneId) { const t = id ? this.task(id) : null; document.getElementById('pm-task-modal-title').textContent = t ? 'Taskを編集' : 'Taskを追加'; document.getElementById('pm-task-id').value = t?.id || ''; document.getElementById('pm-task-title').value = t?.title || ''; this.fillProjectOptions('pm-task-project', t?.projectId || projectId); this.populateMilestones(t?.projectId || projectId, t?.milestoneId || milestoneId); document.getElementById('pm-task-status').value = t?.status || 'backlog'; document.getElementById('pm-task-priority').value = t?.priority || 'medium'; document.getElementById('pm-task-due').value = t?.dueDate || ''; document.getElementById('pm-task-description').value = t?.description || ''; document.querySelectorAll('#pm-task-assignees .tag').forEach(el => el.classList.toggle('selected', Boolean(t?.assignees?.includes(el.dataset.member)))); const saveButton = document.getElementById('pm-task-save-button'); if (saveButton) saveButton.textContent = this.user()?.sessionMode === 'direct' ? '保存（GitHub連携待ち）' : '保存してIssue化'; this.openModal('pm-task-modal'); },
    ensureSettings() {
      const page = document.getElementById('view-settings'); if (!page || page.querySelector('#pm-settings-card')) return;
      page.insertAdjacentHTML('afterbegin', `<div class="glass-card" id="pm-settings-card" style="margin-bottom:16px"><h3 style="margin-top:0">PM運用</h3><p class="pm-muted">共通Slackチャンネルには、平日9:00（JST）に期限超過・直近期限・Blocked・Review停滞・同期失敗を通知します。</p><div class="form-group"><label class="form-label">共通SlackチャンネルID</label><input class="form-input" id="pm-slack-channel" placeholder="C0123456789"/></div><button class="pm-btn pm-btn-primary" onclick="PM.savePmSettings()">PM設定を保存</button><button class="pm-btn" onclick="PM.openMigration()">旧データ移行プレビュー</button></div>`);
    },
    async savePmSettings() { await this.update('pm/settings', { slackChannel: document.getElementById('pm-slack-channel').value.trim(), timezone: 'Asia/Tokyo', digestWeekdaysOnly: true, digestHour: 9, ...this.metadata() }); toast('PM設定を保存しました'); },
    async readLegacySnapshot() {
      if (!window.firebaseDb) throw new Error('Realtime Database is unavailable');
      const [goals, tasks, logs] = await Promise.all(['goals', 'tasks', 'workLogs'].map(path => window.firebaseDb.ref(path).get()));
      return { goals: goals.val() || {}, tasks: tasks.val() || {}, workLogs: logs.val() || {} };
    },
    migrationPreview(legacySnapshot) {
      const rows = value => Object.entries(value || {}).filter(([, item]) => item && typeof item === 'object').map(([key, item]) => ({ ...item, id: item.id ?? key }));
      const legacyGoals = rows(legacySnapshot ? legacySnapshot.goals : window.goals);
      const legacyTasks = legacySnapshot
        ? [...rows(legacySnapshot.tasks.dev).map(t => ({ ...t, ctx: 'dev' })), ...rows(legacySnapshot.tasks.biz).map(t => ({ ...t, ctx: 'biz' }))]
        : [...(window.DATA?.dev?.tasks || []), ...(window.DATA?.biz?.tasks || []), ...(window.localTasks || [])];
      const projects = []; const milestones = []; const tasks = []; const duplicates = []; const seen = new Map();
      legacyGoals.forEach(project => { const projectId = uid(); projects.push({ id: projectId, name: project.name, status: project.status || 'active', github: { owner: '', repo: '' }, migrated: true }); rows(project.bigGoals).forEach(big => { const milestoneId = uid(); milestones.push({ id: milestoneId, projectId, name: big.name, dueDate: big.due || '', successCriteria: '', status: 'open', migrated: true }); rows(big.midGoals).forEach(mid => rows(mid.tasks).forEach(item => { const assignees = Array.isArray(item.assign) ? item.assign : (item.assign ? [item.assign] : []); const task = { id: uid(), projectId, milestoneId, title: item.name, status: item.done ? 'done' : 'backlog', assignees, dueDate: item.due || '', priority: 'medium', legacyGroup: mid.name, migrated: true, ...(item.id !== undefined ? { legacyTaskId: item.id } : {}) }; const key = `${task.title.trim().toLowerCase()}|${assignees.join(',')}`; seen.set(key, [...(seen.get(key) || []), task]); tasks.push(task); })); }); });
      legacyTasks.forEach(old => {
        const assignees = old.assign ? [old.assign] : [];
        const key = `${String(old.title || '').trim().toLowerCase()}|${assignees.join(',')}`;
        if (seen.has(key)) {
          const candidates = seen.get(key);
          if (candidates.length !== 1) {
            duplicates.push({ legacy: old, candidates, ambiguous: true });
            return;
          }
          const task = candidates[0];
          const oldStatus = ({ TODO:'todo', WIP:'in_progress', Review:'review', Blocked:'blocked', Done:'done' })[old.status] || 'backlog';
          const oldDue = /^\d{4}-\d{2}-\d{2}$/.test(old.due || '') ? old.due : '';
          duplicates.push({ legacy: old, task, conflict: task.status !== oldStatus || task.dueDate !== oldDue });
          return;
        }
        let project = projects.find(p => p.name === '未分類');
        if (!project) {
          project = { id: uid(), name: '未分類', status: 'active', github: { owner: '', repo: '' }, migrated: true, needsConfiguration: true };
          projects.push(project);
        }
        let milestone = milestones.find(m => m.projectId === project.id && m.name === 'Backlog');
        if (!milestone) {
          milestone = { id: uid(), projectId: project.id, name: 'Backlog', dueDate: '', successCriteria: '', status: 'open', migrated: true };
          milestones.push(milestone);
        }
        tasks.push({ id: uid(), projectId: project.id, milestoneId: milestone.id, title: old.title, status: 'backlog', assignees, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(old.due || '') ? old.due : '', priority: ({ 高:'high', 中:'medium', 低:'low' })[old.prio] || 'medium', legacyTaskId: old.id, legacyContext: old.ctx || '', legacyStatus: old.status || '', migrated: true });
      });
      return { projects, milestones, tasks, duplicates, ...(legacySnapshot ? { legacySnapshot } : {}) };
    },
    async openMigration() {
      this.state.migration = null;
      const previewEl = document.getElementById('pm-migration-preview');
      if (previewEl) previewEl.innerHTML = '';
      try {
        const data = this.migrationPreview(await this.readLegacySnapshot());
        this.state.migration = data;
        const el = document.getElementById('pm-migration-preview');
        el.innerHTML = `<div class="pm-migration-group"><h4>変換対象</h4><p>${data.projects.length} Project、${data.milestones.length} Milestone、${data.tasks.length} Task</p></div><div class="pm-migration-group"><h4>重複候補</h4>${data.duplicates.length ? data.duplicates.map((d, i) => d.ambiguous ? `<p>${esc(d.legacy.title)} — 複数のGoal Taskが該当します。旧データの重複を確認してからプレビューを再取得してください。</p>` : d.conflict ? `<label>${esc(d.legacy.title)} — 状態または期限が競合<select class="form-select" id="pm-migration-choice-${i}"><option value="formal">Goal Taskを採用</option><option value="legacy">看板Taskを採用</option></select></label>` : `<p>${esc(d.legacy.title)} — 既存Goal Taskへ統合</p>`).join('') : '<p>ありません</p>'}</div><div class="pm-migration-group"><h4>確認が必要なProject</h4>${data.projects.filter(p => p.needsConfiguration || !p.github.owner).map(p => `<p>${esc(p.name)}: GitHub owner/repositoryを移行後に設定してください。</p>`).join('') || '<p>ありません</p>'}</div><p class="pm-muted">旧データは削除せず、Realtime Databaseにバックアップしてから新しい <code>/pm</code> へ保存します。外部Issueはこの確認操作では作成しません。</p>`;
        this.openModal('pm-migration-modal');
      } catch (_) {
        this.state.migration = null;
        toast('移行データを取得できませんでした。接続を確認して再試行してください。');
      }
    },
    async confirmMigration() {
      const data = this.state.migration;
      if (!data) return;
      if (!data.legacySnapshot) return toast('移行プレビューを再取得してから確定してください。');
      if (data.duplicates.some(d => d.ambiguous)) return toast('重複候補が複数あります。旧データを確認してプレビューを再取得してください。');
      data.duplicates.forEach((d, i) => {
        if (d.conflict && document.getElementById(`pm-migration-choice-${i}`)?.value === 'legacy') {
          d.task.status = ({ TODO:'todo', WIP:'in_progress', Review:'review', Blocked:'blocked', Done:'done' })[d.legacy.status] || 'backlog';
          d.task.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(d.legacy.due || '') ? d.legacy.due : '';
          d.task.priority = ({ 高:'high', 中:'medium', 低:'low' })[d.legacy.prio] || 'medium';
        }
      });
      data.tasks.forEach(t => {
        if (t.status !== 'backlog' && (!t.assignees?.length || !t.dueDate)) {
          t.status = 'backlog';
          t.migrationNeedsScheduling = true;
        }
      });
      const aliases = new Map();
      const addAlias = (legacyId, taskId) => {
        if (legacyId === undefined) return;
        const key = String(legacyId);
        const targets = aliases.get(key) || new Set();
        targets.add(taskId);
        aliases.set(key, targets);
      };
      data.tasks.forEach(t => addAlias(t.legacyTaskId, t.id));
      // Both source IDs refer to the surviving formal Task after deduplication.
      data.duplicates.forEach(d => {
        addAlias(d.legacy.id, d.task.id);
      });
      if (Object.values(data.legacySnapshot.workLogs || {}).some(log => aliases.get(String(log.taskId))?.size > 1)) {
        return toast('作業記録の旧Task IDが複数のTaskに一致します。旧データを確認してプレビューを再取得してください。');
      }
      const taskIdMap = new Map([...aliases].map(([key, targets]) => [key, [...targets][0]]));
      const updates = { 'pm/schemaVersion': 2 };
      Object.entries(data.legacySnapshot.workLogs || {}).forEach(([key, log]) => {
        const taskId = taskIdMap.get(String(log.taskId));
        if (taskId) updates[`workLogs/${key}/taskId`] = taskId;
      });
      data.projects.forEach(p => updates[`pm/projects/${p.id}`] = { ...p, createdAt: now(), ...this.metadata() });
      data.milestones.forEach(m => updates[`pm/milestones/${m.id}`] = { ...m, syncStatus: 'pending', createdAt: now(), ...this.metadata() });
      data.tasks.forEach(t => updates[`pm/tasks/${t.id}`] = { ...t, syncStatus: 'pending', createdAt: now(), ...this.metadata() });
      const canonical = value => value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      const fingerprint = root => JSON.stringify(canonical({ goals: root?.goals || {}, tasks: root?.tasks || {}, workLogs: root?.workLogs || {} }));
      const expectedSource = fingerprint(data.legacySnapshot);
      const matches = root => root && Number(root.pm?.schemaVersion || 0) < 2 && fingerprint(root) === expectedSource;
      const hasUnsafeLog = root => Object.values(data.legacySnapshot.workLogs || {}).some(log => {
        const key = String(log.taskId);
        const formalExists = Object.prototype.hasOwnProperty.call(root?.pm?.tasks || {}, key);
        const mapped = taskIdMap.get(key);
        // A shared scalar ID cannot distinguish an existing formal Task from
        // a different legacy Task. Never give the legacy alias precedence.
        return mapped ? formalExists && String(mapped) !== key : !formalExists;
      });
      const rootRef = window.firebaseDb.ref();
      let observer;
      // Keep a temporary value listener until completion so the transaction's
      // initial input is a complete root, not an unpopulated local cache.
      const ready = new Promise((resolve, reject) => {
        observer = snapshot => resolve(snapshot.val());
        rootRef.on('value', observer, reject);
      });
      try {
        const observedRoot = await ready;
        if (!matches(observedRoot)) return toast('移行対象が更新済み、または移行済みです。プレビューを再取得してください。');
        if (hasUnsafeLog(observedRoot)) return toast('作業記録の参照先Taskを特定できません。旧データを確認してプレビューを再取得してください。');
        data.backupId ||= uid();
        await this.write(`migrationBackups/${data.backupId}`, { ...data.legacySnapshot, createdAt: now(), ...this.metadata() });
        // Guard source, schema switch and Work Log relinking in ONE commit.
        // RTDB retries with current data after any conflicting client write.
        const result = await rootRef.transaction(current => {
          if (!matches(current) || hasUnsafeLog(current)) return;
          const next = JSON.parse(JSON.stringify(current));
          Object.entries(updates).forEach(([path, value]) => {
            const parts = path.split('/');
            let parent = next;
            parts.slice(0, -1).forEach(key => { parent = parent[key] ||= {}; });
            parent[parts[parts.length - 1]] = value;
          });
          return next;
        }, undefined, false);
        if (!result.committed) return toast('移行対象が更新済み、または移行済みです。プレビューを再取得してください。');
      } finally {
        rootRef.off('value', observer);
      }
      this.closeModal('pm-migration-modal');
      toast('バックアップを作成し、PM v2へ移行しました');
    },
    legacyTask(task) { return { id: task.id, title: task.title, status: ({ backlog:'TODO', todo:'TODO', in_progress:'WIP', review:'Review', blocked:'Blocked', done:'Done' })[task.status] || 'TODO', assign: task.assignees?.[0] || '全員', due: task.dueDate || '随時', tags: [this.project(task.projectId)?.name || 'PM'], ctx: 'biz' }; }
  };

  API.getPmSession = () => PM.user();
  API.syncPmTask = id => PM.syncTask(id);
  API.syncPmMilestone = id => PM.syncMilestone(id);
  API.establishWorkspaceSession = body => PM.callFunction('establishWorkspaceSession', body);

  function showLoginError(error) {
    const errorEl = document.getElementById('login-error');
    const code = error?.code || '';
    const message = code === 'auth/internal-error'
      ? 'Firebase Authenticationの構成を確認してください。'
      : code === 'workspace/api-unreachable' || code === 'workspace/api-not-deployed'
        ? 'WorkspaceのログインAPIを準備中です。管理者はデプロイ状況を確認してください。'
        : code === 'workspace/forbidden'
          ? 'このGitHubアカウントにはWorkspaceの利用権限がありません。'
          : code === 'WORKSPACE_INTEGRATION_UNAVAILABLE'
            ? 'Workspace連携の設定が未完了です。管理者に連絡してください。'
            : 'GitHubログインを完了できませんでした。再試行してください。';
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  let authGeneration = 0;

  async function completeGitHubLogin(user, profile = {}, expectedGeneration) {
    const isCurrent = () => firebase.auth().currentUser?.uid === user.uid &&
      (expectedGeneration === undefined || expectedGeneration === authGeneration);
    if (!isCurrent()) return;
    const githubId = String(user.providerData?.find(p => p.providerId === 'github.com')?.uid || '');
    const short = ALLOWED_GITHUB_IDS[githubId];
    if (!short) {
      await firebase.auth().signOut();
      const error = new Error('GitHubアカウントが許可リストにありません。');
      error.code = 'workspace/forbidden';
      throw error;
    }
    let sessionMode = window.WORKSPACE_SYNC_MODE === 'actions' ? 'actions' : 'server';
    try {
      if (sessionMode !== 'actions') {
      await API.establishWorkspaceSession({ githubId });
      await user.getIdToken(true);
      }
    } catch (error) {
      // RTDB Rules independently validate the signed GitHub numeric ID. This
      // keeps approved members productive while an API release is unavailable;
      // server-only integrations remain pending and are retried after release.
      if (!['workspace/api-unreachable', 'workspace/api-not-deployed'].includes(error.code)) throw error;
      sessionMode = 'direct';
    }
    // A sign-out or account switch while the server responds must not reopen
    // the previous user's Workspace.
    if (!isCurrent()) return;
    const session = { githubId, githubLogin: profile.login || MEMBERS[short].github, short, name: short, emoji: MEMBERS[short].emoji, sessionMode };
    localStorage.setItem('vg_session', JSON.stringify(session)); currentUser = short;
    document.getElementById('user-display').textContent = `${session.emoji} ${short}`;
    document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app').style.display = 'flex'; PM.attach();
    if (sessionMode === 'direct') toast('Workspaceに接続しました。GitHub Issue連携はサーバー配備後に自動再試行されます。');
    if (sessionMode === 'direct') window.setTimeout(() => PM.retryWorkspaceSession(), 5 * 60 * 1000);
  }

  window.handleGitHubLogin = async function () {
    const button = document.getElementById('login-btn'); const errorEl = document.getElementById('login-error');
    try {
      // Playwright uses an explicit injected identity; production never sets this flag.
      if (window.__VG_TEST_AUTH__ && ['localhost', '127.0.0.1'].includes(location.hostname)) {
        const session = window.__VG_TEST_AUTH__;
        localStorage.setItem('vg_session', JSON.stringify(session)); currentUser = session.short;
        document.getElementById('user-display').textContent = `${session.emoji || '🌿'} ${session.short}`;
        document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app').style.display = 'flex';
        PM.state.ready = true; PM.renderAll();
        return;
      }
      button.disabled = true; button.textContent = 'GitHubへ移動します…'; errorEl.style.display = 'none';
      const provider = new firebase.auth.GithubAuthProvider(); provider.addScope('read:user');
      sessionStorage.setItem('vg_github_redirect_pending', '1');
      await firebase.auth().signInWithRedirect(provider);
    } catch (error) {
      console.error('ViaGLYPH GitHub sign-in failed');
      sessionStorage.removeItem('vg_github_redirect_pending');
      showLoginError(error);
    }
    finally { button.disabled = false; button.textContent = 'GitHubでログイン'; }
  };

  API.getToken = () => null;
  API.isLoggedIn = () => Boolean(firebase.auth?.().currentUser && localStorage.getItem('vg_session'));
  API.logout = async () => { PM.detach(); localStorage.removeItem('vg_session'); await firebase.auth().signOut(); location.reload(); };

  const oldGetAllTasks = window.getAllTasks;
  window.getAllTasks = () => PM.state.ready ? PM.tasks.map(t => PM.legacyTask(t)) : oldGetAllTasks();
  window.findTask = id => window.getAllTasks().find(t => String(t.id) === String(id));
  window.renderMembers = () => PM.renderDashboard();
  window.renderGoals = () => PM.renderProjects();
  window.renderKanban = () => PM.renderTasks();
  window.renderAll = () => PM.renderAll();
  window.openAddTask = () => PM.openTaskModal();
  window.addTask = () => PM.saveTask();
  window.setCtx = () => {};

  function clearWorkspaceSession() {
    PM.detach();
    API.detachRealtimeListeners?.();
    localStorage.removeItem('vg_session');
    currentUser = null;
    PM.state = { projects: {}, milestones: {}, tasks: {}, settings: {}, ready: false, migration: null };
    document.getElementById('login-screen')?.classList.remove('hidden');
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const display = document.getElementById('user-display');
    if (display) display.textContent = '';
    document.querySelectorAll('.modal-overlay.open').forEach(modal => modal.classList.remove('open'));
  }

  firebase.auth?.().onAuthStateChanged(async user => {
    const generation = ++authGeneration;
    clearWorkspaceSession();
    if (!user) return;
    try {
      await completeGitHubLogin(user, {}, generation);
    } catch (error) {
      if (generation !== authGeneration) return;
      clearWorkspaceSession();
      showLoginError(error);
    }
  });

  // Both resumed sessions and redirect results revalidate the signed identity.
  // Server mode waits for the member claim; Actions mode is guarded by RTDB Rules.
  (async function completeRedirectLogin() {
    if (!firebase.auth) return;
    try {
      const result = await firebase.auth().getRedirectResult();
      if (!result?.user || !sessionStorage.getItem('vg_github_redirect_pending')) return;
      sessionStorage.removeItem('vg_github_redirect_pending');
      await completeGitHubLogin(result.user, result.additionalUserInfo?.profile || {}, authGeneration);
    } catch (error) {
      sessionStorage.removeItem('vg_github_redirect_pending');
      console.error('ViaGLYPH GitHub redirect sign-in failed');
      showLoginError(error);
    }
  })();



})();
