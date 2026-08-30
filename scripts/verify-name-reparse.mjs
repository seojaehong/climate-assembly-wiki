/**
 * 이름 되파싱 드라이런 — **8.29 실데이터 641건을 그대로 넣는다. 아무것도 쓰지 않는다.**
 *
 *   node scripts/verify-name-reparse.mjs
 *   node scripts/verify-name-reparse.mjs --names     # 뽑힌 이름 전수를 찍는다
 *   node scripts/verify-name-reparse.mjs --hold      # 보류(loose 만 잡은 것)를 찍는다
 *
 * 무엇을 재는가 — 「테스트가 통과했다」가 아니라 **몇 건이 맞고 몇 건이 틀렸는지**를 센다.
 *   입력  `10_작업산출물/2026-08-29_산출물_백업/latest.json` 의 submissions[].item_content
 *   정답  `10_작업산출물/2026-08-27_0829_조별입력_3꼭지/참석명단_대조_0829_v2.0.csv`
 *         — 조별 참석자 실명단 201명. **뽑은 이름이 그 조 명단에 있으면 맞은 것**이다.
 *   보류  좁은 규칙은 안 뽑고 느슨한 규칙만 뽑는 건수. 「애매하면 안 건드린다」의 값이다.
 *
 * ★ 대조 대상은 **화면이 실제로 쓰는 함수 그 자체**다. 규칙을 이 파일에 베껴 적지 않는다 —
 *   esbuild 로 `src/islands/mod/submission-panel-logic.ts` 를 그 자리에서 변환해 import 한다.
 *   (verify-server-split.mjs 는 .mjs 사본 + 원문 대조였다. 여기서는 사본 자체를 없앤다.)
 *
 * 쓰기 없음 — 파일만 읽고 순수 함수만 돌린다. DB 에 접속조차 하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const BACKUP = resolve(HERE, arg('backup', '../../10_작업산출물/2026-08-29_산출물_백업/latest.json'));
const ROSTER = resolve(
  HERE,
  arg('roster', '../../10_작업산출물/2026-08-27_0829_조별입력_3꼭지/참석명단_대조_0829_v2.0.csv'),
);
const LOGIC = resolve(HERE, '../src/islands/mod/submission-panel-logic.ts');

/** 화면이 쓰는 TS 를 그 자리에서 변환해 불러온다(형만 벗긴다 — 규칙은 손대지 않는다). */
async function loadLogic() {
  const src = readFileSync(LOGIC, 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
}

const {
  parseSpeaker,
  joinSpeaker,
  looksLikeSpeakerName,
  normalizeSpeakerName,
  nameOnlyRowIndexes,
  liftNameOnlyRows,
  rowsFromItems,
  toSaveItems,
  pickRestoredRows,
  splitPastedRows,
  isDirty,
  emptyRow,
} = await loadLogic();

/** 느슨한 규칙 — 이름처럼 생겼는지 **안 따진다.** 좁은 규칙과의 차이가 곧 「보류」다. */
function looseParse(content) {
  if (/\r?\n/.test(content)) return null;
  const head = content.replace(/^\s*[-–—·•*]\s*/, '');
  const paren = /^\(\s*([^()]{1,12})\s*\)\s*(\S[\s\S]*)$/.exec(head);
  if (paren) return { name: paren[1].trim(), body: paren[2].trim() };
  const colon = /^([^:：]{1,12})\s*[:：]\s*(\S[\s\S]*)$/.exec(head);
  if (colon) return { name: colon[1].trim(), body: colon[2].trim() };
  return null;
}

// ── 자료 읽기 ───────────────────────────────────────────────────
const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
const items = (backup.submissions ?? []).filter(
  (r) => typeof r.item_content === 'string' && r.item_content.trim().length > 0,
);

/** 조별 참석자 실명단. 조 이름은 백업본의 team_name 과 같은 표기다. */
const rosterByTeam = new Map();
const rosterAll = new Set();
{
  const text = readFileSync(ROSTER, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cell = line.split(',');
    const team = cell[0]?.trim();
    const name = cell[2]?.trim();
    if (!team || !name) continue;
    if (!rosterByTeam.has(team)) rosterByTeam.set(team, new Set());
    rosterByTeam.get(team).add(name);
    rosterAll.add(name);
  }
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

console.log('\n이름 되파싱 드라이런 · 8.29 실데이터 · 쓰기 없음\n');
console.log(`  백업본 ${BACKUP}`);
console.log(`  명단   ${ROSTER}  (${rosterAll.size}명 · ${rosterByTeam.size}개 조)\n`);

// ── ① 정밀도 — 맞은 수 / 틀린 수 / 보류 ─────────────────────────
const stat = {
  total: items.length,
  hit: 0, // 이름을 뽑았다
  inTeam: 0, // 그 조 명단에 있다 = 맞음
  inOther: 0, // 다른 조 명단에 있다 = 사람 이름은 맞으나 조가 다름(맞은 것으로 세지 않는다)
  offRoster: 0, // 어느 명단에도 없다 = 틀렸을 수 있음
  hold: 0, // 좁은 규칙은 안 뽑고 느슨한 규칙만 뽑음 = 보류
};
const offRosterNames = new Map();
const holdSamples = [];
const hitNames = new Map();

for (const r of items) {
  const content = r.item_content;
  const got = parseSpeaker(content);
  if (got.name) {
    stat.hit += 1;
    hitNames.set(got.name, (hitNames.get(got.name) ?? 0) + 1);
    const team = rosterByTeam.get(r.team_name);
    if (team?.has(got.name)) stat.inTeam += 1;
    else if (rosterAll.has(got.name)) stat.inOther += 1;
    else {
      stat.offRoster += 1;
      if (!offRosterNames.has(got.name)) offRosterNames.set(got.name, []);
      offRosterNames.get(got.name).push(`${r.team_name}②${r.topic_ordinal} ${content.slice(0, 46)}`);
    }
  } else if (looseParse(content)) {
    stat.hold += 1;
    if (holdSamples.length < 40) holdSamples.push(`${r.team_name} · ${content.slice(0, 60)}`);
  }
}

console.log('  ── 정밀도 (n=%d) ───────────────────────', stat.total);
console.log(`     뽑음        ${stat.hit}/${stat.total}`);
console.log(`       ├ 그 조 명단에 있음 (맞음)   ${stat.inTeam}/${stat.hit}`);
console.log(`       ├ 다른 조 명단에 있음        ${stat.inOther}/${stat.hit}`);
console.log(`       └ 어느 명단에도 없음         ${stat.offRoster}/${stat.hit}`);
console.log(`     안 뽑음     ${stat.total - stat.hit}/${stat.total}`);
console.log(`       └ 그중 느슨한 규칙은 뽑았을 것 (보류)  ${stat.hold}`);
console.log('');

if (argv.includes('--names')) {
  console.log(
    '  뽑힌 이름 전수:',
    [...hitNames.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(' '),
  );
  console.log('');
}
if (offRosterNames.size > 0) {
  console.log('  ⚠ 명단에 없는 이름 (눈으로 볼 것):');
  for (const [name, samples] of offRosterNames) {
    console.log(`     ${name} ×${samples.length}  예: ${samples[0]}`);
  }
  console.log('');
}
if (argv.includes('--hold')) {
  console.log('  보류 표본:');
  holdSamples.forEach((s) => console.log(`     ${s}`));
  console.log('');
}

/** 편집거리(치환·삽입·삭제 1회 + 인접 두 글자 뒤바뀜) ≤ 1 인가. */
function nearName(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    const at = [];
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) { diff += 1; at.push(i); }
    if (diff === 1) return true;
    if (diff === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]]) return true;
    return false;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i <= s.length; i += 1) {
    if (s.slice(0, i) === l.slice(0, i) && s.slice(i) === l.slice(i + 1)) return true;
  }
  return false;
}

