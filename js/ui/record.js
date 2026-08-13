/* record.js - 記録画面 (GAS版) */
const RecordView = {
  selectedTags: [],

  init() {
    this.form = document.getElementById('record-form');
    this.projectSelect = document.getElementById('record-project');
    this.hoursInput = document.getElementById('record-hours');
    this.minutesInput = document.getElementById('record-minutes');
    this.commentInput = document.getElementById('record-comment');
    this.blockerInput = document.getElementById('record-blocker');
    this.quickTags = document.getElementById('quick-tags');
    this.useStopwatchBtn = document.getElementById('btn-use-stopwatch');
    this.submitBtn = document.getElementById('btn-submit');

    this.quickTags.querySelectorAll('.tag').forEach(tag => {
      tag.addEventListener('click', () => {
        tag.classList.toggle('selected');
        const val = tag.dataset.tag;
        if (this.selectedTags.includes(val)) {
          this.selectedTags = this.selectedTags.filter(t => t !== val);
        } else {
          this.selectedTags.push(val);
        }
      });
    });

    this.useStopwatchBtn.addEventListener('click', () => {
      const mins = Stopwatch.getMinutes();
      this.hoursInput.value = Math.floor(mins / 60);
      this.minutesInput.value = mins % 60;
    });

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  },

  async submit() {
    const project = this.projectSelect.value;
    const hours = parseInt(this.hoursInput.value) || 0;
    const minutes = parseInt(this.minutesInput.value) || 0;
    const totalMinutes = hours * 60 + minutes;

    if (!project) { App.showToast('プロジェクトを選択してください'); return; }
    if (totalMinutes <= 0) { App.showToast('作業時間を入力してください'); return; }

    // Disable button while saving
    this.submitBtn.disabled = true;
    this.submitBtn.querySelector('.btn-submit-text').textContent = '保存中...';

    const record = {
      project,
      durationMinutes: totalMinutes,
      tags: [...this.selectedTags],
      comment: this.commentInput.value.trim(),
      blocker: this.blockerInput.value.trim()
    };

    const result = await Store.addRecord(record);

    this.submitBtn.disabled = false;
    this.submitBtn.querySelector('.btn-submit-text').textContent = '記録を保存';

    if (result && result.ok) {
      Confetti.launch();
      App.showToast('✅ 記録を保存しました！');
      this.resetForm();
      Stopwatch.reset();
      App.updateStreak();
      setTimeout(() => App.switchView('timeline'), 800);
    } else {
      App.showToast('❌ 保存に失敗しました。GAS URLを確認してください。');
    }
  },

  resetForm() {
    this.form.reset();
    this.selectedTags = [];
    this.quickTags.querySelectorAll('.tag').forEach(t => t.classList.remove('selected'));
    this.hoursInput.value = 0;
    this.minutesInput.value = 0;
  },

  async updateProjectOptions() {
    const records = await Store.fetchRecords();
    const projects = Store.getProjects(records);
    const current = this.projectSelect.value;
    this.projectSelect.innerHTML = '<option value="">選択してください</option>' +
      projects.map(p => `<option value="${p}" ${p === current ? 'selected' : ''}>${p}</option>`).join('');
  }
};
