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

function sbRpc(name, body) {
  const headers = sbHeaders('POST');
  headers['Content-Profile'] = 'climate_vote';
  headers['Accept-Profile'] = 'climate_vote';
  return fetch(SB_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers,
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

let memoryClientId = null;
let persistentClientIdAvailable = true;

function getClientId() {
  if (memoryClientId) return memoryClientId;
  try {
    let id = localStorage.getItem('cv_device') || localStorage.getItem('climate_vote_client_id');
    if (!id) id = uuid4();
    localStorage.setItem('cv_device', id);
    localStorage.removeItem('climate_vote_client_id');
    memoryClientId = id;
    return id;
  } catch (error) {
    console.error('vote device persistence unavailable', error);
    persistentClientIdAvailable = false;
    memoryClientId = uuid4();
    return memoryClientId;
  }
}

// State
let currentRound = null;
let radioSelected = null;
let checkboxSelected = new Set();
let scaleValues = new Map();
let pendingRefreshTimer = null;

function optionLabel(option, fallback) {
  if (typeof option === 'string') return option;
  if (option && typeof option === 'object') {
    if (typeof option.label === 'string') return option.label;
    if (typeof option.value === 'string') return option.value;
  }
  return fallback;
}

function replaceChildren(element, children) {
  if (!element) return;
  element.replaceChildren(...children);
}

function makeTallyRow(label, detail, percent) {
  const row = document.createElement('div');
  row.className = 'tally-bar-row';
  const heading = document.createElement('div');
  heading.className = 'tally-bar-label';
  const labelNode = document.createElement('span');
  labelNode.textContent = label;
  const detailNode = document.createElement('span');
  detailNode.textContent = detail;
  heading.append(labelNode, detailNode);
  const track = document.createElement('div');
  track.className = 'tally-bar-track';
  const fill = document.createElement('div');
  fill.className = 'tally-bar-fill';
  fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  track.append(fill);
  row.append(heading, track);
  return row;
}

function showMessage(title, message, retry) {
  const titleNode = document.querySelector('#screenError .error-title');
  const body = document.getElementById('errorMsg');
  if (titleNode) titleNode.textContent = title;
  if (body) {
    const messageNode = document.createElement('p');
    messageNode.textContent = message;
    const children = [messageNode];
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'retry-btn';
      button.textContent = '다시 시도';
      button.addEventListener('click', retry);
      children.push(button);
    }
    replaceChildren(body, children);
  }
  show('screenError');
}

function ensureNonbindingNotice(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('[data-public-vote-notice]')) return;
  const notice = document.createElement('p');
  notice.dataset.publicVoteNotice = 'true';
  notice.textContent = '기기 기준 중복 제한을 적용한 비구속 현장 조사입니다. 공식 의사결정의 단독 근거로 사용할 수 없으며 조 모더레이터의 대리 기록과는 별개입니다.';
  notice.style.color = '#7c2d12';
  notice.style.fontWeight = '700';
  notice.style.marginTop = '16px';
  container.append(notice);
}

function ensureStorageNotice(containerId) {
  if (persistentClientIdAvailable) return;
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('[data-storage-notice]')) return;
  const notice = document.createElement('p');
  notice.dataset.storageNotice = 'true';
  notice.setAttribute('role', 'status');
  notice.textContent = '이 브라우저에서는 기기 식별값을 저장할 수 없습니다. 새로고침하면 중복 응답 방지가 유지되지 않을 수 있습니다.';
  notice.style.color = '#991b1b';
  notice.style.fontWeight = '700';
  notice.style.marginTop = '12px';
  container.append(notice);
}

function removeLegacyIdentityInputs() {
  document.querySelectorAll('.voter-section').forEach(section => section.remove());
  const form = document.getElementById('screenForm');
  if (!form || form.querySelector('[data-privacy-notice]')) return;
  const notice = document.createElement('p');
  notice.dataset.privacyNotice = 'true';
  notice.textContent = '이름 등 개인정보는 수집하지 않습니다.';
  notice.style.color = '#4a5568';
  notice.style.marginBottom = '16px';
  form.insertBefore(notice, document.getElementById('submitBtn'));
}

function wireStaticControls() {
  const submit = document.getElementById('submitBtn');
  if (submit && !submit.dataset.safeVoteHandler) {
    submit.removeAttribute('onclick');
    submit.dataset.safeVoteHandler = 'true';
    submit.addEventListener('click', () => { void window._voteSubmit(); });
  }
  document.querySelectorAll('.retry-btn').forEach(button => {
    button.removeAttribute('onclick');
    if (button.dataset.safeVoteHandler) return;
    button.dataset.safeVoteHandler = 'true';
    button.addEventListener('click', window._voteShowForm);
  });
}