/**
 * 명단 밖 이름을 두 갈래로 가른다.
 *   · 같은 조 명단에 **한 글자 차이** 이름이 있다 → 기록자가 잘못 적은 것. 되파싱은 맞았다
 *   · 그런 것이 없다 → 되파싱이 이름 아닌 것을 이름으로 본 것. **틀린 것**
 */
const typoVariants = [];
const trueFalsePositives = [];
for (const [name, samples] of offRosterNames) {
  const team = samples[0].split('②')[0];
  const near = [...(rosterByTeam.get(team) ?? [])].filter((n) => nearName(n, name));
  if (near.length > 0) typoVariants.push(`${name}→${near.join('/')}`);
  else trueFalsePositives.push(`${name} (${samples[0]})`);
}
if (typoVariants.length > 0) {
  console.log(`  ℹ 같은 조 명단과 한 글자 차이 (기록자 오기 · 되파싱은 맞음): ${typoVariants.join(' · ')}\n`);
}

check('★ 되파싱이 이름 아닌 것을 이름으로 본 건수 = 0', () => {
  must(
    trueFalsePositives.length === 0,
    `${trueFalsePositives.length}건 — ${trueFalsePositives.join(' / ')}`,
  );
  return `${stat.hit}건 중 명단 정확일치 ${stat.inTeam} · 같은 조 오기변형 ${typoVariants.length} · 오탐 0`;
});

