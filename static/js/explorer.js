/* ═══════════════════════════════════════════════════════
   QUERY EXPLORER
   ═══════════════════════════════════════════════════════ */

let _allRows       = [];
let _rows          = [];
let _activeState   = '';
let _activeCluster = '';
let _openRows      = new Set();
let _sortCol       = 'startTime';
let _sortAsc       = false;
let _activeHours   = 1;
let _es            = null;

/* 클러스터 색상 — qmLoadSidebar에서 API 응답으로 채워짐 */
const _CLUSTER_COLOR = new Map();

function _hexToRgba(hex, alpha) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function _clFg(id)  { return _CLUSTER_COLOR.get(id) || '#4361ee'; }
function _clBg(id)  { return _hexToRgba(_clFg(id), 0.12); }
const _STATE_BADGE_CLS = {
  FINISHED: 'badge-finished', RUNNING: 'badge-running',
  EXCEPTION: 'badge-exception', QUEUED: 'badge-queued',
};

/* duration(ms) → 사람이 읽는 문자열 */
function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000)  return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/* 초기화 */
async function qeInit() {
  await qeLoadClusters();
  qeAddCondRow();
  qeSetPreset(1);

  $('qe-search-btn').onclick = qeSearch;
  $('qe-reset-btn').onclick  = qeReset;
  $('qe-stop-btn').onclick   = qeStop;
  $('qe-add-cond').onclick   = qeAddCondRow;

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => qeSetPreset(parseInt(btn.dataset.h));
  });

  document.querySelector('.filters').addEventListener('keydown', e => {
    if (e.key === 'Enter') qeSearch();
  });
}

async function qeLoadClusters() {
  const resp = await fetch('/explorer/clusters');
  const { clusters } = await resp.json();

  const sel = $('qe-cluster-select');
  clusters.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  });

  const tabBar = $('qe-cluster-tabs');
  clusters.forEach(id => {
    const tab = document.createElement('div');
    tab.className = 'stab';
    tab.dataset.cluster = id;
    tab.onclick = () => qeSelectCluster(tab);
    tab.innerHTML = `${esc(id)} <span class="cnt">0</span>`;
    tabBar.appendChild(tab);
  });
  tabBar.querySelector('[data-cluster=""]').querySelector('.cnt').textContent = '0';
}

/* 빠른 범위 */
function qeSetPreset(h) {
  _activeHours = h;
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.h) === h);
  });
  $('qe-from').value = '';
  $('qe-to').value   = '';
}

/* 조건 행 추가 */
function qeAddCondRow() {
  const area = $('qe-conds');
  const row  = document.createElement('div');
  row.className = 'cond-row';
  row.innerHTML = `
    <select class="cond-val" style="min-width:80px">
      <option value="keyword">keyword</option>
      <option value="user">user</option>
    </select>
    <input class="cond-val" type="text" placeholder="검색어" style="min-width:140px">
    <button class="cond-remove" onclick="this.closest('.cond-row').remove()" title="제거">×</button>`;
  area.appendChild(row);
}

/* 검색 폼 → URLSearchParams */
function qeBuildSearchParams() {
  const user       = $('qe-user').value.trim();
  const qtype      = $('qe-qtype').value;
  const clusterSel = $('qe-cluster-select').value;
  const fromVal    = $('qe-from').value.trim();
  const toVal      = $('qe-to').value.trim();

  const conditions = [];
  if (user) conditions.push({ field: 'user', value: user });
  document.querySelectorAll('#qe-conds .cond-row').forEach(row => {
    const field = row.querySelector('select').value;
    const value = row.querySelector('input').value.trim();
    if (value) conditions.push({ field, value });
  });

  const params = new URLSearchParams();
  if (qtype)   params.set('query_type', qtype);
  if (fromVal) params.set('from_time', fromVal);
  if (toVal)   params.set('to_time', toVal);
  if (!fromVal && !toVal) params.set('hours', _activeHours);
  if (clusterSel) params.set('clusters', clusterSel);
  if (conditions.length) params.set('conditions', JSON.stringify(conditions));

  return params;
}

/* 검색 */
function qeSearch() {
  if (_es) { _es.close(); _es = null; }
  _allRows = [];
  _rows    = [];
  _openRows.clear();
  $('qe-tbody').innerHTML = '';

  const params = qeBuildSearchParams();

  $('qe-search-btn').disabled = true;
  $('qe-stop-btn').style.display = '';
  $('qe-progress').classList.add('show');
  $('qe-progress-text').textContent = '검색 중…';
  $('qe-progress-bar').style.width = '0%';
  $('qe-summary').style.display = 'none';

  _es = new EventSource(`/explorer/queries/stream?${params}`);
  _es.onmessage = e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'progress') {
      const pct = ev.total > 0 ? Math.round(ev.chunk / ev.total * 100) : 0;
      $('qe-progress-bar').style.width = pct + '%';
      $('qe-progress-text').textContent =
        `검색 중… 청크 ${ev.chunk}/${ev.total || '?'}  수집: ${ev.collected}건`;
      if (ev.new_queries && ev.new_queries.length > 0) {
        _allRows.push(...ev.new_queries);
        qeApplyFilters();
      }
    } else if (ev.type === 'done') {
      _allRows = ev.queries || [];
      qeApplyFilters();
      qeFinish(ev);
    }
  };
  _es.onerror = () => {
    showToast('스트리밍 오류 발생', true);
    qeFinish(null);
  };
}

function qeStop() {
  if (_es) { _es.close(); _es = null; }
  qeFinish(null);
  showToast('검색 중지');
}

