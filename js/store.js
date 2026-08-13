/* store.js - Firebase Realtime Database Data Access Helper */

const Store = {
  _cache: { records: null, users: null, lastFetch: 0 },
  CACHE_TTL: 30000,

  // === Records / WorkLogs ===
  async fetchRecords(forceRefresh) {
    if (typeof API !== 'undefined' && API.isOnline()) {
      const logs = await API.getWorkLogs();
      if (logs) {
        this._cache.records = logs;
        this._cache.lastFetch = Date.now();
        return logs;
      }
    }
    return this._cache.records || (typeof workLogs !== 'undefined' ? workLogs : []);
  },

  async addRecord(record) {
    if (typeof API !== 'undefined' && API.isOnline()) {
      const res = await API.addWorkLog(record);
      return res;
    }
    if (typeof addWorkLog === 'function') {
      addWorkLog(record.taskId, record.durationMinutes || record.minutes || 0, record.tags || [], record.comment || '');
      return { ok: true, id: Date.now() };
    }
    return { ok: true };
  },

  async deleteRecord(id) {
    if (this._cache.records) {
      this._cache.records = this._cache.records.filter(r => r.id !== id);
    }
    return { ok: true };
  },

  async toggleReaction(recordId, emoji) {
    return { ok: true };
  },

  // === Stats ===
  _getRecordsByDate(records, dateStr) {
    return records.filter(r => (r.date || r.createdAt?.split('T')[0]) === dateStr);
  },

  getTotalMinutesForDate(records, dateStr) {
    return this._getRecordsByDate(records, dateStr)
      .reduce((sum, r) => sum + (r.durationMinutes || r.minutes || 0), 0);
  },

  getWeeklyTotal(records) {
    const dates = (typeof DateUtils !== 'undefined' && DateUtils.getWeekDates) ? DateUtils.getWeekDates() : [];
    return dates.reduce((sum, d) => sum + this.getTotalMinutesForDate(records, d), 0);
  },

  getCategoryBreakdown(records) {
    const map = {};
    records.forEach(r => {
      const key = r.project || 'その他';
      map[key] = (map[key] || 0) + (r.durationMinutes || r.minutes || 0);
    });
    return map;
  },

  getStreak(records) {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      if (this._getRecordsByDate(records, dateStr).length > 0) {
        streak++;
      } else {
        if (i === 0) continue;
        break;
      }
    }
    return streak;
  },

  // === Users ===
  async fetchUsers() {
    if (typeof API !== 'undefined' && API.isOnline()) {
      const status = await API.getMemberStatus();
      if (status) return status;
    }
    return [];
  },

  getProjects(records) {
    const defaults = ['ViaGLYPH開発', 'マーケティング', 'DB設計', 'ミーティング', 'リサーチ', 'その他'];
    const fromRecords = [...new Set(records.map(r => r.project).filter(Boolean))];
    return [...new Set([...defaults, ...fromRecords])];
  },

  getUserByEmail(users, email) {
    return users.find(u => u.email === email) || { name: email, avatar: '👤' };
  }
};
