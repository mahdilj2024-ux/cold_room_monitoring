/**
 * charts.js
 * Powers the "Charts" page: fetches php/api.php?action=range for all
 * four metrics across a chosen date range and renders one chart per
 * metric, switchable between line and bar.
 */
(function () {
  const API_URL = 'php/api.php';

  const METRIC_COLORS = {
    temperature: () => cssVar('--accent-temp'),
    humidity: () => cssVar('--accent-hum'),
    current: () => cssVar('--accent-current'),
    voltage: () => cssVar('--accent-volt'),
  };

  const METRICS = ['temperature', 'humidity', 'current', 'voltage'];

  let chartType = 'line';
  const chartInstances = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#FFB454';
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function setDefaultRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000); // last 7 days
    document.getElementById('rangeTo').value = to.toISOString().slice(0, 10);
    document.getElementById('rangeFrom').value = from.toISOString().slice(0, 10);

    const minDate = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    document.getElementById('rangeFrom').min = minDate.toISOString().slice(0, 10);
    document.getElementById('rangeFrom').max = to.toISOString().slice(0, 10);
    document.getElementById('rangeTo').min = minDate.toISOString().slice(0, 10);
    document.getElementById('rangeTo').max = to.toISOString().slice(0, 10);
  }

  function destroyChart(metric) {
    if (chartInstances[metric]) {
      chartInstances[metric].destroy();
      chartInstances[metric] = null;
    }
  }

  function renderMetricChart(metric, points) {
    const canvas = document.getElementById('chart-range-' + metric);
    const emptyEl = document.getElementById('empty-' + metric);

    destroyChart(metric);

    if (!points || points.length === 0) {
      canvas.style.visibility = 'hidden';
      emptyEl.style.display = 'flex';
      return;
    }
    canvas.style.visibility = 'visible';
    emptyEl.style.display = 'none';

    const color = METRIC_COLORS[metric]();
    const textDim = cssVar('--text-dim');
    const border = cssVar('--border');

    chartInstances[metric] = new Chart(canvas.getContext('2d'), {
      type: chartType,
      data: {
        labels: points.map(p => p.time_label),
        datasets: [{
          data: points.map(p => p.value),
          borderColor: color,
          backgroundColor: chartType === 'bar' ? color : hexToRgba(color, 0.18),
          fill: chartType === 'line',
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          borderRadius: chartType === 'bar' ? 3 : 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: textDim, maxTicksLimit: 8, font: { family: 'IBM Plex Mono', size: 10 } },
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

  async function loadRangeCharts() {
    const dateFrom = document.getElementById('rangeFrom').value;
    const dateTo = document.getElementById('rangeTo').value;
    if (!dateFrom || !dateTo) return;

    try {
      const params = new URLSearchParams({ action: 'range', metric: 'all', date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API_URL}?${params.toString()}`);
      const json = await res.json();

      if (json.error) {
        console.error('range API error:', json.error, json.detail);
        METRICS.forEach(metric => renderMetricChart(metric, []));
        return;
      }

      METRICS.forEach(metric => renderMetricChart(metric, json.data?.[metric] || []));
    } catch (err) {
      console.error('failed to load range charts', err);
    }
  }

  function wireControls() {
    document.getElementById('loadRangeBtn').addEventListener('click', loadRangeCharts);

    document.querySelectorAll('[data-range-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-range-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        chartType = btn.getAttribute('data-range-view');
        loadRangeCharts();
      });
    });

    document.addEventListener('themechange', loadRangeCharts);
  }

  function init() {
    setDefaultRange();
    wireControls();
    loadRangeCharts();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
