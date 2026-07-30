/**
 * gauges.js
 * Renders the Current and Voltage panels as semi-circular analog-style
 * gauges by default, with buttons to switch each panel to a line or
 * bar chart of recent trend data (pulled from php/api.php).
 */
(function () {
  const API_URL = 'php/api.php';

  const GAUGE_CONFIG = {
    temperature: { max: 60, unit: '°C', color: () => cssVar('--accent-temp'), label: 'Temperature (°C)' },
    humidity:    { max: 100, unit: '%RH', color: () => cssVar('--accent-hum'), label: 'Humidity (%RH)' },
    current:     { max: 20, unit: 'A', color: () => cssVar('--accent-current'), label: 'Current (A)' },
    voltage:     { max: 250, unit: 'V', color: () => cssVar('--accent-volt'), label: 'Voltage (V)' },
  };

  const METRICS = Object.keys(GAUGE_CONFIG);

  const state = {
    temperature: { view: 'gauge', chart: null, latest: 0 },
    humidity:    { view: 'gauge', chart: null, latest: 0 },
    current:     { view: 'gauge', chart: null, latest: 0 },
    voltage:     { view: 'gauge', chart: null, latest: 0 },
  };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#FFB454';
  }

  function destroyChart(metric) {
    if (state[metric].chart) {
      state[metric].chart.destroy();
      state[metric].chart = null;
    }
  }

  function buildGaugeChart(metric) {
    const cfg = GAUGE_CONFIG[metric];
    const ctx = document.getElementById('chart-' + metric).getContext('2d');
    const value = state[metric].latest || 0;
    const remainder = Math.max(cfg.max - value, 0);
    const track = cssVar('--track');

    return new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [value, remainder],
          backgroundColor: [cfg.color(), track],
          borderWidth: 0,
        }],
      },
      options: {
        rotation: -90,
        circumference: 180,
        cutout: '78%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  }

  function buildTrendChart(metric, view, points) {
    const cfg = GAUGE_CONFIG[metric];
    const ctx = document.getElementById('chart-' + metric).getContext('2d');
    const textDim = cssVar('--text-dim');
    const border = cssVar('--border');

    const labels = points.map(p => p.label);
    const values = points.map(p => p.value);

    return new Chart(ctx, {
      type: view === 'bar' ? 'bar' : 'line',
      data: {
        labels,
        datasets: [{
          label: cfg.label,
          data: values,
          borderColor: cfg.color(),
          backgroundColor: view === 'bar' ? cfg.color() : hexToRgba(cfg.color(), 0.18),
          fill: view === 'line',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          borderRadius: view === 'bar' ? 4 : 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 400 },
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: textDim, maxTicksLimit: 6, font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: border },
          },
          y: {
            ticks: { color: textDim, font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: border },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3
      ? h.split('').map(c => c + c).join('')
      : h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  async function fetchTrend(metric) {
    try {
      const res = await fetch(`${API_URL}?action=trend&metric=${encodeURIComponent(metric)}&limit=40`);
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      return (json.data || []).map(row => ({
        label: row.time_label,
        value: Number(row.value),
      }));
    } catch (err) {
      console.error('trend fetch failed for', metric, err);
      return [];
    }
  }

  function setCenterVisible(metric, visible) {
    const el = document.getElementById('center-' + metric);
    if (el) el.style.display = visible ? 'flex' : 'none';
  }

  async function renderView(metric, view) {
    state[metric].view = view;
    destroyChart(metric);

    if (view === 'gauge') {
      setCenterVisible(metric, true);
      state[metric].chart = buildGaugeChart(metric);
      return;
    }

    setCenterVisible(metric, false);
    const points = await fetchTrend(metric);
    state[metric].chart = buildTrendChart(metric, view, points);
  }

  function wireButtons() {
    document.querySelectorAll('.gauge-card').forEach(card => {
      const metric = card.getAttribute('data-gauge');
      card.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          card.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderView(metric, btn.getAttribute('data-view'));
        });
      });
    });
  }

  function updateLatest(data) {
    METRICS.forEach(metric => {
      if (data[metric] === undefined || data[metric] === null) return;
      state[metric].latest = Number(data[metric]);
      const centerVal = document.getElementById('gaugeval-' + metric);
      if (centerVal) centerVal.textContent = Number(data[metric]).toFixed(2);

      if (state[metric].view === 'gauge' && state[metric].chart) {
        const cfg = GAUGE_CONFIG[metric];
        const value = state[metric].latest;
        const remainder = Math.max(cfg.max - value, 0);
        state[metric].chart.data.datasets[0].data = [value, remainder];
        state[metric].chart.update('none');
      }
    });
  }

  function reflectThemeChange() {
    METRICS.forEach(metric => renderView(metric, state[metric].view));
  }

  function init() {
    wireButtons();
    METRICS.forEach(metric => renderView(metric, 'gauge'));
    document.addEventListener('themechange', reflectThemeChange);
  }

  window.PSUGauges = { init, updateLatest };
})();
