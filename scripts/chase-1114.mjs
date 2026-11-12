#!/usr/bin/env node
/**
 * 11/14 의결 — 운영 PC 전용 「투표 진행판 + 카톡 독려 전송」(로컬 서버, 운영 사이트 배포 없음).
 *
 *   # 진행판(브라우저 http://127.0.0.1:8766/)
 *   node scripts/chase-1114.mjs --serve [--port 8766] [--token-file <파일>] [--room <카톡 방번호>]
 *   # 시연(Supabase 없이 가짜 명단 174명 · 진행이 시간에 따라 오른다)
 *   node scripts/chase-1114.mjs --serve --demo [--room self-inbox]
 *   # 한 번만 문구 만들기(stdout) · --send 면 --room 방으로 보냄
 *   node scripts/chase-1114.mjs --once --ballot <id> [--label 의제1] [--deadline 14:40] [--send --room <방>]
 *
 * 읽는 RPC(쓰기 0, anon 키 + 운영자 접속 토큰): ballot_list_v2 · ballot_progress_board(s34).
 *   s34 가 아직 운영 DB 에 없으면 ballot_named_responses_v2 로 대체(제출 기준만, 진행 중 건수 0) — 화면에 띄를 띄운다.
 *   그때도 찬반 값(answers)은 서버 안에서 「답이 있다」로만 세고 버린다. 브라우저로 가는 값에 찬반은 없다.
 * 운영자 접속 토큰은 CV_ACCESS_TOKEN 또는 --token-file. 화면 · 로그 · 응답에 내보내지 않는다.
 * 제외 목록 · 전송 기록은 저장소 안 .tmp-chase/(스스로 .gitignore 를 둔다, 실명이 들어간다).
 * 카톡 전송은 로컬 kakao-reader API(127.0.0.1:8755)의 outbox 준비 → 발송 두 단계. 재시도하지 않는다.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardChaseState, chaseText, namedToBoard, remainText } from './lib/chase-1114.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(REPO, '.tmp-chase');
const SETTINGS_FILE = join(STATE_DIR, 'settings.json');
const SEND_LOG = join(STATE_DIR, 'send-log.jsonl');

const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (k) => argv.includes(k);

const DEMO = has('--demo');
const ROOM = (arg('--room') ?? '').trim();
const PORT = Number(arg('--port') ?? 8766);
const KAKAO_BASE = (process.env.CHASE_KAKAO_BASE ?? 'http://127.0.0.1:8755').replace(/\/$/, '');
// 시연 문구는 본인방으로만 보낸다. 카톡 로컬 API 는 방 이름이 아니라 고정 번호를 받는다(본컴 「나와의 채팅」 = 2, 11/12 실측)
// — 본인방 번호는 CHASE_SELF_ROOM 으로 준다(저장소에 적지 않는다).
const DEMO_ROOM_OK = process.env.CHASE_SELF_ROOM?.trim() || 'self-inbox';

function die(msg, code = 2) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

// ── 로컬 저장(.tmp-chase) ────────────────────────────────────────────

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
  const gi = join(STATE_DIR, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n', 'utf8'); // 폴더 통째로 git 밖(실명 포함)
}

function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      exclude: Array.isArray(s.exclude) ? s.exclude.map(String) : [],
      signed: Array.isArray(s.signed) ? s.signed.map(String) : [],
    };
  } catch {
    return { exclude: [], signed: [] };
  }
}

function saveSettings(s) {
  ensureStateDir();
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function logSend(entry) {
  try {
    ensureStateDir();
    appendFileSync(SEND_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    /* 기록 실패가 전송 결과를 바꾸지 않는다 */
  }
}

// ── Supabase(export-result-v2.mjs 와 같은 방식) ──────────────────────

function supabaseTarget() {
  let url = process.env.PUBLIC_SUPABASE_URL;
  let anon = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // 화면과 같은 공개 값(anon 키는 공개 키다)을 src/lib/supabase.ts 에서 읽는다 — 두 곳에 적지 않는다.
    const src = readFileSync(join(REPO, 'src/lib/supabase.ts'), 'utf8');
    url ||= /const FALLBACK_URL = '([^']+)'/.exec(src)?.[1];
    anon ||= /const FALLBACK_ANON = '([^']+)'/.exec(src)?.[1];
  }
  if (!url || !anon) die('Supabase 주소 · anon 키를 찾지 못했습니다');
  return { url: url.trim().replace(/\/$/, ''), anon: anon.trim() };
}

function accessToken() {
  const file = arg('--token-file');
  const raw = (file ? readFileSync(file, 'utf8') : process.env.CV_ACCESS_TOKEN ?? '').trim();
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    die('운영자 접속 토큰이 없습니다. CV_ACCESS_TOKEN(64자리)을 넣거나 --token-file 을 주세요.\n  /mod 에 로그인한 노트북 개발자 도구: JSON.parse(localStorage.climate_vote_mod_session_v1).accessToken');
  }
  return raw;
}

