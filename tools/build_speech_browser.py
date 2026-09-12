"""Build the standalone citizen-speech browser from the final-report canon.

Reads the user-designated canon (시민발언_보고서정본.json) plus the representative-quote
document, and writes one self-contained HTML page with client-side search and a
real-name / team-only toggle.

The speech payload is encrypted with AES-GCM under a PBKDF2 key derived from the
passphrase, so the names are not in the page until someone types it.

The passphrase never lives in this file: pass --passphrase, or set SPEECH_PASS.
This repository is public, so a passphrase committed beside the ciphertext would
void the encryption outright. Keep in mind that a short numeric passphrase is
brute-forceable offline by anyone holding the built page — it stops casual link
sharing, not a motivated attacker. No network, no build step, no external assets.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MODERATOR_ROOT = Path(r'C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터')
CANON = MODERATOR_ROOT / '10_작업산출물/2026-09-11_보고서기준_배포자료/정본/시민발언_보고서정본.json'
QUOTES = MODERATOR_ROOT / 'evaluation/20260911_report_delivery/01_content_ppt/quote_documents.json'
OUTPUT = Path(__file__).resolve().parent.parent / 'public/s-v9m4tqz7kp2h/index.html'

ITERATIONS = 310_000
ALIAS_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def load_representative_quotes(path: Path) -> dict[str, dict[str, str]]:
    """Map canon record id -> the agenda topic it was lifted into."""
    if not path.exists():
        return {}
    picked: dict[str, dict[str, str]] = {}
    for document in json.loads(path.read_text(encoding='utf-8')):
        for topic in document['topics']:
            for role in ('bg', 'ef'):
                for quote in topic.get(role, []):
                    uid = quote.get('uid') or quote.get('source', {}).get('record_id')
                    if uid:
                        picked[uid] = {'topic': topic['title'], 'role': role}
    return picked


def build_records(canon: dict, picked: dict[str, dict[str, str]]) -> list[dict]:
    """Flatten the canon into render-ready rows, assigning a stable per-team alias."""
    blocks = {block['id']: block for block in canon['blocks']}
    aliases: dict[tuple[int, int], dict[str, str]] = {}
    rows: list[dict] = []
    for record in canon['records']:
        text = record['text'].strip()
        if not text:
            continue
        block = blocks[record['block_id']]
        division, team = block['division'], block['team']
        speaker = record['speaker']
        # 진행자·전문가는 시민이 아니다. 「환경강사」처럼 역할 이름이라 가릴 것이 없고,
        # 조 안의 시민 글자(A·B·C…)를 가져가서도 안 된다.
        expert = record['kind'] == 'facilitator_or_expert'
        if speaker and not expert:
            table = aliases.setdefault((division, team), {})
            if speaker not in table:
                index = len(table)
                table[speaker] = ALIAS_LETTERS[index] if index < len(ALIAS_LETTERS) else f'A{index}'
            alias = table[speaker]
        else:
            alias = speaker or ''
        mark = picked.get(record['id'])
        rows.append({
            'i': record['id'],
            'd': division,
            'g': team,
            's': block['session'],
            'n': speaker or '',
            'a': alias,
            't': text,
            'p': mark['topic'] if mark else '',
            'x': 1 if expert else 0,
        })
    return rows


def seal(payload: str, passphrase: str) -> dict[str, str]:
    """AES-GCM the payload under a PBKDF2 key, in the shape SubtleCrypto expects."""
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt,
                     iterations=ITERATIONS).derive(passphrase.encode('utf-8'))
    sealed = AESGCM(key).encrypt(nonce, payload.encode('utf-8'), None)
    b64 = lambda raw: base64.b64encode(raw).decode('ascii')
    return {'s': b64(salt), 'v': b64(nonce), 'c': b64(sealed), 'n': ITERATIONS}


STYLE = '''
*{box-sizing:border-box}
:root{
 --paper:#eef3f6; --ink:#153249; --card:#ffffff; --line:#d3e0e8;
 --muted:#5a7186; --accent:#006b75; --accent-soft:#e2f1f2;
 --mark:#ffe08a; --pick:#8a5a00; --pick-soft:#fff3d6; --warn:#b3261e;
}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
 font:19px/1.72 "Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;
 word-break:keep-all;overflow-wrap:anywhere}

/* ---- lock ---- */
#gate{min-height:100vh;display:grid;place-items:center;padding:24px}
#gate .box{width:100%;max-width:430px;background:var(--card);border:1px solid var(--line);
 border-radius:18px;padding:38px 32px;text-align:center;
 box-shadow:0 18px 50px rgba(21,50,73,.13)}
#gate .key{font-size:44px;line-height:1;margin-bottom:14px}
#gate h1{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em}
#gate p{margin:0 0 24px;color:var(--muted);font-size:16px;line-height:1.6}
#gate input{width:100%;padding:15px 16px;border:2px solid var(--line);border-radius:12px;
 font:inherit;font-size:26px;text-align:center;letter-spacing:.35em;color:var(--ink);
 font-variant-numeric:tabular-nums}
#gate input:focus{outline:0;border-color:var(--accent)}
#gate button{width:100%;margin-top:12px;padding:15px;border:0;border-radius:12px;
 background:var(--ink);color:#fff;font:inherit;font-size:19px;font-weight:700;cursor:pointer}
#gate button:hover{background:#0e2739}
#gate button:disabled{opacity:.55;cursor:progress}
#gate .msg{min-height:26px;margin-top:12px;font-size:16px;color:var(--warn);font-weight:600}
body.unlocked #gate{display:none}
#app{display:none}
body.unlocked #app{display:block}

header{position:sticky;top:0;z-index:5;background:var(--ink);color:#fff;
 box-shadow:0 2px 14px rgba(21,50,73,.28)}
.bar{max-width:1180px;margin:0 auto;padding:14px 20px;display:flex;flex-wrap:wrap;
 gap:12px 18px;align-items:center}
.brand{display:flex;flex-direction:column;gap:2px;margin-right:auto}
.brand b{font-size:23px;font-weight:800;letter-spacing:-.02em}
.brand span{font-size:14px;color:#b9cfdd}

.search{position:relative;flex:1 1 340px;min-width:0}
.search input{width:100%;padding:13px 44px;border:0;border-radius:11px;
 font:inherit;font-size:19px;color:var(--ink);background:#fff}
.search input:focus{outline:3px solid #ffc24a;outline-offset:2px}
.search .glass{position:absolute;left:15px;top:50%;transform:translateY(-50%);
 color:var(--muted);font-size:18px;pointer-events:none}
.search .clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);
 border:0;background:transparent;color:var(--muted);font:inherit;font-size:22px;
 line-height:1;padding:6px 10px;border-radius:8px;cursor:pointer;display:none}
.search .clear:hover{background:#eef3f6}
body.searching .search .clear{display:block}

.toggle{display:flex;align-items:center;background:rgba(255,255,255,.13);
 border-radius:11px;padding:4px}
.toggle button{border:0;background:transparent;color:#cfe0ea;font:inherit;
 font-size:16px;font-weight:700;padding:9px 15px;border-radius:8px;cursor:pointer;
 white-space:nowrap}
.toggle button[aria-pressed="true"]{background:#fff;color:var(--ink)}
.toggle button:focus-visible{outline:3px solid #ffc24a;outline-offset:1px}

.filters{background:#1d4160;color:#fff}
.filters .bar{padding:11px 20px;gap:8px 10px}
.chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chips .label{font-size:14px;color:#a8c4d6;margin-right:2px}
.chip{border:1px solid rgba(255,255,255,.32);background:transparent;color:#e4eff6;
 font:inherit;font-size:16px;padding:6px 14px;border-radius:999px;cursor:pointer;
 white-space:nowrap}
.chip:hover{background:rgba(255,255,255,.12)}
.chip[aria-pressed="true"]{background:#fff;color:var(--ink);border-color:#fff;font-weight:700}
.chip:focus-visible{outline:3px solid #ffc24a;outline-offset:2px}

main{max-width:1180px;margin:0 auto;padding:22px 20px 80px}
.count{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;
 padding:4px 2px 18px;color:var(--muted);font-size:16px}
.count b{color:var(--ink);font-size:20px;font-weight:800}

.block{margin:0 0 26px}
.block > h2{position:sticky;top:var(--stick,124px);z-index:2;margin:0;
 padding:11px 18px;background:var(--accent-soft);color:#0b4a51;
 border:1px solid #bfe0e2;border-radius:11px;font-size:18px;font-weight:800;
 display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.block > h2 small{font-weight:600;color:#3c7f86;font-size:15px}

.rows{display:flex;flex-direction:column;gap:10px;margin-top:10px}
article{background:var(--card);border:1px solid var(--line);border-radius:13px;
 padding:15px 19px;display:grid;grid-template-columns:auto 1fr;gap:4px 15px;
 align-items:start;scroll-margin-top:200px}
article:target{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.who{grid-column:1;grid-row:1 / span 2;display:flex;flex-direction:column;
 align-items:center;gap:5px;min-width:64px}
.dot{width:46px;height:46px;border-radius:50%;background:var(--accent-soft);
 color:#0b4a51;display:grid;place-items:center;font-size:18px;font-weight:800}
.who .nm{font-size:16px;font-weight:700;text-align:center;line-height:1.3}
.who .nm .anon{color:var(--muted);font-weight:600}
.meta{grid-column:2;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;
 color:var(--muted);font-size:14.5px}
.meta .id{font-variant-numeric:tabular-nums;color:var(--muted);text-decoration:none}
.meta .id:hover{color:var(--accent);text-decoration:underline}
.pick{background:var(--pick-soft);color:var(--pick);border:1px solid #f0d8a0;
 border-radius:999px;padding:2px 11px;font-size:14px;font-weight:700}
.say{grid-column:2;margin:2px 0 0;font-size:19px;line-height:1.75}
mark{background:var(--mark);color:inherit;padding:1px 2px;border-radius:3px}

.ctx{background:#f6fafb;border-style:dashed}
.ctx .dot{background:#e7eef2;color:var(--muted);font-size:14px}

.empty{text-align:center;padding:70px 20px;color:var(--muted);font-size:20px}
.empty b{display:block;color:var(--ink);font-size:24px;margin-bottom:8px}

footer{max-width:1180px;margin:0 auto;padding:26px 20px 60px;color:var(--muted);
 font-size:14.5px;line-height:1.8;border-top:1px solid var(--line)}
footer code{font-size:13px;word-break:break-all}
kbd{background:#fff;border:1px solid var(--line);border-bottom-width:2px;
 border-radius:5px;padding:1px 7px;font:inherit;font-size:13px}

body.anon .who .nm .real{display:none}
body:not(.anon) .who .nm .anon{display:none}

@media (max-width:640px){
 body{font-size:18px}
 .bar{padding:12px 14px}
 .brand{flex:1 1 100%}
 .toggle{flex:1 1 100%;justify-content:center}
 main{padding:18px 14px 60px}
 article{grid-template-columns:1fr;gap:8px;padding:14px 16px}
 .who{grid-column:1;grid-row:auto;flex-direction:row;align-items:center;gap:10px}
 .dot{width:38px;height:38px;font-size:16px}
 .meta,.say{grid-column:1}
 .block > h2{position:static}
 footer{padding:22px 14px 50px}
}
@media print{
 header,.filters,.count,#gate{display:none}
 body{background:#fff;font-size:12pt}
 article{break-inside:avoid;border-color:#999}
 .block > h2{position:static}
}
'''

SCRIPT = r'''
const $ = (s) => document.querySelector(s);
const gateInput = $('#pw'), gateButton = $('#go'), gateMsg = $('#msg');
let DATA = [];
const state = {q: '', d: 0, s: 0, anon: false};

const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function open(pass) {
  const lock = window.__LOCK__;
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name: 'PBKDF2', salt: bytes(lock.s), iterations: lock.n, hash: 'SHA-256'},
    material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: bytes(lock.v)}, key, bytes(lock.c));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function tryPass(pass, quiet) {
  if (!pass) return false;
  gateButton.disabled = true;
  gateMsg.textContent = '';
  try {
    DATA = await open(pass);
  } catch (err) {
    gateButton.disabled = false;
    if (!quiet) {
      gateMsg.textContent = '암호가 맞지 않습니다.';
      gateInput.value = '';
      gateInput.focus();
    }
    return false;
  }
  try { sessionStorage.setItem('speech-pass', pass); } catch (err) { /* private mode */ }
  for (const r of DATA) {
    r._h = norm(r.n + ' ' + r.t + ' ' + r.p + ' ' + r.i +
      ' ' + r.d + '분과 ' + r.g + '조 ' + r.s + '세션');
  }
  document.body.classList.add('unlocked');
  stick();
  render();
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
  return true;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(text, needle) {
  const target = norm(needle || '');
  if (!target) return escapeHtml(text);
  const map = [];
  let flat = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    flat += text[i].toLowerCase();
    map.push(i);
  }
  const spans = [];
  let from = 0;
  for (;;) {
    const hit = flat.indexOf(target, from);
    if (hit < 0) break;
    spans.push([map[hit], map[hit + target.length - 1]]);
    from = hit + target.length;
  }
  if (!spans.length) return escapeHtml(text);
  let out = '', cursor = 0;
  for (const [a, b] of spans) {
    out += escapeHtml(text.slice(cursor, a)) + '<mark>' +
           escapeHtml(text.slice(a, b + 1)) + '</mark>';
    cursor = b + 1;
  }
  return out + escapeHtml(text.slice(cursor));
}

function matches(r) {
  if (state.d && r.d !== state.d) return false;
  if (state.s && r.s !== state.s) return false;
  return !state.q || r._h.includes(state.q);
}

function render() {
  const input = $('#q');
  const rows = DATA.filter(matches);
  const people = new Set(rows.filter((r) => r.n && !r.x).map((r) => r.n));
  const narrowed = state.q || state.d || state.s;
  $('#count').innerHTML = narrowed
    ? '<b>' + rows.length.toLocaleString() + '건</b> 찾음 · 발언자 ' + people.size +
      '명 · 전체 ' + DATA.length.toLocaleString() + '건 가운데'
    : '<b>' + DATA.length.toLocaleString() + '건</b> · 발언자 ' + people.size +
      '명 · 3개 분과 15개 조 · 1·2세션';

  if (!rows.length) {
    $('#list').innerHTML = '<div class="empty"><b>찾는 발언이 없습니다</b>' +
      '다른 낱말로 찾아보거나 위의 분과·세션 단추로 범위를 넓혀 보세요.</div>';
    return;
  }

  const blocks = [];
  let current = null;
  for (const r of rows) {
    const key = r.d + '-' + r.g + '-' + r.s;
    if (!current || current.key !== key) {
      current = {key, d: r.d, g: r.g, s: r.s, rows: []};
      blocks.push(current);
    }
    current.rows.push(r);
  }

  const needle = state.q ? input.value.trim() : '';
  $('#list').innerHTML = blocks.map((b) => {
    const cards = b.rows.map((r) => {
      const face = r.n ? (state.anon ? r.a || '·' : r.n.slice(-2)) : '문맥';
      const name = r.n
        ? '<span class="real">' + escapeHtml(r.n) + '</span><span class="anon">' +
          (r.x ? escapeHtml(r.a) : b.g + '조 ' + (r.a || '·')) + '</span>'
        : '<span class="anon">기록 문맥</span>';
      const pick = r.p
        ? '<span class="pick">의제 대표발언 · ' + escapeHtml(r.p) + '</span>' : '';
      return '<article id="' + r.i + '"' + (r.n ? '' : ' class="ctx"') + '>' +
        '<div class="who"><div class="dot">' + escapeHtml(face) + '</div>' +
        '<div class="nm">' + name + '</div></div>' +
        '<div class="meta"><a class="id" href="#' + r.i + '">' + r.i + '</a>' +
        '<span>' + r.d + '분과 ' + r.g + '조 · ' + r.s + '세션</span>' + pick + '</div>' +
        '<p class="say">' + highlight(r.t, needle) + '</p></article>';
    }).join('');
    return '<section class="block"><h2>' + b.d + '분과 ' + b.g + '조' +
      '<small>' + b.s + '세션 · ' + b.rows.length + '건</small></h2>' +
      '<div class="rows">' + cards + '</div></section>';
  }).join('');
}

function stick() {
  const head = $('#app header'), filters = $('#app .filters');
  if (!head || !filters) return;
  const h = head.offsetHeight + filters.offsetHeight;
  document.documentElement.style.setProperty('--stick', (h + 4) + 'px');
}

gateButton.addEventListener('click', () => tryPass(gateInput.value.trim(), false));
gateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryPass(gateInput.value.trim(), false);
});

$('#q').addEventListener('input', function () {
  document.body.classList.toggle('searching', this.value.trim() !== '');
  clearTimeout(window._t);
  window._t = setTimeout(() => { state.q = norm(this.value.trim()); render(); }, 90);
});

$('#clear').addEventListener('click', () => {
  const input = $('#q');
  input.value = '';
  state.q = '';
  document.body.classList.remove('searching');
  input.focus();
  render();
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    state[chip.dataset.group] = Number(chip.dataset.value);
    for (const other of document.querySelectorAll(
        '.chip[data-group="' + chip.dataset.group + '"]')) {
      other.setAttribute('aria-pressed', String(other === chip));
    }
    render();
  });
}

for (const button of document.querySelectorAll('.toggle button')) {
  button.addEventListener('click', () => {
    state.anon = button.dataset.mode === 'anon';
    document.body.classList.toggle('anon', state.anon);
    for (const other of document.querySelectorAll('.toggle button')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('unlocked')) return;
  const input = $('#q');
  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
    input.select();
  }
  if (e.key === 'Escape' && document.activeElement === input) input.blur();
});

addEventListener('resize', stick);

(async function () {
  let remembered = null;
  try { remembered = sessionStorage.getItem('speech-pass'); } catch (err) { /* ignore */ }
  if (!(remembered && await tryPass(remembered, true))) gateInput.focus();
})();
'''


def render_page(rows: list[dict], canon: dict, lock: dict) -> str:
    people = len({row['n'] for row in rows if row['n']})
    picked = sum(1 for row in rows if row['p'])
    context = sum(1 for row in rows if not row['n'])
    source = canon['source']
    chips = lambda group, values, suffix: ''.join(
        f'<button class="chip" data-group="{group}" data-value="{v}" '
        f'aria-pressed="false">{v}{suffix}</button>' for v in values)
    return f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>시민 발언 전체 · 기후시민회의 제5차 분과토론</title>
<style>{STYLE}</style>
</head>
<body>

<div id="gate">
 <div class="box">
  <div class="key">🔑</div>
  <h1>시민 발언 전체</h1>
  <p>기후시민회의 제5차 분과토론 기록입니다.<br>모더레이터에게 받은 암호를 넣어 주세요.</p>
  <input id="pw" type="password" inputmode="numeric" autocomplete="off"
   maxlength="24" aria-label="암호" placeholder="····">
  <button id="go" type="button">열기</button>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
 </div>
</div>

<div id="app">
<header>
 <div class="bar">
  <div class="brand">
   <b>시민 발언 전체</b>
   <span>제5차 분과토론 · 최종 보고서 정본 {len(rows):,}건</span>
  </div>
  <div class="search">
   <span class="glass">🔍</span>
   <input id="q" type="search" autocomplete="off" spellcheck="false"
    placeholder="이름 · 낱말 · 조로 찾기 (예: 재생에너지, 3조)" aria-label="발언 검색">
   <button id="clear" class="clear" type="button" aria-label="검색어 지우기">×</button>
  </div>
  <div class="toggle" role="group" aria-label="발언자 표시 방식">
   <button type="button" data-mode="real" aria-pressed="true">실명 보기</button>
   <button type="button" data-mode="anon" aria-pressed="false">조 단위</button>
  </div>
 </div>
</header>
<div class="filters">
 <div class="bar">
  <div class="chips"><span class="label">분과</span>
   <button class="chip" data-group="d" data-value="0" aria-pressed="true">전체</button>
   {chips('d', (1, 2, 3), '분과')}</div>
  <div class="chips"><span class="label">세션</span>
   <button class="chip" data-group="s" data-value="0" aria-pressed="true">전체</button>
   {chips('s', (1, 2), '세션')}</div>
 </div>
</div>
<main>
 <div id="count" class="count"></div>
 <div id="list"></div>
</main>
<footer>
 <p>분과·조·세션 순서로 실었습니다. 의제에 선정되지 않은 발언도 그대로 보존했습니다 —
 <strong>의제 대표발언</strong> 표시가 붙은 {picked}건이 분과 장표에 오른 발언입니다.
 발언자 {people}명, 이름이 붙지 않은 기록 문맥 {context}건을 포함합니다.</p>
 <p><strong>조 단위</strong>로 바꾸면 이름이 가려지고 조 안에서만 통하는 글자(1조 A, 1조 B …)로
 바뀝니다. 같은 사람은 1·2세션에서 같은 글자를 씁니다.</p>
 <p>검색은 이름·본문·조·분과·세션·기록번호를 함께 훑고 띄어쓰기는 무시합니다.
 <kbd>/</kbd> 를 누르면 검색창으로 갑니다.</p>
 <p>정본 = {source['path']}<br><code>sha256 {source['sha256']}</code></p>
</footer>
</div>

<script>window.__LOCK__={json.dumps(lock)};</script>
<script>{SCRIPT}</script>
</body>
</html>
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--canon', type=Path, default=CANON)
    parser.add_argument('--quotes', type=Path, default=QUOTES)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--passphrase', default=os.environ.get('SPEECH_PASS'),
                        help='열쇠글. 생략하면 SPEECH_PASS 환경변수를 쓴다. 저장소에 두지 않는다.')
    args = parser.parse_args()
    if not args.passphrase:
        parser.error('열쇠글이 없다. --passphrase 를 주거나 SPEECH_PASS 를 설정할 것.')

    canon = json.loads(args.canon.read_text(encoding='utf-8'))
    rows = build_records(canon, load_representative_quotes(args.quotes))
    payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_page(rows, canon, seal(payload, args.passphrase)),
                           encoding='utf-8')

    people = len({row['n'] for row in rows if row['n']})
    print(f'{args.output}\n  {len(rows)}건 · 발언자 {people}명 · '
          f'대표발언 {sum(1 for row in rows if row["p"])}건 · '
          f'{args.output.stat().st_size / 1024:.0f}KB · 암호 잠금 적용')


if __name__ == '__main__':
    main()
