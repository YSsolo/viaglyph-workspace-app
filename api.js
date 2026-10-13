// ═══ ViaGLYPH Workspace — API Layer (Firebase Realtime Database Direct) ═══

// ─── FIREBASE GLOBAL INITIALIZATION ───
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDS4v9y0FnUvY5MFxtypkWrrSAH8GMUCLY",
  authDomain: "viaglyph-workspace.firebaseapp.com",
  databaseURL: "https://viaglyph-workspace-default-rtdb.firebaseio.com",
  projectId: "viaglyph-workspace",
  storageBucket: "viaglyph-workspace.firebasestorage.app",
  messagingSenderId: "1062801720102",
  appId: "1:1062801720102:web:9b99141f1a21b4e76937e7"
};

window.FIREBASE_CONFIG = FIREBASE_CONFIG;
if (typeof firebase !== 'undefined') {
  window.firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
  window.firebaseDb = firebase.database();
}

const USER_KEY_MAP = { '山口': 'yamaguchi', '市川': 'ichikawa', '村山': 'murayama' };
const USER_SHORT_MAP = { 'yamaguchi': '山口', 'ichikawa': '市川', 'murayama': '村山' };

async function workspaceAuthHeaders() {
  const user = typeof firebase !== 'undefined' ? firebase.auth?.().currentUser : null;
  if (!user) return { 'Content-Type': 'application/json' };
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` };
}


function normalizeGoals(data) {
  if (!data) return [];
  let arr = Array.isArray(data) ? data : Object.values(data);
  arr = arr.filter(Boolean);
  return arr.map(project => {
    if (!project || typeof project !== 'object') return project;
    const p = { ...project };
    if (p.bigGoals) {
      let bigGoalsArr = Array.isArray(p.bigGoals) ? p.bigGoals : Object.values(p.bigGoals);
      bigGoalsArr = bigGoalsArr.filter(Boolean);
      p.bigGoals = bigGoalsArr.map(bg => {
        if (!bg || typeof bg !== 'object') return bg;
        const b = { ...bg };
        if (b.midGoals) {
          let midGoalsArr = Array.isArray(b.midGoals) ? b.midGoals : Object.values(b.midGoals);
          midGoalsArr = midGoalsArr.filter(Boolean);
          b.midGoals = midGoalsArr.map(mg => {
            if (!mg || typeof mg !== 'object') return mg;
            const m = { ...mg };
            if (m.tasks) {
              let tasksArr = Array.isArray(m.tasks) ? m.tasks : Object.values(m.tasks);
              m.tasks = tasksArr.filter(Boolean);
            }
            return m;
          });
        }
        return b;
      });
    }
    return p;
  });
}

const API = {
  _loginAttempts: 0,
  _lockUntil: 0,
  MAX_ATTEMPTS: 5,
  LOCK_DURATION: 30000, // 30秒
  _listenersAttached: false,

  // ─── AUTH ───
  getToken() { return localStorage.getItem('vg_token'); },
  getSession() {
    const s = localStorage.getItem('vg_session');
    return s ? JSON.parse(s) : null;
  },
  isLoggedIn() { return !!this.getToken() && !!this.getSession(); },
  isOnline() {
    return (typeof navigator === 'undefined' || navigator.onLine !== false) &&
      typeof window !== 'undefined' && typeof window.firebaseDb !== 'undefined' && !!window.firebaseDb;
  },

  // Legacy login is deliberately disabled. PM v2 uses Firebase GitHub OAuth in pm.js.
  async login(email, password) {
    return { success: false, error: 'GitHubでログインしてください' };
  },

  // 2. VALIDATE TOKEN
  async validateToken() {
    if (!this.isLoggedIn()) return false;
    this.initRealtimeListeners();
    return true;
  },

  logout() {
    this.detachRealtimeListeners();
    localStorage.removeItem('vg_token');
    localStorage.removeItem('vg_session');
    location.reload();
  },

  // 3. GET TASKS
  async getTasks() {
    if (!this.isOnline()) return null;
    const snap = await window.firebaseDb.ref('tasks').once('value');
    return snap.val() || { dev: {}, biz: {} };
  },

  // 4. GET WORK LOGS
  async getWorkLogs() {
    if (!this.isOnline()) return null;
    const snap = await window.firebaseDb.ref('workLogs').once('value');
    const val = snap.val() || {};
    return Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
  },

  _withTimeout(promise, ms = 500) {
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
  },

  // 3. GET TASKS
  async getTasks() {
    if (!this.isOnline()) return null;
    return this._withTimeout(
      window.firebaseDb.ref('tasks').once('value').then(snap => snap.val() || { dev: {}, biz: {} }),
      500
    );
  },

  async getWorkLogs() {
    if (!this.isOnline()) return null;
    const res = await this._withTimeout(
      window.firebaseDb.ref('workLogs').once('value').then(snap => {
        const val = snap.val() || {};
        return Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
      }),
      800
    );
    if (res) return res;
    try {
      const dbUrl = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) || (window.firebaseConfig && window.firebaseConfig.databaseURL) || 'https://viaglyph-workspace-default-rtdb.firebaseio.com';
      const r = await fetch(`${dbUrl}/workLogs.json`);
      if (r.ok) {
        const val = await r.json() || {};
        return Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
      }
    } catch(e){}
    return null;
  },

  // 5. GET GOALS
  async getGoals() {
    if (!this.isOnline()) return null;
    return this._withTimeout(
      window.firebaseDb.ref('goals').once('value').then(snap => normalizeGoals(snap.val())),
      500
    );
  },

  // 6. GET MEMBER STATUS
  async getMemberStatus() {
    if (!this.isOnline()) return null;
    return this._withTimeout(
      window.firebaseDb.ref('memberStatus').once('value').then(snap => snap.val() || {}),
      500
    );
  },

  // 7. GET DAILY MEMOS
  async getDailyMemos() {
    if (!this.isOnline()) return null;
    return this._withTimeout(
      window.firebaseDb.ref('dailyMemos').once('value').then(snap => snap.val() || {}),
      500
    );
  },

  // 8. ADD TASK
  async addTask(task) {
    if (!this.isOnline()) return { success: true };
    const taskCtx = task.ctx || 'dev';
    const taskId = task.id || Date.now();
    return this._withTimeout(
      window.firebaseDb.ref(`tasks/${taskCtx}/${taskId}`).set(task).then(() => ({ success: true })),
      500
    ).then(res => res || { success: true });
  },

  // 9. UPDATE TASK
  async updateTask(id, updates, taskCtx) {
    if (!this.isOnline()) return { success: true };
    if (!taskCtx && typeof DATA !== 'undefined') {
      const allDev = DATA?.dev?.tasks || [];
      taskCtx = allDev.some(t => t.id === id) ? 'dev' : 'biz';
    }
    if (!taskCtx) taskCtx = 'dev';
    return this._withTimeout(
      window.firebaseDb.ref(`tasks/${taskCtx}/${id}`).update(updates).then(() => ({ success: true })),
      500
    ).then(res => res || { success: true });
  },

  // 10. ADD WORK LOG
  async addWorkLog(log) {
    if (!this.isOnline()) return { success: true };
    const key = log.id || window.firebaseDb.ref('workLogs').push().key;
    const fullLog = { ...log, id: key };
    return this._withTimeout(
      window.firebaseDb.ref(`workLogs/${key}`).set(fullLog).then(() => ({ success: true, id: key })),
      2000
    ).then(res => (res && res.id) ? res : { success: true, id: key });
  },

  // 11. UPDATE GOALS
  async saveGoals(goalsData) {
    if (!this.isOnline()) return { success: true };
    return this._withTimeout(
      window.firebaseDb.ref('goals').set(goalsData).then(() => ({ success: true })),
      2000
    ).then(res => res || { success: true });
  },

  // 12. UPDATE MEMBER STATUS
  async updateMemberStatus(userShort, status) {
    if (!this.isOnline()) return { success: true };
    const key = USER_KEY_MAP[userShort] || userShort;
    return this._withTimeout(
      window.firebaseDb.ref(`memberStatus/${key}`).set(status).then(() => ({ success: true })),
      2000
    ).then(res => res || { success: true });
  },

  // 13. SAVE DAILY MEMO
  async saveDailyMemo(date, user, memo) {
    if (!this.isOnline()) return { success: true };
    const dateKey = String(date).replace(/[^0-9-]/g, '');
    return this._withTimeout(
      window.firebaseDb.ref(`dailyMemos/${dateKey}`).set(memo).then(() => ({ success: true })),
      2000
    ).then(res => res || { success: true });
  },

  // 14. SLACK / DISCORD NOTIFICATION PROXIES (Cloud Functions Proxy)
  async sendSlackMessage(channel, messagePayload) {
    const rawBaseUrl = (typeof window !== 'undefined' && window.FUNCTIONS_BASE_URL)
      ? window.FUNCTIONS_BASE_URL
      : 'https://us-central1-viaglyph-workspace.cloudfunctions.net';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/sendSlackMessage`;

    let payload = {};
    if (typeof channel === 'object' && channel !== null) {
      payload = channel;
    } else {
      payload = { channel, messagePayload };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: await workspaceAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const contentType = res.headers ? (res.headers.get('content-type') || '') : '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok && !data.error) {
          data.error = `HTTP ${res.status}: ${res.statusText || 'Server Error'}`;
        }
        return data;
      } else {
        const text = await res.text();
        return {
          success: false,
          error: `HTTP ${res.status}: ${res.statusText || 'Server Error'}`,
          details: text ? text.substring(0, 300) : undefined
        };
      }
    } catch (err) {
      console.warn('sendSlackMessage network error:', err);
      return { success: false, error: err.message || 'ネットワークエラー' };
    }
  },

  async createSlackCanvas(title, markdown, channel) {
    const rawBaseUrl = (typeof window !== 'undefined' && window.FUNCTIONS_BASE_URL)
      ? window.FUNCTIONS_BASE_URL
      : 'https://us-central1-viaglyph-workspace.cloudfunctions.net';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/createSlackCanvas`;

    let payload = {};
    if (typeof title === 'object' && title !== null) {
      payload = title;
    } else {
      payload = { title, markdown, channel };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: await workspaceAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const contentType = res.headers ? (res.headers.get('content-type') || '') : '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok && !data.error) {
          data.error = `HTTP ${res.status}: ${res.statusText || 'Server Error'}`;
        }
        return data;
      } else {
        const text = await res.text();
        return {
          success: false,
          error: `HTTP ${res.status}: ${res.statusText || 'Server Error'}`,
          details: text ? text.substring(0, 300) : undefined
        };
      }
    } catch (err) {
      console.warn('createSlackCanvas network error:', err);
      return { success: false, error: err.message || 'ネットワークエラー' };
    }
  },

  // ─── DATA SYNC & REALTIME LISTENERS ───
  async syncAll() {
    this.initRealtimeListeners();
    if (!this.isOnline()) return {};

    const results = {};
    try {
      const [tasks, workLogs, goals, memberStatus, dailyMemos] = await Promise.all([
        this.getTasks(),
        this.getWorkLogs(),
        this.getGoals(),
        this.getMemberStatus(),
        this.getDailyMemos()
      ]);

      if (tasks) {
        if (typeof DATA !== 'undefined') {
          if (tasks.dev) DATA.dev.tasks = Array.isArray(tasks.dev) ? tasks.dev.filter(Boolean) : Object.values(tasks.dev);
          if (tasks.biz) DATA.biz.tasks = Array.isArray(tasks.biz) ? tasks.biz.filter(Boolean) : Object.values(tasks.biz);
        }
        localStorage.setItem('vg_synced_tasks', JSON.stringify(tasks));
        results.tasks = tasks;
        if (typeof renderAll === 'function') renderAll();
      }
      if (workLogs) {
        const rtdbLogs = Array.isArray(workLogs) ? workLogs.filter(Boolean) : Object.values(workLogs);
        const currentLocal = (typeof window.workLogs !== 'undefined' && Array.isArray(window.workLogs)) ? window.workLogs : [];
        for (const item of currentLocal) {
          if (item && item.comment && !rtdbLogs.some(r => r.comment === item.comment && String(r.taskId) === String(item.taskId))) {
            rtdbLogs.push(item);
          }
        }
        window.workLogs = rtdbLogs;
        if (typeof workLogs !== 'undefined') workLogs = rtdbLogs;
        localStorage.setItem('vg_work_logs', JSON.stringify(rtdbLogs));
        results.workLogs = rtdbLogs;
        if (typeof renderTimeline === 'function') renderTimeline();
        if (typeof renderDaily === 'function') renderDaily();
        if (typeof renderMembers === 'function') renderMembers();
      }
      if (goals) {
        const goalsArr = normalizeGoals(goals);
        window.goals = goalsArr;
        if (typeof goals !== 'undefined') goals = goalsArr;
        localStorage.setItem('vg_goals', JSON.stringify(goalsArr));
        results.goals = goalsArr;
        if (typeof renderGoals === 'function') renderGoals();
      }
      if (memberStatus) {
        window.memberStatuses = memberStatus;
        if (typeof memberStatuses !== 'undefined') memberStatuses = memberStatus;
        localStorage.setItem('vg_member_status', JSON.stringify(memberStatus));
        results.statuses = memberStatus;
        if (typeof renderMembers === 'function') renderMembers();
      }
      if (dailyMemos) {
        window.dailyMemos = dailyMemos;
        if (typeof dailyMemos !== 'undefined') dailyMemos = dailyMemos;
        localStorage.setItem('vg_daily_memos', JSON.stringify(dailyMemos));
        results.memos = dailyMemos;
        if (typeof renderDaily === 'function') renderDaily();
      }
    } catch (err) {
      console.warn('syncAll error:', err);
    }
    return results;
  },

  initRealtimeListeners() {
    if (this._listenersAttached || !this.isOnline()) return;
    this._listenersAttached = true;
    console.log('📡 Subscribing to RTDB realtime listeners...');

    // 1. Tasks listener
    window.firebaseDb.ref('tasks').on('value', (snap) => {
      const val = snap.val();
      if (!val) return;
      if (typeof DATA !== 'undefined') {
        if (val.dev) DATA.dev.tasks = Array.isArray(val.dev) ? val.dev.filter(Boolean) : Object.values(val.dev);
        if (val.biz) DATA.biz.tasks = Array.isArray(val.biz) ? val.biz.filter(Boolean) : Object.values(val.biz);
      }
      localStorage.setItem('vg_synced_tasks', JSON.stringify(val));
      if (typeof renderAll === 'function') renderAll();
      if (typeof populateTaskSelect === 'function') populateTaskSelect();
    });

    // 2. WorkLogs listener
    window.firebaseDb.ref('workLogs').on('value', (snap) => {
      const val = snap.val() || {};
      const rtdbLogs = Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
      const currentLocal = (typeof window.workLogs !== 'undefined' && Array.isArray(window.workLogs)) ? window.workLogs : [];
      for (const item of currentLocal) {
        if (item && item.comment && !rtdbLogs.some(r => r.comment === item.comment && String(r.taskId) === String(item.taskId))) {
          rtdbLogs.push(item);
        }
      }
      window.workLogs = rtdbLogs;
      if (typeof workLogs !== 'undefined') workLogs = rtdbLogs;
      localStorage.setItem('vg_work_logs', JSON.stringify(rtdbLogs));
      if (typeof renderTimeline === 'function') renderTimeline();
      if (typeof renderDaily === 'function') renderDaily();
      if (typeof renderMembers === 'function') renderMembers();
    });

    // 3. Goals listener
    window.firebaseDb.ref('goals').on('value', (snap) => {
      const val = snap.val();
      if (!val) return;
      const goalsArr = normalizeGoals(val);
      window.goals = goalsArr;
      if (typeof goals !== 'undefined') goals = goalsArr;
      localStorage.setItem('vg_goals', JSON.stringify(goalsArr));
      if (typeof renderGoals === 'function') renderGoals();
      const projPage = document.getElementById('project-page');
      if (projPage?.classList?.contains?.('open') && typeof currentProjectId !== 'undefined' && currentProjectId && typeof openProjectPage === 'function') {
        openProjectPage(currentProjectId);
      }
    });

    // 4. MemberStatus listener
    window.firebaseDb.ref('memberStatus').on('value', (snap) => {
      const val = snap.val();
      if (!val) return;
      if (typeof memberStatuses !== 'undefined') memberStatuses = val;
      else window.memberStatuses = val;
      localStorage.setItem('vg_member_status', JSON.stringify(val));
      if (typeof renderMembers === 'function') renderMembers();
    });

    // 5. DailyMemos listener
    window.firebaseDb.ref('dailyMemos').on('value', (snap) => {
      const val = snap.val();
      if (!val) return;
      if (typeof dailyMemos !== 'undefined') dailyMemos = val;
      else window.dailyMemos = val;
      localStorage.setItem('vg_daily_memos', JSON.stringify(val));
      if (typeof renderDaily === 'function') {
        renderDaily();
      }
    });
  },

  detachRealtimeListeners() {
    if (!this._listenersAttached || !this.isOnline()) return;
    window.firebaseDb.ref('tasks').off();
    window.firebaseDb.ref('workLogs').off();
    window.firebaseDb.ref('goals').off();
    window.firebaseDb.ref('memberStatus').off();
    window.firebaseDb.ref('dailyMemos').off();
    this._listenersAttached = false;
  }
};

window.API = API;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (window.firebaseDb && typeof window.firebaseDb.goOnline === 'function') {
      try { window.firebaseDb.goOnline(); } catch (e) { console.warn(e); }
    }
    if (window.API && typeof window.API.syncAll === 'function') {
      window.API.syncAll();
    }
  });
}