class RpcError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 진행판은 3초마다 묻는다 — 재시도 없이 짧게(4초) 끊는다. */
async function rpc(fn, body, timeoutMs = 4000) {
  const { url, anon } = supabaseTarget();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'climate_vote',
        'Accept-Profile': 'climate_vote',
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      let code = '';
      try {
        const j = JSON.parse(text);
        msg = j.message ?? text;
        code = j.code ?? '';
      } catch {
        /* 본문이 JSON 이 아님 */
      }
      throw new RpcError(`${fn} HTTP ${res.status}: ${String(msg).slice(0, 200)}`, { status: res.status, code });
    }
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof RpcError) throw e;
    throw new RpcError(`${fn}: ${e.name === 'AbortError' ? `응답 없음(${timeoutMs / 1000}초)` : e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── 데이터 출처(실전 · 시연) ─────────────────────────────────────────

function agendaOf(b) {
  const m = /의제\s*([1-9])/.exec(`${b.title ?? ''} ${b.subgroup ?? ''}`);
  return m ? Number(m[1]) : null;
}

/** 브라우저로 가는 투표지 줄 — 투표지 토큰은 뺀다. */
function publicBallot(b) {
  return {
    id: b.id,
    title: b.title,
    status: b.status,
    item_count: b.item_count,
    response_count: b.response_count ?? null,
    agenda: agendaOf(b),
  };
}

function liveSource(token) {
  let listCache = { at: 0, rows: null };
  let progressMissing = false; // s34 미적용이면 대체 경로로(확인한 시각, ms)
  return {
    mode: 'live',
    async ballots() {
      if (listCache.rows && Date.now() - listCache.at < 15000) return listCache.rows;
      const rows = await rpc('ballot_list_v2', { p_token: token }, 6000);
      listCache = {
        at: Date.now(),
        rows: (rows ?? []).filter((b) => b.status === 'open' || b.status === 'closed').map(publicBallot),
      };
      return listCache.rows;
    },
    async board(ballotId) {
      // 함수가 없으면 대체 경로로 가되, 서버를 켜 둔 채 s34 를 적용해도 넘어오게 60초마다 다시 본다.
      if (!progressMissing || Date.now() - progressMissing > 60000) {
        try {
          const b = await rpc('ballot_progress_board', { p_token: token, p_ballot_id: ballotId });
          progressMissing = false;
          return b;
        } catch (e) {
          // 함수가 없음(PGRST202 / 404) → 대체 경로. 권한 · 범위 오류는 그대로 올린다.
          if (!(e.code === 'PGRST202' || e.status === 404)) throw e;
          progressMissing = Date.now();
        }
      }
      const named = await rpc('ballot_named_responses_v2', { p_token: token, p_ballot_id: ballotId });
      return named ? namedToBoard(named) : null; // answers 는 여기서 버려진다
    },
  };
}

// 시연 — 결정적 난수.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoRoster() {
  const r = rng(1114);
  const sur = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
  const giv = ['민', '서', '지', '현', '수', '영', '준', '우', '하', '은', '도', '윤', '재', '경', '아', '진', '호', '연'];
  const teams = [];
  for (let d = 1; d <= 3; d += 1) for (let t = 1; t <= 5; t += 1) teams.push(`${d}분과 ${t}조`);
  const sizes = teams.map((_, i) => (i < 5 ? 11 : 10)); // 55 + 50 + 50 = 155
  teams.push('기획참여단 1조', '기획참여단 2조');
  sizes.push(10, 9); // 합 174
  const used = new Set();
  const people = [];
  teams.forEach((team, ti) => {
    for (let k = 0; k < sizes[ti]; k += 1) {
      let name;
      do name = sur[Math.floor(r() * sur.length)] + giv[Math.floor(r() * giv.length)] + giv[Math.floor(r() * giv.length)];
      while (used.has(name));
      used.add(name);
      people.push({ team, name });
    }
  });
  // 동명이인 한 쌍(조가 다르다).
  people.find((p) => p.team === '2분과 3조').name = '김민수';
  people.find((p) => p.team === '3분과 3조').name = '김민수';
  return people;
}

function demoSource() {
  const t0 = Date.now();
  const roster = demoRoster();
  const ballots = [
    { id: 'demo-agenda-1', title: '[시연] 의제1 권고안 투표', status: 'open', item_count: 19, agenda: 1 },
    { id: 'demo-agenda-2', title: '[시연] 의제2 권고안 투표', status: 'open', item_count: 28, agenda: 2 },
    { id: 'demo-agenda-3', title: '[시연] 의제3 권고안 투표', status: 'open', item_count: 23, agenda: 3 },
  ];
  const plans = new Map();
  for (const b of ballots) {
    const r = rng(b.item_count * 7919);
    plans.set(
      b.id,
      roster.map((p) => ({
        ...p,
        never: r() < 0.08, // 끝까지 안 들어옴
        startSec: 3 + r() * 70,
        perItem: 1.5 + r() * 4.5,
        stallAt: r() < 0.06 ? 1 + Math.floor(r() * (b.item_count - 1)) : null, // 중간에 멈춤
      })),
    );
  }
  const iso = (sec) => new Date(t0 + sec * 1000).toISOString();
  return {
    mode: 'demo',
    async ballots() {
      return ballots;
    },
    async board(ballotId) {
      const b = ballots.find((x) => x.id === ballotId);
      if (!b) throw new RpcError('ballot not in authorization scope');
      const n = b.item_count;
      const el = (Date.now() - t0) / 1000;
      const voters = [];
      const perOrdinal = new Array(n + 1).fill(0);
      const plan = [...plans.get(ballotId), { team: '1분과 2조', name: '홍길동', offRoster: true, never: false, startSec: 20, perItem: 6, stallAt: 9 }];
      for (const p of plan) {
        const v = {
          team: p.team,
          name: p.name,
          in_roster: !p.offRoster,
          started_at: null,
          answered_count: 0,
          last_ordinal: null,
          updated_at: null,
          submitted: false,
          submitted_at: null,
        };
        if (!p.never && el >= p.startSec) {
          let k = Math.min(n, Math.floor((el - p.startSec) / p.perItem));
          if (p.stallAt != null) k = Math.min(k, p.stallAt);
          v.started_at = iso(p.startSec);
          v.answered_count = k;
          v.last_ordinal = k || null;
          v.updated_at = iso(p.startSec + k * p.perItem);
          const doneSec = p.startSec + n * p.perItem + 4;
          if (k === n && el >= doneSec) {
            v.submitted = true;
            v.submitted_at = iso(doneSec);
          }
          for (let o = 1; o <= k; o += 1) perOrdinal[o] += 1;
          // 시연 — 멈춘 사람은 진행요원 폰으로 이어 하는 중(기기 2대). 그중 둘에 하나는 대리 입력으로 제출됐다고 본다.
          v.devices = 1;
          if (p.stallAt != null && el >= p.startSec + 30) {
            v.devices = 2;
            if (p.stallAt % 2 === 0) {
              v.submitted = true;
              v.proxy = true;
              v.submitted_at = iso(p.startSec + 40);
            }
          }
        }
        if (v.in_roster || v.started_at) voters.push(v);
      }
      return {
        id: b.id,
        title: b.title,
        status: b.status,
        item_count: n,
        at: new Date().toISOString(),
        roster_count: roster.length,
        items: Array.from({ length: n }, (_, i) => ({
          ordinal: i + 1,
          statement_head: `[시연] ${b.agenda}-${i + 1} 권고안 문장 앞부분 예시입니다`.slice(0, 40),
          answered: perOrdinal[i + 1],
        })),
        voters,
        submitted: voters.filter((v) => v.submitted).length,
        started: voters.filter((v) => v.submitted || v.started_at).length,
      };
    },
  };
}

// ── 판 만들기(브라우저로 가는 값 — 찬반 · 토큰 없음) ────────────────

function composeView(board, { label, deadline, exclude, signed = [] }) {
  const st = boardChaseState(board, exclude, signed);
  const now = new Date();
  const text = chaseText(st, { label, now, remainText: remainText(deadline, now) });
  return {
    board: {
      id: board.id,
      title: board.title,
      status: board.status,
      item_count: board.item_count,
      at: board.at ?? now.toISOString(),
      roster_count: board.roster_count ?? st.rosterCount,
      items: (board.items ?? []).map((it) => ({
        ordinal: it.ordinal,
        statement_head: String(it.statement_head ?? '').slice(0, 40),
        answered: Number(it.answered) || 0,
      })),
      fallback: board.fallback ?? null,
    },
    chase: {
      text,
      submitted: st.submittedBase ?? st.submitted,
      rosterCount: st.rosterCount,
      remaining: st.remaining,
      excluded: st.excluded,
      waitingCount: st.waiting.length,
      notStartedCount: st.notStartedCount,
      itemCount: st.itemCount,
      offRoster: st.waiting.filter((w) => w.offRoster).map((w) => ({ team: w.team, name: w.name, answered: w.answered })),
      useSigned: st.useSigned,
      signedCount: st.signedCount,
      unsigned: st.unsigned,
      signedUnmatched: st.signedUnmatched,
      checks: st.checks,
    },
    groups: st.groups,
  };
}

/** 머리줄 이름 — 「전체회의 의결 의제N …」 제목에서 「의제N」. 못 찾으면 제목 앞부분. */
function labelFor(ballots, ballotId, given, board = null) {
  if (given) return given;
  const b = ballots?.find((x) => x.id === ballotId);
  const n = b?.agenda ?? (board ? agendaOf(board) : null);
  if (n) return `의제${n}`;
  const head = String(board?.title ?? b?.title ?? '').trim().slice(0, 16);
  return head || '전체회의';
}

// ── 카톡(로컬 kakao-reader API) ──────────────────────────────────────

function kakaoToken() {
  const file = process.env.CHASE_KAKAO_TOKEN_FILE ?? join(process.env.LOCALAPPDATA ?? '', 'kakao-reader', 'api', 'token');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

async function kakaoPost(path, body, key, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${KAKAO_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kakaoToken()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let env = null;
    try {
      env = JSON.parse(await res.text());
    } catch {
      env = null;
    }
    // 카톡 로컬 API 봉투 = { ok: true, data: {...} } / 실패 { ok: false, error: { code } } (kakao_client.request 와 같은 해석, 11/12 실측)
    const good = res.ok && env?.ok === true && env?.data && typeof env.data === 'object';
    return { http: res.status, ok: !!good, json: good ? env.data : { code: env?.error?.code ?? 'request_rejected' } };
  } finally {
    clearTimeout(timer);
  }
}

/** 오류 본문에는 방 이름 · 문구가 들어갈 수 있다 — 상태 · 코드만 꺼낸다. */
function codeOf(json) {
  const c = json?.code ?? json?.error?.code ?? json?.detail?.code ?? json?.last_attempt?.code ?? '';
  return typeof c === 'string' ? c.slice(0, 80) : String(c).slice(0, 80);
}

/**
 * 준비 → 발송. 재시도 없음. 발송 단계에서 끊기면 uncertain(나갔는지 모름)으로 본다.
 * @returns {{ ok:boolean, stage:'guard'|'prepare'|'send', status:string, code?:string, http?:number, id?:string }}
 */
async function kakaoSend(room, rawText) {
  if (!room) return { ok: false, stage: 'guard', status: 'no_room', code: '스태프 단톡방 미등록(--room)' };
  if (DEMO && room !== DEMO_ROOM_OK) {
    return { ok: false, stage: 'guard', status: 'demo_blocked', code: `시연 모드는 --room ${DEMO_ROOM_OK} 로만 보낸다` };
  }
  const text = DEMO && !rawText.startsWith('[시연]') ? `[시연] ${rawText}` : rawText;
  if (!text.trim()) return { ok: false, stage: 'guard', status: 'empty' };
  if (!kakaoToken()) return { ok: false, stage: 'guard', status: 'no_kakao_token', code: '카톡 API 토큰 파일 없음' };
  const root = `chase1114-${sha256(`${room}\n${text}`).slice(0, 32)}`;
  let prep;
  try {
    prep = await kakaoPost('/v1/outbox', { room, text }, sha256(`${root}:prepare`), 30000);
  } catch (e) {
    return { ok: false, stage: 'prepare', status: 'prepare_failed', code: e.name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!prep.ok || !prep.json?.id || !prep.json?.confirmation) {
    return { ok: false, stage: 'prepare', status: 'prepare_failed', http: prep.http, code: codeOf(prep.json) };
  }
  const id = String(prep.json.id);
  let sent;
  try {
    sent = await kakaoPost(`/v1/outbox/${encodeURIComponent(id)}/send`, { confirmation: prep.json.confirmation }, sha256(`${root}:send`), 180000);
  } catch (e) {
    return { ok: false, stage: 'send', status: 'uncertain', id, code: e.name === 'AbortError' ? 'timeout_180s' : 'network' };
  }
  const status = String(sent.json?.status ?? sent.json?.state ?? (sent.ok ? 'unknown' : 'send_failed')).slice(0, 60);
  return { ok: sent.ok && /^sent/.test(status), stage: 'send', status, http: sent.http, id, code: codeOf(sent.json) };
}

// ── 서버 ─────────────────────────────────────────────────────────────

function serve(source) {
  ensureStateDir();
  const settings = loadSettings();
  const cache = new Map(); // ballotId → { at, inflight, good, goodAt, error }
  let sending = false;

  async function fetchBoard(ballotId) {
    let c = cache.get(ballotId);
    if (!c) {
      c = { at: 0, inflight: null, good: null, goodAt: null, error: null };
      cache.set(ballotId, c);
    }
    if (c.inflight) return c.inflight;
    if (c.good && Date.now() - c.at < 1200) return c;
    c.inflight = (async () => {
      try {
        const b = await source.board(ballotId);
        if (!b) throw new RpcError('투표지를 읽지 못했습니다');
        c.good = b;
        c.goodAt = new Date().toISOString();
        c.error = null;
      } catch (e) {
        c.error = String(e.message ?? e).slice(0, 200);
      } finally {
        c.at = Date.now();
        c.inflight = null;
      }
      return c;
    })();
    return c.inflight;
  }

  async function stateFor(params) {
    const out = { ok: true, mode: source.mode, at: new Date().toISOString(), roomReady: !!ROOM, demoRoomOnly: DEMO ? DEMO_ROOM_OK : null };
    let ballots = [];
    try {
      ballots = await source.ballots();
    } catch (e) {
      out.listError = String(e.message ?? e).slice(0, 200);
    }
    out.ballots = ballots;
    // 화면이 기억한 id 가 지금 목록에 없으면(시연 id 등) 버리고 열린 투표지로.
    const asked = params.get('ballot') || '';
    const known = !ballots.length || ballots.some((b) => b.id === asked);
    const ballotId = (asked && known ? asked : '') || ballots.find((b) => b.status === 'open')?.id || ballots[0]?.id || '';
    out.ballotId = ballotId;
    out.exclude = settings.exclude;
    out.signed = settings.signed;
    if (!ballotId) return out;
    const c = await fetchBoard(ballotId);
    out.error = c.error;
    out.stale = !!c.error;
    out.lastGoodAt = c.goodAt;
    if (c.good) {
      Object.assign(
        out,
        composeView(c.good, { label: labelFor(ballots, ballotId, params.get('label'), c.good), deadline: params.get('deadline'), exclude: settings.exclude, signed: settings.signed }),
      );
    }
    return out;
  }

  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (d) => {
        size += d.length;
        if (size > 32 * 1024) {
          reject(new Error('본문이 너무 큽니다'));
          req.destroy();
        } else chunks.push(d);
      });
      req.on('end', () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new Error('JSON 이 아닙니다'));
        }
      });
      req.on('error', reject);
    });
  }

  async function doSend(text, kind) {
    if (sending) return { ok: false, stage: 'guard', status: 'busy', code: '앞 전송이 아직 끝나지 않았습니다' };
    sending = true;
    try {
      const r = await kakaoSend(ROOM, text);
      logSend({ at: new Date().toISOString(), kind, chars: text.length, ...r });
      return r;
    } finally {
      sending = false;
    }
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, { ok: false, error: 'host' });
      const u = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (req.method === 'GET' && u.pathname === '/') return send(res, 200, PAGE_HTML, 'text/html; charset=utf-8');
      if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, await stateFor(u.searchParams));
      if (req.method === 'POST') {
        // 다른 탭의 웹 페이지가 이 주소로 보내지 못하게 — 같은 출처 + JSON 만.
        if (!allowedOrigins.has(req.headers.origin ?? '')) return send(res, 403, { ok: false, error: 'origin' });
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { ok: false, error: 'content-type' });
        const body = await readJson(req);
        if (u.pathname === '/api/exclude') {
          const lines = String(body.lines ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 400);
          settings.exclude = lines;
          saveSettings(settings);
          cache.forEach((c) => (c.at = 0));
          return send(res, 200, { ok: true, exclude: lines });
        }
        if (u.pathname === '/api/signed') {
          // 의결 서명 명단(현장 마감 명부). 비우면 명단 전원 기준으로 돌아간다.
          const lines = String(body.lines ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 600);
          settings.signed = lines;
          saveSettings(settings);
          cache.forEach((c) => (c.at = 0));
          return send(res, 200, { ok: true, signed: lines });
        }
        if (u.pathname === '/api/send') {
          const text = String(body.text ?? '').slice(0, 8000);
          return send(res, 200, await doSend(text, 'manual'));
        }
        if (u.pathname === '/api/auto-send') {
          // 자동 전송은 서버가 방금 읽은 값으로 문구를 새로 만든다(화면 문구 · 묵은 값으로 보내지 않음).
          const ballotId = String(body.ballot ?? '');
          if (!ballotId) return send(res, 200, { ok: false, stage: 'guard', status: 'skipped', code: '투표지 없음' });
          const c = cache.get(ballotId);
          if (c) c.at = 0;
          const fresh = await fetchBoard(ballotId);
          if (fresh.error || !fresh.good) return send(res, 200, { ok: false, stage: 'guard', status: 'skipped', code: `최신 값을 못 읽음 — ${fresh.error ?? ''}`.slice(0, 200) });
          if (fresh.good.status !== 'open') return send(res, 200, { ok: false, stage: 'guard', status: 'skipped', code: '투표지가 열림 상태가 아님' });
          const ballots = await source.ballots().catch(() => []);
          const view = composeView(fresh.good, { label: labelFor(ballots, ballotId, body.label, fresh.good), deadline: body.deadline, exclude: settings.exclude, signed: settings.signed });
          if (view.chase.remaining === 0) return send(res, 200, { ok: false, stage: 'guard', status: 'skipped', code: '남은 분 0' });
          return send(res, 200, { ...(await doSend(view.chase.text, 'auto')), text: view.chase.text });
        }
      }
      return send(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message ?? e).slice(0, 200) });
    }
  });
  server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(
      `진행판: http://127.0.0.1:${PORT}/  (${source.mode === 'demo' ? '시연' : '실전'} · 카톡 방 ${ROOM ? '등록됨' : '미등록 — 보내기 비활성'})\n`,
    );
  });
  return server;
}