function qeFinish(ev) {
  if (_es) { _es.close(); _es = null; }
  $('qe-search-btn').disabled = false;
  $('qe-stop-btn').style.display = 'none';
  $('qe-progress').classList.remove('show');
  if (ev) {
    $('qe-summary').style.display = '';
    $('qe-summary-text').textContent = `총 ${ev.total || _allRows.length}건`;
  }
}

/* 필터 적용 */
function qeApplyFilters() {
  let rows = _allRows;
  if (_activeState)   rows = rows.filter(r => r.queryState === _activeState);
  if (_activeCluster) rows = rows.filter(r => r._cluster   === _activeCluster);
  _rows = rows;
  qeUpdateCounts();
  qeRenderTable();
}

function qeUpdateCounts() {
  const byState   = {};
  const byCluster = {};
  _allRows.forEach(r => {
    byState[r.queryState] = (byState[r.queryState] || 0) + 1;
    byCluster[r._cluster] = (byCluster[r._cluster] || 0) + 1;
  });
  $('cnt-all').textContent       = _allRows.length;
  $('cnt-finished').textContent  = byState['FINISHED']  || 0;
  $('cnt-running').textContent   = byState['RUNNING']   || 0;
  $('cnt-exception').textContent = byState['EXCEPTION'] || 0;

  document.querySelectorAll('#qe-cluster-tabs .stab').forEach(tab => {
    const cl = tab.dataset.cluster;
    const n  = cl ? (byCluster[cl] || 0) : _allRows.length;
    tab.querySelector('.cnt').textContent = n;
  });
}

/* 테이블 렌더 */
function qeRenderTable() {
  const sorted = [..._rows].sort((a, b) => {
    const av = a[_sortCol] ?? '';
    const bv = b[_sortCol] ?? '';
    return _sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const tbody = $('qe-tbody');
  tbody.innerHTML = '';

  sorted.forEach(q => {
    const expanded     = _openRows.has(q.queryId);
    const stateCls     = _STATE_BADGE_CLS[q.queryState] || '';
    const clBadgeColor = _clFg(q._cluster);
    const clBadgeBg    = _clBg(q._cluster);
    const dur          = formatDuration(q.durationMillis);

    const statusVal  = (q.attributes && q.attributes.query_status) || '';
    const isOk       = statusVal === 'OK' || !statusVal;
    const statusHtml = isOk
      ? `<span class="ok-block">${esc(statusVal || 'OK')}</span>`
      : `<span class="err-block">${esc(statusVal)}</span>`;

    const tr = document.createElement('tr');
    if (expanded) tr.classList.add('expanded');
    tr.innerHTML = `
      <td class="expand-btn" onclick="qeToggleRow('${esc(q.queryId)}')">${expanded ? '▼' : '▶'}</td>
      <td><span style="background:${clBadgeBg};color:${clBadgeColor};padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700">${esc(q._cluster)}</span></td>
      <td class="mono" onclick="qeOpenProfile('${esc(q._cluster)}','${esc(q.queryId)}')">${esc(q.queryId)}</td>
      <td style="font-weight:500">${esc(q.user || '')}</td>
      <td style="color:#8892a4">${esc((q.attributes && q.attributes.connected_user) || '')}</td>
      <td><span class="badge ${stateCls}">${esc(q.queryState || '')}</span></td>
      <td class="stmt-cell" title="${esc(q.statement || '')}">${esc(q.statement || '')}</td>
      <td>${dur}</td>
      <td>${q.rowsProduced != null ? q.rowsProduced.toLocaleString() : '—'}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.startTime || '')}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.endTime || '')}</td>
      <td>${statusHtml}</td>`;
    tbody.appendChild(tr);

    if (expanded) {
      const exp = document.createElement('tr');
      exp.className = 'expand-row';
      const statusNote = statusVal ? '\n\n[Status] ' + esc(statusVal) : '';
      exp.innerHTML = `<td colspan="12"><div class="expand-content">${esc(q.statement || '')}${statusNote}</div></td>`;
      tbody.appendChild(exp);
    }
  });
}

function qeToggleRow(queryId) {
  if (_openRows.has(queryId)) _openRows.delete(queryId);
  else _openRows.add(queryId);
  qeRenderTable();
}

/* 정렬 */
function qeSort(th) {
  const col = th.dataset.col;
  if (_sortCol === col) {
    _sortAsc = !_sortAsc;
  } else {
    _sortCol = col;
    _sortAsc = false;
  }
  qeRenderTable();
}

/* 상태 탭 */
function qeSelectState(el) {
  document.querySelectorAll('#qe-state-tabs .stab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  _activeState = el.dataset.state;
  qeApplyFilters();
}

/* 클러스터 탭 */
function qeSelectCluster(el) {
  document.querySelectorAll('#qe-cluster-tabs .stab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  _activeCluster = el.dataset.cluster;
  qeApplyFilters();
}

/* 프로파일 (새 탭) */
function qeOpenProfile(clusterId, queryId) {
  window.open(`/explorer/profile/${encodeURIComponent(clusterId)}/${encodeURIComponent(queryId)}`, '_blank');
}

/* 초기화 */
function qeReset() {
  $('qe-user').value = '';
  $('qe-conds').innerHTML = '';
  qeAddCondRow();
  $('qe-cluster-select').value = '';
  $('qe-qtype').value = 'QUERY';
  $('qe-from').value = '';
  $('qe-to').value   = '';
  qeSetPreset(1);
}
