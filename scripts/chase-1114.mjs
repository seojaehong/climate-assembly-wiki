#!/usr/bin/env node
/**
 * 11/14 의결 — 운영 PC 전용 「투표 진행판 + 카톡 독려 전송」(로컬 서버, 운영 사이트 배포 없음).
 *
 *   # 진행판(브라우저 http://127.0.0.1:8766/)
 *   node scripts/chase-1114.mjs --serve [--port 8766] [--token-file <파일>] [--room <카톡 방번호>]
 *     [--ballot-token 의제1=<투표지토큰>,의제2=…]   (ballot_list_v2 가 토큰을 못 줄 때만 — 대리 입력 화면 링크용)
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
 * 카톡 읽기는 같은 API 의 GET /v1/messages/{방}?since=today 를 10초 캐시로(최근 30건, 메모리에만 — 파일 · 로그에 남기지 않는다).
 *   --lan 보기 전용 화면 · --demo 에는 내보내지 않는다.
 * 대리 입력 화면 링크(/b?t=<투표지토큰>&proxy=1)는 이 PC 화면에만. 투표지 토큰은 서버 안에만 들고 투표지 목록 응답에는 넣지 않는다.
 *
 * 자동 마감(11/14) — 투표지가 열린 시각(진행판이 draft → open 을 처음 본 시각) + 분 + 15초에 /mod 와 같은
 *   ballot_set_status_v2(…,'closed') 로 한 번 닫고, 목록을 다시 읽어 closed 인지 본다. 판단은 scripts/lib/autoclose-1114.mjs.
 *   분: --close-min 의제1=30,의제2=45,의제3=35 (화면에서 바꾸면 .tmp-chase/autoclose-<모드>.json 에 남는다). 없으면 권고 수 × 90초.
 *   --demo · --lan 에서는 실제 닫기를 부르지 않는다(시연 닫기). --rehearsal 이면 세션 slug 가 zz-dryrun- 일 때만 닫는다.
 *   닫기 직전마다 mod_session_get(세션 확인) + ballot_list_v2(그 투표지가 지금 열림인지) 를 새로 읽는다.
 */
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardChaseState, chaseText, checkNote, namedToBoard, parseKakaoText, remainText } from './lib/chase-1114.mjs';
import { createAutoCloser, parseCloseMin, showUrls } from './lib/autoclose-1114.mjs';
import { recountSummary, reflectView } from './lib/reflect-1114.mjs';
import { FINAL_COUNTS, ResultV2Error, attachRequired, recountAgenda } from './lib/result-v2.mjs';

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
const LAN = has('--lan');
const REHEARSAL = has('--rehearsal');
// 자동 마감 모드 — fake 는 실제 닫기를 절대 부르지 않는다.
const AC_MODE = DEMO || LAN ? 'fake' : REHEARSAL ? 'test' : 'live';
const CLOSE_MIN = parseCloseMin(arg('--close-min') ?? '');
const ROOM = (arg('--room') ?? '').trim();
const PORT = Number(arg('--port') ?? 8766);
const KAKAO_BASE = (process.env.CHASE_KAKAO_BASE ?? 'http://127.0.0.1:8755').replace(/\/$/, '');
// 시연 문구는 본인방으로만 보낸다. 카톡 로컬 API 는 방 이름이 아니라 고정 번호를 받는다(본컴 「나와의 채팅」 = 2, 11/12 실측)
// — 본인방 번호는 CHASE_SELF_ROOM 으로 준다(저장소에 적지 않는다).
const DEMO_ROOM_OK = process.env.CHASE_SELF_ROOM?.trim() || 'self-inbox';
const SITE = 'https://climate-assembly.org';
const TOKEN_RE = /^[A-Za-z0-9_-]{4,200}$/;
// --ballot-token 의제1=<토큰>,의제2=<토큰> — 의제 번호 → 투표지 토큰(목록에서 토큰을 못 얻을 때만 쓴다).
const ARG_TOKENS = new Map();
for (const part of String(arg('--ballot-token') ?? '').split(',')) {
  const m = /^\s*의제\s*([1-9])\s*=\s*(\S+)\s*$/.exec(part);
  if (m && TOKEN_RE.test(m[2])) ARG_TOKENS.set(Number(m[1]), m[2]);
}

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
  const ballotTokens = new Map(); // 투표지 id → 투표지 토큰(ballot_list_v2.token). 서버 안에만 — 대리 입력 링크용
  return {
    mode: 'live',
    async ballots() {
      if (listCache.rows && Date.now() - listCache.at < 15000) return listCache.rows;
      const rows = await rpc('ballot_list_v2', { p_token: token }, 6000);
      const kept = (rows ?? []).filter((b) => b.status === 'open' || b.status === 'closed');
      for (const b of kept) if (typeof b.token === 'string' && TOKEN_RE.test(b.token)) ballotTokens.set(b.id, b.token);
      listCache = { at: Date.now(), rows: kept.map(publicBallot) };
      return listCache.rows;
    },
    tokenOf(ballotId) {
      return ballotTokens.get(ballotId) ?? null;
    },
    /** 자동 마감용 — 초안 포함 · 캐시 없음. 토큰도 여기서 채운다(/show 주소는 열기 전에 필요하다). */
    async allBallots() {
      const rows = await rpc('ballot_list_v2', { p_token: token }, 6000);
      for (const b of rows ?? []) if (typeof b.token === 'string' && TOKEN_RE.test(b.token)) ballotTokens.set(b.id, b.token);
      return (rows ?? []).map(publicBallot);
    },
    async sessionSlug() {
      const s = await rpc('mod_session_get', { p_token: token }, 6000);
      const row = Array.isArray(s) ? s[0] : s;
      return typeof row?.sessionSlug === 'string' ? row.sessionSlug : '';
    },
    /** /mod 「투표 마감」과 같은 함수 · 같은 값. 새 서버 함수 없음. */
    async closeBallot(ballotId) {
      const r = await rpc('ballot_set_status_v2', { p_token: token, p_ballot_id: ballotId, p_status: 'closed' }, 8000);
      listCache = { at: 0, rows: null };
      return r;
    },
    /** 마감 후 재집계 원자료 — 찬반 값은 서버 안에서만 쓰고 버린다. */
    async recountRaw(ballotId) {
      const named = await rpc('ballot_named_responses_v2', { p_token: token, p_ballot_id: ballotId }, 15000);
      const bt = ballotTokens.get(ballotId);
      const meta = bt ? await rpc('ballot_get', { p_token: bt }, 15000) : null;
      return attachRequired(named, meta);
    },
    invalidate() {
      listCache = { at: 0, rows: null };
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
    startedAt: t0,
    async ballots() {
      return ballots;
    },
    async allBallots() {
      return ballots;
    },
    /** 시연 닫기 — 실제 DB 를 부르지 않고 시연 투표지 상태만 바꾼다. */
    fakeClose(ballotId) {
      const b = ballots.find((x) => x.id === ballotId);
      if (b) b.status = 'closed';
    },
    tokenOf() {
      return null; // 시연 투표지는 실제 화면이 없다 — --ballot-token 을 주면 그것만 쓴다
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
      // 시연 — 맨 먼저 낸 명단 사람 한 명이 20초 뒤 진행요원 대리 입력으로 「이름(수정)」을 다시 냈다(11/13 수정 표 규칙).
      const first = voters
        .filter((v) => v.in_roster && v.submitted && !v.proxy)
        .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : a.submitted_at > b.submitted_at ? 1 : 0))[0];
      if (first && Date.now() >= Date.parse(first.submitted_at) + 20000) {
        const at = new Date(Date.parse(first.submitted_at) + 20000).toISOString();
        voters.push({ team: first.team, name: `${first.name}(수정)`, in_roster: false, started_at: at, answered_count: n, last_ordinal: n,
          updated_at: at, submitted: true, submitted_at: at, devices: 1, proxy: true });
        for (let o = 1; o <= n; o += 1) perOrdinal[o] += 1;
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
  // 원래 표 + 「이름(수정)」 표가 둘 다 제출됐으면 건별 막대가 그 사람을 두 번 센다(보드는 (조, 이름)마다 따로 센다) — 한 번 뺀다.
  // 원래 사람이 진행 중일 때 겹친 건은 이 응답으로 알 수 없다(남은 위험).
  const dupAnswered = st.corrections.filter((c) => c.hadOriginal).length;
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
        answered: Math.max(0, (Number(it.answered) || 0) - dupAnswered),
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
      checks: st.checks.map((c) => ({ ...c, note: checkNote(c) })),
      corrections: st.corrections,
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

// ── 카톡 읽기(같은 로컬 API, GET — 쓰기 없음) ──────────────────────────

async function kakaoGet(path, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${KAKAO_BASE}${path}`, { headers: { Authorization: `Bearer ${kakaoToken()}` }, signal: ctl.signal });
    let env = null;
    try {
      env = JSON.parse(await res.text());
    } catch {
      env = null;
    }
    const good = res.ok && env?.ok === true && env?.data && typeof env.data === 'object';
    return { http: res.status, ok: !!good, data: good ? env.data : null, code: good ? '' : codeOf(env?.error ?? {}) || `http_${res.status}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── 서버 ─────────────────────────────────────────────────────────────

function serve(source) {
  ensureStateDir();
  const settings = loadSettings();
  const cache = new Map(); // ballotId → { at, inflight, good, goodAt, error }
  let sending = false;

  // 카톡 읽기 — /api/state 를 막지 않는다. 마지막 값을 돌려주고, 앞 읽기가 끝난 지 10초가 지났으면 뒤에서 새로 읽는다.
  // 11/13 실측: 이 GET 은 한 번에 8~11초 걸리고, 이어 부르면 status 가 'cached'(같은 수집본) — ready · cached 만 읽은 것으로 본다.
  // 보내기가 진행 중이면 읽기를 미룬다(같은 로컬 API — 발송을 늦추지 않게).
  const kakao = { at: 0, inflight: null, view: null };
  function kakaoRefresh() {
    if (kakao.inflight || sending || Date.now() - kakao.at < 10000) return;
    kakao.inflight = (async () => {
      let view;
      try {
        if (!kakaoToken()) view = { ok: false, code: 'no_kakao_token' };
        else {
          const r = await kakaoGet(`/v1/messages/${encodeURIComponent(ROOM)}?since=today`, 20000);
          if (!r.ok) view = { ok: false, code: r.code };
          else if (r.data.status !== 'ready' && r.data.status !== 'cached') view = { ok: false, code: `status_${String(r.data.status ?? '').slice(0, 40)}` };
          else view = { ok: true, observedAt: String(r.data.observed_at_kst ?? '').slice(0, 40), messages: parseKakaoText(r.data.text).slice(-30) };
        }
      } catch (e) {
        view = { ok: false, code: e.name === 'AbortError' ? 'timeout' : 'network' };
      }
      kakao.view = view; // 오류면 옛 글은 버린다(코드만)
      kakao.at = Date.now();
      kakao.inflight = null;
    })();
  }
  function kakaoView() {
    if (DEMO) return { ok: false, room: ROOM, code: 'demo', note: '시연: 카톡 읽기 꺼짐', messages: [] };
    if (!ROOM) return { ok: false, room: '', code: 'no_room', messages: [] };
    kakaoRefresh();
    return { room: ROOM, messages: [], ...(kakao.view ?? { ok: false, code: 'loading' }) };
  }
  // ── 자동 마감 ────────────────────────────────────────────────────
  const acFile = AC_MODE === 'fake' ? null : join(STATE_DIR, `autoclose-${AC_MODE}.json`);
  const acLog = join(STATE_DIR, 'autoclose-log.jsonl');
  const ac = { error: null, at: null, slug: '', busy: false, ballots: [] };
  const closer = createAutoCloser({
    mode: AC_MODE,
    cliMinutes: CLOSE_MIN,
    // 시연 상태는 남기지 않는다(시연 id 가 늘 같아 재시작하면 묵은 기준점을 읽는다).
    load: () => {
      if (!acFile) return null;
      try {
        return JSON.parse(readFileSync(acFile, 'utf8'));
      } catch {
        return null;
      }
    },
    save: (s) => {
      if (acFile) writeFileSync(acFile, JSON.stringify(s, null, 2), 'utf8');
    },
    log: (e) => {
      try {
        appendFileSync(acLog, `${JSON.stringify({ mode: AC_MODE, ...e })}\n`, 'utf8'); // 토큰 · 주소는 넣지 않는다
      } catch {
        /* 기록 실패 무시 */
      }
    },
    openedAtOf: () => (source.mode === 'demo' ? source.startedAt : null), // 시연 투표지는 서버가 켜질 때 열린다
    fakeCloseFn: async (id) => {
      source.fakeClose?.(id); // 시연 출처만 바뀐다. 실전 출처(--lan)는 아무것도 하지 않는다
    },
    guardFn: async (id) => {
      const slug = await source.sessionSlug();
      ac.slug = slug;
      if (AC_MODE === 'test' && !slug.startsWith('zz-dryrun-')) throw new Error(`시험 모드인데 세션이 zz-dryrun- 이 아님(${slug || '알 수 없음'}) — 닫지 않음`);
      const list = await source.allBallots();
      const b = list.find((x) => x.id === id);
      if (!b) throw new Error('이 세션 투표지 목록에 없음 — 닫지 않음');
      if (b.status !== 'open') throw new Error(`지금 열림이 아님(${b.status}) — 닫지 않음`);
    },
    closeFn: (id) => source.closeBallot(id),
    statusFn: async (id) => {
      const list = await source.allBallots();
      return list.find((x) => x.id === id)?.status ?? 'unknown';
    },
  });
  async function acLoop() {
    if (ac.busy) return;
    ac.busy = true;
    try {
      const list = await source.allBallots();
      ac.ballots = list;
      closer.observe(list.map((b) => ({ id: b.id, title: b.title, status: b.status, item_count: b.item_count, agenda: b.agenda ?? agendaOf(b) })));
      ac.error = null;
      ac.at = new Date().toISOString();
    } catch (e) {
      ac.error = String(e.message ?? e).slice(0, 200); // 목록을 못 읽어도 마지막 상태로 예정 시각 판단은 계속한다
    }
    try {
      const fired = closer.tick();
      if (fired.length) {
        await Promise.allSettled(fired);
        source.invalidate?.();
        cache.forEach((c) => (c.at = 0));
      }
    } finally {
      ac.busy = false;
    }
  }
  if (source.mode !== 'demo' && AC_MODE !== 'fake') {
    source.sessionSlug().then((s) => {
      ac.slug = s;
      process.stdout.write(`자동 마감 대상 세션: ${s || '(읽지 못함)'}\n`);
      if (AC_MODE === 'test' && !s.startsWith('zz-dryrun-')) process.stdout.write('⚠ --rehearsal 인데 zz-dryrun- 세션이 아닙니다 — 닫기는 모두 거부됩니다.\n');
    }, (e) => process.stdout.write(`세션 확인 실패: ${String(e.message ?? e).slice(0, 120)}\n`));
  }
  acLoop();
  setInterval(acLoop, 2000);

  function acState(present, local) {
    const v = closer.view();
    const out = { mode: AC_MODE, lan: LAN, demo: source.mode === 'demo', graceSec: v.graceSec, slug: ac.slug, error: ac.error, at: ac.at, rows: v.rows };
    if (local) {
      out.show = showUrls(
        v.rows.map((r) => ({ agenda: r.agenda, token: source.tokenOf?.(r.id) || (r.agenda ? ARG_TOKENS.get(r.agenda) : null), minutes: r.minutes + (r.adjustSec || 0) / 60 })),
        { site: SITE, present },
      );
    }
    return out;
  }

  // ── 마감 후 재집계(결과 내보내기와 같은 규칙, 찬반은 화면에 안 보냄) ─────
  async function recount(ballotId) {
    const b = ac.ballots.find((x) => x.id === ballotId) ?? (await source.ballots()).find((x) => x.id === ballotId);
    if (source.mode === 'demo') {
      const c = cache.get(ballotId);
      if (!c?.good) return { ok: false, error: '시연 값 없음' };
      const st = boardChaseState(c.good);
      const corr = st.corrections.filter((x) => x.hadOriginal).length;
      return { ok: true, demo: true, line: `[시연] 유효 표 ${st.submitted} · 수정으로 대체 ${corr} · 이상 ${st.checks.length} (시연은 실제 재집계가 아님)` };
    }
    const raw = await source.recountRaw(ballotId);
    const agendaNo = b?.agenda ?? agendaOf(raw) ?? 0;
    const expectedCount = FINAL_COUNTS[agendaNo] ?? (raw.items ?? []).length;
    try {
      const s = recountSummary(recountAgenda(raw, { agendaNo, expectedCount }));
      return { ok: true, status: raw.status, provisional: raw.status === 'open', ...s, note: '잠정 — 출석부 파일 없이 셈(명단 밖 이름은 빠짐). 최종은 export-result-v2' };
    } catch (e) {
      if (e instanceof ResultV2Error) return { ok: false, status: raw.status, problems: e.problems ?? [String(e.message)] };
      throw e;
    }
  }

  function proxyUrlFor(ballots, ballotId) {
    const b = ballots.find((x) => x.id === ballotId);
    const t = source.tokenOf?.(ballotId) || (b?.agenda ? ARG_TOKENS.get(b.agenda) : null) || null;
    return t ? `${SITE}/b?t=${encodeURIComponent(t)}&proxy=1` : null;
  }

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

  // LAN 보기 전용 — 다른 노트북이 따라 보도록 이 PC(운영자)가 마지막으로 고른 투표지 · 마감 시각을 기억한다.
  const lastLocal = { ballot: '', deadline: '' };
  async function stateFor(params, viewOnly = false) {
    if (viewOnly) {
      params = new URLSearchParams(params);
      if (lastLocal.ballot) params.set('ballot', lastLocal.ballot);
      if (lastLocal.deadline) params.set('deadline', lastLocal.deadline);
    } else {
      // 운영 PC 가 마감 칸을 비우면(q() 가 deadline 을 빼면) 송출 쪽도 비운다. 투표지는 아래에서 확정된 id 로만 기록.
      lastLocal.deadline = params.get('deadline') || '';
    }
    const out = { ok: true, mode: source.mode, at: new Date().toISOString(), roomReady: !!ROOM, demoRoomOnly: DEMO && !viewOnly ? DEMO_ROOM_OK : null, viewOnly, deadline: params.get('deadline') || '' };
    let ballots = [];
    try {
      ballots = await source.ballots();
    } catch (e) {
      out.listError = String(e.message ?? e).slice(0, 200);
    }
    out.ballots = ballots;
    out.autoclose = acState(params.get('present'), !viewOnly);
    // 화면이 기억한 id 가 지금 목록에 없으면(시연 id 등) 버리고 열린 투표지로.
    const asked = params.get('ballot') || '';
    const known = !ballots.length || ballots.some((b) => b.id === asked);
    const ballotId = (asked && known ? asked : '') || ballots.find((b) => b.status === 'open')?.id || ballots[0]?.id || '';
    out.ballotId = ballotId;
    if (!viewOnly && ballotId) lastLocal.ballot = ballotId;
    out.exclude = viewOnly ? [] : settings.exclude;
    out.signed = viewOnly ? [] : settings.signed;
    if (!viewOnly) {
      // 이 PC 화면에만 — 송출(보기 전용) 응답에는 칸 자체가 없다.
      out.kakao = kakaoView();
      out.proxyUrl = ballotId ? proxyUrlFor(ballots, ballotId) : null;
    }
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
      if (!viewOnly) out.reflect = reflectView(c.good, boardChaseState(c.good, settings.exclude, settings.signed));
      // 송출 노트북에는 화면에 그리는 것만 — 카톡 문안 · 서명 명단 원문은 보내지 않는다.
      if (viewOnly && out.chase) out.chase = { ...out.chase, text: '', signedUnmatched: [] };
    }
    return out;
  }

  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
  // --lan: 같은 망(테더링·현장 와이파이)의 다른 노트북이 보기 전용으로 연다. 열쇠(k)가 주소에 있어야 하고 GET 만 받는다.
  // 카톡 보내기 · 서명 명단 · 제외 저장은 이 PC(127.0.0.1)에서만.
  const VIEW_KEY = (arg('--view-key') ?? randomBytes(6).toString('hex')).trim();
  if (LAN && !/^[\w-]{8,}$/.test(VIEW_KEY)) die('--view-key 는 8자 이상(영문 · 숫자 · - · _)이어야 합니다.');
  // 주소 목록은 안내 출력용. 다른 노트북의 요청은 Host 가 아니라 열쇠(k)로 가른다 — 테더링이 나중에 붙거나 IP 가 바뀌어도 그대로 열린다.
  const lanIps = () =>
    Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
  const isLocalReq = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

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
      const local = isLocalReq(req);
      // 이 PC 에서 온 요청만 Host 를 본다(DNS 리바인딩 차단). 다른 노트북은 아래에서 열쇠로만 통과.
      if (local && !allowedHosts.has(req.headers.host ?? '')) return send(res, 403, { ok: false, error: 'host' });
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (!local) {
        // 다른 노트북 — 보기 전용(GET · 열쇠 일치)만.
        if (!LAN || req.method !== 'GET' || u.searchParams.get('k') !== VIEW_KEY) return send(res, 403, { ok: false, error: 'view only' });
        if (u.pathname === '/') return send(res, 200, PAGE_HTML, 'text/html; charset=utf-8');
        if (u.pathname === '/api/state') return send(res, 200, await stateFor(u.searchParams, true));
        return send(res, 404, { ok: false, error: 'not found' });
      }
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
        if (u.pathname === '/api/autoclose') {
          const id = String(body.ballot ?? '');
          const action = String(body.action ?? '');
          if (!['minutes', 'plus', 'minus', 'enable', 'openedAt', 'close'].includes(action)) return send(res, 400, { ok: false, error: '모르는 조작' });
          const r = await closer.control(action, id, body.value);
          if (action === 'close') {
            source.invalidate?.();
            cache.forEach((c) => (c.at = 0));
          }
          return send(res, 200, r);
        }
        if (u.pathname === '/api/recount') {
          const id = String(body.ballot ?? '');
          if (!id) return send(res, 200, { ok: false, error: '투표지 없음' });
          try {
            return send(res, 200, await recount(id));
          } catch (e) {
            return send(res, 200, { ok: false, error: String(e.message ?? e).slice(0, 200) });
          }
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
  server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
    process.stdout.write(
      `진행판: http://127.0.0.1:${PORT}/  (${source.mode === 'demo' ? '시연' : '실전'} · 카톡 방 ${ROOM ? '등록됨' : '미등록 — 보내기 비활성'})\n`,
    );
    const acText = { fake: '시연 닫기만(실제 닫기 안 함)', test: '리허설 시험 — zz-dryrun- 세션만 실제로 닫음', live: '실전 — 예정 시각에 실제로 닫음' }[AC_MODE];
    process.stdout.write(`자동 마감: ${acText} · 분 ${CLOSE_MIN.size ? [...CLOSE_MIN].map(([k, v]) => `의제${k}=${v}`).join(',') : '기본(권고 수 × 90초)'} + 15초\n`);
    if (LAN && source.mode !== 'demo') process.stdout.write('⚠ --lan 으로 켰습니다 — 자동 마감은 실제로 닫지 않습니다. 자동 마감이 필요하면 --lan 없이 켜세요.\n');
    if (LAN) {
      const ips = lanIps();
      if (!ips.length) process.stdout.write('⚠ 지금 잡힌 망 주소가 없습니다 — 테더링·와이파이에 붙은 뒤 `ipconfig` 의 IPv4 주소로 http://<주소>:' + PORT + '/?k=' + VIEW_KEY + ' 를 여세요.\n');
      for (const ip of ips) process.stdout.write(`송출 노트북(보기 전용): http://${ip}:${PORT}/?k=${VIEW_KEY}\n`);
    }
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
.chip.submitted{background:#173d29;color:#c8f5d8}.chip.progress{background:#5a4718;color:#ffe8b3}.chip.none{background:#5a1f24;color:#ffd5d5}.chip.excluded,.chip.unsigned{background:#2a2f35;color:#7d8790;text-decoration:line-through}.checks{align-self:start;border:2px solid #c0392b;border-radius:10px;padding:8px 12px;margin:10px 0;background:#3a1416}.checks b{color:#ffb3b3}
textarea{width:100%;min-height:260px;font-size:15px;line-height:1.45}#exclude,#signed{min-height:110px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}.muted{color:var(--muted);font-size:15px}
a.btn{color:var(--fg);background:#22303d;border:1px solid var(--line);border-radius:6px;padding:4px 10px;text-decoration:none}a.btn:hover{border-color:var(--accent)}
.corr{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:10px 0;background:var(--panel)}.corr .need{color:var(--warn)}
.kk{max-height:240px;overflow:auto;background:#0b1015;border:1px solid var(--line);border-radius:6px 6px 0 0;padding:6px 10px;font-size:15px}
.kk div{padding:2px 0;border-bottom:1px solid var(--line);white-space:pre-wrap;word-break:break-all}.kk time,.kk span{color:var(--muted);margin-right:6px}
.kk + #preview{border-top:0;border-radius:0 0 6px 6px}
.ac{background:var(--panel);border:2px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:12px}
.ac h2{margin:2px 0 6px}.acrow{display:grid;grid-template-columns:150px minmax(260px,1.3fr) minmax(240px,1fr) minmax(330px,1.2fr);gap:8px 16px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.acrow .ag{font-size:24px;font-weight:700}.acrow .due{font-size:40px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}.acrow .left{font-size:40px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--accent);line-height:1.1}
.acrow .left.soon{color:var(--warn)}.acrow .left.over{color:var(--bad)}.acrow .sub{color:var(--muted);font-size:15px}.acrow .res{grid-column:1/-1;padding:6px 10px;border-radius:6px}
.acrow .res.bad{background:#5a1f24;color:#ffd5d5;font-weight:700}.acrow .res.ok{background:#173d29;color:#c8f5d8}.acrow .res.warn{background:#5a4718;color:#ffe8b3}
.acrow input.min{width:80px}.acrow input.oa{width:96px}
.showurl{display:flex;gap:6px;align-items:center;margin:4px 0}.showurl input{flex:1;font-size:13px;min-width:0}
@media (max-width:1100px){.acrow{grid-template-columns:1fr}}
.ac.vo .acctl,.ac.vo #acShow{display:none}
.refl table{border-collapse:collapse;width:100%;font-size:15px}.refl td,.refl th{border-bottom:1px solid var(--line);padding:2px 6px;text-align:left}.refl .bad{color:#ffb3b3}
</style></head><body>
<header>
  <h1>투표 진행판</h1>
  <label>투표지 <select id="ballot"></select></label>
  <label>새로고침 <select id="every"><option value="3000">3초</option><option value="5000">5초</option></select></label>
  <label>출석(서명) 인원 <input id="present" type="number" min="1" step="1"></label>
  <label>마감 시각 <input id="deadline" class="hm" placeholder="14:40"></label>
  <span id="proxyBox" style="display:none"><a id="proxy" class="btn" target="_blank" rel="noopener noreferrer">대리 입력 화면 열기</a> <span class="muted">대리 입력 안내: 고칠 때는 같은 조·이름(수정)</span></span>
  <span id="mode" class="badge"></span>
  <span id="updated" class="badge"></span>
</header>
<main>
  <div id="banners"></div>
  <section id="ac" class="ac"><h2>자동 마감 <span id="acMode" class="badge"></span> <span id="acInfo" class="muted"></span></h2><div id="acRows"></div>
    <details id="acShow"><summary>/show 주소(진행판과 같은 분 · 출석 인원) — 송출 노트북에 붙여 넣기</summary><div id="acUrls" style="padding:6px 10px"></div></details>
  </section>
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
    <section><div id="refl" class="corr refl"><b>반영 확인</b> <span class="muted">— 대리 입력(수기 투표지) · 수정 표가 들어갔는지</span><div id="reflBody"></div>
      <div class="row"><button id="recount">마감 후 재집계</button><span id="recountOut" class="muted"></span></div></div>
      <div id="corr" class="corr" style="display:none"></div><h2>분과·조별 진행</h2><div id="groups"></div></section>
    <section id="ops">
      <h2 id="kkTitle">카톡</h2>
      <div class="row"><span id="room" class="badge"></span><span id="sendStatus" class="muted"></span></div>
      <div id="kk" class="kk"></div>
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
  // 보기 전용 주소(?k=)면 첫 응답 전부터 운영 칸을 숨긴다(응답이 실패해도 보이지 않게).
  if (new URLSearchParams(location.search).get('k')) $('ops').style.display = 'none';
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
    const k = new URLSearchParams(location.search).get('k');
    if (k) p.set('k', k);
    const pr = Number($('present').value);
    if (pr > 0) p.set('present', String(Math.floor(pr)));
    return p.toString();
  }
  // ── 자동 마감 ──
  let acLast = null, acOffset = 0;
  const acEls = new Map();
  const hms = (ms) => (ms == null ? '-' : new Date(ms).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }));
  const dur = (ms) => {
    let t = Math.floor(Math.abs(ms) / 1000);
    const h = Math.floor(t / 3600); t -= h * 3600;
    const m = Math.floor(t / 60); const sec = t - m * 60;
    return (ms < 0 ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  };
  async function acPost(action, id, value) {
    try {
      const r = await post('/api/autoclose', { action, ballot: id, value });
      if (r && r.ok === false && r.error && action !== 'close') alert(r.error);
    } catch { alert('진행판 서버 응답 없음'); }
    tick();
  }
  function acRow(r) {
    let e = acEls.get(r.id);
    if (e) return e;
    e = {};
    const row = el('div', 'acrow');
    e.ag = el('div', 'ag'); e.st = el('div', 'sub');
    const c1 = el('div'); c1.append(e.ag, e.st);
    e.due = el('div', 'due'); e.dueSub = el('div', 'sub');
    const c2 = el('div'); c2.append(el('div', 'sub', '자동 마감 시각'), e.due, e.dueSub);
    e.left = el('div', 'left');
    const c3 = el('div'); c3.append(el('div', 'sub', '남은 시간'), e.left);
    const c4 = el('div', 'acctl');
    const r1 = el('div', 'row');
    e.min = el('input', 'min'); e.min.type = 'number'; e.min.step = '0.5'; e.min.min = '0.5';
    e.min.onchange = () => acPost('minutes', r.id, e.min.value.trim());
    const bm = el('button', null, '-1분'); bm.onclick = () => acPost('minus', r.id);
    const bp = el('button', null, '+1분'); bp.onclick = () => acPost('plus', r.id);
    e.en = el('button'); e.en.onclick = () => acPost('enable', r.id, !e.enabled);
    r1.append(el('label', null, '분'), e.min, bm, bp, e.en);
    const r2 = el('div', 'row');
    e.oa = el('input', 'oa'); e.oa.placeholder = '14:10:05';
    const boa = el('button', null, '연 시각 넣기');
    boa.onclick = () => { if (e.oa.value.trim()) acPost('openedAt', r.id, e.oa.value.trim()); };
    e.close = el('button', 'danger', '지금 닫기');
    let armed = 0;
    e.close.onclick = async () => {
      if (Date.now() > armed) {
        armed = Date.now() + 5000; e.close.classList.add('armed'); e.close.textContent = '한 번 더 눌러 닫기(5초)';
        setTimeout(() => { if (Date.now() >= armed) { e.close.classList.remove('armed'); e.close.textContent = '지금 닫기'; } }, 5100);
        return;
      }
      armed = 0; e.close.classList.remove('armed'); e.close.textContent = '닫는 중…'; e.close.disabled = true;
      try { await acPost('close', r.id); } finally { e.close.textContent = '지금 닫기'; e.close.disabled = false; }
    };
    r2.append(e.oa, boa, e.close);
    c4.append(r1, r2);
    e.res = el('div', 'res');
    row.append(c1, c2, c3, c4, e.res);
    e.row = row;
    acEls.set(r.id, e);
    return e;
  }
  function renderAc(a, s) {
    if (!a) { $('ac').style.display = 'none'; return; }
    $('ac').style.display = '';
    acLast = a; acOffset = Date.parse(s.at) - Date.now();
    if (s.viewOnly) $('ac').classList.add('vo');
    $('acMode').textContent = a.mode === 'fake' ? (a.lan && !a.demo ? '--lan 실행: 실제로 닫지 않음 — /mod 에서 닫으세요' : '시연 — 실제로 닫지 않음') : a.mode === 'test' ? '리허설 시험(zz-dryrun- 세션만 닫음)' : '실전 — 예정 시각에 실제로 닫음';
    $('acMode').className = 'badge ' + (a.mode === 'live' ? 'ok' : a.mode === 'test' ? 'warn' : 'bad');
    $('acInfo').textContent = '마감 = 투표지가 열린 시각(진행판이 처음 본 시각) + 분 + ' + a.graceSec + '초' + (a.slug ? ' · 세션 ' + a.slug : '') + (a.error ? ' · 목록 오류: ' + a.error : '');
    const box = $('acRows');
    const ids = a.rows.map((r) => r.id).join(',');
    if (box.dataset.ids !== ids) { box.replaceChildren(); acEls.clear(); box.dataset.ids = ids; }
    for (const r of a.rows) {
      const e = acRow(r);
      if (!e.row.isConnected) box.append(e.row);
      e.enabled = r.enabled;
      e.ag.textContent = r.agenda ? '의제' + r.agenda : String(r.title || '').slice(0, 12);
      e.st.textContent = r.status + ' · ' + r.itemCount + '건 · ' + r.minutes + '분(' + r.minutesSource + ')' + (r.adjustSec ? ' · 조정 ' + (r.adjustSec > 0 ? '+' : '') + Math.round(r.adjustSec / 60) + '분' : '');
      if (document.activeElement !== e.min) e.min.value = r.minutes;
      e.en.textContent = r.enabled ? '자동 마감 끄기' : '자동 마감 켜기';
      e.en.className = r.enabled ? '' : 'danger';
      const basis = r.basis === 'observed' ? '진행판이 본 시각(오차 최대 ' + Math.max(1, Math.round((r.uncertaintyMs || 0) / 1000)) + '초)' : r.basis === 'manual' ? '사람이 넣은 시각' : r.basis === 'source' ? '시연 시작 시각' : r.basis === 'unknown' ? '열린 시각 모름' : '';
      e.due.textContent = r.dueAt ? hms(r.dueAt) : r.status === 'draft' ? '열리면 시작' : '-';
      e.dueSub.textContent = r.openedAt ? '열림 ' + hms(r.openedAt) + ' · ' + basis + ' · 화면 타이머 0 = ' + hms(r.timerEndAt) : basis;
      let cls = '', txt = '';
      if (r.result && r.result.ok) { cls = 'ok'; txt = (r.result.fake ? '시연: 닫은 것으로 표시(실제 DB 는 안 바뀜) ' : '닫힘 확인(' + r.result.status + ') ') + hms(r.result.at) + ' · ' + (r.result.kind === 'manual' ? '「지금 닫기」' : '자동') + (r.result.kind === 'auto' && r.result.lateMs != null ? ' · 예정보다 ' + (r.result.lateMs / 1000).toFixed(1) + '초 뒤 시도' : ''); }
      else if (r.result && !r.result.ok) { cls = 'bad'; txt = '닫기 실패 — ' + (r.result.error || r.result.status) + ' → 「지금 닫기」 또는 /mod 에서 바로 닫으세요'; }
      else if (r.closedBy === 'other') { cls = 'ok'; txt = '다른 곳(/mod)에서 닫힘 — 자동 마감은 부르지 않음'; }
      else if (r.missed) { cls = 'bad'; txt = '예정 시각이 지났는데 자동으로 닫지 않았습니다(진행판이 늦게 켜짐 · 잠자기 · 조정으로 이미 지남) → 「지금 닫기」 또는 /mod'; }
      else if (r.status === 'open' && r.basis === 'unknown') { cls = 'warn'; txt = '열린 시각을 모릅니다(진행판이 켜지기 전에 열림 등) — 자동 마감이 걸리지 않았습니다. 연 시각(KST 시:분:초)을 넣으세요'; }
      else if (r.status === 'open' && !r.enabled) { cls = 'warn'; txt = '자동 마감 꺼짐 — 사람이 닫습니다'; }
      e.res.className = 'res ' + cls; e.res.textContent = txt; e.res.style.display = txt ? '' : 'none';
      e.close.style.display = r.status === 'open' ? '' : 'none';
    }
    acCountdown();
    const u = $('acUrls');
    const sig = JSON.stringify(a.show || null);
    if (u.dataset.sig !== sig) {
      u.dataset.sig = sig; u.replaceChildren();
      const add = (label, url) => {
        const d = el('div', 'showurl'); const i = el('input'); i.readOnly = true; i.value = url;
        const bt = el('button', null, '복사');
        bt.onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { i.select(); document.execCommand('copy'); } bt.textContent = '복사함'; setTimeout(() => { bt.textContent = '복사'; }, 1500); };
        d.append(el('span', 'muted', label), i, bt); u.append(d);
      };
      if (!a.show || !a.show.one.length) u.append(el('div', 'muted', '투표지 토큰을 아직 모릅니다(시연이거나 목록을 못 읽음)'));
      else { for (const x of a.show.one) add('의제' + x.agenda, x.url); if (a.show.all) add('종합', a.show.all); if (a.show.allAuto) add('종합 자동', a.show.allAuto); }
      u.append(el('div', 'muted', '분 · 출석 인원을 바꾸면 주소도 바뀝니다. /show 는 Space 를 누른 때부터 셉니다 — 투표지 열기와 같은 순간에 누르세요.'));
    }
  }
  function acCountdown() {
    if (!acLast) return;
    const now = Date.now() + acOffset;
    for (const r of acLast.rows) {
      const e = acEls.get(r.id);
      if (!e) continue;
      if (r.status !== 'open' || !r.dueAt || r.attempted || r.closedBy || !r.enabled) {
        e.left.textContent = r.status === 'draft' ? '시작 전' : r.status === 'open' ? (r.enabled ? '-' : '꺼짐') : '마감';
        e.left.className = 'left';
        continue;
      }
      const left = r.dueAt - now;
      e.left.textContent = dur(left);
      e.left.className = 'left' + (left < 0 ? ' over' : left < 60000 ? ' soon' : '');
    }
  }
  setInterval(acCountdown, 500);
  // ── 반영 확인 ──
  function renderReflect(rf) {
    const box = $('reflBody');
    const wasOpen = !!(box.querySelector('details') && box.querySelector('details').open);
    box.replaceChildren();
    if (!rf) { box.append(el('div', 'muted', '값 없음')); return; }
    const p1 = el('div');
    p1.append(el('div', null, rf.proxyKnown ? '대리 입력 제출 ' + rf.proxyTotal + '건' + (rf.proxyTeams.length ? ' — ' + rf.proxyTeams.map((t) => t.team + ' ' + t.n).join(' · ') : '') : '대리 입력 여부: 알 수 없음(진행 기록 함수 없음 — 0건이 아님)'));
    if (rf.proxy.length) {
      const d = el('details'); d.open = wasOpen; d.append(el('summary', null, '대리 입력 목록 ' + rf.proxy.length + '건(조 순)'));
      const t = el('table');
      for (const x of rf.proxy) { const tr = el('tr'); tr.append(el('td', null, x.team), el('td', null, x.name), el('td', null, x.submitted_at ? hms(Date.parse(x.submitted_at)) : '')); t.append(tr); }
      d.append(t); p1.append(d);
    }
    box.append(p1);
    const p2 = el('div');
    p2.append(el('div', null, '「이름(수정)」 ' + rf.corrections.length + '건 · 원래 표 대체 ' + rf.replacedCount + '건'));
    if (rf.corrections.length) {
      const t = el('table');
      for (const x of rf.corrections) { const tr = el('tr'); tr.append(el('td', null, x.team), el('td', null, x.name), el('td', x.hadOriginal ? null : 'bad', x.state + (x.count >= 2 ? ' · 수정 ' + x.count + '건' : ''))); t.append(tr); }
      p2.append(t);
    }
    box.append(p2);
    const p3 = el('div');
    p3.append(el('div', rf.anomalies.length ? 'bad' : null, '이상 ' + rf.anomalies.length + '건 · 미응답 ' + rf.unanswered.total + '명(진행 중 ' + rf.unanswered.progress + ' · 미시작 ' + rf.unanswered.notStarted + ')'));
    for (const x of rf.anomalies) p3.append(el('div', 'bad', '· ' + x.kind + ': ' + x.team + ' ' + x.name));
    box.append(p3);
  }
  $('recount').onclick = async () => {
    $('recountOut').textContent = '재집계 중…'; $('recountOut').className = 'muted';
    try {
      const r = await post('/api/recount', { ballot });
      $('recountOut').textContent = r.ok ? (r.provisional ? '[아직 열림 — 잠정] ' : '') + r.line + (r.note ? ' — ' + r.note : '') : '재집계 못 함: ' + (r.error || (r.problems || []).join(' / '));
      $('recountOut').className = r.ok && !r.oddTotal ? 'muted' : 'bad';
    } catch { $('recountOut').textContent = '진행판 서버 응답 없음'; }
  };
  async function tick() {
    try {
      const r = await fetch('/api/state?' + q(), { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
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
    $('mode').textContent = (s.mode === 'demo' ? '시연 모드' : '실전') + (s.viewOnly ? ' · 보기 전용(송출)' : '');
    $('mode').className = 'badge ' + (s.mode === 'demo' ? 'warn' : 'ok');
    if (s.viewOnly) {
      // 송출 노트북 — 투표지·마감은 운영 PC를 따른다. 카톡·명단 조작은 운영 PC에서만.
      $('ops').style.display = 'none';
      sel.disabled = true; $('deadline').disabled = true;
      $('deadline').value = s.deadline || '';
    }
    const b = s.board;
    // 배너
    const ban = $('banners'); ban.replaceChildren();
    if (s.error) ban.append(el('div', 'banner bad', '최신 값을 못 읽음(' + s.error + ') — ' + (s.lastGoodAt ? new Date(s.lastGoodAt).toLocaleTimeString('ko-KR') + ' 값을 보여 줍니다' : '아직 받은 값 없음')));
    if (s.listError) ban.append(el('div', 'banner bad', '투표지 목록 오류: ' + s.listError));
    if (b && b.fallback) ban.append(el('div', 'banner', '진행 기록 함수(s34)가 아직 운영 DB에 없습니다 — 제출한 사람만 셉니다. 「진행 중」 건수는 0으로 보입니다.'));
    $('updated').className = 'badge ' + (s.error ? 'bad' : 'ok');
    $('updated').textContent = '갱신 ' + new Date(s.lastGoodAt || s.at).toLocaleTimeString('ko-KR');
    // 대리 입력 화면 바로가기(이 PC 만 — 송출 응답에는 proxyUrl 이 없다)
    if (s.proxyUrl && !s.viewOnly) { $('proxy').href = s.proxyUrl; $('proxyBox').style.display = ''; } else { $('proxy').removeAttribute('href'); $('proxyBox').style.display = 'none'; }
    if (!s.viewOnly && s.kakao) renderKakao(s.kakao);
    renderAc(s.autoclose, s);
    if (s.viewOnly) $('refl').style.display = 'none';
    if (!b) return;
    if (!s.viewOnly) renderReflect(s.reflect);
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
      for (const x of c.checks) ck.append(el('div', null, x.team + ' ' + x.name + ' (' + (x.note || ((x.devices >= 2 ? '기기 ' + x.devices + '대, ' : '') + (x.offRoster ? '명단 밖, ' : '') + (x.unsigned ? '서명 명단에 없음, ' : '') + (x.submitted ? (x.proxy ? '대리 제출' : '제출됨') : '미제출'))) + ')'));
      ck.style.display = '';
    } else ck.style.display = 'none';
    // 수정 표(「이름(수정)」 대리 입력) — 원래 사람에 붙여 한 번만 센다. 확인 필요는 노란 글씨.
    const co = $('corr'); co.replaceChildren();
    const cs = c.corrections || [];
    if (cs.length) {
      const need = cs.filter((x) => x.needsCheck).length;
      co.append(el('b', null, '수정 표 ' + cs.length + '건' + (need ? ' · 확인 필요 ' + need : '') + ' — 원래 사람 제출로 한 번만 셈'));
      for (const x of cs) co.append(el('div', x.needsCheck ? 'need' : null, x.team + ' ' + x.name + ' · ' + (x.submitted_at ? new Date(x.submitted_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '') + ' · ' + (x.hadOriginal ? '원래 표 있음' : '원래 표 없음') + (x.needsCheck ? ' · 확인 필요(' + x.note + ')' : '')));
      co.style.display = '';
    } else co.style.display = 'none';
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
  let kkSig = '';
  function renderKakao(k) {
    $('kkTitle').textContent = '카톡' + (k.room ? ' (방 ' + k.room + ')' : '') + ' — 읽기 · 보내기';
    const box = $('kk');
    const sig = JSON.stringify([k.ok, k.code, (k.messages || []).map((m) => m.at + m.text)]);
    if (sig === kkSig) return;
    kkSig = sig;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.replaceChildren();
    if (!k.ok) box.append(el('div', 'muted', k.note || ('카톡 읽기 안 됨: ' + (k.code || '알 수 없음'))));
    else if (!(k.messages || []).length) box.append(el('div', 'muted', '오늘 글 없음'));
    else for (const m of k.messages) { const d = el('div'); d.append(el('time', null, m.hm), el('span', null, m.sender), document.createTextNode(m.text)); box.append(d); }
    if (atBottom || box.dataset.first !== '1') { box.scrollTop = box.scrollHeight; box.dataset.first = '1'; }
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
