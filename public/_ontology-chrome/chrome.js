// ontology-chrome v1 — 공통 탭바·modal settings·우측 detail·localStorage og-*
// Cytoscape·3d-force-graph 공용. 페이지가 OntologyChrome.init({...})로 hooks 주입.

const KIND_DEFAULT = {
  Issue:'#f08c4b', Claim:'#4dabf7', Proposal:'#51cf66', Concern:'#ffd43b',
  Condition:'#cc5de8', Value:'#22b8cf', Evidence:'#adb5bd', Group:'#ff8787',
  Clause:'#e9ecef', Decision:'#ffa94d',
};
const PRESETS = {
  default: KIND_DEFAULT,
  vivid:   {Issue:'#ff6f3c',Claim:'#0066ff',Proposal:'#00cc44',Concern:'#ffcc00',Condition:'#cc00cc',Value:'#00aacc',Evidence:'#aaaaaa',Group:'#ff4040',Clause:'#ffffff',Decision:'#ffa040'},
  pastel:  {Issue:'#ffb3a7',Claim:'#a8c7fa',Proposal:'#aee3b8',Concern:'#fff3b0',Condition:'#d4b3ff',Value:'#a8d8e3',Evidence:'#cccccc',Group:'#ffb3b3',Clause:'#e0e0e0',Decision:'#ffcc88'},
  mono:    {Issue:'#888',Claim:'#999',Proposal:'#aaa',Concern:'#bbb',Condition:'#777',Value:'#aaa',Evidence:'#888',Group:'#666',Clause:'#ccc',Decision:'#999'},
};
const KIND_KO = {Issue:'쟁점',Claim:'주장',Proposal:'정책대안',Concern:'우려',Condition:'조건',Value:'가치',Evidence:'근거',Group:'영향집단',Clause:'조항',Decision:'의결'};
const PAGES = [
  { id:'workshop',     href:'/workshop-graph/',     icon:'🗂', label:'워크숍 2D' },
  { id:'workshop-3d',  href:'/workshop-graph-3d/',  icon:'🌐', label:'워크숍 3D' },
  { id:'regulation',   href:'/regulation-graph/',   icon:'📜', label:'운영규정' },
  { id:'live',         href:'/live-graph/',         icon:'🔴', label:'LIVE (모더 전용)' },
  { id:'inputs',       href:'/workshop-graph/inputs/', icon:'📄', label:'원문 회의록' },
];

function migrateOldKeys() {
  // wg-* / wg3d-* → og-*
  const map = {
    'wg-colors':'og-colors', 'wg3d-colors':'og-colors',
    'wg-lang':'og-lang', 'wg3d-lang':'og-lang',
    'wg-style':'og-style',
  };
  for (const [old, neu] of Object.entries(map)) {
    const v = localStorage.getItem(old);
    if (v != null && localStorage.getItem(neu) == null) {
      localStorage.setItem(neu, v);
    }
  }
}

function getPalette() {
  migrateOldKeys();
  try { return Object.assign({}, KIND_DEFAULT, JSON.parse(localStorage.getItem('og-colors') || 'null') || {}); }
  catch { return Object.assign({}, KIND_DEFAULT); }
}
function setPalette(p) { localStorage.setItem('og-colors', JSON.stringify(p)); }
function getLang() { return localStorage.getItem('og-lang') || 'ko'; }
function setLang(l) { localStorage.setItem('og-lang', l); }

function renderChrome({ activeId, title, meta, advisory }) {
  // 헤더 + 탭바 + footer 영역을 DOM에 삽입. body 안에 #og-app 컨테이너 가정.
  const app = document.getElementById('og-app') || document.body;
  // 헤더
  const header = document.createElement('div');
  header.className = 'og-header';
  header.innerHTML = `
    <div class="og-h-top">
      <h1>${escapeHtml(title)}</h1>
      <span class="og-stat" id="og-stat">${escapeHtml(meta || '')}</span>
      <span class="og-pill">advisory · uid 역추적</span>
    </div>
    ${advisory ? `<div class="og-advisory">${escapeHtml(advisory)}</div>` : ''}
  `;
  // 탭바
  const tabs = document.createElement('div');
  tabs.className = 'og-tabs';
  tabs.innerHTML = PAGES.map(p => `<a href="${p.href}" class="${p.id === activeId ? 'active' : ''}"><span class="og-tab-icon">${p.icon}</span>${p.label}</a>`).join('');
  app.prepend(tabs);
  app.prepend(header);
}

