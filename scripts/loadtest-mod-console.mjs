#!/usr/bin/env node
// test(mod-console): public_round_cast_v2를 통한 300명 동시 부하 검증.
//
// 배경/제약 (2026-07-24 라이브 실행 전 조사에서 확인, 브리프 원안과 다름 — 근거는 아래):
//   - climate_vote.rounds는 anon INSERT 정책이 없다(admin_write ALL만 존재, admin_users 체크).
//     task-1-report.md 정책 표에서 anon에 열려있는 건 rounds_anon_select(SELECT)뿐.
//     → 라운드 생성은 anon 키로 직접 INSERT 불가. mod_create_round RPC(anon EXECUTE 부여됨,
//       SECURITY DEFINER)를 쓰거나 서비스 롤 권한이 필요하다.
//   - cv_archive_round의 EXECUTE 권한은 authenticated/service_role에만 부여되어 있고 anon에는
//     없다(20260621140534_snapshot_include_agenda.sql 상단 주석). → 정리(cleanup) 단계도
//     anon 키만으로는 불가능하다. 서비스 롤 키(SUPABASE_SERVICE_ROLE_KEY)가 필요하다.
//   - 이 저장소 환경(wiki/.env)에는 서비스 롤 키가 없다(task-7-report.md에서도 동일하게
//     "라이브 실행 불가, 서비스 롤 키 필요"로 보고됨). 따라서:
//       · setup/cleanup 단계는 SUPABASE_SERVICE_ROLE_KEY가 있으면 그 키로 수행하고,
//         없으면 스크립트가 필요한 조작을 정확히 stdout에 안내하고 종료한다.
//       · 실제 2026-07-24 라이브 실행에서는 setup(15개 테스트 라운드 생성)과 cleanup
//         (cv_archive_round + status=closed)을 Supabase MCP(execute_sql, postgres 권한)로
//         직접 수행했다 — 서비스 롤 SQL 접근과 동등한 권한이며, anon 키로는 애초에
//         불가능한 두 관리 작업이기 때문. **투표(vote) 단계만은 반드시 REST anon 키
//         경로로 측정**한다 — 이게 이 부하테스트의 실측 대상이다.
//
// 사용법:
//   node scripts/loadtest-mod-console.mjs vote [--rounds-file <path>] [--per-round N] [--run-id <id>]
//   WORKSHOP_ACCESS_TOKEN=<token> node scripts/loadtest-mod-console.mjs setup --count 15 [--title-prefix LOADTEST]
//   node scripts/loadtest-mod-console.mjs cleanup [--rounds-file <path>]
//
// ── 2026-07-24 라이브 실행 결과 (기록) ──────────────────────────────────────────
// 대상: project pleyuknjnprsckssxvrh, schema climate_vote, PostgREST anon 키.
// 라운드: 팀 "테스트조"(join_code 123456, 평소 status=disabled — Task1 잔여 테스트 팀,
//   실제 8/29 15팀과 무관) 아래 team_id로 스코프한 15개 신규 라운드
//   (id: lt-1774972800-1 .. lt-1774972800-15), Supabase MCP execute_sql로 생성.
// 투표: 300명(라운드당 20명) × Content-Profile: climate_vote POST /votes,
//   client_id = "lt-<runId>-<n>"(런당 고유, >=8자), choice는 A/B 랜덤, 5초 창 내 동시 발사
//   (node:https keepAlive Agent, maxSockets=320, jitter 0~4000ms).
// 결과: ok=300 fail=0 (에러율 0%)  |  p50=89.1ms  p95=513.3ms  max=895.2ms
//   발사 창(전체 완료까지): 4059ms(목표 5초 창 이내). 실행 커맨드:
//   node scripts/loadtest-mod-console.mjs vote --rounds-file scripts/loadtest-rounds.json --per-round 20 --run-id 20260724a
//   → 기준(에러율 0%, p95<2000ms) 충족. 상세 원문은 .superpowers/sdd/task-8-report.md.
// 정리: cv_archive_round(각 라운드, reason='loadtest cleanup', by='loadtest') 15회 호출 +
//   status='closed' 갱신, 모두 MCP execute_sql로 수행. 검증 쿼리 결과:
//   select count(*) from climate_vote.votes where round_id like 'lt-1774972800-%' and archived_at is null;
//   → live_remaining = 0 (라이브 잔존 투표 없음, soft-delete로만 보존 — 물리 삭제 없음).
//   select count(*) ... and archived_at is not null;  → total_archived = 301
//   (300 부하테스트 표 + 사전 스모크테스트 1표, 모두 archived). 전 라운드 status=closed 확인.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── .env parsing (no dependency; PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY only) ──
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadSupabaseConfig() {
  const envFile = parseEnvFile(join(REPO_ROOT, '.env'));
  const url = process.env.PUBLIC_SUPABASE_URL || envFile.PUBLIC_SUPABASE_URL;
  const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || envFile.PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // optional, never read from .env (not stored there)
  if (!url || !anonKey) {
    console.error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY 를 찾을 수 없습니다 (wiki/.env 또는 환경변수).');
    process.exit(1);
  }
  const workshopAccessToken = process.env.WORKSHOP_ACCESS_TOKEN;
  return { url, anonKey, serviceRoleKey, workshopAccessToken };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ── raw HTTPS request helper with an explicit keep-alive pool (avoids relying on
//    global fetch's internal undici pool, whose default connection cap can silently
//    serialize a large Promise.all and inflate p95 with *client-side queue* time
//    rather than real server latency). ──────────────────────────────────────────
const agent = new https.Agent({ keepAlive: true, maxSockets: 320 });

function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(bodyObj);
    const started = performance.now();
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const elapsedMs = performance.now() - started;
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = rawBody ? JSON.parse(rawBody) : null; }
          catch (error) {
            if (ok) console.error(`RPC JSON 응답 해석 실패: ${error.message}`);
          }
          resolve({ ok, status: res.statusCode, elapsedMs, data,
            body: ok ? null : rawBody.slice(0, 300) });
        });
      }
    );
    req.on('error', (err) => {
      const elapsedMs = performance.now() - started;
      resolve({ ok: false, status: 0, elapsedMs, body: `request error: ${err.message}` });
    });
    req.write(body);
    req.end();
  });
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return NaN;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function classifyVoteRpcResponse(result) {
  if (!result.ok) return 'request_error';
  if (result.data === 'ok' || result.data === 'duplicate' || result.data === 'closed') return result.data;
  throw new Error(`unexpected public vote RPC result: ${JSON.stringify(result.data)}`);
}

