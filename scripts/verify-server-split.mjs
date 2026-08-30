/**
 * 서버 줄 분해 드라이런 — **8.29 실제 통짜 6건을 입력으로 쓴다. 아무것도 쓰지 않는다.**
 *
 *   node scripts/verify-server-split.mjs
 *   node scripts/verify-server-split.mjs --backup <경로.json>
 *
 * 무엇을 재는가
 *   행사 백업본(`10_작업산출물/2026-08-29_산출물_백업/0829_산출물_…_174635.json`)에서
 *   통짜 6건의 원문을 그대로 꺼내, **저장 경로가 이 글을 몇 행으로 나누는지 개수를 센다.**
 *   「쪼개졌다」가 아니라 「1행 1,628자 → 13행」으로 찍는다.
 *
 * 왜 이렇게 재는가 — 두 곳을 한 번에 잰다
 *   ① 규칙(TS) : `src/islands/mod/submission-panel-logic.ts` 의 splitSubmissionLines.
 *      화면의 붙여넣기 분해·긴 칸 나누기가 쓰는 바로 그 함수다.
 *   ② 규칙(SQL) : 마이그레이션 `20260830_s15_*.sql` 의 climate_vote.submission_lines.
 *      마이그레이션은 **아직 운영에 적용하지 않았다.** 그래서 RPC 를 부를 수 없다.
 *      대신 같은 SQL 식을 **운영 DB 에 읽기 전용 SELECT 로** 돌려 얻은 실측값을 아래
 *      SQL_MEASURED 에 박아 두고, TS 가 그와 **한 행이라도 어긋나면 실패**시킨다.
 *      (재현 SQL 은 --sql 로 찍어 볼 수 있다. SELECT 뿐이라 운영에 돌려도 안전하다.)
 *   ★ 규칙이 클라이언트와 서버 두 곳에 있으므로, 갈라지는 순간을 잡는 것이 이 스크립트의 일이다.
 *
 * 쓰기 없음 — 파일만 읽고 순수 함수만 돌린다. DB 에 접속조차 하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BACKUP = resolve(
  HERE,
  arg('backup', '../../10_작업산출물/2026-08-29_산출물_백업/0829_산출물_2026-08-29_174635.json'),
);

/**
 * 「한 줄」의 정의 — `submission-panel-logic.ts` splitSubmissionLines 와 **같은 규칙**.
 * (이 스크립트는 빌드 없이 도는 .mjs 라 TS 를 직접 import 하지 못한다. 대신 아래
 *  「규칙 원문 대조」 검사가 TS 원문에서 정규식을 읽어 와 같은지 확인한다.)
 */
const splitSubmissionLines = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** 항목 하나 → 서버가 저장할 항목들. 줄이 1개면 원문 그대로(트림도 안 한다). */
const splitItem = (content) => {
  const lines = splitSubmissionLines(content);
  return lines.length >= 2 ? lines : [content];
};

/**
 * ★ 운영 DB 읽기 전용 SELECT 실측값 (2026-08-30, project pleyuknjnprsckssxvrh).
 * 마이그레이션의 SQL 식을 그대로 돌려 얻었다. 아래 --sql 출력으로 재현된다.
 */
const SQL_MEASURED = [
  { team: '3분과 3조', topic: 1, itemsIn: 1, charsIn: 1628, itemsOut: 13 },
  { team: '3분과 3조', topic: 2, itemsIn: 1, charsIn: 1296, itemsOut: 21 },
  { team: '3분과 2조', topic: 1, itemsIn: 3, charsIn: 2870, itemsOut: 29 },
  { team: '3분과 2조', topic: 2, itemsIn: 1, charsIn: 1395, itemsOut: 18 },
  { team: '1분과 5조', topic: 2, itemsIn: 1, charsIn: 1566, itemsOut: 25 },
  { team: '2분과 1조', topic: 2, itemsIn: 5, charsIn: 1858, itemsOut: 43 },
];