check('★ 뽑은 이름의 대부분이 **그 조** 명단에 있다 (95% 이상)', () => {
  const ratio = stat.hit === 0 ? 0 : stat.inTeam / stat.hit;
  must(ratio >= 0.95, `그 조 일치율 ${(ratio * 100).toFixed(1)}%`);
  return `${(ratio * 100).toFixed(1)}% (${stat.inTeam}/${stat.hit})`;
});

// ── ② 불변식 — 본문을 잃지 않는다 ────────────────────────────────
check('★ 안 뽑은 행은 원문과 한 글자도 다르지 않다', () => {
  let n = 0;
  for (const r of items) {
    const got = parseSpeaker(r.item_content);
    if (got.name) continue;
    must(got.body === r.item_content, `원문이 바뀌었다: ${JSON.stringify(r.item_content.slice(0, 40))}`);
    n += 1;
  }
  return `${n}/${items.length}건 원문 그대로`;
});

check('★ 뽑은 행의 본문은 원문에서 잘라낸 **연속된 조각**이다 (지어내지 않는다)', () => {
  let n = 0;
  for (const r of items) {
    const got = parseSpeaker(r.item_content);
    if (!got.name) continue;
    must(
      r.item_content.includes(got.body),
      `본문이 원문에 없다: ${JSON.stringify(r.item_content.slice(0, 40))} → ${JSON.stringify(got.body.slice(0, 40))}`,
    );
    must(r.item_content.includes(got.name), `이름이 원문에 없다: ${got.name}`);
    n += 1;
  }
  return `${n}/${stat.hit}건 부분문자열`;
});

check('★ 본문 알맹이를 잃지 않는다 — 뗀 것은 이름·괄호·콜론·글머리표뿐', () => {
  const strip = (s) => s.replace(/\s+/g, '');
  let n = 0;
  for (const r of items) {
    const got = parseSpeaker(r.item_content);
    if (!got.name) continue;
    // 원문에서 「머리(이름 표기)」를 뗀 나머지가 곧 본문이어야 한다.
    const tail = strip(r.item_content).slice(-strip(got.body).length);
    must(tail === strip(got.body), `꼬리가 다르다: ${JSON.stringify(r.item_content.slice(0, 50))}`);
    n += 1;
  }
  return `${n}건 꼬리 일치`;
});

