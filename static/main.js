/* ═══════════════════════════════════════════════════════
   main.js — Impala Tool
   ═══════════════════════════════════════════════════════ */

/* ── 공통: DOM 헬퍼 ── */
const $ = (id) => document.getElementById(id);

/* ── 공통: 탭 전환 ── */
function switchTab(id) {
  document.querySelectorAll('.app-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  $('tab-' + id).classList.add('active');
  $('content-' + id).classList.add('active');
}

/* ── 공통: 토스트 ── */
let _toastTimer = null;
function showToast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

/* ── XSS 방지 이스케이프 ── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════
   QUERY MONITORING
   ═══════════════════════════════════════════════════════ */

let _qmSelectedHost  = null;
let _qmSelectedColor = null;

/* 쿼리 데이터 캐시 — onclick에 JSON 직접 삽입 시 단일 인용부호 오류 방지 */
const _qmQueryCache = new Map();

/* 사이드바 로드 */
async function qmLoadSidebar() {
  const resp = await fetch('/monitor/coordinators');
  if (!resp.ok) return;
  const { clusters } = await resp.json();

  const opsEl  = $('sb-ops');
  const userEl = $('sb-user');

  clusters.forEach(cl => {
    _CLUSTER_COLOR.set(cl.id, cl.color);
    if (cl.ops.length > 0)  opsEl.appendChild(buildClusterGroup(cl, cl.ops));
    if (cl.user.length > 0) userEl.appendChild(buildClusterGroup(cl, cl.user));
  });
}

function buildClusterGroup(cl, coords) {
  const group = document.createElement('div');
  group.className = 'cluster-group';

  const hdr = document.createElement('div');
  hdr.className = 'cluster-hdr';
  hdr.innerHTML = `<div class="cluster-dot" style="background:${cl.color}"></div>
    ${esc(cl.id)} <span class="chev">▾</span>`;
  hdr.onclick = () => toggleClusterGroup(hdr);

  const list = document.createElement('div');
  list.className = 'cluster-coords';

  coords.forEach(coord => {
    const item = document.createElement('div');
    item.className = 'coord-item';
    item.textContent = coord.host;
    item.dataset.host  = coord.host;
    item.dataset.port  = coord.port;
    item.dataset.color = cl.color;
    item.onclick = () => qmSelectCoord(item);
    list.appendChild(item);
  });

  group.appendChild(hdr);
  group.appendChild(list);
  return group;
}

function toggleClusterGroup(hdr) {
  const list = hdr.nextElementSibling;
  const chev = hdr.querySelector('.chev');
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? 'block' : 'none';
  chev.textContent = hidden ? '▾' : '▸';
}

function qmSelectCoord(item) {
  document.querySelectorAll('.coord-item').forEach(el => {
    el.classList.remove('active');
    el.style.borderLeftColor = 'transparent';
    el.style.color = '';
    el.style.fontWeight = '';
  });
  item.classList.add('active');
  item.style.borderLeftColor = item.dataset.color;
  item.style.color = item.dataset.color;
  item.style.fontWeight = '600';

  _qmSelectedHost  = item.dataset.host;
  _qmSelectedColor = item.dataset.color;

  $('qm-infobar').style.borderLeftColor = item.dataset.color;
  const nameEl = $('qm-coord-name');
  nameEl.textContent     = item.dataset.host;
  nameEl.style.color     = '#1a1d2e';
  nameEl.style.fontStyle = 'normal';
  $('qm-refresh-btn').disabled = false;

  qmFetchQueries();
}

/* 새로고침 */
function qmRefresh() {
  if (_qmSelectedHost) qmFetchQueries();
}

/* 섹션 접기/펼치기 */
function toggleSec(hdr) {
  const body = hdr.nextElementSibling;
  const chev = hdr.querySelector('.chev');
  const collapsed = body.classList.toggle('collapsed');
  chev.textContent = collapsed ? '▸' : '▾';
}

/* 쿼리 조회 */
async function qmFetchQueries() {
  const host = _qmSelectedHost;
  try {
    const resp = await fetch(`/monitor/queries/${encodeURIComponent(host)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const inflight  = data.in_flight_queries    || [];
    const waiting   = data.waiting_to_be_closed || [];
    const completed = data.completed_queries    || [];

    renderInflight(inflight);
    renderWaiting(waiting);
    renderCompleted(completed);

    $('ib-inflight').textContent  = inflight.length;
    $('ib-waiting').textContent   = waiting.length;
    $('ib-completed').textContent = completed.length;

    updateSecCnt('sec-cnt-inflight',  inflight.length,  'blue');
    updateSecCnt('sec-cnt-waiting',   waiting.length,   'amber');
    updateSecCnt('sec-cnt-completed', completed.length, 'green');
  } catch (e) {
    showToast(`조회 실패: ${e.message}`, true);
  }
}

function updateSecCnt(id, n, colorClass) {
  const el = $(id);
  el.textContent = n;
  el.className = 'sec-cnt' + (n > 0 ? ' ' + colorClass : '');
}

/* ── 렌더 함수 공통 ── */
function emptyRow(colspan, msg) {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:#b0b8cc;padding:20px;font-style:italic">${msg}</td></tr>`;
}

function stateBadge(state) {
  return state === 'EXCEPTION'
    ? '<span class="badge-sm badge-exception-sm">EXCEPTION</span>'
    : '<span class="badge-sm badge-finished-sm">FINISHED</span>';
}

/* Query ID 셀 (클릭 → 상세 모달) */
function qidCell(q) {
  return `<td class="mono" onclick="openModal('${esc(_qmSelectedHost)}','${esc(q.query_id)}')">${esc(q.query_id)}</td>`;
}

/* Cancel 버튼 셀 */
function cancelCell(q) {
  return `<td><button class="btn-cancel" onclick="qmCancel(this,'${esc(q.query_id)}')">Cancel</button></td>`;
}

/* 공통 메타 셀들 (User / DB / Type) */
function metaCells(q) {
  return `
    <td>${esc(q.effective_user || '')}</td>
    <td style="color:#8892a4">${esc(q.default_db || '')}</td>
    <td>${esc(q.stmt_type || '')}</td>`;
}

function stmtCell(q) {
  return `<td class="stmt-cell" title="${esc(q.stmt || '')}">${esc(q.stmt || '')}</td>`;
}

/* 행 추가 */
function appendRow(tbody, html) {
  const tr = document.createElement('tr');
  tr.innerHTML = html;
  tbody.appendChild(tr);
}

/* ── 렌더: In-Flight ── */
function renderInflight(queries) {
  const tbody = $('tbody-inflight');
  tbody.innerHTML = '';
  if (!queries.length) {
    tbody.innerHTML = emptyRow(14, '실행 중인 쿼리 없음');
    return;
  }
  queries.forEach(q => {
    _qmQueryCache.set(q.query_id, q);
    const pct = parseInt(q.progress) || 0;
    appendRow(tbody, `
      ${qidCell(q)}
      ${cancelCell(q)}
      ${metaCells(q)}
      <td><span class="badge-sm badge-running-sm">${esc(q.state || '')}</span></td>
      <td>
        <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div>
        <span style="font-size:10px;color:#8892a4">${pct}%</span>
      </td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#b0b8cc">${q.rows_fetched != null ? q.rows_fetched : '—'}</td>
      <td>${esc(q.mem_usage || '')}</td>
      <td style="color:#8892a4;font-size:11px">${esc(q.last_event || '')}</td>
      <td style="font-size:11px;color:#8892a4">${esc(q.resource_pool || '')}</td>
      ${stmtCell(q)}`);
  });
}

/* ── 렌더: Waiting ── */
function renderWaiting(queries) {
  const tbody = $('tbody-waiting');
  tbody.innerHTML = '';
  if (!queries.length) {
    tbody.innerHTML = emptyRow(13, '대기 중인 쿼리 없음');
    return;
  }
  queries.forEach(q => {
    _qmQueryCache.set(q.query_id, q);
    appendRow(tbody, `
      ${qidCell(q)}
      ${cancelCell(q)}
      ${metaCells(q)}
      <td>${stateBadge(q.state)}</td>
      <td><span style="color:#e67e22;font-weight:700">${esc(q.waiting_time || '')}</span></td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.end_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#27ae60">${q.rows_fetched != null ? q.rows_fetched : '—'}</td>
      <td>${esc(q.mem_usage || '')}</td>
      ${stmtCell(q)}`);
  });
}

/* ── 렌더: Completed ── */
function renderCompleted(queries) {
  const tbody = $('tbody-completed');
  tbody.innerHTML = '';
  if (!queries.length) {
    tbody.innerHTML = emptyRow(14, '완료된 쿼리 없음');
    return;
  }
  queries.forEach(q => {
    _qmQueryCache.set(q.query_id, q);
    appendRow(tbody, `
      ${qidCell(q)}
      ${metaCells(q)}
      <td>${stateBadge(q.state)}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.end_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#8892a4">${esc(q.queued_duration || '—')}</td>
      <td>${q.rows_fetched != null ? q.rows_fetched : '—'}</td>
      <td>${esc(q.bytes_read || '—')}</td>
      <td>${esc(q.mem_usage || '')}</td>
      <td style="font-size:11px;color:#8892a4">${esc(q.resource_pool || '')}</td>
      ${stmtCell(q)}`);
  });
}

/* Cancel */
async function qmCancel(btn, queryId) {
  btn.disabled = true;
  btn.textContent = '취소 중…';
  const row = btn.closest('tr');
  try {
    const resp = await fetch(
      `/monitor/cancel/${encodeURIComponent(_qmSelectedHost)}/${encodeURIComponent(queryId)}`,
      { method: 'POST' }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    row.style.opacity = '0.4';
    row.style.transition = 'opacity .4s';
    setTimeout(() => {
      row.remove();
      qmRefreshCounts();
      showToast('쿼리가 취소되었습니다.');
    }, 400);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Cancel';
    showToast(`취소 실패: ${e.message}`, true);
  }
}

function qmRefreshCounts() {
  ['inflight', 'waiting', 'completed'].forEach(key => {
    const tbody = $('tbody-' + key);
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => !tr.querySelector('td[colspan]')).length;
    const cnt = $('sec-cnt-' + key);
    if (cnt) cnt.textContent = rows;
    const ib = $('ib-' + key);
    if (ib) ib.textContent = rows;
  });
}

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

/* ═══════════════════════════════════════════════════════
   쿼리 상세 모달
   ═══════════════════════════════════════════════════════ */

let _modalHost  = null;
let _modalQid   = null;
let _planLoaded = false;
let _profLoaded = false;

function openModal(host, queryId) {
  _modalHost  = host;
  _modalQid   = queryId;
  _planLoaded = false;
  _profLoaded = false;

  $('modal-query-id').textContent = queryId;

  const q = _qmQueryCache.get(queryId) || {};
  const rows = q.rows_fetched != null
    ? q.rows_fetched
    : (q.rowsProduced != null ? q.rowsProduced : '—');

  const fields = [
    ['State',        q.state          || q.queryState || ''],
    ['User',         q.effective_user || q.user       || ''],
    ['DB',           q.default_db     || q.defaultDb  || ''],
    ['Start',        q.start_time     || q.startTime  || ''],
    ['End',          q.end_time       || q.endTime    || ''],
    ['Duration',     q.duration       || ''],
    ['Rows',         rows],
    ['Bytes Read',   q.bytes_read     || '—'],
    ['Mem Usage',    q.mem_usage      || ''],
    ['Pool',         q.resource_pool  || ''],
    ['Backends',     q.backends       || '—'],
    ['Session Type', q.session_type   || '—'],
  ];
  $('modal-meta').innerHTML = fields.map(([k, v]) =>
    `<div class="meta-item"><div class="mk">${esc(k)}</div><div class="mv">${esc(String(v))}</div></div>`
  ).join('');

  $('modal-stmt').textContent    = q.stmt || q.statement || '';
  $('modal-plan').textContent    = '불러오는 중…';
  $('modal-profile').textContent = '불러오는 중…';

  $('dl-text').onclick   = () => dlProfile('text');
  $('dl-json').onclick   = () => dlProfile('json');
  $('dl-thrift').onclick = () => dlProfile('thrift');

  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-pane').forEach(p => p.classList.remove('active'));
  document.querySelector('.modal-tab[data-pane="summary"]').classList.add('active');
  $('pane-summary').classList.add('active');

  $('modal-overlay').classList.add('show');
}

function closeModal(e) {
  if (e && e.target !== $('modal-overlay') && e.target !== $('modal-close')) return;
  $('modal-overlay').classList.remove('show');
}

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-pane').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  const pane = tab.dataset.pane;
  $('pane-' + pane).classList.add('active');

  if (pane === 'plan' && !_planLoaded) {
    _planLoaded = true;
    loadModalDetail('plan', 'modal-plan');
  }
  if (pane === 'profile' && !_profLoaded) {
    _profLoaded = true;
    loadModalDetail('profile', 'modal-profile');
  }
}

async function loadModalDetail(type, elId) {
  const el = $(elId);
  try {
    const resp = await fetch(
      `/monitor/detail/${encodeURIComponent(_modalHost)}/${encodeURIComponent(_modalQid)}/${type}`
    );
    el.textContent = resp.ok ? await resp.text() : `오류: HTTP ${resp.status}`;
  } catch (e) {
    el.textContent = `오류: ${e.message}`;
  }
}

function dlProfile(fmt) {
  const ext = fmt === 'text' ? 'txt' : fmt;
  const url = `/monitor/download/${encodeURIComponent(_modalHost)}/${encodeURIComponent(_modalQid)}/${fmt}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `profile_${_modalQid}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ═══════════════════════════════════════════════════════
   앱 초기화
   ═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  qmLoadSidebar();
  qeInit();
});