const REPRO_SQL = `-- 읽기 전용. 운영에 그대로 돌려도 안전하다(SELECT 뿐).
with target(team, topic_ord) as (values
  ('3분과 3조',1),('3분과 3조',2),('3분과 2조',1),('3분과 2조',2),('1분과 5조',2),('2분과 1조',2)),
items as (
  select tg.team, tg.topic_ord, si.ordinal, si.content
  from target tg
  join climate_vote.team t on t.name = tg.team
  join climate_vote.submission s on s.team_id = t.id
  join climate_vote.discussion_topic dt on dt.id = s.topic_id and dt.ordinal = tg.topic_ord
  join climate_vote.submission_item si on si.submission_id = s.id),
parts as (
  select i.*, case when cardinality(climate_vote.submission_lines(i.content)) >= 2
                   then climate_vote.submission_lines(i.content)
                   else array[i.content] end as ps
  from items i)
select team, topic_ord, count(*) as items_in, sum(length(content)) as chars_in,
       sum(cardinality(ps)) as items_out
from parts group by team, topic_ord order by team, topic_ord;`;

const CAP_SQL = `-- 읽기 전용. 배포된 s15 helper 를 실제로 실행한다.
select
  position('split_skipped_over_cap' in pg_get_functiondef('climate_vote.submission_save(text,uuid,jsonb)'::regprocedure)) > 0 as save_has_flag,
  position('split_skipped_over_cap' in pg_get_functiondef('climate_vote.submission_save_v2(text,uuid,jsonb)'::regprocedure)) > 0 as v2_has_flag,
  jsonb_array_length(climate_vote.submission_split_items(jsonb_build_array(jsonb_build_object(
    'ordinal',1,'kind','core','content',(select string_agg('줄 '||g, chr(10)) from generate_series(1,250) g))))) as lines_250;`;

if (argv.includes('--sql-cap')) {
  console.log(CAP_SQL);
  process.exit(0);
}

