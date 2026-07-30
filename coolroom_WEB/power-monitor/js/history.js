/**
 * history.js
 * Lets the user pick a date (and optionally an hour) plus a metric,
 * then draws a line or bar chart of the stored readings for that
 * window by querying php/api.php?action=history.
 */
(function () {
  const API_URL = 'php/api.php';

  const METRIC_COLORS = {
    temperature: () => cssVar('--accent-temp'),
    humidity: () => cssVar('--accent-hum'),
    current: () => cssVar('--accent-current'),
    voltage: () => cssVar('--accent-volt'),
  };

  const METRIC_LABELS = {
    temperature: 'Temperature (°C)',
    humidity: 'Humidity (%RH)',
    current: 'Current (A)',
    voltage: 'Voltage (V)',
  };

  let historyChart = null;
  let historyView = 'line';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#FFB454';
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function populateHourSelect() {
    const select = document.getElementById('historyHour');
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = String(h).padStart(2, '0');
      opt.textContent = `${String(h).padStart(2, '0')}:00 – ${String(h).padStart(2, '0')}:59`;
      select.appendChild(opt);
    }
  }

  function setDefaultDate() {
    const dateInput = document.getElementById('historyDate');
    const today = new Date();
    dateInput.value = today.toISOString().slice(0, 10);
    // don't allow picking dates further back than the 30-day retention window
    const minDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    dateInput.min = minDate.toISOString().slice(0, 10);
    dateInput.max = today.toISOString().slice(0, 10);
  }

  async function fetchHistory(metric, date, hour) {
    const params = new URLSearchParams({ action: 'history', metric, date });
    if (hour) params.set('hour', hour);
    const res = await fetch(`${API_URL}?${params.toString()}`);
    if (!res.ok) throw new Error('history request failed');
    return res.json();
  }

  function buildDataset(metric, points) {
    const color = METRIC_COLORS[metric] ? METRIC_COLORS[metric]() : cssVar('--accent-current');
    return {
      label: METRIC_LABELS[metric] || metric,
      data: points.map(p => Number(p.value)),
      borderColor: color,
      backgroundColor: historyView === 'bar' ? color : hexToRgba(color, 0.15),
      fill: historyView === 'line',
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
      borderRadius: historyView === 'bar' ? 3 : 0,
    };
  }

  function renderChart(labels, datasets) {
    const wrap = document.getElementById('historyEmpty').parentElement;
    const noData = datasets.every(ds => ds.data.length === 0);
    wrap.classList.toggle('is-empty', noData);
    if (noData) return;

    if (historyChart) historyChart.destroy();
    const ctx = document.getElementById('chart-history').getContext('2d');
    const textDim = cssVar('--text-dim');
    const border = cssVar('--border');

    historyChart = new Chart(ctx, {
      type: historyView,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: textDim, font: { family: 'IBM Plex Mono', size: 11 } },
          },
        },
        scales: {
          x: {
            ticks: { color: textDim, maxTicksLimit: 12, font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: border },
          },
          y: {
            ticks: { color: textDim, font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: border },
          },
        },
      },
    });
  }

  async function loadHistory() {
    const date = document.getElementById('historyDate').value;
    const hour = document.getElementById('historyHour').value;
    const metricSel = document.getElementById('historyMetric').value;
    if (!date) return;

    const metrics = metricSel === 'all'
      ? ['temperature', 'humidity', 'current', 'voltage']
      : [metricSel];

    try {
      const results = await Promise.all(metrics.map(m => fetchHistory(m, date, hour)));
      let labels = [];
      const datasets = results.map((json, i) => {
        const points = json.data || [];
        if (points.length > labels.length) labels = points.map(p => p.time_label);
        return buildDataset(metrics[i], points);
      });
      renderChart(labels, datasets);
    } catch (err) {
      console.error('failed to load history', err);
      document.getElementById('chart-history').parentElement.classList.add('is-empty');
    }
  }

  function wireControls() {
    document.getElementById('loadHistoryBtn').addEventListener('click', loadHistory);

    document.querySelectorAll('[data-history-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-history-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        historyView = btn.getAttribute('data-history-view');
        loadHistory();
      });
    });

    document.addEventListener('themechange', loadHistory);
  }

  function init() {
    populateHourSelect();
    setDefaultDate();
    wireControls();
    loadHistory();
  }

  window.PSUHistory = { init };
})();
