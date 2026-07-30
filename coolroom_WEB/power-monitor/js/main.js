/**
 * main.js
 * Bootstraps the dashboard: polls php/api.php?action=latest on an
 * interval, updates the numeric readout cards, the gauge values,
 * and the live-clock indicator.
 */
(function () {
  const API_URL = 'php/api.php';
  const POLL_INTERVAL_MS = 5000;

  const METRICS = ['temperature', 'humidity', 'current', 'voltage'];
  const DECIMALS = { temperature: 1, humidity: 1, current: 2, voltage: 1 };

  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour12: false });
  }

  function updateReadouts(data) {
    METRICS.forEach(metric => {
      const el = document.getElementById('val-' + metric);
      if (el && data[metric] !== undefined && data[metric] !== null) {
        el.textContent = Number(data[metric]).toFixed(DECIMALS[metric]);
      }
      const rangeEl = document.getElementById('range-' + metric);
      if (rangeEl && data[metric + '_min'] !== undefined) {
        const min = Number(data[metric + '_min']).toFixed(DECIMALS[metric]);
        const max = Number(data[metric + '_max']).toFixed(DECIMALS[metric]);
        rangeEl.textContent = `min ${min} / max ${max} today`;
      }
    });
  }

  function setLiveState(isLive) {
    const indicator = document.getElementById('liveIndicator');
    indicator.style.opacity = isLive ? '1' : '.55';
  }

  async function pollLatest() {
    try {
      const res = await fetch(`${API_URL}?action=latest`);
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      if (json && json.data) {
        updateReadouts(json.data);
        window.PSUGauges.updateLatest(json.data);
        setLiveState(true);
      } else {
        setLiveState(false);
      }
    } catch (err) {
      console.error('failed to poll latest data', err);
      setLiveState(false);
    }
    document.getElementById('liveTime').textContent = formatTime(new Date());
  }

  function init() {
    window.PSUGauges.init();
    window.PSUHistory.init();
    pollLatest();
    setInterval(pollLatest, POLL_INTERVAL_MS);
    setInterval(() => {
      document.getElementById('liveTime').textContent = formatTime(new Date());
    }, 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