check('★ 왕복 — 뽑았다 다시 합치면 규칙형(`(이름) 내용`)으로 수렴하고 두 번째부터 고정된다', () => {
  let changed = 0;
  for (const r of items) {
    const a = parseSpeaker(r.item_content);
    const joined = joinSpeaker(a.name, a.content ?? a.body);
    const b = parseSpeaker(joined);
    const joined2 = joinSpeaker(b.name, b.body);
    must(joined2 === joined, `두 번째 왕복에서 바뀐다: ${JSON.stringify(joined.slice(0, 50))}`);
    if (joined !== r.item_content) changed += 1;
  }
  return `641건 전부 멱등 · 저장 문자열이 달라지는 행 ${changed}건(형식 정규화)`;
});

check('★ 641건 전체를 화면 경로(rowsFromItems → toSaveItems)로 돌려도 알맹이가 보존된다', () => {
  // 형식 정규화로만 없어지는 것을 뺀다 — 앞머리 글머리표·공백·괄호·콜론(`이름:` → `(이름)`).
  // 알맹이 글자는 한 자도 빠지면 안 된다.
  const strip = (s) =>
    s.replace(/^\s*[-–—·•*]\s*/, '').replace(/\s+/g, '').replace(/[():：]/g, '');
  const src = items.map((r, i) => ({ ordinal: i + 1, kind: 'core', content: r.item_content, rationale: null }));
  const rows = rowsFromItems(src);
  const out = toSaveItems(rows);
  must(out.length === src.length, `건수가 달라졌다 ${src.length} → ${out.length}`);
  for (let i = 0; i < src.length; i += 1) {
    must(
      strip(out[i].content) === strip(src[i].content),
      `알맹이가 달라졌다\n      전 ${JSON.stringify(src[i].content.slice(0, 60))}\n      후 ${JSON.stringify(out[i].content.slice(0, 60))}`,
    );
  }
  return `${out.length}/${src.length}건 (공백·괄호 제외 알맹이 동일)`;
});

// ── ③ 되파싱이 건드리지 말아야 할 실측 표본 ───────────────────────
const MUST_ABSTAIN = [
  '(촉진질문: 홍보가 아예 없다고 생각하진 않음. 근데 기업들이 움직이지 않는 이유는 무엇일까?)',
  '(추가질문: 기업이 왜 감축노력을 하고 있지 않은가?)',
  '(1) 정주현 : 지금 사는 곳이 대학 오름촌에 있는데, 분리수거 할 장소가 없어',
  '(1) 기후문제로 인한 식재료 가격 변동이 없음. 안정적인 식료값.',
  '1. 시민참여단 발표하고 템플릿에 정리된 내용 작성',
  '2. 의견정리(시민참여단 발표하고 템플릿에 정리된 내용 or 투표해서 선정된 내용 작성)',
  '의제1. 기업이 온실가스를 감축하도록 촉진하는 방안.',
  '오프닝',
  '오셔서 느낀점.',
];
check('★ 애매한 실측 표본 9건을 전부 건드리지 않는다', () => {
  for (const s of MUST_ABSTAIN) {
    const got = parseSpeaker(s);
    must(got.name === '' && got.body === s, `건드렸다: ${JSON.stringify(s.slice(0, 40))} → 이름 ${got.name}`);
  }
  return `${MUST_ABSTAIN.length}/${MUST_ABSTAIN.length}건 원문 보존`;
});

const MUST_PARSE = [
  ['- (박서준) 환경교육 방식이 너무 지루하다. 앉아서 얘기하는 것', '박서준', '환경교육'],
  ['(윤하은) 일회용 사용이 너무 많다.', '윤하은', '일회용'],
  ['최삼관: 낮은 플라스틱 재활용률과 생분해 플라스틱의 비경제성', '최삼관', '낮은'],
];
check('★ 모범 3형태를 전부 뽑는다', () => {
  for (const [src, name, headword] of MUST_PARSE) {
    const got = parseSpeaker(src);
    must(got.name === name, `${JSON.stringify(src.slice(0, 30))} → 이름 ${JSON.stringify(got.name)}`);
    must(got.body.startsWith(headword), `본문이 잘렸다: ${JSON.stringify(got.body.slice(0, 30))}`);
  }
  return '(이름) · - (이름) · 이름: 세 형태';
});