function makeNativeChoiceInput(input, label) {
  input.style.display = 'block';
  input.style.position = 'absolute';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  input.style.overflow = 'hidden';
  input.style.clipPath = 'inset(50%)';
  input.addEventListener('focus', () => { label.style.outline = '3px solid #0D7490'; });
  input.addEventListener('blur', () => { label.style.outline = ''; });
}

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
  scaleValues.set(label, score);
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
  scaleValues = new Map();
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
    const labels = opts.map((option, index) => optionLabel(option, '항목' + (index + 1)));
    const missing = labels.filter(label => !scaleValues.has(label));
    if (missing.length > 0) {
      alert('모든 항목에 점수를 매겨 주세요.\n미입력: ' + missing.slice(0,3).join(', '));
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = Object.fromEntries(scaleValues);
  } else if (type === 'TEXT') {
    const val = document.getElementById('textInput').value.trim();
    if (!val) {
      alert('의견을 입력해 주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    if (val.length > 2000) {
      alert('의견은 2,000자 이하로 입력해 주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    choice = val;
  }

  try {
    const cast = await sbRpc('public_round_cast_v2', {
      p_round_id: currentRound.id,
      p_choice: choice,
      p_client_id: getClientId(),
    });
    if (cast === 'duplicate') {
      alert('이 기기에서는 이미 응답하셨습니다.');
      if (btn) { btn.disabled = false; btn.textContent = '제출'; }
      return;
    }
    if (cast === 'closed') {
      alert('이미 마감된 투표입니다.');
      show('screenClosed');
      return;
    }
    if (cast !== 'ok') throw new Error('알 수 없는 투표 처리 결과입니다.');
    const thanksMsg = document.getElementById('thanksMsg');
    if (thanksMsg) thanksMsg.textContent = currentRound.title + ' 라운드에 응답하셨습니다.';
    show('screenThanks');
  } catch(e) {
    console.error(e);
    const msg = e && (e.message || e.details || '');
    alert('제출 오류: ' + msg);
    if (btn) { btn.disabled = false; btn.textContent = '제출'; }
  }
};

async function loadTallyPreview() {
  if (!currentRound) return;
  const type = currentRound.type;
  try {
    const rows = await sbRpc('public_round_votes_v2', { p_round_id: currentRound.id });
    if (!Array.isArray(rows)) throw new Error('집계 응답 형식이 올바르지 않습니다.');
    const total = Number(rows[0]?.total_votes || 0);
    const preview = document.getElementById('tallyPreview');
    const rowsEl = document.getElementById('tallyRows');
    if (!rowsEl || !preview) return;

    if (type === 'TEXT') {
      const summary = document.createElement('p');
      summary.textContent = `기기 응답 ${total}건입니다. 자유서술 원문은 공개 결과 화면에 표시하지 않습니다.`;
      replaceChildren(rowsEl, [summary]);
    } else if (type === 'SCALE_MULTI') {
      replaceChildren(rowsEl, rows.slice(0, 100).map(row => {
        const average = Number(row.average_score || 0);
        const low = Number(currentRound.scale_low || 1);
        const high = Number(currentRound.scale_high || 5);
        const percent = high > low ? ((average - low) / (high - low)) * 100 : 0;
        const label = typeof row.choice === 'string' ? row.choice : '-';
        return makeTallyRow(label,
          `평균 ${average.toFixed(1)} / ${high} (${Number(row.vote_count || 0)}명)`, percent);
      }));
    } else {
      replaceChildren(rowsEl, rows.map(row => {
        const count = Number(row.vote_count || 0);
        const percent = total > 0 ? (count / total) * 100 : 0;
        const label = typeof row.choice === 'string' ? row.choice : JSON.stringify(row.choice ?? '-');
        return makeTallyRow(label, `${count}표 (${percent.toFixed(0)}%)`, percent);
      }));
    }
    const closed = document.getElementById('screenClosed');
    if (closed && currentRound.status === 'closed') closed.append(preview);
    preview.style.display = 'block';
  } catch(e) {
    console.error('tally preview failed', e);
    const preview = document.getElementById('tallyPreview');
    const rowsEl = document.getElementById('tallyRows');
    if (preview && rowsEl) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = '집계를 불러오지 못했습니다.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry-btn';
      retry.textContent = '집계 다시 시도';
      retry.addEventListener('click', loadTallyPreview);
      replaceChildren(rowsEl, [message, retry]);
      const closed = document.getElementById('screenClosed');
      if (closed && currentRound.status === 'closed') closed.append(preview);
      preview.style.display = 'block';
    }
  }
}

function renderForm(round) {
  if (!round) return;
  currentRound = round;

  if (round.status === 'closed') {
    if (pendingRefreshTimer) window.clearTimeout(pendingRefreshTimer);
    show('screenClosed');
    ensureNonbindingNotice('screenClosed');
    ensureStorageNotice('screenClosed');
    void loadTallyPreview();
    return;
  }
  if (round.status !== 'active') {
    showMessage('투표 대기 중입니다.', '운영진이 투표를 시작하면 참여할 수 있습니다.', init);
    if (pendingRefreshTimer) window.clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = window.setTimeout(() => { void init(); }, 5_000);
    return;
  }
  if (pendingRefreshTimer) window.clearTimeout(pendingRefreshTimer);

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

  const opts = Array.isArray(round.options) ? round.options : [];

  if (round.type === 'RADIO') {
    const list = document.getElementById('radioList');
    if (list) {
      replaceChildren(list, opts.map((option, index) => {
        const value = optionLabel(option, JSON.stringify(option));
        const label = document.createElement('label');
        label.className = 'opt-label';
        label.id = 'radio_' + index;
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'vote_radio';
        input.value = value;
        input.addEventListener('change', () => window._voteSelectRadio(index, value));
        makeNativeChoiceInput(input, label);
        const custom = document.createElement('span');
        custom.className = 'opt-custom';
        const text = document.createElement('span');
        text.textContent = value;
        label.append(input, custom, text);
        return label;
      }));
    }
    const sec = document.getElementById('radioSection');
    if (sec) sec.style.display = 'block';

  } else if (round.type === 'CHECKBOX') {
    const list = document.getElementById('checkboxList');
    if (list) {
      replaceChildren(list, opts.map((option, index) => {
        const value = optionLabel(option, JSON.stringify(option));
        const label = document.createElement('label');
        label.className = 'opt-label checkbox';
        label.id = 'chk_' + index;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.addEventListener('change', () => window._voteToggleCheckbox(index, value));
        makeNativeChoiceInput(input, label);
        const custom = document.createElement('span');
        custom.className = 'opt-custom';
        const text = document.createElement('span');
        text.textContent = value;
        label.append(input, custom, text);
        return label;
      }));
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
      replaceChildren(list, opts.map((option, index) => {
        const labelText = optionLabel(option, '항목' + (index + 1));
        const row = document.createElement('div');
        row.className = 'scale-row';
        const label = document.createElement('div');
        label.className = 'scale-label';
        label.textContent = labelText;
        const buttons = document.createElement('div');
        buttons.className = 'scale-btns';
        for (let score = low; score <= high; score += 1) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'scale-btn';
          button.id = `sb_${index}_${score}`;
          button.textContent = String(score);
          button.setAttribute('aria-label', `${labelText} ${score}점`);
          button.addEventListener('click', () => window._voteSetScale(labelText, score, index));
          buttons.append(button);
        }
        const hint = document.createElement('div');
        hint.className = 'scale-hint';
        const lowHint = document.createElement('span');
        lowHint.textContent = `${low} = ${lowLabel}`;
        const highHint = document.createElement('span');
        highHint.textContent = `${high} = ${highLabel}`;
        hint.append(lowHint, highHint);
        row.append(label, buttons, hint);
        return row;
      }));
    }
    const sec = document.getElementById('scaleSection');
    if (sec) sec.style.display = 'block';

  } else if (round.type === 'TEXT') {
    const sec = document.getElementById('textSection');
    if (sec) sec.style.display = 'block';
    const input = document.getElementById('textInput');
    if (input) input.focus();
  }

  show('screenForm');
  ensureNonbindingNotice('screenForm');
  ensureStorageNotice('screenForm');
}

