/* report.js - レポート画面 (GAS版) */
const ReportView = {
  async render() {
    const records = await Store.fetchRecords();

    const weeklyMins = Store.getWeeklyTotal(records);
    document.getElementById('weekly-total').textContent = DateUtils.formatDuration(weeklyMins);

    const dailyMins = Store.getTotalMinutesForDate(records, DateUtils.today());
    document.getElementById('daily-total').textContent = DateUtils.formatDuration(dailyMins);

    const streak = Store.getStreak(records);
    document.getElementById('streak-total').textContent = `🔥 ${streak}日`;

    Chart.renderBarChart('bar-chart', records);
    Chart.renderPieChart('pie-chart', 'pie-legend', records);
  }
};