// ── ④ 이름 칸에 조가 적을 법한 잡동사니 ─────────────────────────
check('이름 칸 정리 — 괄호·콜론·글머리표를 떼고 합친다', () => {
  const cases = [
    ['(홍길동)', '홍길동'],
    ['홍길동:', '홍길동'],
    ['- 홍길동', '홍길동'],
    ['  홍길동  ', '홍길동'],
  ];
  for (const [raw, want] of cases) {
    must(normalizeSpeakerName(raw) === want, `${raw} → ${normalizeSpeakerName(raw)}`);
    must(joinSpeaker(raw, '내용') === '(홍길동) 내용', `합치기 실패: ${joinSpeaker(raw, '내용')}`);
  }
  must(joinSpeaker('', '내용') === '내용', '이름이 비면 본문만 저장해야 한다');
  must(joinSpeaker('홍길동', '   ') === '', '본문이 없으면 이름만 저장하지 않는다');
  return '4형태 정리 + 이름 없음 + 본문 없음';
});

// ── ⑤ §4-5 이름만 있는 행 ──────────────────────────────────────
check('★ 8.29 유형 C 실제 모양을 잡아 내려 채운다', () => {
  const rows = [
    { name: '', content: '권민정:', rationale: '' },
    { name: '', content: '(1) 기후문제로 인한 식재료 가격 변동이 없음.', rationale: '' },
    { name: '', content: '(2) 분명한 계절(4계절) 정상적인 기후변화', rationale: '' },
    { name: '', content: '김혜인:', rationale: '' },
    { name: '', content: '(1) 대중교통이 편해짐', rationale: '' },
  ];
  const marks = nameOnlyRowIndexes(rows);
  must(marks.length === 2, `이름만 있는 행 ${marks.length}개 (기대 2)`);
  const lift = liftNameOnlyRows(rows);
  must(lift.applied, '옮기지 못했다');
  must(lift.rows.length === 3, `행수 ${lift.rows.length} (기대 3)`);
  must(lift.rows[0].name === '권민정' && lift.rows[1].name === '권민정', '내려 채우기가 한 행에서 멈췄다');
  must(lift.rows[2].name === '김혜인', '다음 이름으로 안 넘어갔다');
  must(lift.filled === 3 && lift.removed === 2, `filled ${lift.filled} removed ${lift.removed}`);
  // 본문은 한 글자도 안 바뀐다
  must(lift.rows[0].content === rows[1].content, '본문이 바뀌었다');
  return `이름행 2개 제거 · 본문 3행에 이름 채움 · 본문 무변경`;
});

check('★ 양식 잔재 「오프닝」을 이름으로 오인하지 않는다', () => {
  const rows = [{ name: '', content: '오프닝', rationale: '' }];
  must(nameOnlyRowIndexes(rows).length === 0, '「오프닝」을 이름행으로 봤다');
  const lift = liftNameOnlyRows(rows);
  must(!lift.applied && lift.rows === rows, '건드렸다');
  return '장식(괄호·콜론) 없는 홑단어는 이름행이 아니다';
});

check('★ 이름 칸만 채우고 본문이 빈 행도 같은 안내로 잡는다 (조용한 유실 방지)', () => {
  const rows = [
    { name: '홍길동', content: '', rationale: '' },
    { name: '', content: '', rationale: '' },
  ];
  const marks = nameOnlyRowIndexes(rows);
  must(marks.length === 1 && marks[0].index === 0 && marks[0].inBody === false, JSON.stringify(marks));
  must(toSaveItems(rows).length === 0, '저장되면 안 되는 행이 저장된다');
  // 빈 행은 지우지 않는다 — 이름행 제거 대상은 본문이 이름뿐인 행만이다
  must(!liftNameOnlyRows(rows).applied, '빈 행을 건드렸다');
  return '이름만 있는 행 1건 감지 · 빈 여분 칸은 무시';
});