function ensureModal() {
  if (document.getElementById('og-modal-overlay')) return;
  const m = document.createElement('div');
  m.id = 'og-modal-overlay';
  m.className = 'og-modal-overlay';
  m.innerHTML = `
    <div class="og-modal">
      <div class="og-modal-h">
        <h2>⚙ 설정</h2>
        <button class="og-close" data-close>✕</button>
      </div>
      <div class="og-modal-body">
        <div class="og-sec">
          <h3>🌐 언어 (라벨)</h3>
          <div class="og-style-tog">
            <button id="og-lang-en">English</button>
            <button id="og-lang-ko">한국어</button>
          </div>
        </div>
        <div class="og-sec">
          <h3>🌈 종류별 색상</h3>
          <div id="og-color-rows"></div>
          <div class="og-preset">
            <button data-preset="default">기본</button>
            <button data-preset="vivid">선명</button>
            <button data-preset="pastel">파스텔</button>
            <button data-preset="mono">단색</button>
          </div>
          <button class="og-reset" id="og-color-reset">전체 리셋 (저장된 색상 삭제)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  // 색상 row 채우기
  const rows = m.querySelector('#og-color-rows');
  Object.keys(KIND_DEFAULT).forEach(k => {
    const r = document.createElement('div');
    r.className = 'og-row';
    r.innerHTML = `<label>${k} <span style="color:#6c757d">${KIND_KO[k] || ''}</span></label><input type="color" data-kind="${k}">`;
    rows.appendChild(r);
  });
  // close
  m.addEventListener('click', e => {
    if (e.target.matches('[data-close]') || e.target === m) m.classList.remove('open');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') m.classList.remove('open'); });
}

function openSettings(applyCallback) {
  ensureModal();
  const m = document.getElementById('og-modal-overlay');
  const palette = getPalette();
  // 색 picker 초기값
  m.querySelectorAll('input[type=color]').forEach(inp => {
    inp.value = palette[inp.dataset.kind] || KIND_DEFAULT[inp.dataset.kind];
    inp.oninput = () => {
      palette[inp.dataset.kind] = inp.value;
      setPalette(palette);
      applyCallback && applyCallback({ palette: Object.assign({}, palette), lang: getLang() });
    };
  });
  // 프리셋
  m.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => {
      const p = Object.assign({}, PRESETS[btn.dataset.preset]);
      setPalette(p);
      m.querySelectorAll('input[type=color]').forEach(inp => inp.value = p[inp.dataset.kind]);
      applyCallback && applyCallback({ palette: p, lang: getLang() });
    };
  });
  // 리셋
  m.querySelector('#og-color-reset').onclick = () => {
    localStorage.removeItem('og-colors');
    const p = Object.assign({}, KIND_DEFAULT);
    m.querySelectorAll('input[type=color]').forEach(inp => inp.value = p[inp.dataset.kind]);
    applyCallback && applyCallback({ palette: p, lang: getLang() });
  };
  // 언어 토글
  const cur = getLang();
  const en = m.querySelector('#og-lang-en');
  const ko = m.querySelector('#og-lang-ko');
  en.classList.toggle('active', cur === 'en');
  ko.classList.toggle('active', cur === 'ko');
  en.onclick = () => { setLang('en'); en.classList.add('active'); ko.classList.remove('active'); applyCallback && applyCallback({ palette: getPalette(), lang: 'en' }); };
  ko.onclick = () => { setLang('ko'); ko.classList.add('active'); en.classList.remove('active'); applyCallback && applyCallback({ palette: getPalette(), lang: 'ko' }); };
  m.classList.add('open');
}

function renderDetail(side, node) {
  // side: HTMLElement (.og-side). node: { id, kind, kindKo, label, text, cited, session, synthesized }
  const palette = getPalette();
  const color = palette[node.kind] || '#888';
  const lang = getLang();
  const kindLabel = lang === 'ko' ? (KIND_KO[node.kind] || node.kind) : node.kind;
  side.innerHTML = `
    <button class="og-s-close" data-side-close>✕</button>
    <div>
      <span class="og-s-badge" style="background:${color}">${escapeHtml(kindLabel)}</span>
      ${node.session ? `<span class="og-s-badge" style="background:#2c3848;color:#9aa7b8;margin-left:5px">${escapeHtml(node.session)}</span>` : ''}
      ${node.synthesized ? '<div class="og-s-synth">합성 노드 — 원천 추출 아님</div>' : ''}
      <div class="og-s-label">${escapeHtml(node.label || '')}</div>
      ${node.text ? `<div class="og-s-sec"><h4>본문</h4><div class="og-s-text">${escapeHtml(node.text)}</div></div>` : ''}
      ${node.cited && node.cited.length ? `<div class="og-s-sec"><h4>근거 uid (${node.cited.length})</h4>${node.cited.map(c => `<div class="og-s-cite">${escapeHtml(c)}</div>`).join('')}</div>` : ''}
    </div>
  `;
  side.classList.remove('collapsed');
  side.querySelector('[data-side-close]').onclick = () => side.classList.add('collapsed');
}

function showQuick(quickEl, sideEl, node) {
  const palette = getPalette();
  const lang = getLang();
  const kindLabel = lang === 'ko' ? (KIND_KO[node.kind] || node.kind) : node.kind;
  const color = palette[node.kind] || '#888';
  quickEl.innerHTML = `<span style="background:${color};color:#0c1118;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700">${escapeHtml(kindLabel)}</span> <b>${escapeHtml(node.label || '')}</b><br>${escapeHtml((node.text || '').slice(0, 100))}${(node.text || '').length > 100 ? '…' : ''}<br><a class="og-more" data-more>자세히 →</a>`;
  quickEl.classList.add('show');
  quickEl.querySelector('[data-more]').onclick = () => {
    renderDetail(sideEl, node);
    quickEl.classList.remove('show');
  };
}

function hideQuick(quickEl) { quickEl.classList.remove('show'); }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

export const OntologyChrome = {
  KIND_DEFAULT, KIND_KO, PRESETS, PAGES,
  init({ activeId, title, meta, advisory }) {
    migrateOldKeys();
    renderChrome({ activeId, title, meta, advisory });
    ensureModal();
  },
  openSettings,
  renderDetail,
  showQuick,
  hideQuick,
  getPalette, setPalette,
  getLang, setLang,
};
window.OntologyChrome = OntologyChrome;
