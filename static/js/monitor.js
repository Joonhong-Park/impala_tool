/* ═══════════════════════════════════════════════════════
   QUERY MONITORING
   ═══════════════════════════════════════════════════════ */

let _qmSelectedHost  = null;
let _inflightQueries = [];

function _parseProgress(progressStr) {
  return parseFloat(progressStr?.match(/\((\d+(?:\.\d+)?)%\)/)?.[1]) || 0;
}

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

  _qmSelectedHost = item.dataset.host;

  $('qm-infobar').style.borderLeftColor = item.dataset.color;
  const nameEl = $('qm-coord-name');
  nameEl.textContent     = item.dataset.host;
  nameEl.style.color     = '#1a1d2e';
  nameEl.style.fontStyle = 'normal';
  $('qm-refresh-btn').disabled = false;
  $('qm-cancel-rows-btn').disabled = false;

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

    const all_inflight = data.in_flight_queries || [];
    const inflight  = all_inflight.filter(q => !q.waiting);
    const waiting   = all_inflight.filter(q =>  q.waiting);
    const completed = data.completed_queries    || [];

    _inflightQueries = inflight;

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

function qidCell(q) {
  return `<td class="mono">${esc(q.query_id)}</td>`;
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
    const pct = _parseProgress(q.progress);
    appendRow(tbody, `
      ${qidCell(q)}
      ${cancelCell(q)}
      ${metaCells(q)}
      <td><span class="badge-sm badge-running-sm">${esc(q.state || '')}</span></td>
      <td>
        <div class="prog-wrap"><div class="prog-fill" style="width:${Math.min(pct, 100)}%"></div></div>
        <span style="font-size:10px;color:#8892a4">${pct.toFixed(1)}%</span>
      </td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#b0b8cc">${q.row_fetched != null ? q.row_fetched : '—'}</td>
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
    appendRow(tbody, `
      ${qidCell(q)}
      ${cancelCell(q)}
      ${metaCells(q)}
      <td>${stateBadge(q.state)}</td>
      <td><span style="color:#e67e22;font-weight:700">${esc(q.waiting_time || '')}</span></td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.end_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#27ae60">${q.row_fetched != null ? q.row_fetched : '—'}</td>
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
    appendRow(tbody, `
      ${qidCell(q)}
      ${metaCells(q)}
      <td>${stateBadge(q.state)}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.start_time || '')}</td>
      <td style="white-space:nowrap;color:#5a6278">${esc(q.end_time || '')}</td>
      <td style="font-weight:500">${esc(q.duration || '')}</td>
      <td style="color:#8892a4">${esc(q.queued_duration || '—')}</td>
      <td>${q.row_fetched != null ? q.row_fetched : '—'}</td>
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
      _inflightQueries = _inflightQueries.filter(q => q.query_id !== queryId);
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
   Rows Available 전체 취소
   ═══════════════════════════════════════════════════════ */

async function qmCancelRowsAvailable() {
  const targets = _inflightQueries.filter(q =>
    _parseProgress(q.progress) === 100 &&
    q.last_event === 'Rows available' &&
    q.row_fetched === 0
  );

  if (!targets.length) {
    showToast('해당하는 쿼리가 없습니다.');
    return;
  }

  if (!confirm(`Rows Available 상태 쿼리 ${targets.length}건을 모두 취소하시겠습니까?`)) return;

  const results = await Promise.allSettled(
    targets.map(q =>
      fetch(`/monitor/cancel/${encodeURIComponent(_qmSelectedHost)}/${encodeURIComponent(q.query_id)}`, { method: 'POST' })
    )
  );

  const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const fail = targets.length - ok;

  showToast(fail > 0 ? `${ok}건 취소 완료, ${fail}건 실패` : `${ok}건 취소 완료`, fail > 0);
  qmFetchQueries();
}