// ── ⑥ 초안(sessionStorage) 왕복 — dropDraft 와 같은 계열의 함정 ──
check('★ dirty 판정이 이름 칸을 본다 (이름만 고쳐도 저장 버튼이 켜진다)', () => {
  const base = [{ name: '', content: '내용', rationale: '' }];
  const edited = [{ name: '홍길동', content: '내용', rationale: '' }];
  must(isDirty(edited, base), '이름만 바꿨는데 dirty 가 안 선다 — 이름이 조용히 사라진다');
  must(!isDirty(base, base), '같은 값인데 dirty 가 선다');
  return 'isDirty(name) 반영됨';
});

check('★ 초안 복원이 이름 칸을 싣고 돌아온다', () => {
  const server = [{ name: '', content: '서버 내용', rationale: '' }];
  const draft = [{ name: '홍길동', content: '쓰던 내용', rationale: '' }];
  const back = pickRestoredRows(JSON.stringify(draft), server);
  must(back != null, '초안을 못 살렸다');
  must(back[0].name === '홍길동', `이름이 안 왔다: ${JSON.stringify(back[0])}`);
  must(back[0].content === '쓰던 내용', '본문이 안 왔다');
  // 저장을 마쳐 서버와 같아지면 되살리지 않는다(낡은 초안 방지)
  must(pickRestoredRows(JSON.stringify(server), server) === null, '같은 값인데 되살렸다');
  return '이름·본문 모두 복원 · 서버와 같으면 복원 안 함';
});

check('★ 이름 칸이 생기기 전의 옛 초안도 안전하게 연다 (name 없음 → 빈 문자열)', () => {
  const old = JSON.stringify([{ content: '옛 초안', rationale: '' }]); // name 필드가 없다
  const back = pickRestoredRows(old, [emptyRow()]);
  must(back != null, '옛 초안을 못 살렸다');
  must(back[0].name === '', `name 이 ${JSON.stringify(back[0].name)} — controlled input 이 깨진다`);
  return "옛 모양 {content, rationale} → name:''";
});

check('★ 붙여넣기 분해가 이름 칸을 함께 채운다 (저장 전후 화면이 같다)', () => {
  const text = '- (박서준) 환경교육이 지루하다.\n(윤하은) 일회용이 많다.\n최삼관: 재활용률이 낮다.';
  const out = splitPastedRows([emptyRow()], 0, text);
  must(out.applied && out.rows.length === 3, `분해 실패 ${out.rows.length}행`);
  must(out.rows.map((r) => r.name).join(',') === '박서준,윤하은,최삼관', out.rows.map((r) => r.name).join(','));
  must(out.rows[0].content === '환경교육이 지루하다.', out.rows[0].content);
  // 저장 → 서버 → 다시 읽기와 화면이 같아야 한다
  const round = rowsFromItems(toSaveItems(out.rows).map((it) => ({ ...it, rationale: null })));
  must(
    JSON.stringify(round.map((r) => [r.name, r.content])) ===
      JSON.stringify(out.rows.map((r) => [r.name, r.content])),
    '저장 왕복에서 화면이 달라진다',
  );
  return '3행 · 이름 3개 · 저장 왕복 동일';
});

// ── ⑦ §4-6 양식 머리말이 화면에서 들어가는 경로가 없다 ────────────
/** 주석을 뺀 코드 본문 — 주석에 적힌 「양식 잔재 예시」를 잔재로 오인하지 않기 위해서다. */
const withoutComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

