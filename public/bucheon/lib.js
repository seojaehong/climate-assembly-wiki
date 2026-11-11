// 부천 100인 공론장 — 공용 RPC 도우미 (public 스키마 bucheon_* 함수만 호출)
(function () {
  var URL = 'https://pleyuknjnprsckssxvrh.supabase.co/rest/v1/rpc/';
  var KEY = 'sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn';

  var MESSAGES = {
    'invalid team code': '조 코드가 맞지 않습니다. 받은 링크나 QR로 다시 들어와 주세요.',
    'q1 is required': '질문 1을 적어 주세요.',
    'q2 is required': '질문 2를 적어 주세요.',
    'reason_top is required': '1~3순위를 고른 이유를 적어 주세요.',
    'terms must cover every policy exactly once': '모든 과제의 시기를 골라 주세요.',
    'ranking must list every policy exactly once': '모든 과제의 순위를 매겨 주세요.',
    'survey is closed': '설문이 마감되었습니다.',
    'invalid answers': '응답을 확인해 주세요.',
    'invalid hq key': '본부 주소가 맞지 않습니다.',
    'no picks to show': '선정 과제를 하나 이상 고른 뒤 내보낼 수 있습니다.',
    'invalid image': '사진을 올리지 못했습니다. 카메라로 다시 찍어 주세요.',
    'too many photos': '사진이 너무 많습니다. 잘못 올린 사진을 지운 뒤 다시 올려 주세요.'
  };

  function rpc(fn, args) {
    return fetch(URL + fn, {
      method: 'POST',
      headers: {
        'apikey': KEY,
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {})
    }).catch(function () {
      // 와이파이가 끊기면 브라우저가 영어 오류(Failed to fetch)를 낸다 — 화면에는 우리말로
      var err = new Error('서버에 연결하지 못했습니다. 와이파이를 확인하고 다시 눌러 주세요.');
      err.raw = 'network';
      throw err;
    }).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = txt; }
        if (!res.ok) {
          var raw = (body && body.message) || ('HTTP ' + res.status);
          var msg = MESSAGES[raw];
          if (!msg && /too long/.test(raw)) msg = '글이 너무 깁니다. 조금 줄여 주세요.';
          var err = new Error(msg || '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
          err.raw = raw;
          throw err;
        }
        return body;
      });
    });
  }

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function hhmm(iso) {
    var d = new Date(iso);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var TERMS = [
    { k: 'S', label: '단기' },
    { k: 'M', label: '중기' },
    { k: 'LI', label: '장기 · 중요도가 낮아서' },
    { k: 'LR', label: '장기 · 현실 제약 때문에' }
  ];

  // 세션1 질문 카드: 조당 질문 1개, group_lead 로 묶인 질문은 대표 조 카드 하나로 합친다
  function questionCards(questions, includeHidden) {
    var q = {}, cards = [], byLead = {};
    questions.forEach(function (x) { q[x.team_no] = x; });
    function leadOf(x) { return x.group_lead && q[x.group_lead] && !q[x.group_lead].group_lead ? x.group_lead : null; }
    questions.forEach(function (x) {
      var lead = leadOf(x);
      if (lead && (includeHidden || !q[lead].hidden)) (byLead[lead] = byLead[lead] || []).push(x);
    });
    questions.slice().sort(function (a, b) { return a.team_no - b.team_no; }).forEach(function (x) {
      if (x.hidden && !includeHidden) return;
      var lead = leadOf(x);
      if (lead && (includeHidden || !q[lead].hidden)) return;
      var members = (byLead[x.team_no] || []).filter(function (m) { return includeHidden || !m.hidden; });
      var teams = [x].concat(members).map(function (m) { return m.team_no; }).sort(function (a, b) { return a - b; });
      cards.push({ lead: x, members: members, label: teams.join('·') + '조' });
    });
    return cards;
  }

  // 중복 후보: 공백·문장부호를 뺀 글자 2개씩 묶음의 겹침 비율(자카드). 0~1.
  function bigrams(s) {
    var t = String(s || '').replace(/\[시험\]/g, '').replace(/[\s.,?!·\-—_()"'“”‘’…:;]/g, ''), m = {};
    for (var i = 0; i < t.length - 1; i++) m[t.substr(i, 2)] = 1;
    return m;
  }
  function similarity(a, b) {
    var x = bigrams(a), y = bigrams(b), inter = 0, n = 0, k;
    for (k in x) { n++; if (y[k]) inter++; }
    for (k in y) if (!x[k]) n++;
    return n ? inter / n : 0;
  }

  // 원탁 고리: items = [{ no, q(질문 냄), p(세션2 결과 들어옴) }], core = { n, of, label, kind('q'|'p') } 또는 null.
  // 같은 상자를 다시 넘기면 자리를 다시 만들지 않는다 — 상태가 바뀐 조만 한 번 튄다(5초 갱신에도 깜빡이지 않게).
  function orbit(items, core, box) {
    var first = !box;
    box = box || el('div', { class: 'orbit' }, [el('div', { class: 'track' })]);
    var c = box.querySelector('.core');
    if (core) {
      if (!c) { c = el('div', { class: 'core' }, [el('div', { class: 'n' }), el('div', { class: 'l' })]); box.appendChild(c); }
      c.className = 'core ' + (core.kind || 'q');
      var n = c.querySelector('.n'); n.textContent = String(core.n);
      if (core.of) n.appendChild(el('small', { text: '/' + core.of }));
      c.querySelector('.l').textContent = core.label || '';
    } else if (c) c.remove();
    var seats = box.querySelectorAll('.seat');
    items.forEach(function (it, i) {
      var s = seats[i];
      if (!s) {
        s = el('div', { class: 'seat' }, [el('span', { class: 'tag' }), el('div', { class: 'pips' }, [el('b', { class: 'q' }), el('b', { class: 'p' })])]);
        // 화면을 다시 붙이면 애니메이션이 처음부터 다시 돈다 — 한 번 튀고 나면 표시를 뗀다
        s.addEventListener('animationend', function () { this.classList.remove('pop'); });
        box.appendChild(s);
      }
      // 첫 자리를 12시 방향에 두고 시계 방향으로 돈다. 반지름 = 지름의 40%
      var a = (-90 + i * 360 / items.length) * Math.PI / 180;
      s.style.left = (50 + 40 * Math.cos(a)).toFixed(2) + '%';
      s.style.top = (50 + 40 * Math.sin(a)).toFixed(2) + '%';
      var state = (it.q ? 'q' : '') + (it.p ? 'p' : '');
      if (!first && s.dataset.state !== undefined && s.dataset.state !== state && state) {
        s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
      }
      s.dataset.state = state;
      s.classList.toggle('done', !!(it.q || it.p));
      s.classList.toggle('full', !!(it.q && it.p));
      s.querySelector('.tag').textContent = it.no + '조';
      var bq = s.querySelector('b.q'), bp = s.querySelector('b.p');
      bq.textContent = it.q ? '질문 ✓' : '질문'; bq.classList.toggle('on', !!it.q);
      bp.textContent = it.p ? '결과 ✓' : '결과'; bp.classList.toggle('on', !!it.p);
    });
    for (var k = seats.length - 1; k >= items.length; k--) seats[k].remove();
    return box;
  }

  window.BF = { rpc: rpc, store: store, el: el, hhmm: hhmm, TERMS: TERMS, questionCards: questionCards, similarity: similarity, orbit: orbit };
})();
