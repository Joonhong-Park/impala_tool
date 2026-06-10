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
