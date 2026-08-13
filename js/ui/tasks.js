/* tasks.js - タスク管理画面 (GAS版) */
const TasksView = {
  init() {
    this.addBtn = document.getElementById('btn-add-project');
    this.addBtn.addEventListener('click', () => this.addProject());
  },

  async render() {
    const countdown = DateUtils.countdownTo('2026-05-18T23:59:59');
    document.getElementById('countdown-display').textContent = countdown;

    const records = await Store.fetchRecords();
    const projects = Store.getProjects(records);
    const container = document.getElementById('project-list-items');

    container.innerHTML = projects.map(p => {
      const count = records.filter(r => r.project === p).length;
      return `
        <div class="project-item">
          <span class="project-name">${p}</span>
          <span class="project-count">${count}件の記録</span>
        </div>
      `;
    }).join('');
  },

  addProject() {
    const name = prompt('新しいプロジェクト名を入力:');
    if (name && name.trim()) {
      // Projects are auto-discovered from records, so just show toast
      App.showToast(`📋 新しいプロジェクト名「${name.trim()}」で記録を作成してください`);
    }
  }
};
