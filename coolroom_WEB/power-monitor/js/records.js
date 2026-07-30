/**
 * records.js
 * Powers the "All Records" table page: fetches paginated rows from
 * php/api.php?action=records, renders them, and handles date filters,
 * pagination controls, and a client-side CSV export of the current page.
 */
(function () {
  const API_URL = 'php/api.php';

  const state = {
    page: 1,
    perPage: 25,
    dateFrom: '',
    dateTo: '',
    totalPages: 1,
    total: 0,
    rows: [],
  };

  function el(id) { return document.getElementById(id); }

  function formatTimestamp(raw) {
    // raw is "YYYY-MM-DD HH:MM:SS" from MySQL
    return raw.replace('T', ' ');
  }

  function renderRows() {
    const body = el('recordsBody');
    const empty = el('recordsEmpty');

    if (state.rows.length === 0) {
      body.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    body.innerHTML = state.rows.map(row => `
      <tr>
        <td>${row.id}</td>
        <td>${formatTimestamp(row.recorded_at)}</td>
        <td class="cell-temp">${Number(row.temperature).toFixed(1)}</td>
        <td class="cell-hum">${Number(row.humidity).toFixed(1)}</td>
        <td class="cell-current">${Number(row.current).toFixed(3)}</td>
        <td class="cell-volt">${Number(row.voltage).toFixed(2)}</td>
      </tr>
    `).join('');
  }

  function renderPagination() {
    const start = state.total === 0 ? 0 : (state.page - 1) * state.perPage + 1;
    const end = Math.min(state.page * state.perPage, state.total);
    el('paginationInfo').textContent = `Showing ${start}–${end} of ${state.total} records`;
    el('pageIndicator').textContent = `Page ${state.page} of ${state.totalPages}`;

    el('firstPageBtn').disabled = state.page <= 1;
    el('prevPageBtn').disabled = state.page <= 1;
    el('nextPageBtn').disabled = state.page >= state.totalPages;
    el('lastPageBtn').disabled = state.page >= state.totalPages;
  }

  async function loadRecords() {
    const params = new URLSearchParams({
      action: 'records',
      page: state.page,
      per_page: state.perPage,
    });
    if (state.dateFrom) params.set('date_from', state.dateFrom);
    if (state.dateTo) params.set('date_to', state.dateTo);

    try {
      const res = await fetch(`${API_URL}?${params.toString()}`);
      const json = await res.json();

      if (json.error) {
        console.error('records API error:', json.error, json.detail);
        state.rows = [];
        state.total = 0;
        state.totalPages = 1;
        renderRows();
        renderPagination();
        return;
      }

      state.rows = json.data || [];
      state.total = json.pagination?.total ?? 0;
      state.totalPages = json.pagination?.total_pages ?? 1;
      state.page = json.pagination?.page ?? state.page;

      renderRows();
      renderPagination();
    } catch (err) {
      console.error('failed to load records', err);
    }
  }

  function exportCsv() {
    if (state.rows.length === 0) return;
    const header = ['id', 'recorded_at', 'temperature_c', 'humidity_pct', 'current_a', 'voltage_v'];
    const lines = [header.join(',')];
    state.rows.forEach(row => {
      lines.push([
        row.id,
        formatTimestamp(row.recorded_at),
        row.temperature,
        row.humidity,
        row.current,
        row.voltage,
      ].join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psu-records-page${state.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function wireControls() {
    el('applyFilters').addEventListener('click', () => {
      state.dateFrom = el('filterFrom').value;
      state.dateTo = el('filterTo').value;
      state.perPage = Number(el('perPage').value);
      state.page = 1;
      loadRecords();
    });

    el('clearFilters').addEventListener('click', () => {
      el('filterFrom').value = '';
      el('filterTo').value = '';
      state.dateFrom = '';
      state.dateTo = '';
      state.page = 1;
      loadRecords();
    });

    el('exportCsv').addEventListener('click', exportCsv);

    el('firstPageBtn').addEventListener('click', () => { state.page = 1; loadRecords(); });
    el('prevPageBtn').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); loadRecords(); });
    el('nextPageBtn').addEventListener('click', () => { state.page = Math.min(state.totalPages, state.page + 1); loadRecords(); });
    el('lastPageBtn').addEventListener('click', () => { state.page = state.totalPages; loadRecords(); });
  }

  function init() {
    wireControls();
    loadRecords();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
