/* stopwatch.js - ストップウォッチ */
const Stopwatch = {
  startTime: null, elapsed: 0, interval: null, running: false,

  init() {
    this.display = document.getElementById('stopwatch-display');
    this.toggleBtn = document.getElementById('btn-stopwatch-toggle');
    this.resetBtn = document.getElementById('btn-stopwatch-reset');
    this.icon = document.getElementById('stopwatch-icon');
    this.useBtn = document.getElementById('btn-use-stopwatch');

    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.resetBtn.addEventListener('click', () => this.reset());
  },

  toggle() {
    if (this.running) { this.pause(); } else { this.start(); }
  },

  start() {
    this.running = true;
    this.startTime = Date.now() - this.elapsed;
    this.interval = setInterval(() => this.update(), 100);
    this.display.classList.add('running');
    this.toggleBtn.classList.add('running');
    this.icon.textContent = '⏸';
  },

  pause() {
    this.running = false;
    this.elapsed = Date.now() - this.startTime;
    clearInterval(this.interval);
    this.display.classList.remove('running');
    this.toggleBtn.classList.remove('running');
    this.icon.textContent = '▶';
    if (this.elapsed > 0) this.useBtn.style.display = 'block';
  },

  reset() {
    this.running = false;
    this.elapsed = 0;
    clearInterval(this.interval);
    this.display.textContent = '00:00:00';
    this.display.classList.remove('running');
    this.toggleBtn.classList.remove('running');
    this.icon.textContent = '▶';
    this.useBtn.style.display = 'none';
  },

  update() {
    this.elapsed = Date.now() - this.startTime;
    const totalSec = Math.floor(this.elapsed / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    this.display.textContent = `${h}:${m}:${s}`;
  },

  getMinutes() {
    return Math.round(this.elapsed / 60000);
  }
};