check('★ 초기 행·placeholder 에 양식 머리말이 없다', () => {
  const panel = withoutComments(readFileSync(resolve(HERE, '../src/islands/mod/SubmissionPanel.tsx'), 'utf8'));
  const logic = withoutComments(readFileSync(LOGIC, 'utf8'));
  const e = emptyRow();
  must(e.name === '' && e.content === '' && e.rationale === '', `초기 행이 비어 있지 않다: ${JSON.stringify(e)}`);
  must(rowsFromItems([]).length === 1 && rowsFromItems([])[0].content === '', '빈 제출물의 첫 행이 비어 있지 않다');
  for (const bad of ['시민참여단 발표', '템플릿에 정리', '의견정리(', '오프닝', '의제1.']) {
    must(!panel.includes(bad), `SubmissionPanel 에 양식 잔재: ${bad}`);
    must(!logic.includes(bad), `logic 에 양식 잔재: ${bad}`);
  }
  const ph = [...panel.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
  must(ph.length > 0, 'placeholder 를 못 찾았다');
  for (const p of ph) must(!/^\s*\d+[.)]/.test(p), `번호 매긴 양식이 placeholder 에 있다: ${p}`);
  return `초기 행 3칸 전부 빈 문자열 · placeholder ${ph.length}개(${ph.join(' / ')}) 전부 무해`;
});

// ── ⑧ 안내문 ↔ 화면 문구 대조 ──────────────────────────────────
check('★ 조 안내문(mod-help/team)의 인용 문구가 화면에 실제로 있다', () => {
  const help = readFileSync(resolve(HERE, '../src/pages/mod-help/team.astro'), 'utf8');
  const panel = readFileSync(resolve(HERE, '../src/islands/mod/SubmissionPanel.tsx'), 'utf8');
  const logic = readFileSync(LOGIC, 'utf8');
  const guide = readFileSync(resolve(HERE, '../src/islands/mod/submission-guide.ts'), 'utf8');
  // JSX 는 「＋ 한 줄 더」처럼 한 문장을 태그로 쪼개 놓는다 — 태그를 걷고 공백을 줄여 맞춘다.
  const flatten = (t) => t.replace(/<[^>]*>/g, '').replace(/[{}]/g, '').replace(/s+/g, ' ');
  const screen = flatten(panel) + flatten(logic) + flatten(guide);
  /** 안내문이 「이렇게 보인다」고 적은 화면 문구 — 하나라도 화면에 없으면 안내가 거짓이 된다. */
  const QUOTED = [
    '＋ 한 줄 더',
    '최종 제출됨 · 잠금',
    '재오픈됨 · 다시 편집 가능',
    '다시 열기',
    '더 다듬기',
    '화면이 갱신되었습니다',
    '여러 분 말씀이 한 칸에 들어간 것 같습니다',
    '줄 단위로 나누기',
    '이대로 두기',
    '저장하지 않은 변경이 있습니다',
    '이름만 있는 줄',
    '이름 칸으로 옮기기',
    '최종 제출하면 잠깁니다. 잘못 눌렀다면 「다시 열기」로 바로 풀 수 있습니다.',
    '지금 화면의 내용',
  ];
  const helpFlat = flatten(help);
  const missing = QUOTED.filter((q) => helpFlat.includes(q) && !screen.includes(q));
  must(missing.length === 0, `안내문에만 있고 화면에 없는 문구: ${missing.join(' / ')}`);
  const notQuoted = QUOTED.filter((q) => !helpFlat.includes(q));
  must(notQuoted.length === 0, `안내문이 인용하지 않은 화면 문구: ${notQuoted.join(' / ')}`);
  return `${QUOTED.length}/${QUOTED.length} 문구가 안내문·화면 양쪽에 있다`;
});

check('★ 안내문에서 없어진 화면의 흔적이 지워졌다', () => {
  const help = readFileSync(resolve(HERE, '../src/pages/mod-help/team.astro'), 'utf8');
  const panel = readFileSync(resolve(HERE, '../src/islands/mod/SubmissionPanel.tsx'), 'utf8');
  const gone = ['주제 탭', '＋ 의견 추가', '근거(선택)', '근거를 덧붙일'];
  const left = gone.filter((g) => help.includes(g));
  must(left.length === 0, `화면에 없는 것을 안내문이 설명한다: ${left.join(' / ')}`);
  must(!panel.includes('근거 (선택)') || panel.includes('없애기로'), '화면에 근거 칸이 살아 있다');
  return `없어진 요소 ${gone.length}건 전부 안내문에서 제거됨`;
});

console.log(`\n결과: ${pass} PASS · ${fail} FAIL  (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
