/* timeline.js - タイムライン画面 (GAS版) */
const TimelineView = {
  init() {
    this.list = document.getElementById('timeline-list');
    this.empty = document.getElementById('timeline-empty');
  },

  async render() {
    this.list.innerHTML = '<div class="loading">読み込み中...</div>';
    this.empty.style.display = 'none';
    this.list.style.display = 'flex';

    const records = await Store.fetchRecords();
    const users = await Store.fetchUsers();

    if (!records || records.length === 0) {
      this.list.style.display = 'none';
      this.empty.style.display = 'block';
      return;
    }

    this.list.innerHTML = records.map(r => this.renderCard(r, users)).join('');
    this.bindReactions();
  },

  renderCard(record, users) {
    const user = Store.getUserByEmail(users, record.email);
    const tagsHtml = (record.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');
    const blockerHtml = record.blocker ? `<div class="card-blocker">😰 ${this.escapeHtml(record.blocker)}</div>` : '';
    const commentHtml = record.comment ? `<div class="card-comment">${this.escapeHtml(record.comment)}</div>` : '';
    const reactions = record.reactions || {};
    const reactionEmojis = ['👍','🔥','💡','🙏'];

    return `
      <div class="record-card" data-id="${record.id}">
        <div class="card-header">
          <div class="card-user">
            <span class="card-avatar">${user.avatar}</span>
            <span class="card-name">${this.escapeHtml(user.name)}</span>
          </div>
          <span class="card-time-ago">${DateUtils.timeAgo(record.createdAt)}</span>
        </div>
        <div class="card-project">${this.escapeHtml(record.project)}</div>
        <div class="card-duration">${DateUtils.formatDuration(record.durationMinutes)}</div>
        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
        ${commentHtml}
        ${blockerHtml}
        <div class="card-reactions">
          ${reactionEmojis.map(e => `
            <button class="reaction-btn ${reactions[e] ? 'active' : ''}" data-record="${record.id}" data-emoji="${e}">
              ${e}<span class="count">${reactions[e] || ''}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  },

  bindReactions() {
    this.list.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const recordId = btn.dataset.record;
        const emoji = btn.dataset.emoji;
        await Store.toggleReaction(recordId, emoji);
        this.render();
      });
    });
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