function loadRoundIds(roundsFilePath) {
  const path = roundsFilePath || join(__dirname, 'loadtest-rounds.json');
  if (!existsSync(path)) {
    console.error(
      `라운드 id 파일을 찾을 수 없습니다: ${path}\n` +
        `먼저 setup 단계(또는 관리자 권한으로 climate_vote.rounds에 테스트 라운드)를 생성하고, ` +
        `그 id 배열을 이 JSON 파일(문자열 배열)로 저장한 뒤 --rounds-file 로 지정하세요.`
    );
    process.exit(1);
  }
  const ids = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(ids) || ids.length === 0) {
    console.error(`라운드 id 파일이 비어있거나 배열이 아닙니다: ${path}`);
    process.exit(1);
  }
  return ids;
}

// ── vote phase ───────────────────────────────────────────────────────────────
async function runVote(args) {
  const { url, anonKey } = loadSupabaseConfig();
  const roundIds = loadRoundIds(args['rounds-file']);
  const perRound = Number(args['per-round'] || 20);
  const runId = args['run-id'] || String(Date.now());
  const total = roundIds.length * perRound;

  console.log(`부하 테스트 시작: 라운드 ${roundIds.length}개 × ${perRound}명 = 총 ${total}명, run-id=${runId}`);

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Profile': 'climate_vote',
  };
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/rpc/public_round_cast_v2`;

  // 5초 창 안에 무작위 지터로 흩뿌려 발사 (동시성 시뮬레이션 — 완전 동시 0ms는 비현실적)
  const tasks = [];
  let n = 0;
  for (const roundId of roundIds) {
    for (let i = 0; i < perRound; i++) {
      n++;
      const clientId = `lt-${runId}-${n}`; // >=8 chars, 런당 고유
      const choice = Math.random() < 0.5 ? 'A' : 'B';
      const jitterMs = Math.floor(Math.random() * 4000); // 0~4000ms, 총 5초 창 안에 수렴
      tasks.push(
        new Promise((resolve) => {
          setTimeout(async () => {
            const result = await postJson(endpoint, headers, {
              p_round_id: roundId,
              p_choice: choice,
              p_client_id: clientId,
            });
            try {
              result.voteStatus = classifyVoteRpcResponse(result);
            } catch (error) {
              console.error('public vote RPC semantic check failed', error);
              result.voteStatus = 'unexpected';
            }
            result.ok = result.ok && result.voteStatus === 'ok';
            resolve(result);
          }, jitterMs);
        })
      );
    }
  }

  const windowStart = performance.now();
  const results = await Promise.all(tasks);
  const windowMs = performance.now() - windowStart;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const duplicate = results.filter((r) => r.voteStatus === 'duplicate');
  const closed = results.filter((r) => r.voteStatus === 'closed');
  const unexpected = results.filter((r) => r.status >= 200 && r.status < 300
    && !['ok', 'duplicate', 'closed'].includes(r.voteStatus));
  const latencies = ok.map((r) => r.elapsedMs).sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies.length ? latencies[latencies.length - 1] : NaN;

  console.log('');
  console.log(`실제 발사 창(전체 완료까지): ${windowMs.toFixed(0)}ms`);
  console.log(`성공: ${ok.length} / ${total}  실패: ${failed.length}`);
  console.log(`RPC 결과: ok=${ok.length} duplicate=${duplicate.length} closed=${closed.length} unexpected=${unexpected.length}`);
  console.log(`p50: ${p50.toFixed(1)}ms  p95: ${p95.toFixed(1)}ms  max: ${max.toFixed(1)}ms`);
  console.log(`에러율: ${((failed.length / total) * 100).toFixed(2)}%`);

  if (failed.length > 0) {
    console.log('');
    console.log('에러 샘플 (최대 5건):');
    for (const f of failed.slice(0, 5)) {
      console.log(`  status=${f.status} elapsed=${f.elapsedMs.toFixed(0)}ms body=${f.body}`);
    }
  }

  const pass = failed.length === 0 && p95 < 2000;
  console.log('');
  console.log(pass ? '✅ 기준 충족 (에러율 0%, p95 < 2000ms)' : '❌ 기준 미달 — 원인 조사 필요 (RLS 정책 비용/인덱스 등)');
  process.exitCode = pass ? 0 : 1;
}

// ── setup phase: workshop token-scoped v3 create RPC only. ────────────────────
async function runSetup(args) {
  const { url, anonKey, workshopAccessToken } = loadSupabaseConfig();
  const count = Number(args.count || 15);
  const titlePrefix = args['title-prefix'] || 'LOADTEST';
  if (!workshopAccessToken) {
    console.error('WORKSHOP_ACCESS_TOKEN 환경변수가 필요합니다. 토큰을 명령행 인자로 전달하지 마세요.');
    process.exit(1);
  }

  const rpcBase = `${url.replace(/\/$/, '')}/rest/v1/rpc`;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Profile': 'climate_vote',
    Prefer: 'return=representation',
  };

  const created = [];
  for (let i = 1; i <= count; i++) {
    const result = await postJson(`${rpcBase}/mod_create_round_v3`, headers, {
      p_token: workshopAccessToken,
      p_title: `${titlePrefix} r${i}`,
      p_type: 'RADIO',
      p_options: ['A', 'B'],
      p_idempotency_key: randomUUID(),
    });
    const roundId = result.data && typeof result.data.id === 'string' ? result.data.id : null;
    if (!result.ok || !roundId || result.data?.status !== 'active') {
      console.error(`라운드 ${i} 생성 실패: status=${result.status} body=${result.body}`);
      process.exit(1);
    }
    // mod_create_round_v3 creates an active round. A redundant active -> active
    // status call would violate the v3 transition contract (only close/reopen).
    console.log(`라운드 ${i} 생성·활성 상태 확인 완료`);
    created.push(roundId);
  }
  const roundsPath = args['rounds-file'] || join(__dirname, 'loadtest-rounds.json');
  writeFileSync(roundsPath, `${JSON.stringify(created, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`${count}개 라운드 생성 완료. 비밀이 없는 id 목록: ${roundsPath}`);
}

