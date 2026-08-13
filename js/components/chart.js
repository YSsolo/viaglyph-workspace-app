/* chart.js - グラフ描画 (records引数版) */
const Chart = {
  renderBarChart(containerId, records) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const dates = DateUtils.getWeekDates();
    const maxMinutes = Math.max(...dates.map(d => Store.getTotalMinutesForDate(records, d)), 60);

    dates.forEach(dateStr => {
      const mins = Store.getTotalMinutesForDate(records, dateStr);
      const pct = Math.max((mins / maxMinutes) * 100, 3);
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="bar-value">${mins > 0 ? DateUtils.formatDuration(mins) : ''}</div>
        <div class="bar" style="height: ${pct}%"></div>
        <div class="bar-label">${DateUtils.dayLabel(dateStr)}</div>
      `;
      container.appendChild(col);
    });
  },

  renderPieChart(canvasId, legendId, records) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const legend = document.getElementById(legendId);
    const data = Store.getCategoryBreakdown(records);
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const total = entries.reduce((s, [, v]) => s + v, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    legend.innerHTML = '';

    if (total === 0) {
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.arc(100, 100, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#616161';
      ctx.font = '14px "Google Sans", "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('データなし', 100, 105);
      return;
    }

    const colors = ['#005BAC', '#D25400', '#007E46', '#644696', '#B91C1C', '#008282', '#8A5C00'];
    let startAngle = -Math.PI / 2;

    entries.forEach(([label, value], i) => {
      const sliceAngle = (value / total) * Math.PI * 2;
      const color = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(100, 100);
      ctx.arc(100, 100, 80, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      startAngle += sliceAngle;

      const pct = Math.round((value / total) * 100);
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <span class="legend-dot" style="background:${color}"></span>
        <span class="legend-label">${label}</span>
        <span class="legend-pct">${pct}%</span>
      `;
      legend.appendChild(item);
    });

    ctx.beginPath();
    ctx.arc(100, 100, 45, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 16px "Google Sans", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(DateUtils.formatDuration(total), 100, 100);
    ctx.font = '10px "Google Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#616161';
    ctx.fillText('合計', 100, 116);
  }
};
