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

  window.BF = { rpc: rpc, store: store, el: el, hhmm: hhmm, TERMS: TERMS };
})();
