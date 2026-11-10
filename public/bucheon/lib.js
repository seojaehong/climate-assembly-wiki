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
    'invalid hq key': '본부 주소가 맞지 않습니다.'
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

  // 회의장 3D: items = [{ no, up(솟은 원탁), st(팻말 아래 한 줄) }]. 같은 상자를 다시 그리면 바뀐 원탁만 솟는다.
  function hall(items, box) {
    box = box || el('div', { class: 'hall' });
    var floor = box.querySelector('.floor');
    if (!floor) { floor = el('div', { class: 'floor' }); box.appendChild(floor); }
    items.forEach(function (it, i) {
      var t = floor.children[i];
      if (!t) {
        t = el('div', { class: 'tbl' }, [el('div', { class: 'disc base' }), el('div', { class: 'disc side' }), el('div', { class: 'disc top' }),
          el('div', { class: 'sign' }, [el('span', { class: 'tag' }), el('span', { class: 'st' })])]);
        floor.appendChild(t);
      }
      t.classList.toggle('up', !!it.up);
      t.querySelector('.tag').textContent = it.no + '조';
      t.querySelector('.st').textContent = it.st || '';
    });
    while (floor.children.length > items.length) floor.lastChild.remove();
    return box;
  }

  window.BF = { rpc: rpc, store: store, el: el, hhmm: hhmm, TERMS: TERMS, questionCards: questionCards, similarity: similarity, hall: hall };
})();
