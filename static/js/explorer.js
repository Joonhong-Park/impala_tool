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
let _page          = 1;
const _pageSize    = 100;
let _fpFrom        = null;
let _fpTo          = null;

/* Date → "YYYY-MM-DD HH:MM" (KST, 텍스트 입력 표시용) */
function _toDatetimeLocal(date) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

/* ISO 시각 → KST "YYYY-MM-DD HH:mm:ss" */
function formatKST(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19);
}

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
  qeAddCondRow();

  const fpOpts = {
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    time_24hr: true,
    locale: 'ko',
    allowInput: true,
  };
  _fpFrom = flatpickr($('qe-from'), fpOpts);
  _fpTo   = flatpickr($('qe-to'),   fpOpts);

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

  /* 클러스터 목록 로딩 실패가 위 UI 초기화(달력 등)를 막지 않도록 분리 */
  try {
    await qeLoadClusters();
  } catch (e) {
    showToast(`클러스터 목록을 불러오지 못했습니다: ${e.message}`, true);
  }
}

async function qeLoadClusters() {
  const resp = await fetch('/explorer/clusters');
  const { clusters } = await resp.json();

  const sel = $('qe-cluster-select');
  clusters.forEach(({ id, color }) => {
    _CLUSTER_COLOR.set(id, color);

    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  });

  const tabBar = $('qe-cluster-tabs');
  clusters.forEach(({ id }) => {
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
  const now     = new Date();
  const fromStr = _toDatetimeLocal(new Date(now.getTime() - h * 3600 * 1000));
  const toStr   = _toDatetimeLocal(now);
  if (_fpFrom) _fpFrom.setDate(fromStr, true); else $('qe-from').value = fromStr;
  if (_fpTo)   _fpTo.setDate(toStr,   true);   else $('qe-to').value   = toStr;
}

/* 조건 행 추가 */
function qeAddCondRow() {
  const area = $('qe-conds');
  const row  = document.createElement('div');
  row.className = 'cond-row';
  row.innerHTML = `
    <input class="cond-val" type="text" placeholder="table, 키워드 등" style="min-width:160px">
    <button class="cond-remove" onclick="this.closest('.cond-row').remove()" title="제거">×</button>`;
  area.appendChild(row);
}

/* 검색 폼 → URLSearchParams */
function qeBuildSearchParams() {
  const qtype      = $('qe-qtype').value;
  const clusterSel = $('qe-cluster-select').value;
  const fromVal    = $('qe-from').value.trim().replace(' ', 'T');
  const toVal      = $('qe-to').value.trim().replace(' ', 'T');

  const conditions = [];
  const userVal = ($('qe-user').value || '').trim();
  if (userVal) conditions.push({ field: 'user', value: userVal });
  document.querySelectorAll('#qe-conds input').forEach(input => {
    const value = input.value.trim();
    if (value) conditions.push({ field: 'keyword', value });
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

function _resetStateTabs() {
  _activeState   = '';
  _activeCluster = '';
  document.querySelectorAll('#qe-state-tabs .stab, #qe-cluster-tabs .stab').forEach(t => t.classList.remove('active'));
  document.querySelector('#qe-state-tabs [data-state=""]').classList.add('active');
  document.querySelector('#qe-cluster-tabs [data-cluster=""]').classList.add('active');
}

/* 검색 */
function qeSearch() {
  if (_es) { _es.close(); _es = null; }
  _resetStateTabs();
  _allRows = [];
  _rows    = [];
  _page    = 1;
  _openRows.clear();
  $('qe-tbody').innerHTML = '';
  $('qe-pagination').style.display = 'none';

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
      if (ev.queries && ev.queries.length > 0) _allRows = ev.queries;
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
  if (_activeCluster) rows = rows.filter(r => r._cluster   === _activeCluster);
  if (_activeState)   rows = rows.filter(r => r.queryState === _activeState);
  _rows = rows;
  qeUpdateCounts();
  qeRenderTable();
}

function qeUpdateCounts() {
  /* 클러스터 탭 카운트: 전체 행 기준 */
  const byCluster = {};
  _allRows.forEach(r => {
    byCluster[r._cluster] = (byCluster[r._cluster] || 0) + 1;
  });

  document.querySelectorAll('#qe-cluster-tabs .stab').forEach(tab => {
    const cl = tab.dataset.cluster;
    tab.querySelector('.cnt').textContent = cl ? (byCluster[cl] || 0) : _allRows.length;
  });

  /* 상태 탭 카운트: 선택된 클러스터 기준 */
  const clusterBase = _activeCluster
    ? _allRows.filter(r => r._cluster === _activeCluster)
    : _allRows;

  const byState = {};
  clusterBase.forEach(r => {
    byState[r.queryState] = (byState[r.queryState] || 0) + 1;
  });

  $('cnt-all').textContent       = clusterBase.length;
  $('cnt-finished').textContent  = byState['FINISHED']  || 0;
  $('cnt-running').textContent   = byState['RUNNING']   || 0;
  $('cnt-exception').textContent = byState['EXCEPTION'] || 0;
}

/* 테이블 렌더 */
function qeRenderTable() {
  const sorted = [..._rows].sort((a, b) => {
    const av = a[_sortCol] ?? '';
    const bv = b[_sortCol] ?? '';
    return _sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const totalPages = Math.ceil(sorted.length / _pageSize) || 1;
  if (_page > totalPages) _page = totalPages;
  const pageRows = sorted.slice((_page - 1) * _pageSize, _page * _pageSize);

  const tbody = $('qe-tbody');
  tbody.innerHTML = '';

  pageRows.forEach(q => {
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
      <td class="mono">${esc(q.queryId)}</td>
      <td style="font-weight:500">${esc(q.user || '')}</td>
      <td>${esc((q.attributes && q.attributes.connected_user) || '')}</td>
      <td><span class="badge ${stateCls}">${esc(q.queryState || '')}</span></td>
      <td><div class="stmt-cell">${esc(q.statement || '')}</div></td>
      <td>${dur}</td>
      <td>${q.rowsProduced != null ? q.rowsProduced.toLocaleString() : '—'}</td>
      <td style="white-space:nowrap">${esc(formatKST(q.startTime))}</td>
      <td style="white-space:nowrap">${esc(formatKST(q.endTime))}</td>
      <td><div class="status-cell">${statusHtml}</div></td>
      <td><button class="btn-dl-profile" title="프로파일 다운로드" onclick="qeDownloadProfile('${esc(q._cluster)}','${esc(q.queryId)}')">⬇</button></td>`;
    tbody.appendChild(tr);

    if (expanded) {
      const exp = document.createElement('tr');
      exp.className = 'expand-row';
      const expandStatus = !isOk
        ? `<div class="expand-status"><strong>queryStatus:</strong> ${esc(statusVal)}</div>`
        : '';
      exp.innerHTML = `<td colspan="13"><div class="expand-content">${esc(q.statement || '')}</div>${expandStatus}</td>`;
      tbody.appendChild(exp);
    }
  });

  qeRenderPagination(totalPages);
}

/* 페이지네이션 렌더 */
function qeRenderPagination(totalPages) {
  const pg = $('qe-pagination');
  if (totalPages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = '';

  const start = Math.max(1, _page - 2);
  const end   = Math.min(totalPages, _page + 2);

  let html = `<span class="pg-info">${_page} / ${totalPages} 페이지 (총 ${_rows.length}건)</span>`;
  html += `<button class="btn-pg" onclick="qeGoPage(1)" ${_page === 1 ? 'disabled' : ''}>«</button>`;
  html += `<button class="btn-pg" onclick="qeGoPage(${_page - 1})" ${_page === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="btn-pg${i === _page ? ' active' : ''}" onclick="qeGoPage(${i})">${i}</button>`;
  }
  html += `<button class="btn-pg" onclick="qeGoPage(${_page + 1})" ${_page === totalPages ? 'disabled' : ''}>›</button>`;
  html += `<button class="btn-pg" onclick="qeGoPage(${totalPages})" ${_page === totalPages ? 'disabled' : ''}>»</button>`;

  pg.innerHTML = html;
}

function qeGoPage(n) {
  const totalPages = Math.ceil(_rows.length / _pageSize) || 1;
  _page = Math.max(1, Math.min(n, totalPages));
  qeRenderTable();
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
  _page = 1;
  qeApplyFilters();
}

/* 클러스터 탭 */
function qeSelectCluster(el) {
  document.querySelectorAll('#qe-cluster-tabs .stab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  _activeCluster = el.dataset.cluster;
  /* 클러스터 전환 시 상태 탭은 항상 '전체'로 리셋 */
  _activeState = '';
  document.querySelectorAll('#qe-state-tabs .stab').forEach(t => t.classList.remove('active'));
  document.querySelector('#qe-state-tabs [data-state=""]').classList.add('active');
  _page = 1;
  qeApplyFilters();
}

/* 프로파일 다운로드 */
async function qeDownloadProfile(clusterId, queryId) {
  const url = `/explorer/profile/${encodeURIComponent(clusterId)}/${encodeURIComponent(queryId)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const { error } = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      showToast(error, true);
      return;
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${queryId}_profile.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showToast(`다운로드 실패: ${e.message}`, true);
  }
}

/* 초기화 */
function qeReset() {
  $('qe-user').value = '';
  $('qe-conds').innerHTML = '';
  qeAddCondRow();
  $('qe-cluster-select').value = '';
  $('qe-qtype').value = '';
  if (_fpFrom) _fpFrom.clear(); else $('qe-from').value = '';
  if (_fpTo)   _fpTo.clear();   else $('qe-to').value   = '';
  qeSetPreset(1);
  _resetStateTabs();

  if (_es) { _es.close(); _es = null; }
  _allRows = [];
  _rows    = [];
  _page    = 1;
  _openRows.clear();
  $('qe-tbody').innerHTML = '';
  $('qe-pagination').style.display = 'none';
  $('qe-summary').style.display = 'none';
  $('qe-progress').classList.remove('show');
  $('qe-search-btn').disabled = false;
  $('qe-stop-btn').style.display = 'none';
  qeUpdateCounts();
}
