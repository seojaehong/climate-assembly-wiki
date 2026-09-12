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
import re
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
#gate .help{margin:4px 0 0;font-size:16px}
#gate .help a{color:var(--accent);font-weight:700}
.guide{flex:0 0 auto;color:#fff;font-size:16px;font-weight:700;text-decoration:none;
 border:1px solid rgba(255,255,255,.45);border-radius:9px;padding:8px 14px;white-space:nowrap}
.guide:hover{background:rgba(255,255,255,.14)}
.guide:focus-visible{outline:3px solid #ffc24a;outline-offset:2px}
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
  <p class="help"><a href="guide.html">처음이신가요? 사용법 보기</a></p>
 </div>
</div>

<div id="app">
<header>
 <div class="bar">
  <div class="brand">
   <b>시민 발언 전체</b>
   <span>제5차 분과토론 · 최종 보고서 정본 {len(rows):,}건</span>
  </div>
  <a class="guide" href="guide.html">사용법</a>
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


def hits(rows: list[dict], query: str) -> tuple[int, int]:
    """검색창이 세는 방식 그대로 — 안내문 숫자가 화면과 어긋나지 않게 한다."""
    flat = lambda s: re.sub(r'\s+', '', s).lower()
    needle = flat(query)
    whole = sum(1 for r in rows if needle in flat(
        f"{r['n']} {r['t']} {r['p']} {r['i']} {r['d']}분과 {r['g']}조 {r['s']}세션"))
    body = sum(1 for r in rows if needle in flat(r['t']))
    return whole, body


GUIDE_STYLE = '''
*{box-sizing:border-box}
:root{--paper:#eef3f6;--ink:#153249;--card:#fff;--line:#d3e0e8;--muted:#5a7186;
 --accent:#006b75;--accent-soft:#e2f1f2;--mark:#ffe08a;--pick:#8a5a00;--pick-soft:#fff3d6}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
 font:19px/1.75 "Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;
 word-break:keep-all;overflow-wrap:anywhere}
header{background:var(--ink);color:#fff}
header .bar{max-width:900px;margin:0 auto;padding:22px 24px;display:flex;
 flex-wrap:wrap;gap:10px 18px;align-items:baseline}
header b{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-right:auto}
header a{color:#fff;font-size:17px;font-weight:700;text-decoration:none;
 border:1px solid rgba(255,255,255,.45);border-radius:9px;padding:7px 15px}
header a:hover{background:rgba(255,255,255,.14)}
main{max-width:900px;margin:0 auto;padding:26px 24px 90px}
.lead{font-size:20px;color:var(--muted);margin:0 0 30px}
.lead b{color:var(--ink)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;
 padding:24px 26px;margin:0 0 18px}
h2{margin:0 0 14px;font-size:22px;font-weight:800;display:flex;gap:12px;align-items:center}
h2 i{flex:0 0 auto;width:34px;height:34px;border-radius:50%;background:var(--accent-soft);
 color:#0b4a51;display:grid;place-items:center;font-style:normal;font-size:17px;font-weight:800}
p{margin:0 0 12px}
ul{margin:0 0 12px;padding-left:22px}
li{margin:0 0 7px}
.note{background:#f6fafb;border-left:4px solid var(--accent);border-radius:0 9px 9px 0;
 padding:12px 16px;margin:14px 0 0;font-size:17.5px;color:#3c5468}
.warn{background:var(--pick-soft);border-left-color:#d9a441;color:#6b4600}
table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:18px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:700;font-size:16px;white-space:nowrap}
td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700}
code,kbd{background:#eef3f6;border:1px solid var(--line);border-radius:6px;
 padding:2px 8px;font:inherit;font-size:16.5px;white-space:nowrap}
kbd{border-bottom-width:2px}
.mock{background:#f6fafb;border:1px solid var(--line);border-radius:11px;
 padding:15px 17px;margin:12px 0}
.mock .top{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:11px}
.mock .box{flex:1 1 180px;background:#fff;border:1px solid var(--line);border-radius:9px;
 padding:9px 13px;color:var(--muted);font-size:17px}
.mock .sw{display:flex;background:var(--ink);border-radius:9px;padding:3px}
.mock .sw span{padding:6px 12px;border-radius:7px;font-size:15.5px;font-weight:700;color:#cfe0ea}
.mock .sw span.on{background:#fff;color:var(--ink)}
.mock .row{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;background:#fff;
 border:1px solid var(--line);border-radius:11px;padding:13px 16px}
.mock .dot{grid-row:1 / span 2;width:42px;height:42px;border-radius:50%;
 background:var(--accent-soft);color:#0b4a51;display:grid;place-items:center;
 font-size:16px;font-weight:800;align-self:start}
.mock .meta{display:flex;flex-wrap:wrap;gap:4px 9px;align-items:center;
 color:var(--muted);font-size:15px}
.mock .pick{background:var(--pick-soft);color:var(--pick);border:1px solid #f0d8a0;
 border-radius:999px;padding:1px 10px;font-size:14px;font-weight:700}
.mock .say{margin:2px 0 0;font-size:18px}
.mock mark{background:var(--mark);padding:1px 2px;border-radius:3px}
.tag{display:inline-block;background:var(--accent-soft);color:#0b4a51;border-radius:7px;
 padding:1px 9px;font-size:16px;font-weight:700}
footer{max-width:900px;margin:0 auto;padding:0 24px 70px;color:var(--muted);font-size:15.5px}
@media (max-width:640px){
 body{font-size:18px}
 header .bar,main,footer{padding-left:15px;padding-right:15px}
 section{padding:20px 17px}
 h2{font-size:20px}
 .mock .row{grid-template-columns:1fr}
 .mock .dot{grid-row:auto}
}
@media print{
 body{background:#fff;font-size:11.5pt;line-height:1.6}
 header{background:#fff;color:var(--ink);border-bottom:2px solid var(--ink)}
 header a{display:none}
 section{break-inside:avoid;border-color:#aaa;padding:14px 16px;margin-bottom:10px}
 main{padding:14px 0 0}
}
'''


def render_guide(rows: list[dict], canon: dict) -> str:
    people = len({row['n'] for row in rows if row['n'] and not row['x']})
    picked = sum(1 for row in rows if row['p'])
    context = sum(1 for row in rows if not row['n'])
    word, word_body = hits(rows, '재생에너지')
    samples = [('김명훈', '이름으로'), ('재생에너지', '낱말로'),
               ('3조', '조로'), ('일회용', '낱말로')]
    table = ''.join(
        f'<tr><td><code>{q}</code></td><td>{how} 찾기</td>'
        f'<td class="n">{hits(rows, q)[0]}건</td></tr>' for q, how in samples)
    source = canon['source']
    return f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>사용법 · 시민 발언 전체</title>
<style>{GUIDE_STYLE}</style>
</head>
<body>
<header><div class="bar">
 <b>사용법 · 시민 발언 전체</b>
 <a href="./">화면 열기 →</a>
</div></header>
<main>

<p class="lead">제5차 분과토론에서 나온 <b>시민 발언 {len(rows):,}건</b>을 이름·낱말로 찾아보는
화면입니다. 발언자 {people}명, 3개 분과 15개 조, 1·2세션을 담았습니다.
<b>의제에 선정되지 않은 발언도 그대로</b> 들어 있습니다.</p>

<section>
<h2><i>1</i>들어가기 — 암호를 두 번 넣습니다</h2>
<p>처음 들어갈 때만 두 번이고, 그 뒤로는 묻지 않습니다.</p>
<ul>
 <li><b>첫 번째</b> — 브라우저가 띄우는 작은 창입니다. <b>사용자 이름은 아무거나</b> 넣거나 비워도 되고,
 암호만 맞으면 됩니다.</li>
 <li><b>두 번째</b> — 화면 가운데 열쇠 그림 아래에 같은 암호를 한 번 더 넣습니다.</li>
</ul>
<div class="note">두 번인 이유가 있습니다. 첫 번째는 <b>파일이 서버에서 나가지 않게</b> 막고,
두 번째는 <b>파일이 새어 나가더라도 내용을 읽지 못하게</b> 막습니다. 발언에 실명이 들어 있어서
두 겹으로 두었습니다.</div>
<div class="note warn">브라우저를 완전히 닫으면 다시 묻습니다. 현장에서는 <b>쓰는 동안 창을 닫지 마세요.</b></div>
</section>

<section>
<h2><i>2</i>찾기 — 검색창 한 곳에서 다 됩니다</h2>
<div class="mock"><div class="top">
 <div class="box">🔍 이름 · 낱말 · 조로 찾기</div>
</div></div>
<p>이름이든 낱말이든 조 번호든 같은 칸에 넣습니다. <b>띄어쓰기는 무시</b>합니다.</p>
<table>
 <tr><th>넣어 보면</th><th></th><th>결과</th></tr>
 {table}
 <tr><td><code>RPT-1-1-S1-003</code></td><td>기록번호로 한 건만</td><td class="n">1건</td></tr>
</table>
<div class="note">찾은 건수가 눈에 보이는 것보다 많을 때가 있습니다.
<b>의제 주제명까지 함께 훑기</b> 때문입니다. 예를 들어 <code>재생에너지</code>는 {word}건이 나오는데,
본문에 그 낱말이 있는 것은 {word_body}건이고 나머지 {word - word_body}건은
「재생에너지·전력 인프라 투자」라는 의제에 묶인 발언입니다.</div>
</section>

<section>
<h2><i>3</i>이름 가리기 — 화면을 여럿이 볼 때</h2>
<div class="mock"><div class="top">
 <div class="sw"><span class="on">실명 보기</span><span>조 단위</span></div>
</div></div>
<p>오른쪽 위에서 <span class="tag">조 단위</span>를 누르면 이름이 사라지고
<b>「1조 A」처럼 조 안에서만 통하는 글자</b>로 바뀝니다.
같은 사람은 1세션과 2세션에서 <b>같은 글자</b>를 씁니다.</p>
<p>빔프로젝터로 띄우거나 다른 조에 보여줄 때 먼저 눌러 두면 됩니다.
누가 한 말인지 이어서 읽을 수는 있고, 이름만 가려집니다.</p>
</section>

<section>
<h2><i>4</i>분과·세션으로 좁히기</h2>
<p>검색창 아래 단추로 분과(1·2·3)와 세션(1·2)을 좁힙니다. 검색어와 함께 걸립니다 —
<code>교육</code>을 넣고 <span class="tag">3분과</span>를 누르면 3분과 안에서만 찾습니다.</p>
</section>

<section>
<h2><i>5</i>화면 읽기</h2>
<div class="mock"><div class="row">
 <div class="dot">명훈</div>
 <div class="meta"><span>RPT-1-1-S1-023</span><span>1분과 1조 · 1세션</span>
  <span class="pick">의제 대표발언 · 재생에너지·전력 인프라 투자</span></div>
 <p class="say">친환경적으로 노력하는 기업에게 비용을 지원해주는 <mark>접근</mark>이 어떨까 싶다.</p>
</div></div>
<ul>
 <li><b>RPT-…</b> — 기록번호입니다. 누르면 그 발언의 주소가 됩니다.</li>
 <li><b>1분과 1조 · 1세션</b> — 어느 자리에서 나온 말인지입니다.</li>
 <li><span class="pick">의제 대표발언</span> — 분과 장표에 오른 발언입니다. {picked}건 있습니다.
 이 표시가 없다고 해서 덜 중요한 것은 아니고, 장표에 넣지 않았을 뿐입니다.</li>
 <li><b>노란 칠</b> — 찾은 낱말이 있는 자리입니다.</li>
 <li><b>기록 문맥</b> — 이름이 붙지 않은 기록입니다. 소제목이나 여러 사람의 말이 이어진 부분으로
 {context}건 있고, 테두리가 점선입니다.</li>
</ul>
</section>

<section>
<h2><i>6</i>빠르게 쓰기</h2>
<ul>
 <li><kbd>/</kbd> 를 누르면 어디에 있든 검색창으로 갑니다.</li>
 <li>기록번호를 누른 뒤 <b>주소창을 복사해 보내면</b>, 받은 사람은 그 발언으로 바로 갑니다
 (암호는 따로 넣어야 합니다).</li>
 <li><kbd>Ctrl</kbd>+<kbd>P</kbd> 로 인쇄합니다. <b>검색해서 좁힌 뒤 인쇄하면 그 결과만</b> 나옵니다.
 검색창과 단추는 인쇄되지 않습니다.</li>
 <li>휴대전화에서도 그대로 됩니다.</li>
</ul>
</section>

<section>
<h2><i>7</i>알아둘 것</h2>
<ul>
 <li><b>실명이 들어 있습니다.</b> 주소와 암호를 함께 넘기지 마세요.</li>
 <li>검색은 <b>정확히 그 글자</b>를 찾습니다. 비슷한 말은 걸리지 않으니
 <code>일회용품</code>이 없으면 <code>일회용</code>으로 줄여 보세요.</li>
 <li>내용을 고칠 수는 없는 화면입니다. 고쳐야 할 곳을 찾으면 기록번호를 적어 알려주세요.</li>
</ul>
</section>

</main>
<footer>
 <p>출처 = {source['path']}<br>발언 {len(rows):,}건 · 발언자 {people}명 ·
 의제 대표발언 {picked}건 · 이름 없는 기록 문맥 {context}건</p>
</footer>
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
    guide = args.output.parent / 'guide.html'
    guide.write_text(render_guide(rows, canon), encoding='utf-8')

    people = len({row['n'] for row in rows if row['n'] and not row['x']})
    print(f'{args.output}\n  {len(rows)}건 · 발언자 {people}명 · '
          f'대표발언 {sum(1 for row in rows if row["p"])}건 · '
          f'{args.output.stat().st_size / 1024:.0f}KB · 암호 잠금 적용\n'
          f'{guide}\n  사용법 · {guide.stat().st_size / 1024:.0f}KB')


if __name__ == '__main__':
    main()
