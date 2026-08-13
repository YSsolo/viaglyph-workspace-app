/* settings.js - 設定画面 (GAS版) */
const SettingsView = {
  init() {
    this.exportBtn = document.getElementById('btn-export');
    this.clearBtn = document.getElementById('btn-clear');

    // Remove profile editing (managed by Users sheet)
    const profileGroup = document.querySelector('.settings-group:first-child');
    if (profileGroup) {
      const user = Auth.getCurrentUser();
      if (user) {
        profileGroup.innerHTML = `
          <h3 class="section-title">プロフィール</h3>
          <div style="text-align:center; padding: 16px;">
            <div style="font-size: 3rem; margin-bottom: 8px;">${user.avatar}</div>
            <div style="font-size: 1.1rem; font-weight: 600;">${user.name}</div>
            <div style="color: var(--text-muted); font-size: 0.85rem;">${user.email}</div>
          </div>
        `;
      }
    }

    this.exportBtn.addEventListener('click', () => this.exportData());
    this.clearBtn.style.display = 'none'; // No local data to clear

    // Update version
    const versionEl = document.querySelector('.app-version');
    if (versionEl) versionEl.textContent = 'DailyLog v0.2.0 — ViaGLYPH Team (Google Sheets Backend)';
  },

  async exportData() {
    const records = await Store.fetchRecords();
    const data = JSON.stringify({ records, exportedAt: DateUtils.now() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dailylog_export_${DateUtils.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    App.showToast('📤 データをエクスポートしました');
  }
};
