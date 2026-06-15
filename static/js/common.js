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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── 클러스터 색상 (qmLoadSidebar에서 채워짐, QM·QE 공유) ── */
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