async function init() {
  removeLegacyIdentityInputs();
  wireStaticControls();
  getClientId();
  const queryRoundId = new URLSearchParams(window.location.search).get('round');
  const parts = window.location.pathname.split('/').filter(Boolean);
  const routeIndex = parts.indexOf('v');
  const pathRoundId = routeIndex >= 0 ? parts[routeIndex + 1] : null;
  if (!queryRoundId && pathRoundId) {
    window.location.replace(`/v?round=${encodeURIComponent(pathRoundId)}`);
    return;
  }
  const roundId = window.VOTE_ROUND_ID || queryRoundId || pathRoundId;
  if (!roundId) {
    const errMsg = document.getElementById('errorMsg');
    if (errMsg) errMsg.textContent = '라운드 ID가 설정되지 않았습니다.';
    show('screenError');
    return;
  }

  const hdr = document.getElementById('headerRoundId');
  if (hdr) hdr.textContent = roundId + ' 라운드';

  try {
    const data = await sbRpc('public_round_get_v2', { p_round_id: roundId });
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error('라운드 정보를 찾을 수 없습니다.');
    }
    renderForm(data[0]);
  } catch(e) {
    console.error(e);
    const message = e && typeof e.message === 'string'
      ? e.message
      : '라운드 정보를 불러오지 못했습니다.';
    showMessage('라운드 로드 실패', message, init);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
