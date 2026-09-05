#!/usr/bin/env node
/**
 * 8.29 조별 입력 전수 검증 — 1조~15조가 실제로 들어가서 세 꼭지를 쓰고,
 * 그것이 본부 취합에 모이는지를 끝에서 끝까지 확인한다.
 *
 * 단계
 *   1) 접속      mod_join × 15 — 코드가 살아 있고 올바른 조로 붙는가
 *   2) 꼭지      topic_list × 15 — 세 꼭지가 열려 있고 문안이 정본과 같은가
 *   3) 왕복      submission_save → submission_get × (15 × 3) — 쓴 것이 그대로 돌아오는가
 *   4) 취합      hq_submissions — 45건이 본부 화면 한 곳에 모이는가 (본부 토큰 있을 때만)
 *   5) 되돌리기  3단계에서 넣은 검증 데이터를 지운다
 *
 * 기본은 **읽기 전용**이다(1·2단계만). 쓰기까지 하려면 --write.
 *
 * 🔴 안전장치 — --write는 조에 이미 내용이 있으면 중단한다. submission_save는 항목을
 *    통째로 갈아끼우므로, 행사 당일 실수로 돌리면 조가 쓴 글이 사라진다. 정말 덮어야만
 *    --force를 준다. 검증 데이터는 전부 VERIFY_MARK로 시작해 눈으로도 구분된다.
 *
 * 사용
 *   node scripts/verify-0829-e2e.mjs                 # 읽기 전용
 *   node scripts/verify-0829-e2e.mjs --write         # 왕복까지 (행사 전에만)
 *   HQ_TOKEN=... node scripts/verify-0829-e2e.mjs    # 취합 단계까지
 *
 * env: PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY (wiki/.env)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 8.29 당시 배포된 legacy 코드 fixture. 9.12 이후 운영 코드 생성 규칙이 아니다. */
const TEAMS = Array.from({ length: 15 }, (_, i) => {
  const ordinal = i + 1;
  return {
    ordinal,
    code: `0829${String(ordinal).padStart(2, '0')}`,
    name: `${Math.floor(i / 5) + 1}분과 ${(i % 5) + 1}조`,
  };
});

/** 정본 꼭지 — 20260827_s6_open_0829_topics.sql과 한 글자도 달라선 안 된다. */
const EXPECTED_TOPICS = ['배경·문제 인식', '바라는 변화(기대 효과)', '의제와 관련된 질문'];

const VERIFY_MARK = '[검증]';

const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const FORCE = args.has('--force');

function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !out[m[1]]) out[m[1]] = m[2];
    }
  } catch {
    /* .env 없으면 셸 환경만 쓴다 */
  }
  return out;
}

const env = loadEnv();
const URL_BASE = env.PUBLIC_SUPABASE_URL;
const ANON = env.PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error('환경변수 누락: PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'climate_vote',
      'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message = parsed?.message ?? parsed?.hint ?? text.slice(0, 200);
    throw new Error(`${name} ${res.status}: ${message}`);
  }
  return parsed;
}

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

// ── 1) 접속 ────────────────────────────────────────────────
async function stepJoin() {
  console.log('\n[1] 접속 — mod_join × 15');
  const joined = [];
  for (const team of TEAMS) {
    try {
      const rows = await rpc('mod_join', { p_code: team.code });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        record(`${team.code} ${team.name}`, false, '코드가 조를 찾지 못함');
        continue;
      }
      const nameOk = row.name === team.name;
      const activeOk = row.status === 'active';
      record(
        `${team.code} ${team.name}`,
        nameOk && activeOk,
        nameOk && activeOk ? `${row.name} · ${row.status}` : `실제 ${row.name} · ${row.status}`
      );
      joined.push({ ...team, teamId: row.id });
    } catch (error) {
      record(`${team.code} ${team.name}`, false, error.message);
    }
  }
  return joined;
}

// ── 2) 꼭지 ────────────────────────────────────────────────
async function stepTopics() {
  console.log('\n[2] 꼭지 — topic_list × 15 (세 꼭지가 열려 있는가)');
  let reference = null;
  for (const team of TEAMS) {
    try {
      const topics = await rpc('topic_list', { p_code: team.code });
      const prompts = (topics ?? []).map((t) => t.prompt);
      const open = (topics ?? []).filter((t) => t.status === 'open').length;
      const ok =
        prompts.length === EXPECTED_TOPICS.length &&
        prompts.every((p, i) => p === EXPECTED_TOPICS[i]) &&
        open === EXPECTED_TOPICS.length;
      record(
        `${team.code} ${team.name}`,
        ok,
        prompts.length === 0 ? '주제 0건 — s6 SQL 미실행' : `${open}건 open · ${prompts.join(' / ')}`
      );
      if (!reference && topics?.length) reference = topics;
    } catch (error) {
      record(`${team.code} ${team.name}`, false, error.message);
    }
  }
  return reference;
}

