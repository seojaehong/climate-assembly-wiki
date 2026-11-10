#!/usr/bin/env node
/**
 * 11/14 의결 결과 내보내기 — 투표지 3장을 읽어 세리머니용 `result/v2` 를 만든다. 계약 = docs/result-v2-contract.md
 *
 *   # 실전(운영 DB 읽기만): 운영자 접속 토큰은 환경 변수로만 받는다(명령 줄 · 로그에 남기지 않는다)
 *   CV_ACCESS_TOKEN=<64자리> node scripts/export-result-v2.mjs --config <설정.json> --out <폴더>
 *   # 투표지 id 찾기(읽기만)
 *   CV_ACCESS_TOKEN=<64자리> node scripts/export-result-v2.mjs --list
 *   # 저장해 둔 원자료로 다시 만들기(오프라인 · 시험)
 *   node scripts/export-result-v2.mjs --config <설정.json> --out <폴더> --source file --raw-dir <폴더>/raw
 *   # 만든 파일 검사(세리머니 쪽 · 검증자)
 *   node scripts/export-result-v2.mjs --verify <폴더>/result_v2.json
 *
 * 읽는 RPC(쓰기 0): ballot_named_responses_v2(p_token, p_ballot_id) · ballot_list_v2(p_token)(운영자 접속 토큰) ·
 *   ballot_get(p_token = 투표지 토큰, 문항의 필수 표시 — 기권 불인정 검사, 11/10 결정). 모두 anon 키로 부른다.
 *   ballot_get 은 열림 · 마감 · 공개 투표지만 답한다(초안이면 필수 표시를 못 읽어 거부).
 * 이 스크립트는 로그인(토큰 발급)을 하지 않는다 — 발급은 접속 세션 행을 쓰기 때문이다. 토큰은 /mod 에 로그인한 노트북에서 가져온다.
 * 출력: <out>/result_v2.json · result_v2.json.sha256 · result_v2_요약.txt · raw/agenda<N>.json(실명 포함 — 저장소 밖에 둔다)
 * 검사 하나라도 실패하면 result_v2.json 을 만들지도 바꾸지도 않고 종료 코드 2.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResultV2Error, attachRequired, buildResultV2, summaryText, validateResultV2 } from './lib/result-v2.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();

const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (k) => argv.includes(k);

function die(msg, code = 2) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}+09:00`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// ── 접속 ─────────────────────────────────────────────────────────────

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

async function rpc(fn, body) {
  const { url, anon } = supabaseTarget();
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
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
        const msg = (() => {
          try {
            return JSON.parse(text).message ?? text;
          } catch {
            return text;
          }
        })();
        throw new Error(`${fn} HTTP ${res.status}: ${msg}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if (/HTTP 4\d\d/.test(String(e.message))) break; // 권한 · 인자 오류는 다시 해도 같다
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ── 설정 ─────────────────────────────────────────────────────────────

function loadJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    die(`${what} 를 읽지 못했습니다: ${path}\n  ${e.message}`);
  }
}

function loadConfig(path) {
  const cfg = loadJson(path, '설정 파일');
  const base = dirname(resolve(path));
  const rel = (p) => (isAbsolute(p) ? p : join(base, p));
  for (const a of cfg.agendas ?? []) {
    if (typeof a.paper_file === 'string') a.paper = loadJson(rel(a.paper_file), `의제 ${a.no} 서면 집계표`);
    if (typeof a.attendance_file === 'string') a.attendance = loadJson(rel(a.attendance_file), `의제 ${a.no} 출석부`);
  }
  if (cfg.report && typeof cfg.report.paper_file === 'string') cfg.report.paper = loadJson(rel(cfg.report.paper_file), '보고서 서면 집계표');
  if (cfg.report && typeof cfg.report.attendance_file === 'string') cfg.report.attendance = loadJson(rel(cfg.report.attendance_file), '보고서 출석부');
  return cfg;
}

function guardOutDir(out) {
  const r = relative(REPO, out);
  const inside = r && !r.startsWith('..') && !isAbsolute(r);
  if (inside && !r.split(/[\\/]/)[0].match(/^\.tmp(-verify)?$/)) {
    die(`출력 폴더가 저장소 안입니다(${r}). 원자료에 실명이 들어 있어 공개 저장소에 둘 수 없습니다. 저장소 밖이나 .tmp/ 를 쓰세요.`);
  }
}

// ── 모드 ─────────────────────────────────────────────────────────────

async function listMode() {
  const rows = await rpc('ballot_list_v2', { p_token: accessToken() });
  for (const b of rows ?? []) {
    process.stdout.write(`${b.id}\t${b.status}\t${b.subgroup ?? '-'}\t문항 ${b.item_count}\t제출 ${b.response_count}\t${b.title}\n`);
  }
  process.stdout.write(`(${(rows ?? []).length}장 · ${Date.now() - t0}ms)\n`);
}

function verifyMode(file) {
  const buf = readFileSync(file);
  const doc = JSON.parse(buf.toString('utf8'));
  const problems = validateResultV2(doc);
  const shaFile = `${file}.sha256`;
  const actual = sha256(buf);
  if (existsSync(shaFile)) {
    const expected = readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
    if (expected !== actual) problems.push(`sha256 불일치: 파일 ${actual} ≠ 곁 파일 ${expected}`);
  } else problems.push('곁 파일 .sha256 이 없음');
  if (problems.length) die(`검사 실패 ${problems.length}건\n  ${problems.join('\n  ')}`);
  process.stdout.write(`✓ 검사 통과 · ${doc.status} · rehearsal=${doc.rehearsal} · example=${doc.example} · sha256 ${actual}\n`);
}

async function exportMode() {
  const configPath = arg('--config');
  const out = arg('--out');
  if (!configPath || !out) die('사용법: --config <설정.json> --out <폴더> [--source rpc|file --raw-dir <폴더>]');
  const outDir = resolve(out);
  guardOutDir(outDir);
  const cfg = loadConfig(configPath);
  const source = arg('--source') ?? 'rpc';

  const raws = {};
  const targets = (cfg.agendas ?? []).map((a) => ({ key: a.no, id: a.ballot_id }));
  if (cfg.report?.mode === 'vote' && cfg.report.ballot_id) targets.push({ key: 'report', id: cfg.report.ballot_id });
  const tRead = Date.now();
  if (source === 'rpc') {
    const token = accessToken();
    // 필수 표시(required)는 실명 응답 함수가 주지 않는다 — 목록에서 투표지 토큰을 찾아 ballot_get 으로 읽어 붙인다.
    const list = await rpc('ballot_list_v2', { p_token: token });
    const ballotTokenOf = new Map((list ?? []).map((b) => [b.id, b.token]));
    const got = await Promise.all(
      targets.map(async (t) => {
        if (!t.id) die(`의제 ${t.key}: ballot_id 가 없습니다(--list 로 찾기)`);
        const ballotToken = ballotTokenOf.get(t.id);
        if (!ballotToken) die(`의제 ${t.key}: 투표지 ${t.id} 가 이 세션 투표지 목록에 없습니다(--list 로 확인)`);
        const [data, meta] = await Promise.all([
          rpc('ballot_named_responses_v2', { p_token: token, p_ballot_id: t.id }),
          rpc('ballot_get', { p_token: ballotToken }),
        ]);
        if (!data) die(`의제 ${t.key}: 투표지 ${t.id} 를 읽지 못했습니다(실명 응답 함수 없음 또는 범위 밖)`);
        return [t.key, attachRequired(data, meta)];
      }),
    );
    mkdirSync(join(outDir, 'raw'), { recursive: true });
    const fetchedAt = kstNow();
    for (const [k, data] of got) {
      raws[k] = data;
      writeFileSync(join(outDir, 'raw', `agenda${k}.json`), JSON.stringify({ fetched_at: fetchedAt, ...data }, null, 1));
    }
  } else if (source === 'file') {
    const dir = resolve(arg('--raw-dir') ?? join(outDir, 'raw'));
    for (const t of targets) raws[t.key] = loadJson(join(dir, `agenda${t.key}.json`), `의제 ${t.key} 원자료`);
  } else die(`--source 는 rpc 또는 file (지금 ${source})`);
  const readMs = Date.now() - tRead;

  let built;
  try {
    built = buildResultV2(cfg, raws, { generatedAt: arg('--now') ?? kstNow() });
  } catch (e) {
    if (e instanceof ResultV2Error) die(`검사 실패 ${e.problems.length}건 — result_v2.json 을 만들지 않았습니다\n  ${e.problems.join('\n  ')}`);
    throw e;
  }
  const json = `${JSON.stringify(built.doc, null, 2)}\n`;
  const buf = Buffer.from(json, 'utf8');
  const hash = sha256(buf);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'result_v2.json');
  // 임시 파일 → 이름 바꾸기(세리머니가 반쯤 쓴 파일을 읽지 않게). 곁 파일 · 요약은 그 뒤.
  writeFileSync(`${file}.tmp`, buf);
  renameSync(`${file}.tmp`, file);
  writeFileSync(`${file}.sha256`, `${hash}  result_v2.json\n`);
  writeFileSync(join(outDir, 'result_v2_요약.txt'), summaryText(built.doc, built.recounts, hash));
  const s = built.doc.summary;
  process.stdout.write(
    [
      `✓ ${file}`,
      `  ${built.doc.rehearsal ? '[리허설] ' : ''}${built.doc.status} · 합계 ${s.total} · 가결 ${s.passed} · 부결 ${s.failed} · 불성립 ${s.not_established} · 미확정 ${s.pending}`,
      `  sha256 ${hash}`,
      `  요약 ${join(outDir, 'result_v2_요약.txt')}`,
      `  읽기 ${readMs}ms · 전체 ${Date.now() - t0}ms`,
      '',
    ].join('\n'),
  );
}

const verify = arg('--verify');
try {
  if (verify) verifyMode(resolve(verify));
  else if (has('--list')) await listMode();
  else await exportMode();
} catch (e) {
  die(String(e?.message ?? e));
}