// ── 명령 줄 한 번 ───────────────────────────────────────────────────

async function onceMode(source) {
  const ballotId = arg('--ballot');
  if (!ballotId) die('사용법: --once --ballot <id> [--label 의제1] [--deadline HH:MM] [--send --room <방>]');
  const ballots = await source.ballots().catch(() => []);
  const board = await source.board(ballotId);
  if (!board) die('투표지를 읽지 못했습니다');
  const view = composeView(board, { label: labelFor(ballots, ballotId, arg('--label'), board), deadline: arg('--deadline'), exclude: loadSettings().exclude, signed: loadSettings().signed });
  if (board.fallback) process.stderr.write('(진행 기록 함수 없음 — 제출 기준만)\n');
  process.stdout.write(`${view.chase.text}\n`);
  if (has('--send')) {
    const r = await kakaoSend(ROOM, view.chase.text);
    logSend({ at: new Date().toISOString(), kind: 'once', chars: view.chase.text.length, ...r });
    process.stderr.write(`카톡: ${r.stage} · ${r.status}${r.code ? ` · ${r.code}` : ''}\n`);
    if (!r.ok) process.exit(r.status === 'uncertain' ? 3 : 2);
  }
}

// ── 화면(한 장) ─────────────────────────────────────────────────────

const PAGE_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>투표 진행판</title>
<style>
:root{--bg:#0f1419;--panel:#1a2129;--line:#2c3742;--fg:#eef2f5;--muted:#9aa8b5;--accent:#4fb3ff;--ok:#43c47a;--warn:#f2b84b;--bad:#ff6b6b;--bar:#2b3a48}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.4 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
header h1{font-size:22px;margin:0 8px 0 0}
label{color:var(--muted);font-size:15px}select,input,textarea,button{font:inherit;color:var(--fg);background:#0b1015;border:1px solid var(--line);border-radius:6px;padding:4px 8px}
input[type=number]{width:90px}input.hm{width:84px}
button{cursor:pointer;background:#22303d}button:hover{border-color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}
button.danger{background:#5a1f24;border-color:#a33}button.armed{background:var(--bad);color:#000;font-weight:700}
.badge{font-size:14px;padding:2px 8px;border-radius:10px;background:#22303d;color:var(--muted)}.badge.bad{background:#5a1f24;color:#ffd5d5}.badge.warn{background:#5a4718;color:#ffe8b3}.badge.ok{background:#173d29;color:#c8f5d8}
main{padding:12px 16px 40px}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 16px;min-width:150px}
.kpi b{display:block;font-size:44px;line-height:1.1}.kpi span{color:var(--muted);font-size:15px}
.banner{background:#5a4718;color:#ffe8b3;padding:8px 12px;border-radius:8px;margin-bottom:10px}
.banner.bad{background:#5a1f24;color:#ffd5d5}
h2{font-size:20px;margin:18px 0 8px}
.items{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:4px 18px}
.item{display:grid;grid-template-columns:48px 1fr 92px 58px;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid var(--line)}
.item .no{font-weight:700;font-size:22px;color:var(--accent);text-align:right}
.item .bar{position:relative;height:30px;background:var(--bar);border-radius:5px;overflow:hidden}
.item .bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#2d7fc0,#4fb3ff)}
.item .bar em{position:absolute;left:8px;top:3px;font-style:normal;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;right:6px;text-shadow:0 1px 2px #000}
.item .n{text-align:right;font-variant-numeric:tabular-nums;font-size:20px}.item .p{text-align:right;font-weight:700;font-size:22px;font-variant-numeric:tabular-nums}
.item.low .p{color:var(--warn)}
.cols{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:18px}
@media (max-width:1100px){.cols{grid-template-columns:1fr}.items{grid-template-columns:1fr}}
details{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin-bottom:6px}
summary{cursor:pointer;padding:6px 10px;display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
summary .t{font-weight:700;min-width:120px}summary .c{font-variant-numeric:tabular-nums;color:var(--muted);font-size:16px}
summary .c b.s{color:var(--ok)}summary .c b.g{color:var(--warn)}summary .c b.z{color:var(--bad)}
.people{display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px 10px}.chip{padding:2px 8px;border-radius:12px;font-size:15px;background:#22303d}
.chip.submitted{background:#173d29;color:#c8f5d8}.chip.progress{background:#5a4718;color:#ffe8b3}.chip.none{background:#5a1f24;color:#ffd5d5}.chip.excluded,.chip.unsigned{background:#2a2f35;color:#7d8790;text-decoration:line-through}.checks{border:2px solid #c0392b;border-radius:10px;padding:8px 12px;margin:10px 0;background:#3a1416}.checks b{color:#ffb3b3}
textarea{width:100%;min-height:260px;font-size:15px;line-height:1.45}#exclude,#signed{min-height:110px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}.muted{color:var(--muted);font-size:15px}
</style></head><body>
<header>
  <h1>투표 진행판</h1>
  <label>투표지 <select id="ballot"></select></label>
  <label>새로고침 <select id="every"><option value="3000">3초</option><option value="5000">5초</option></select></label>
  <label>출석(서명) 인원 <input id="present" type="number" min="1" step="1"></label>
  <label>마감 시각 <input id="deadline" class="hm" placeholder="14:40"></label>
  <span id="mode" class="badge"></span>
  <span id="updated" class="badge"></span>
</header>
<main>
  <div id="banners"></div>
  <div class="kpis">
    <div class="kpi"><b id="k-sub">-</b><span>제출</span></div>
    <div class="kpi"><b id="k-rate">-</b><span>제출률(출석 기준)</span></div>
    <div class="kpi"><b id="k-prog">-</b><span>진행 중(들어왔는데 미제출)</span></div>
    <div class="kpi"><b id="k-none">-</b><span>미시작</span></div>
    <div class="kpi"><b id="k-ex">-</b><span>제외(서명 안 함·그 밖)</span></div>
  </div>
  <h2>권고안별 투표율 <span class="muted">— 그 건을 누른 인원 / 출석 인원 (찬반은 16:30 전까지 보이지 않음)</span></h2>
  <div id="items" class="items"></div>
  <div class="cols">
    <div id="checks" class="checks" style="display:none"></div>
    <section><h2>분과·조별 진행</h2><div id="groups"></div></section>
    <section>
      <h2>카톡 독려</h2>
      <div class="row"><span id="room" class="badge"></span><span id="sendStatus" class="muted"></span></div>
      <textarea id="preview" spellcheck="false"></textarea>
      <div class="row">
        <button id="regen">최신 값으로 다시 만들기</button>
        <button id="copy">복사</button>
        <button id="send" class="danger">카톡 보내기</button>
        <span id="dirty" class="muted"></span>
      </div>
      <div class="row">
        <label><input id="auto" type="checkbox"> 자동 전송</label>
        <label><select id="autoMin"><option value="2">2분</option><option value="3" selected>3분</option><option value="5">5분</option></select> 마다</label>
        <span id="autoInfo" class="muted"></span>
      </div>
      <h2>의결 서명 명단(마감 명부) <span class="muted">한 줄 한 명 — 「조|이름」 또는 이름. 넣으면 이 사람들만 독려 · 분모</span></h2>
      <textarea id="signed" spellcheck="false"></textarea>
      <div class="row"><button id="saveSg">서명 명단 저장</button><span id="sgInfo" class="muted"></span></div>
      <h2>그 밖 제외 <span class="muted">의결권 없는 사람 등 — 「조|이름」 또는 이름</span></h2>
      <textarea id="exclude" spellcheck="false"></textarea>
      <div class="row"><button id="saveEx">제외 저장</button><span id="exInfo" class="muted"></span></div>
    </section>
  </div>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const ls = { get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}} };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  let sgDirty = false;
  let last = null, timer = null, previewDirty = false, exDirty = false, autoTimer = null, autoNext = 0, armedUntil = 0;
  let ballot = new URLSearchParams(location.search).get('ballot') || ls.get('chase.ballot') || '';
  $('every').value = ls.get('chase.every') || '3000';

  function presentFor(id, roster) {
    const v = Number(ls.get('chase.present.' + id));
    return v > 0 ? v : roster;
  }
  function q() {
    const p = new URLSearchParams();
    if (ballot) p.set('ballot', ballot);
    const d = $('deadline').value.trim();
    if (d) p.set('deadline', d);
    return p.toString();
  }
  async function tick() {
    try {
      const r = await fetch('/api/state?' + q(), { cache: 'no-store' });
      const s = await r.json();
      render(s);
    } catch (e) {
      $('updated').className = 'badge bad';
      $('updated').textContent = '진행판 서버 연결 끊김 — 마지막 값 표시 중';
    }
  }
  function schedule() {
    clearInterval(timer);
    timer = setInterval(tick, Number($('every').value));
  }
  function render(s) {
    last = s;
    // 투표지 목록
    const sel = $('ballot');
    const ids = (s.ballots || []).map((b) => b.id).join(',');
    if (sel.dataset.ids !== ids) {
      sel.replaceChildren();
      for (const b of s.ballots || []) {
        const o = el('option', null, (b.agenda ? '의제' + b.agenda + ' · ' : '') + b.title + ' (' + b.status + ', ' + b.item_count + '건)');
        o.value = b.id;
        sel.append(o);
      }
      sel.dataset.ids = ids;
    }
    if (s.ballotId && sel.value !== s.ballotId) sel.value = s.ballotId;
    if (s.ballotId && ballot !== s.ballotId) { ballot = s.ballotId; ls.set('chase.ballot', ballot); }
    $('mode').textContent = s.mode === 'demo' ? '시연 모드' : '실전';
    $('mode').className = 'badge ' + (s.mode === 'demo' ? 'warn' : 'ok');
    const b = s.board;
    // 배너
    const ban = $('banners'); ban.replaceChildren();
    if (s.error) ban.append(el('div', 'banner bad', '최신 값을 못 읽음(' + s.error + ') — ' + (s.lastGoodAt ? new Date(s.lastGoodAt).toLocaleTimeString('ko-KR') + ' 값을 보여 줍니다' : '아직 받은 값 없음')));
    if (s.listError) ban.append(el('div', 'banner bad', '투표지 목록 오류: ' + s.listError));
    if (b && b.fallback) ban.append(el('div', 'banner', '진행 기록 함수(s34)가 아직 운영 DB에 없습니다 — 제출한 사람만 셉니다. 「진행 중」 건수는 0으로 보입니다.'));
    $('updated').className = 'badge ' + (s.error ? 'bad' : 'ok');
    $('updated').textContent = '갱신 ' + new Date(s.lastGoodAt || s.at).toLocaleTimeString('ko-KR');
    if (!b) return;
    // 출석 인원
    if (s.chase && s.chase.useSigned) { $('present').value = s.chase.signedCount; $('present').disabled = true; } else { $('present').disabled = false; if (document.activeElement !== $('present')) $('present').value = presentFor(b.id, b.roster_count); }
    const present = Math.max(1, Number($('present').value) || b.roster_count || 1);
    if (document.activeElement !== $('deadline') && !$('deadline').value) $('deadline').value = ls.get('chase.deadline.' + b.id) || '';
    const c = s.chase;
    $('k-sub').textContent = c.submitted;
    $('k-rate').textContent = Math.min(100, Math.round((c.submitted / present) * 100)) + '%';
    $('k-prog').textContent = c.waitingCount;
    $('k-none').textContent = c.notStartedCount;
    $('k-ex').textContent = c.excluded + (c.unsigned || 0);
    const ck = $('checks'); ck.replaceChildren();
    if (c.checks && c.checks.length) {
      ck.append(el('b', null, '③ 이름 확인 ' + c.checks.length + '명 — 한 이름이 여러 기기 · 명단 밖 이름'));
      for (const x of c.checks) ck.append(el('div', null, x.team + ' ' + x.name + ' (' + (x.devices >= 2 ? '기기 ' + x.devices + '대, ' : '') + (x.offRoster ? '명단 밖, ' : '') + (x.unsigned ? '서명 명단에 없음, ' : '') + (x.submitted ? (x.proxy ? '대리 제출' : '제출됨') : '미제출') + ')'));
      ck.style.display = '';
    } else ck.style.display = 'none';
    $('sgInfo').textContent = c.useSigned ? '서명 ' + c.signedCount + '명 기준 · 서명 안 한 명단 ' + (c.unsigned || 0) + '명 제외' + (c.signedUnmatched && c.signedUnmatched.length ? ' · 명단에 안 맞는 줄: ' + c.signedUnmatched.join(', ') : '') : '비어 있음 — 명단 전원 기준';
    // 권고안 막대
    const items = $('items'); items.replaceChildren();
    for (const it of b.items) {
      const pct = Math.min(100, Math.round((it.answered / present) * 100));
      const row = el('div', 'item' + (pct < 50 ? ' low' : ''));
      row.append(el('div', 'no', it.ordinal));
      const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = pct + '%'; bar.append(fill, el('em', null, it.statement_head)); row.append(bar);
      row.append(el('div', 'n', it.answered + '/' + present));
      row.append(el('div', 'p', pct + '%'));
      items.append(row);
    }
    // 조별
    const open = new Set([...document.querySelectorAll('#groups details[open]')].map((d) => d.dataset.team));
    const gs = $('groups'); gs.replaceChildren();
    for (const g of s.groups || []) {
      const d = el('details'); d.dataset.team = g.team; if (open.has(g.team)) d.open = true;
      const sm = el('summary'); sm.append(el('span', 't', g.team));
      const cnt = el('span', 'c');
      cnt.append(el('b', 's', '제출 ' + g.submitted), ' · ', el('b', 'g', '진행 ' + g.inProgress), ' · ', el('b', 'z', '미시작 ' + g.notStarted), ' · 제외 ' + g.excluded + ' / ' + g.total);
      sm.append(cnt); d.append(sm);
      const ppl = el('div', 'people');
      const order = { progress: 0, none: 1, submitted: 2, excluded: 3, unsigned: 4 };
      for (const p of [...g.people].sort((x, y) => order[x.status] - order[y.status])) {
        const of = (n) => (c.itemCount ? ' ' + (n ?? 0) + '/' + c.itemCount : '');
        const t = p.status === 'progress' ? p.name + (c.itemCount ? of(p.answered) : ' 진행 중') : p.status === 'submitted' ? p.name + ' 제출' : p.status === 'excluded' ? p.name : p.status === 'unsigned' ? p.name + ' 서명X' : p.name + of(0);
        ppl.append(el('span', 'chip ' + p.status, t));
      }
      d.append(ppl); gs.append(d);
    }
    if (c.offRoster && c.offRoster.length) {
      const d = el('details'); d.dataset.team = '__off'; if (open.has('__off')) d.open = true;
      d.append(el('summary', null, '명단 밖 이름으로 들어온 사람 ' + c.offRoster.length + '명'));
      const ppl = el('div', 'people');
      for (const p of c.offRoster) ppl.append(el('span', 'chip progress', p.team + ' ' + p.name + (c.itemCount ? ' ' + (p.answered ?? 0) + '/' + c.itemCount : '')));
      d.append(ppl); gs.append(d);
    }
    // 카톡
    if (!previewDirty) $('preview').value = c.text;
    $('dirty').textContent = previewDirty ? '고친 문구 — 자동 갱신 멈춤' : '';
    if (!exDirty && document.activeElement !== $('exclude')) $('exclude').value = (s.exclude || []).join('\\n');
    if (!sgDirty && document.activeElement !== $('signed')) $('signed').value = (s.signed || []).join('\\n');
    $('room').textContent = s.roomReady ? '카톡 방 등록됨' + (s.demoRoomOnly ? ' (시연: ' + s.demoRoomOnly + ' 만)' : '') : '스태프 단톡방 미등록 — 보내기 비활성';
    $('room').className = 'badge ' + (s.roomReady ? 'ok' : 'bad');
    $('send').disabled = !s.roomReady;
    $('auto').disabled = !s.roomReady;
  }
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  function showSend(r, kind) {
    const t = new Date().toLocaleTimeString('ko-KR');
    $('sendStatus').textContent = t + ' ' + kind + ': ' + (r.ok ? '보냄' : '실패') + ' · ' + r.status + (r.code ? ' · ' + r.code : '');
    if (r.status === 'uncertain') {
      $('sendStatus').textContent += ' — 나갔는지 모름. 카톡 방을 눈으로 확인하고 다시 누르지 마세요.';
      stopAuto('uncertain');
    }
  }
  $('ballot').onchange = (e) => { ballot = e.target.value; ls.set('chase.ballot', ballot); previewDirty = false; $('deadline').value = ''; tick(); };
  $('every').onchange = (e) => { ls.set('chase.every', e.target.value); schedule(); };
  $('present').onchange = () => { if (last && last.board) ls.set('chase.present.' + last.board.id, $('present').value); tick(); };
  $('deadline').onchange = () => { if (last && last.board) ls.set('chase.deadline.' + last.board.id, $('deadline').value.trim()); tick(); };
  $('preview').oninput = () => { previewDirty = true; };
  $('regen').onclick = () => { previewDirty = false; tick(); };
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('preview').value); $('sendStatus').textContent = '복사함'; }
    catch { $('preview').select(); document.execCommand('copy'); $('sendStatus').textContent = '복사함'; }
  };
  $('send').onclick = async () => {
    if (Date.now() > armedUntil) {
      armedUntil = Date.now() + 5000;
      $('send').classList.add('armed'); $('send').textContent = '한 번 더 눌러 보내기(5초)';
      setTimeout(() => { if (Date.now() >= armedUntil) { $('send').classList.remove('armed'); $('send').textContent = '카톡 보내기'; } }, 5100);
      return;
    }
    armedUntil = 0; $('send').classList.remove('armed'); $('send').textContent = '보내는 중…'; $('send').disabled = true;
    try { showSend(await post('/api/send', { text: $('preview').value }), '수동'); }
    catch { $('sendStatus').textContent = '진행판 서버 응답 없음 — 카톡 방을 눈으로 확인'; }
    finally { $('send').textContent = '카톡 보내기'; $('send').disabled = !(last && last.roomReady); }
  };
  function stopAuto(why) {
    clearInterval(autoTimer); autoTimer = null; $('auto').checked = false;
    $('autoInfo').textContent = '자동 전송 꺼짐' + (why ? '(' + why + ')' : '');
  }
  async function autoFire() {
    autoNext = Date.now() + Number($('autoMin').value) * 60000;
    try {
      const r = await post('/api/auto-send', { ballot, deadline: $('deadline').value.trim() });
      showSend(r, '자동');
      if (r.ok === false && r.stage !== 'guard') stopAuto(r.status);
    } catch { stopAuto('서버 응답 없음'); }
    if (autoTimer) $('autoInfo').textContent = '다음 자동 전송 ' + new Date(autoNext).toLocaleTimeString('ko-KR');
  }
  $('auto').onchange = (e) => {
    if (e.target.checked) {
      if (!confirm('자동 전송을 켭니다. ' + $('autoMin').value + '분마다 그때의 최신 값으로 문구를 새로 만들어 스태프 단톡방에 보냅니다. 켤까요?')) { e.target.checked = false; return; }
      autoNext = Date.now() + Number($('autoMin').value) * 60000;
      autoTimer = setInterval(autoFire, Number($('autoMin').value) * 60000);
      $('autoInfo').textContent = '다음 자동 전송 ' + new Date(autoNext).toLocaleTimeString('ko-KR');
    } else stopAuto();
  };
  $('signed').oninput = () => { sgDirty = true; $('sgInfo').textContent = '저장 안 됨'; };
  $('saveSg').onclick = async () => {
    const r = await post('/api/signed', { lines: $('signed').value });
    sgDirty = false; $('sgInfo').textContent = r.ok ? '저장함(' + r.signed.length + '줄)' : '저장 실패';
    tick();
  };
  $('exclude').oninput = () => { exDirty = true; $('exInfo').textContent = '저장 안 됨'; };
  $('saveEx').onclick = async () => {
    const r = await post('/api/exclude', { lines: $('exclude').value });
    exDirty = false; $('exInfo').textContent = r.ok ? '저장함(' + r.exclude.length + '줄)' : '저장 실패';
    tick();
  };
  tick(); schedule();
})();
</script>
</body></html>`;

// ── 진입 ─────────────────────────────────────────────────────────────

const source = DEMO ? demoSource() : liveSource(accessToken());
if (has('--serve')) serve(source);
else if (has('--once')) await onceMode(source);
else die('사용법: --serve [--demo] [--port 8766] [--token-file <파일>] [--room <방>]  |  --once --ballot <id> [--label 의제1] [--send]');
