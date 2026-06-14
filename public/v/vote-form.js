// vote-form.js — shared voting form logic
// Called by each /v/<round_id>/index.html with window.VOTE_ROUND_ID set

(function() {
'use strict';

const SB_URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const SB_KEY = 'sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn';

function sbHeaders(method) {
  const h = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
  };
  if (method && method !== 'GET') {
    h['Content-Type'] = 'application/json';
  }
  return h;
}

function sbGet(path, params) {
  const u = new URL(SB_URL + '/rest/v1/' + path);
  if (params) Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
  return fetch(u.toString(), { headers: sbHeaders('GET') }).then(r => r.json());
}

function sbPost(path, body) {
  return fetch(SB_URL + '/rest/v1/' + path, {
    method: 'POST',
    headers: sbHeaders('POST'),
    body: JSON.stringify(body),
  }).then(async r => {
    const text = await r.text();
    if (!r.ok) {
      let e;
      try { e = JSON.parse(text); }
      catch(_) { e = { message: text || ('HTTP ' + r.status) }; }
      return Promise.reject(e);
    }
    if (!text) return {};
    try { return JSON.parse(text); } catch(_) { return {}; }
  });
}

function uuid4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function getClientId() {
  let id = localStorage.getItem('climate_vote_client_id');
  if (!id) { id = uuid4(); localStorage.setItem('climate_vote_client_id', id); }
  return id;
}

// State
let currentRound = null;
let radioSelected = null;
let checkboxSelected = new Set();
let scaleValues = {};

function show(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

window._voteSelectRadio = function(idx, val) {
  radioSelected = val;
  document.querySelectorAll('#radioList .opt-label').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById('radio_' + idx);
  if (el) el.classList.add('selected');
};

window._voteToggleCheckbox = function(idx, val) {
  const el = document.getElementById('chk_' + idx);
  if (checkboxSelected.has(val)) {
    checkboxSelected.delete(val);
    if (el) el.classList.remove('selected');
  } else {
    checkboxSelected.add(val);
    if (el) el.classList.add('selected');
  }
};

window._voteSetScale = function(label, score, rowIdx) {
  scaleValues[label] = score;
  const low = currentRound ? (currentRound.scale_low || 1) : 1;
  const high = currentRound ? (currentRound.scale_high || 5) : 5;
  for (let s = low; s <= high; s++) {
    const btn = document.getElementById('sb_' + rowIdx + '_' + s);
    if (btn) btn.classList.toggle('sel', s === score);
  }
};

window._voteShowForm = function() {
  radioSelected = null;
  checkboxSelected = new Set();
  scaleValues = {};
  const ti = document.getElementById('textInput');
  if (ti) ti.value = '';
  document.querySelectorAll('.opt-label').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.scale-btn').forEach(el => el.classList.remove('sel'));
  renderForm(currentRound);
};

window._voteSubmit = async function() {
  if (!currentRound) return;
  const btn = document.getElementById('submitBtn');
  if (btn) { btn.disabled = true; btn.textContent = '제출 중...'; }

  let choice;
  const type = currentRound.type;

  if (type === 'RADIO') {
    if (!radioSelected) {
      alert('항목을 선택해 주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = radioSelected;
  } else if (type === 'CHECKBOX') {
    if (checkboxSelected.size === 0) {
      alert('항목을 하나 이상 선택해 주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = Array.from(checkboxSelected);
  } else if (type === 'SCALE_MULTI') {
    const opts = currentRound.options || [];
    const labels = opts.map(o => typeof o === 'string' ? o : (o.label || ''));
    const missing = labels.filter(l => !(l in scaleValues));
    if (missing.length > 0) {
      alert('모든 항목에 점수를 매겨 주세요.\n미입력: ' + missing.slice(0,3).join(', '));
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = scaleValues;
  } else if (type === 'TEXT') {
    const val = document.getElementById('textInput').value.trim();
    if (!val) {
      alert('의견을 입력해 주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = val;
  }

  const voterName = (document.getElementById('voterName').value || '').trim();
  if (!voterName) {
    alert('성함을 입력해 주세요.');
    if (btn) { btn.disabled = false; btn.textContent = '제출'; }
    document.getElementById('voterName').focus();
    return;
  }

  // 사전 중복 체크 (성함 정규화)
  try {
    const norm = voterName.replace(/\s+/g, '').toLowerCase();
    const dupCheck = await sbGet('cv_votes', {
      'round_id': 'eq.' + currentRound.id,
      'select': 'voter_name',
    });
    if (Array.isArray(dupCheck)) {
      const hit = dupCheck.find(v => (v.voter_name || '').replace(/\s+/g, '').toLowerCase() === norm);
      if (hit) {
        alert('이미 같은 성함으로 응답이 접수되었습니다.\n동명이인이라면 운영자에게 알려주세요.');
        if (btn) { btn.disabled = false; btn.textContent = '제출'; }
        return;
      }
    }
  } catch(_) {}

  const payload = {
    round_id: currentRound.id,
    choice: choice,
    voter_role: null,
    voter_name: voterName,
    client_id: getClientId(),
  };

  try {
    await sbPost('cv_votes', payload);
    const thanksMsg = document.getElementById('thanksMsg');
    if (thanksMsg) thanksMsg.textContent = currentRound.title + ' 라운드에 응답하셨습니다.';
    show('screenThanks');
    loadTallyPreview();
  } catch(e) {
    console.error(e);
    const msg = e && (e.message || e.details || '');
    if (/uniq_votes_round_voter_name/.test(JSON.stringify(e))) {
      alert('이미 같은 성함으로 응답이 접수되었습니다.\n동명이인이라면 운영자에게 알려주세요.');
    } else if (/uniq_votes_round_client/.test(JSON.stringify(e))) {
      alert('이 기기에서는 이미 응답하셨습니다.');
    } else {
      alert('제출 오류: ' + msg);
    }
    if (btn) { btn.disabled = false; btn.textContent = '제출'; }
  }
};

async function loadTallyPreview() {
  if (!currentRound) return;
  const type = currentRound.type;
  try {
    let rows;
    if (type === 'SCALE_MULTI') {
      rows = await sbGet('cv_tally_scale', { 'round_id': 'eq.' + currentRound.id, 'order': 'avg_score.desc' });
    } else {
      rows = await sbGet('cv_tally', { 'round_id': 'eq.' + currentRound.id, 'order': 'n.desc' });
    }
    if (!rows || rows.code) return;
    const total = rows.reduce((s, r) => s + (r.n || 0), 0);
    const preview = document.getElementById('tallyPreview');
    const rowsEl = document.getElementById('tallyRows');
    if (!rowsEl || !preview) return;

    if (type === 'SCALE_MULTI') {
      rowsEl.innerHTML = rows.slice(0,5).map(r => {
        const pct = ((r.avg_score - 1) / 4 * 100).toFixed(0);
        return `<div class="tally-bar-row">
          <div class="tally-bar-label"><span>${r.item_label || '-'}</span><span>평균 ${(r.avg_score||0).toFixed(1)} / 5 (${r.n}명)</span></div>
          <div class="tally-bar-track"><div class="tally-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('');
    } else {
      rowsEl.innerHTML = rows.map(r => {
        const pct = total > 0 ? (r.n / total * 100).toFixed(0) : 0;
        return `<div class="tally-bar-row">
          <div class="tally-bar-label"><span>${r.choice_text || '-'}</span><span>${r.n}표 (${pct}%)</span></div>
          <div class="tally-bar-track"><div class="tally-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('');
    }
    preview.style.display = 'block';
  } catch(e) {
    console.warn('tally preview failed', e);
  }
}

function renderForm(round) {
  if (!round) return;
  currentRound = round;

  if (round.status === 'closed') { show('screenClosed'); return; }

  const badge = document.getElementById('formRoundBadge');
  const titleEl = document.getElementById('formTitle');
  const descEl = document.getElementById('formDesc');
  if (badge) badge.textContent = round.id;
  if (titleEl) titleEl.textContent = round.title || '';
  if (descEl) descEl.textContent = round.description || '';

  ['radioSection','checkboxSection','scaleSection','textSection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const opts = round.options || [];

  if (round.type === 'RADIO') {
    const list = document.getElementById('radioList');
    if (list) {
      list.innerHTML = opts.map((o, i) => {
        const val = typeof o === 'string' ? o : (o.label || o.value || JSON.stringify(o));
        const safe = val.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<label class="opt-label" id="radio_${i}" onclick="_voteSelectRadio(${i},'${safe}')">
          <span class="opt-custom"></span><span>${val}</span>
        </label>`;
      }).join('');
    }
    const sec = document.getElementById('radioSection');
    if (sec) sec.style.display = 'block';

  } else if (round.type === 'CHECKBOX') {
    const list = document.getElementById('checkboxList');
    if (list) {
      list.innerHTML = opts.map((o, i) => {
        const val = typeof o === 'string' ? o : (o.label || o.value || JSON.stringify(o));
        const safe = val.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<label class="opt-label checkbox" id="chk_${i}" onclick="_voteToggleCheckbox(${i},'${safe}')">
          <span class="opt-custom"></span><span>${val}</span>
        </label>`;
      }).join('');
    }
    const sec = document.getElementById('checkboxSection');
    if (sec) sec.style.display = 'block';

  } else if (round.type === 'SCALE_MULTI') {
    const list = document.getElementById('scaleList');
    const low = round.scale_low || 1;
    const high = round.scale_high || 5;
    const lowLabel = round.scale_low_label || '낮음';
    const highLabel = round.scale_high_label || '높음';
    if (list) {
      list.innerHTML = opts.map((o, idx) => {
        const lbl = typeof o === 'string' ? o : (o.label || '항목' + (idx+1));
        const safeLbl = lbl.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const btns = [];
        for (let s = low; s <= high; s++) {
          btns.push(`<button class="scale-btn" id="sb_${idx}_${s}" onclick="_voteSetScale('${safeLbl}',${s},${idx})">${s}</button>`);
        }
        return `<div class="scale-row">
          <div class="scale-label">${lbl}</div>
          <div class="scale-btns">${btns.join('')}</div>
          <div class="scale-hint"><span>${low} = ${lowLabel}</span><span>${high} = ${highLabel}</span></div>
        </div>`;
      }).join('');
    }
    const sec = document.getElementById('scaleSection');
    if (sec) sec.style.display = 'block';

  } else if (round.type === 'TEXT') {
    const sec = document.getElementById('textSection');
    if (sec) sec.style.display = 'block';
  }

  show('screenForm');
}

async function init() {
  const roundId = window.VOTE_ROUND_ID;
  if (!roundId) {
    const errMsg = document.getElementById('errorMsg');
    if (errMsg) errMsg.textContent = '라운드 ID가 설정되지 않았습니다.';
    show('screenError');
    return;
  }

  const hdr = document.getElementById('headerRoundId');
  if (hdr) hdr.textContent = roundId + ' 라운드';

  try {
    const data = await sbGet('cv_rounds', { 'id': 'eq.' + roundId, 'limit': '1' });
    if (!data || data.length === 0 || data.code) {
      throw new Error(data?.message || '라운드 정보를 찾을 수 없습니다');
    }
    renderForm(data[0]);
  } catch(e) {
    console.error(e);
    const errMsg = document.getElementById('errorMsg');
    if (errMsg) {
      errMsg.innerHTML = '<b>라운드 로드 실패</b><br>' + (e.message || JSON.stringify(e)) +
        '<br><br><small style="color:#888">Supabase API Settings &gt; Exposed schemas에 <b>climate_vote</b>를 추가해야 합니다.</small>';
    }
    show('screenError');
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