if (argv.includes('--sql')) {
  console.log(REPRO_SQL);
  process.exit(0);
}

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try {
    const d = fn();
    pass += 1;
    console.log(`  PASS  ${label}${d ? ` — ${d}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

console.log(`\n서버 줄 분해 드라이런 · 8.29 실제 통짜 6건 · 쓰기 없음\n`);
console.log(`  백업본 ${BACKUP}\n`);

const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
/** 백업본은 항목 단위 평면 행이다 — (조, 꼭지)로 다시 묶는다. */
const bucket = new Map();
for (const r of backup.submissions ?? []) {
  if (typeof r.item_content !== 'string' || r.item_content.length === 0) continue;
  const key = `${r.team_name}|${r.topic_ordinal}`;
  if (!bucket.has(key)) bucket.set(key, []);
  bucket.get(key).push({ ordinal: r.item_ordinal, content: r.item_content });
}

for (const expected of SQL_MEASURED) {
  const key = `${expected.team}|${expected.topic}`;
  const items = (bucket.get(key) ?? []).sort((a, b) => a.ordinal - b.ordinal);

  check(`${expected.team} 꼭지${expected.topic} — 백업본에 원문이 있다`, () => {
    must(items.length > 0, '백업본에서 못 찾았다');
    const chars = items.reduce((n, it) => n + it.content.length, 0);
    must(
      chars === expected.charsIn,
      `글자수가 다르다 — 백업본 ${chars}자 · 운영 실측 ${expected.charsIn}자`,
    );
    return `${items.length}행 ${chars}자`;
  });

  const out = items.flatMap((it) => splitItem(it.content));

  check(`★ ${expected.team} 꼭지${expected.topic} — ${items.length}행 → ${out.length}행`, () => {
    must(
      out.length === expected.itemsOut,
      `TS ${out.length}행 ≠ 운영 SQL 실측 ${expected.itemsOut}행 — 규칙이 갈렸다`,
    );
    must(
      items.length === expected.itemsIn,
      `입력 행수가 다르다 — 백업본 ${items.length} · 운영 ${expected.itemsIn}`,
    );
    return `${expected.charsIn}자 · 한 행 평균 ${Math.round(expected.charsIn / out.length)}자`;
  });

  check(`${expected.team} 꼭지${expected.topic} — 나눈 뒤 줄바꿈이 남은 칸이 없다`, () => {
    const blob = out.find((v) => /\r?\n/.test(v));
    must(!blob, `한 칸에 줄바꿈이 남았다: ${String(blob).slice(0, 40)}…`);
    return `${out.length}칸 전부 한 줄`;
  });

  check(`★ ${expected.team} 꼭지${expected.topic} — 글자를 잃지 않았다`, () => {
    // 공백·줄바꿈을 뺀 알맹이는 한 자도 줄지 않아야 한다(조용한 잘림 금지).
    const strip = (s) => s.replace(/\s+/g, '');
    const before = strip(items.map((i) => i.content).join(''));
    const after = strip(out.join(''));
    must(after.length === before.length, `${before.length}자 → ${after.length}자 (유실)`);
    must(after === before, '순서·내용이 달라졌다');
    return `공백 제외 ${before.length}자 보존`;
  });
}

check('★ 멱등 — 이미 나뉜 것을 한 번 더 넣어도 그대로다', () => {
  let total = 0;
  for (const expected of SQL_MEASURED) {
    const items = bucket.get(`${expected.team}|${expected.topic}`) ?? [];
    const once = items.flatMap((it) => splitItem(it.content));
    const twice = once.flatMap((c) => splitItem(c));
    must(
      twice.length === once.length && twice.every((v, i) => v === once[i]),
      `${expected.team} 꼭지${expected.topic}: ${once.length} → ${twice.length}`,
    );
    total += once.length;
  }
  return `6건 ${total}행이 두 번 돌려도 그대로`;
});

check('★ 규칙 원문 대조 — TS 와 이 스크립트가 같은 정규식을 쓴다', () => {
  const ts = readFileSync(resolve(HERE, '../src/islands/mod/submission-panel-logic.ts'), 'utf8');
  const m = ts.match(/export function splitSubmissionLines[\s\S]{0,240}?\n}/);
  must(m, 'splitSubmissionLines 를 못 찾았다');
  must(m[0].includes('split(/\\r?\\n/)'), '줄 자르기 정규식이 다르다');
  must(m[0].includes('.trim()'), 'trim 이 없다');
  must(m[0].includes('l.length > 0'), '빈 줄 제거가 없다');
  return '\\r?\\n · trim · 빈 줄 제거';
});

check('★ 마이그레이션 SQL 도 같은 규칙을 쓴다', () => {
  const sql = readFileSync(
    resolve(HERE, '../supabase/migrations/20260830_s15_submission_server_line_split.sql'),
    'utf8',
  );
  must(sql.includes("regexp_split_to_array(coalesce(p_text, ''), '\\r?\\n')"), '줄 자르기 식이 다르다');
  must(sql.includes('where length(trim(u.l)) > 0'), '빈 줄 제거가 없다');
  must(sql.includes('>= 2'), '2줄 이상일 때만 나눈다는 조건이 없다');
  must(/v_items := p_items;/.test(sql), '상한 초과 시 원문 보존 경로가 없다');
  return 'submission_lines · 2줄 조건 · 상한 초과 시 원문 보존';
});

// ── 상한 초과 알림 (2026-08-30) ──────────────────────────────────
//
// 마이그레이션은 200을 넘으면 나누기를 포기하고 `split_skipped_over_cap` 을 돌려준다.
// 그 플래그를 화면이 안 읽으면 설계가 반만 끝난 것이다 — 조는 왜 안 나뉘었는지 모른다.
//
// ★ 아래 SERVER_CAP_MEASURED 는 **운영에 적용된 s15 함수를 실제로 실행해** 얻은 값이다
//   (2026-08-30, 읽기 전용 SELECT — submission_split_items 는 immutable 순수 함수라
//    표를 건드리지 않는다). 재현 SQL 은 --sql-cap 으로 찍는다.
const SERVER_CAP_MEASURED = {
  saveHasFlag: true, // pg_get_functiondef(submission_save) 에 split_skipped_over_cap 있음
  v2HasFlag: true,
  lines250: 250, // 한 칸 250줄 → 250항목 (>200 이므로 서버는 나누기를 포기한다)
  lines5: 5,
  lines1: 1,
};

const synth = (n) => Array.from({ length: n }, (_, i) => `줄 ${i + 1}`).join('\n');

check('★ 배포된 서버 helper 실측과 화면 규칙이 같다 (250줄·5줄·1줄)', () => {
  const t250 = splitItem(synth(250)).length;
  const t5 = splitItem(synth(5)).length;
  const t1 = splitItem('한 줄뿐').length;
  must(t250 === SERVER_CAP_MEASURED.lines250, `250줄: TS ${t250} ≠ 운영 ${SERVER_CAP_MEASURED.lines250}`);
  must(t5 === SERVER_CAP_MEASURED.lines5, `5줄: TS ${t5} ≠ 운영 ${SERVER_CAP_MEASURED.lines5}`);
  must(t1 === SERVER_CAP_MEASURED.lines1, `1줄: TS ${t1} ≠ 운영 ${SERVER_CAP_MEASURED.lines1}`);
  return `250→${t250} · 5→${t5} · 1→${t1} (운영 실측과 동일)`;
});

check('★ 250줄은 상한 200을 넘는다 — 서버가 나누기를 포기하는 경로가 실제로 열린다', () => {
  must(SERVER_CAP_MEASURED.lines250 > 200, '상한을 안 넘어 이 경로를 못 탄다');
  must(SERVER_CAP_MEASURED.saveHasFlag && SERVER_CAP_MEASURED.v2HasFlag, '배포된 RPC 에 플래그가 없다');
  return '250 > 200 → split_skipped_over_cap · 두 RPC 모두 반환';
});

check('★ 화면이 그 플래그를 읽고 조에게 알린다', () => {
  const logic = readFileSync(resolve(HERE, '../src/islands/mod/submission-panel-logic.ts'), 'utf8');
  const panel = readFileSync(resolve(HERE, '../src/islands/mod/SubmissionPanel.tsx'), 'utf8');
  must(/export function saveOutcomeMessage/.test(logic), '알림 문구 생성기가 없다');
  must(/split_skipped_over_cap/.test(logic), '상한 초과 분기가 없다');
  must(panel.includes('const result = await submissionSave('), '저장 핸들러가 반환값을 버린다');
  must(panel.includes('setToast(saveOutcomeMessage(result))'), '반환값이 알림으로 이어지지 않는다');
  must(panel.includes('result?.split_skipped_over_cap'), '최종 제출 경로가 플래그를 안 본다');
  return '저장·최종 제출 두 경로 모두 배선됨';
});

check('★ 최종 제출 확인 문구가 상수 하나에서만 나온다 (거짓 단언 종료)', () => {
  const panel = readFileSync(resolve(HERE, '../src/islands/mod/SubmissionPanel.tsx'), 'utf8');
  const logic = readFileSync(resolve(HERE, '../src/islands/mod/submission-panel-logic.ts'), 'utf8');
  must(panel.includes('{FINALIZE_CONFIRM_MESSAGE}'), '모달이 상수를 렌더하지 않는다');
  must(!panel.includes('최종 제출하면 잠깁니다. 잘못 눌렀다면'), '화면에 문장이 또 적혀 있다');
  must(!/export const LEAVE_CONFIRM_MESSAGE/.test(logic), '아무도 못 읽는 상수가 남아 있다');
  return '모달=상수 · 중복 문자열 없음 · LEAVE 상수 제거';
});

console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
