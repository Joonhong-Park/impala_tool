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