// ── 3) 왕복 ────────────────────────────────────────────────
async function stepRoundTrip(topics) {
  console.log('\n[3] 왕복 — submission_save → submission_get × 45');

  // 안전장치: 이미 내용이 있으면 덮지 않는다.
  console.log('  기존 내용 확인 중…');
  const occupied = [];
  for (const team of TEAMS) {
    for (const topic of topics) {
      const got = await rpc('submission_get', { p_code: team.code, p_topic_id: topic.id });
      const items = got?.items ?? [];
      const real = items.filter((i) => !String(i.content).startsWith(VERIFY_MARK));
      if (real.length > 0) occupied.push(`${team.name}/${topic.prompt}(${real.length}건)`);
    }
  }
  if (occupied.length > 0 && !FORCE) {
    console.log(`\n  ⛔ 중단 — 이미 내용이 있는 칸 ${occupied.length}개: ${occupied.slice(0, 5).join(', ')}${occupied.length > 5 ? ' …' : ''}`);
    console.log('     submission_save는 항목을 통째로 갈아끼운다. 정말 덮으려면 --force.');
    record('쓰기 안전장치', true, `기존 내용 ${occupied.length}칸 보호 — 쓰기 건너뜀`);
    return false;
  }

  for (const team of TEAMS) {
    for (const topic of topics) {
      const items = [1, 2].map((n) => ({
        ordinal: n,
        kind: 'core',
        content: `${VERIFY_MARK} ${team.name} · ${topic.prompt} · ${n}번째 줄`,
        rationale: n === 1 ? `${VERIFY_MARK} 근거 칸 왕복 확인` : null,
      }));
      try {
        const saved = await rpc('submission_save', {
          p_code: team.code,
          p_topic_id: topic.id,
          p_items: items,
        });
        const got = await rpc('submission_get', { p_code: team.code, p_topic_id: topic.id });
        const back = (got?.items ?? []).map((i) => i.content);
        const ok =
          saved?.saved === 2 &&
          back.length === 2 &&
          back[0] === items[0].content &&
          back[1] === items[1].content &&
          (got.items[0].rationale ?? null) === items[0].rationale;
        record(`${team.name} · ${topic.prompt}`, ok, ok ? '2건 저장·회수 일치' : `저장 ${saved?.saved} · 회수 ${back.length}`);
      } catch (error) {
        record(`${team.name} · ${topic.prompt}`, false, error.message);
      }
    }
  }
  return true;
}

// ── 4) 취합 ────────────────────────────────────────────────
async function stepAggregate(topics) {
  const token = env.HQ_TOKEN;
  if (!token) {
    console.log('\n[4] 취합 — 건너뜀 (HQ_TOKEN 없음). 본부 토큰을 주면 45건이 모이는지까지 확인한다.');
    return;
  }
  console.log('\n[4] 취합 — hq_submissions (한 곳에 모이는가)');
  try {
    const rows = await rpc('hq_submissions', { p_token: token, p_session_slug: '0829-deliberation' });
    const withContent = rows.filter((r) => r.item_content);
    const teams = new Set(rows.map((r) => r.team_name));
    const topicSet = new Set(rows.map((r) => r.topic_prompt));
    record('조 15개가 모두 보이는가', teams.size === 15, `${teams.size}개 조`);
    record('꼭지 3개가 모두 보이는가', topicSet.size === topics.length, [...topicSet].join(' / '));
    record('항목이 모이는가', withContent.length > 0, `${withContent.length}건`);
  } catch (error) {
    record('hq_submissions', false, error.message);
  }
}

// ── 5) 되돌리기 ────────────────────────────────────────────
async function stepCleanup(topics) {
  console.log('\n[5] 되돌리기 — 검증 데이터 삭제');
  let wiped = 0;
  for (const team of TEAMS) {
    for (const topic of topics) {
      try {
        const got = await rpc('submission_get', { p_code: team.code, p_topic_id: topic.id });
        const items = got?.items ?? [];
        if (items.length === 0) continue;
        // 검증 데이터만 있을 때만 비운다 — 사람 글이 섞여 있으면 손대지 않는다.
        if (!items.every((i) => String(i.content).startsWith(VERIFY_MARK))) continue;
        await rpc('submission_save', { p_code: team.code, p_topic_id: topic.id, p_items: [] });
        wiped += 1;
      } catch {
        /* 잠긴 제출물 등 — 아래 합계에서 드러난다 */
      }
    }
  }
  record('검증 데이터 삭제', true, `${wiped}칸 비움`);
}

// ── 실행 ───────────────────────────────────────────────────
console.log('8.29 조별 입력 전수 검증');
console.log(`대상: ${URL_BASE} · 조 15개 · 모드 ${WRITE ? '쓰기 왕복 포함' : '읽기 전용'}`);

await stepJoin();
const topics = await stepTopics();

if (!topics) {
  console.log('\n주제가 열려 있지 않아 3~5단계를 건너뛴다.');
  console.log('→ 20260827_s6_open_0829_topics.sql 을 Supabase SQL Editor에서 실행한 뒤 다시 돌릴 것.');
} else if (!WRITE) {
  console.log('\n3~5단계(쓰기 왕복·취합·되돌리기)는 --write 를 줘야 돈다.');
} else {
  const wrote = await stepRoundTrip(topics);
  await stepAggregate(topics);
  if (wrote) await stepCleanup(topics);
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + '─'.repeat(60));
console.log(`합계 ${results.length}건 · 통과 ${results.length - failed.length} · 실패 ${failed.length}`);
if (failed.length > 0) {
  console.log('\n실패 목록:');
  for (const f of failed) console.log(`  · ${f.step} — ${f.detail}`);
}
process.exit(failed.length > 0 ? 1 : 0);
