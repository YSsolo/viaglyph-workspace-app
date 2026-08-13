/* date.js - 日付ユーティリティ */
const DateUtils = {
  today() { return new Date().toISOString().split('T')[0]; },
  now() { return new Date().toISOString(); },
  timeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}時間前`;
    const d = Math.floor(h / 24);
    return `${d}日前`;
  },
  formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
  dayLabel(dateStr) {
    const d = new Date(dateStr);
    return ['日','月','火','水','木','金','土'][d.getDay()];
  },
  getWeekDates() {
    const dates = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  },
  countdownTo(targetDate) {
    const diff = new Date(targetDate).getTime() - Date.now();
    if (diff <= 0) return '終了';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    return `${d}日 ${h}時間`;
  }
};