// ── cleanup phase: cv_archive_round는 EXECUTE가 authenticated/service_role에만 부여되어
//    있고 anon에는 없다 — 서비스 롤 키가 있을 때만 anon 키 경로 없이 직접 수행 가능. ───────
async function runCleanup(args) {
  const { url, serviceRoleKey } = loadSupabaseConfig();
  const roundIds = loadRoundIds(args['rounds-file']);

  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.');
    console.error('cv_archive_round는 anon에 EXECUTE 권한이 없어(authenticated/service_role만) anon 키로는 정리가 불가능합니다.');
    console.error('다음 중 하나로 정리하세요:');
    console.error('  1) SUPABASE_SERVICE_ROLE_KEY=<service_role_key> node scripts/loadtest-mod-console.mjs cleanup --rounds-file <path>');
    console.error('  2) Supabase MCP execute_sql (postgres 권한)로 각 라운드에 대해 아래 SQL 실행:');
    for (const id of roundIds) {
      console.error(`     select climate_vote.cv_archive_round('${id}', 'loadtest cleanup', 'loadtest');`);
    }
    console.error(`     update climate_vote.rounds set status='closed' where id = any(array[${roundIds.map((i) => `'${i}'`).join(',')}]);`);
    process.exit(1);
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Profile': 'climate_vote',
    Prefer: 'return=representation',
  };

  for (const roundId of roundIds) {
    const archiveResult = await postJson(`${url.replace(/\/$/, '')}/rest/v1/rpc/cv_archive_round`, headers, {
      p_round_id: roundId,
      p_reason: 'loadtest cleanup',
      p_archived_by: 'loadtest',
    });
    if (!archiveResult.ok) {
      console.error(`cv_archive_round 실패 (${roundId}): status=${archiveResult.status} body=${archiveResult.body}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`archived: ${roundId}`);

    // status=closed 로 PATCH (rounds는 admin_write만 anon에 없음 — service_role 은 RLS bypass)
    await new Promise((resolve) => {
      const patchUrl = new URL(`${url.replace(/\/$/, '')}/rest/v1/rounds?id=eq.${encodeURIComponent(roundId)}`);
      const body = JSON.stringify({ status: 'closed' });
      const req = https.request(
        {
          hostname: patchUrl.hostname,
          path: patchUrl.pathname + patchUrl.search,
          method: 'PATCH',
          agent,
          headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        }
      );
      req.on('error', resolve);
      req.write(body);
      req.end();
    });
  }
  console.log('정리 완료.');
}

async function main() {
  const [, , phase, ...rest] = process.argv;
  const args = parseArgs(rest);
  if (phase === 'vote') return runVote(args);
  if (phase === 'setup') return runSetup(args);
  if (phase === 'cleanup') return runCleanup(args);
  console.error('사용법: node scripts/loadtest-mod-console.mjs <vote|setup|cleanup> [옵션]');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

export { parseEnvFile, loadSupabaseConfig, parseArgs, percentile, loadRoundIds, classifyVoteRpcResponse, randomUUID };
