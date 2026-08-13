/* app.js - メインアプリケーション (GAS版) */

const Auth = {
  SESSION_KEY: 'dl_session',

  getCurrentUser() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); } catch { return null; }
  },

  async login(email, password) {
    if (typeof API !== 'undefined') return API.login(email, password);
    return { ok: false, error: 'API未初期化' };
  },

  quickLogin(email, name, avatar) {
    const session = { email, name, avatar };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    return { ok: true, user: session };
  },

  logout() {
    localStorage.removeItem(this.SESSION_KEY);
  },

  isLoggedIn() {
    return this.getCurrentUser() !== null;
  }
};

const App = {
  currentView: 'timeline',

  init() {
    if (!Auth.isLoggedIn()) {
      this.showLogin();
      return;
    }
    this.onLoginSuccess();
  },

  showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').style.display = 'none';
    this.bindLoginEvents();
  },

  bindLoginEvents() {
    const form = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      const submitBtn = form.querySelector('.btn-submit');
      submitBtn.textContent = 'ログイン中...';
      submitBtn.disabled = true;

      const result = await Auth.login(email, password);

      submitBtn.textContent = 'ログイン';
      submitBtn.disabled = false;

      if (result.ok) {
        this.onLoginSuccess();
      } else {
        errorEl.textContent = result.error;
        errorEl.style.display = 'block';
      }
    });

    document.querySelectorAll('.login-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        Auth.quickLogin(btn.dataset.email, btn.dataset.name, btn.dataset.avatar);
        this.onLoginSuccess();
      });
    });
  },

  onLoginSuccess() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    this.bootApp();
  },

  bootApp() {
    Confetti.init();
    Stopwatch.init();
    TimelineView.init();
    RecordView.init();
    TasksView.init();
    SettingsView.init();

    const user = Auth.getCurrentUser();
    if (user) {
      const headerRight = document.querySelector('.header-right');
      const userEl = document.createElement('div');
      userEl.className = 'header-user';
      userEl.innerHTML = `<span class="header-user-avatar">${user.avatar}</span><span>${user.name.split(' ')[0]}</span>`;
      userEl.addEventListener('click', () => {
        if (confirm('ログアウトしますか？')) {
          Auth.logout();
          location.reload();
        }
      });
      headerRight.insertBefore(userEl, headerRight.firstChild);
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => this.switchView(item.dataset.view));
    });

    this.refreshAll();
  },

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === viewName));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');
    this.renderView(viewName);
    document.getElementById('main-content').scrollTop = 0;
  },

  async renderView(viewName) {
    switch (viewName) {
      case 'timeline': await TimelineView.render(); break;
      case 'report': await ReportView.render(); break;
      case 'record': await RecordView.updateProjectOptions(); break;
      case 'tasks': await TasksView.render(); break;
    }
  },

  async refreshAll() {
    await this.updateStreak();
    await this.renderView(this.currentView);
  },

  async updateStreak() {
    const records = await Store.fetchRecords();
    const streak = Store.getStreak(records);
    document.getElementById('streak-count').textContent = streak;
  },

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
