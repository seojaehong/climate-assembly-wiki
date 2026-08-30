/**
 * 8.29 조별 산출물 · 출석 로컬 백업 — **읽기 전용**, 시크릿 불필요.
 *
 * 왜 있는가: 예약된 `snapshot` 워크플로가 GitHub Actions 시크릿
 * (SUPABASE_URL·SUPABASE_SERVICE_ROLE) 미등록으로 계속 실패한다. 게다가 이
 * 프로젝트는 PITR이 없어 한 번 지워지면 되돌릴 수단이 없다(2026-06-14 투표
 * ~150건 영구 손실 전례). 그래서 **행사 당일 산출물이 유일본**이 된다.
 *
 * 이 스크립트는 브라우저와 똑같은 경로(공개 anon 키 + 본부 로그인 RPC)로
 * 읽기만 해서 파일로 떨군다. 서비스롤도, Actions 시크릿도 필요 없다.
 *
 *   node scripts/backup-0829.mjs --operator 이름 --password 비번 [--out <디렉터리>]
 *
 * 산출: <out>/0829_산출물_<타임스탬프>.json  +  <out>/latest.json (항상 최신)
 * 같은 내용이면 새 파일을 만들지 않는다(체크섬 비교) — 파일만 쌓이는 것을 막는다.
 */
// ★ Node 20 에서 supabase-js 가 WebSocket 을 못 찾아 죽는다 — createClient 앞에서 막는다.
import './lib/node-ws-shim.mjs';
import { createClient } from '../automation/node_modules/@supabase/supabase-js/dist/index.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const URL_ = process.env.PUBLIC_SUPABASE_URL || 'https://pleyuknjnprsckssxvrh.supabase.co';
// 공개 anon 키다 — 배포된 번들에 그대로 들어 있다. 비밀이 아니다.
const ANON =
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsZXl1a25qbnByc2Nrc3N4dnJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTEyMjQsImV4cCI6MjA4ODk2NzIyNH0.fP_OG2ZpP7KDtPebY4Wp20mMWlVMn5KQad7UpJ4hx08';

// 자격은 인자 > 환경변수 순으로 받는다.
// ★ 환경변수를 받는 이유 — 예약 실행(작업 스케줄러)에 비번을 인자로 박으면
//   명령줄이 프로세스 목록에 그대로 노출된다. `.env.backup`(gitignore 됨)에 두고
//   배치 파일이 읽어 넘긴다. 이 저장소는 **공개**라 자격이 커밋되면 즉시 유출이다.
const OPERATOR = arg('operator') || process.env.HQ_OPERATOR;
const PASSWORD = arg('password') || process.env.HQ_PASSWORD;
const OUT = arg('out', join(process.cwd(), '..', '10_작업산출물', '2026-08-29_산출물_백업'));
const SESSION = arg('session', '0829-deliberation');

if (!OPERATOR || !PASSWORD) {
  console.error('본부 자격이 없다. 둘 중 하나로 준다:');
  console.error('  1) node scripts/backup-0829.mjs --operator 이름 --password 비번');
  console.error('  2) HQ_OPERATOR / HQ_PASSWORD 환경변수 (예약 실행용, 권장)');
  process.exit(2);
}

const db = createClient(URL_, ANON, { auth: { persistSession: false } });
const cv = () => db.schema('climate_vote');

function stamp(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
}

async function rpc(name, args) {
  const { data, error } = await cv().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message ?? JSON.stringify(error)}`);
  return data;
}

const token = await rpc('attendance_hq_unlock_named', {
  p_operator: OPERATOR,
  p_password: PASSWORD,
});
if (typeof token !== 'string' || !token) throw new Error('본부 로그인 실패 — 이름·비밀번호 확인');

// 조별 산출물 전량(조 15 × 꼭지 3)과 조 명단·출석 요약. 전부 읽기 전용 RPC다.
const [submissions, teams, attendance] = await Promise.all([
  rpc('hq_submissions', { p_token: token, p_session_slug: SESSION }),
  rpc('hq_teams', {}),
  rpc('attendance_hq_summary', {}),
]);

const rows = Array.isArray(submissions) ? submissions : [];
const withText = rows.filter((r) => r.item_content != null);
const payload = {
  schema: 'climate-0829-backup/1',
  session: SESSION,
  captured_at_kst: stamp(),
  captured_by: OPERATOR,
  counts: {
    rows: rows.length,
    items: withText.length,
    teams_with_items: new Set(withText.map((r) => r.team_id)).size,
    finalized: new Set(rows.filter((r) => r.submission_status === 'final').map((r) => r.submission_id))
      .size,
  },
  submissions: rows,
  teams,
  attendance_summary: attendance,
};

// 체크섬은 시각을 뺀 본문으로 낸다 — 내용이 같으면 파일을 새로 만들지 않는다.
const body = JSON.stringify({ ...payload, captured_at_kst: undefined }, null, 0);
payload.checksum = 'sha256:' + createHash('sha256').update(body).digest('hex');

mkdirSync(OUT, { recursive: true });
const latestPath = join(OUT, 'latest.json');
let unchanged = false;
if (existsSync(latestPath)) {
  try {
    unchanged = JSON.parse(readFileSync(latestPath, 'utf8')).checksum === payload.checksum;
  } catch {
    unchanged = false;
  }
}

const text = JSON.stringify(payload, null, 2);
writeFileSync(latestPath, text, 'utf8');
if (!unchanged) writeFileSync(join(OUT, `0829_산출물_${payload.captured_at_kst}.json`), text, 'utf8');

console.log(
  `${payload.captured_at_kst} · 줄 ${payload.counts.items} · 쓴 조 ${payload.counts.teams_with_items}` +
    ` · 최종제출 ${payload.counts.finalized} · ${unchanged ? '변화 없음(latest만 갱신)' : '새 스냅샷 저장'}`,
);
console.log(`저장 위치: ${OUT}`);
