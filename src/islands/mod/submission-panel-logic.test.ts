import { describe, expect, it } from 'vitest';
import {
  FINALIZE_CONFIRM_MESSAGE,
  MAX_SUBMISSION_ROWS,
  addRow,
  canFinalize,
  emptyRow,
  isDirty,
  isEditable,
  moveRow,
  removeRow,
  rowsFromItems,
  submissionBadge,
  toSaveItems,
  type EditorRow,
  pickRestoredRows,
  parseSpeaker,
  joinSpeaker,
  nameOnlyRowIndexes,
  liftNameOnlyRows,
} from './submission-panel-logic';
import type { SubmissionItem } from '../../lib/deliberation';
import { DRAFT_TTL_MS, writeDraft } from './submission-draft-store';

const row = (content: string, rationale = '', name = ''): EditorRow => ({ name, content, rationale });

describe('isEditable — 잠금 판정', () => {
  it('제출물 없음(null)·draft·reopened는 편집 가능', () => {
    expect(isEditable(null)).toBe(true);
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('reopened')).toBe(true);
  });

  it('final(잠금)·archived는 편집 불가', () => {
    expect(isEditable('final')).toBe(false);
    expect(isEditable('archived')).toBe(false);
  });
});

describe('rowsFromItems — 서버 항목 → 편집 행', () => {
  it('ordinal 순으로 정렬하고 rationale null은 빈 문자열로 바꾼다', () => {
    const items: SubmissionItem[] = [
      { ordinal: 2, kind: 'core', content: '두 번째', rationale: null },
      { ordinal: 1, kind: 'core', content: '첫 번째', rationale: '근거' },
    ];
    expect(rowsFromItems(items)).toEqual([row('첫 번째', '근거'), row('두 번째')]);
  });

  it('항목이 없으면 빈 행 1개로 시작한다', () => {
    expect(rowsFromItems([])).toEqual([emptyRow()]);
  });
});

describe('toSaveItems — 저장 페이로드', () => {
  it('빈 내용 행을 버리고 ordinal을 1부터 다시 매긴다', () => {
    const items = toSaveItems([row('  '), row(' 의견 A ', ' 근거 A '), row(''), row('의견 B')]);
    expect(items).toEqual([
      { ordinal: 1, kind: 'core', content: '의견 A', rationale: '근거 A' },
      { ordinal: 2, kind: 'core', content: '의견 B', rationale: null },
    ]);
  });

  it('빈 rationale은 null로 보낸다', () => {
    expect(toSaveItems([row('의견', '   ')])[0].rationale).toBeNull();
  });

  it('전부 빈 행이면 빈 배열 (저장은 가능하나 최종 제출은 불가)', () => {
    expect(toSaveItems([emptyRow(), emptyRow()])).toEqual([]);
  });
});

describe('canFinalize — 최종 제출 게이트', () => {
  it('편집 가능 + 내용 1건 이상이어야 한다', () => {
    expect(canFinalize([row('의견')], null)).toBe(true);
    expect(canFinalize([row('의견')], 'draft')).toBe(true);
    expect(canFinalize([row('의견')], 'reopened')).toBe(true);
  });

  it('빈 제출은 막는다 (RPC의 cannot finalize empty와 동일)', () => {
    expect(canFinalize([emptyRow()], 'draft')).toBe(false);
    expect(canFinalize([row('   ')], 'draft')).toBe(false);
  });

  it('final 상태에서는 내용이 있어도 막는다', () => {
    expect(canFinalize([row('의견')], 'final')).toBe(false);
  });
});

describe('행 조작', () => {
  it('addRow — 빈 행을 뒤에 붙이고 상한(30)에서 멈춘다', () => {
    expect(addRow([row('a')])).toHaveLength(2);
    const full = Array.from({ length: MAX_SUBMISSION_ROWS }, (_, i) => row(`r${i}`));
    expect(addRow(full)).toBe(full);
  });

  it('removeRow — 지정 행을 지우고, 마지막 한 행은 지우는 대신 비운다', () => {
    expect(removeRow([row('a'), row('b')], 0)).toEqual([row('b')]);
    expect(removeRow([row('a')], 0)).toEqual([emptyRow()]);
  });

  it('removeRow — 범위 밖 인덱스는 무시한다', () => {
    const rows = [row('a'), row('b')];
    expect(removeRow(rows, -1)).toBe(rows);
    expect(removeRow(rows, 2)).toBe(rows);
  });

  it('moveRow — 위/아래로 자리를 바꾼다', () => {
    expect(moveRow([row('a'), row('b'), row('c')], 1, -1)).toEqual([row('b'), row('a'), row('c')]);
    expect(moveRow([row('a'), row('b'), row('c')], 1, 1)).toEqual([row('a'), row('c'), row('b')]);
  });

  it('moveRow — 경계 밖 이동은 그대로 둔다', () => {
    const rows = [row('a'), row('b')];
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 1, 1)).toBe(rows);
  });

  it('행 조작은 원본 배열을 변형하지 않는다', () => {
    const rows = [row('a'), row('b')];
    moveRow(rows, 0, 1);
    removeRow(rows, 0);
    addRow(rows);
    expect(rows).toEqual([row('a'), row('b')]);
  });
});

describe('isDirty — 저장 전 이탈 방어의 판정 기준', () => {
  it('내용·근거가 같으면 깨끗하다', () => {
    expect(isDirty([row('a', 'r')], [row('a', 'r')])).toBe(false);
  });

  it('내용 또는 근거가 다르면 더럽다', () => {
    expect(isDirty([row('a')], [row('b')])).toBe(true);
    expect(isDirty([row('a', 'x')], [row('a', 'y')])).toBe(true);
  });

  it('행 수가 다르면 더럽다', () => {
    expect(isDirty([row('a'), emptyRow()], [row('a')])).toBe(true);
  });
});

describe('submissionBadge — 상태 배지', () => {
  it('final은 잠금 배지', () => {
    expect(submissionBadge('final')).toEqual({ label: '최종 제출됨 · 잠금', tone: 'locked' });
  });

  it('reopened는 재오픈 배지', () => {
    expect(submissionBadge('reopened')).toEqual({ label: '재오픈됨 · 다시 편집 가능', tone: 'reopened' });
  });

  it('draft·없음은 배지를 달지 않는다', () => {
    expect(submissionBadge('draft')).toBeNull();
    expect(submissionBadge(null)).toBeNull();
  });
});

describe('확인 문구', () => {
  // 조 자체 재오픈(34b96da) 이후로 「본부만 연다」는 거짓이 됐다. 되살아나지 않게 못박는다.
  it('최종 제출 confirm은 조가 직접 다시 열 수 있음을 알린다', () => {
    expect(FINALIZE_CONFIRM_MESSAGE).toContain('다시 열기');
    expect(FINALIZE_CONFIRM_MESSAGE).not.toContain('본부');
  });
});

describe('pickRestoredRows — 탭을 옮겼다 와도 미저장분이 남는다', () => {
  const server: EditorRow[] = [{ name: '', content: '이미 저장한 줄', rationale: '' }];

  it('보관분이 서버와 다르면 그것을 되살린다', () => {
    const draft: EditorRow[] = [
      { name: '', content: '이미 저장한 줄', rationale: '' },
      { name: '', content: '아직 저장 안 한 줄', rationale: '' },
    ];
    expect(pickRestoredRows(JSON.stringify(draft), server)).toEqual(draft);
  });

  it('저장을 마쳐 서버와 같아지면 되살리지 않는다 — 낡은 초안이 되돌아오면 더 위험하다', () => {
    expect(pickRestoredRows(JSON.stringify(server), server)).toBeNull();
  });

  it('보관분이 없으면 서버 내용으로 연다', () => {
    expect(pickRestoredRows(null, server)).toBeNull();
  });

  it('깨진 값·빈 배열·모양이 다른 값은 무시한다', () => {
    expect(pickRestoredRows('{not json', server)).toBeNull();
    expect(pickRestoredRows('[]', server)).toBeNull();
    expect(pickRestoredRows('"문자열"', server)).toBeNull();
    expect(pickRestoredRows('[{"엉뚱":1}]', server)).toBeNull();
  });
});

// ── US-003 ── 초안 봉투(submission-draft-store)를 건너온 뒤에도 계약이 같다 ──
describe('pickRestoredRows — 봉투 모양·유효기간 (US-003 배선)', () => {
  const server: EditorRow[] = [row('이미 저장한 줄')];
  const draft: EditorRow[] = [row('이미 저장한 줄'), row('아직 저장 안 한 줄')];
  const NOW = 1_700_000_000_000;

  it('봉투(writeDraft 산물)를 그대로 되살린다', () => {
    const raw = writeDraft(draft, '2026-09-01T00:00:00Z', NOW);
    expect(pickRestoredRows(raw, server, NOW)).toEqual(draft);
  });

  it('★ 유효기간(72h)이 지난 봉투는 되살리지 않는다 — 지난 회차 글이 돌아오면 안 된다', () => {
    const raw = writeDraft(draft, null, NOW - DRAFT_TTL_MS - 1);
    expect(pickRestoredRows(raw, server, NOW)).toBeNull();
  });

  it('★ 경계(정확히 72h 전)는 아직 살아 있다', () => {
    const raw = writeDraft(draft, null, NOW - DRAFT_TTL_MS);
    expect(pickRestoredRows(raw, server, NOW)).toEqual(draft);
  });

  it('★ 옛 모양(배열 그대로)은 시각을 몰라도 만료로 보지 않는다 — 배포를 건너온 탭', () => {
    expect(pickRestoredRows(JSON.stringify(draft), server, NOW)).toEqual(draft);
  });

  it('봉투라도 서버와 같으면 되살리지 않는다', () => {
    expect(pickRestoredRows(writeDraft(server, null, NOW), server, NOW)).toBeNull();
  });

  it('nowMs 를 안 주면 지금 시각으로 판정한다 — 기존 호출부 계약 유지', () => {
    expect(pickRestoredRows(writeDraft(draft, null, Date.now()), server)).toEqual(draft);
  });
});

// ── 2026-08-30 ── 거짓 단언 끝내기 + 서버 분해 알림 ─────────────────

import { readFileSync } from 'node:fs';
import { saveOutcomeMessage } from './submission-panel-logic';

describe('★ 확인 문구는 화면에 실제로 나가는 것이어야 한다', () => {
  // 예전에는 이 상수를 **아무도 렌더하지 않았다.** 모달은 제 문자열을 따로 갖고 있었고,
  // 위 「확인 문구」 테스트는 화면에 안 나가는 것을 재고 있었다. 그 거짓 단언을 끝낸다.
  const panel = readFileSync(new URL('./SubmissionPanel.tsx', import.meta.url), 'utf8');

  it('모달이 상수를 그대로 렌더한다', () => {
    expect(panel).toContain('{FINALIZE_CONFIRM_MESSAGE}');
  });

  it('★ 같은 문장을 화면에 다시 적어 두지 않았다 (적으면 상수가 또 죽는다)', () => {
    expect(panel).not.toContain('최종 제출하면 잠깁니다. 잘못 눌렀다면');
  });

  it('조 안내문이 인용한 문장과 글자까지 같다', () => {
    // src/pages/mod-help/team.astro 가 이 문장을 그대로 인용한다. 갈라지면 조가 본
    // 화면과 안내문이 어긋난다.
    const help = readFileSync(new URL('../../pages/mod-help/team.astro', import.meta.url), 'utf8');
    expect(help).toContain(FINALIZE_CONFIRM_MESSAGE);
  });
});

describe('saveOutcomeMessage — 서버가 한 일을 조에게 알린다', () => {
  it('아무것도 안 나눴으면 평소 문구', () => {
    expect(saveOutcomeMessage({ split: 0 })).toContain('저장되었습니다');
    expect(saveOutcomeMessage(null)).toContain('저장되었습니다');
    expect(saveOutcomeMessage(undefined)).toContain('저장되었습니다');
  });

  it('옛 RPC(필드 없음)를 만나도 평소 문구로 돌아간다', () => {
    expect(saveOutcomeMessage({})).toContain('저장되었습니다');
  });

  it('서버가 나눴으면 늘어난 칸 수를 말한다', () => {
    expect(saveOutcomeMessage({ split: 12 })).toContain('12개 늘었습니다');
  });

  it(`★ 상한 초과로 못 나눴으면 그 사실과 다음 할 일을 말한다`, () => {
    const msg = saveOutcomeMessage({ split: 0, split_skipped_over_cap: true });
    expect(msg).toContain(`${MAX_SUBMISSION_ROWS}개를 넘어`);
    expect(msg).toContain('그대로 저장했습니다');
    expect(msg).toContain('다시 뜹니다'); // 뭘 하면 되는지
  });

  it('★ 상한 초과가 나눔 안내보다 우선한다', () => {
    expect(saveOutcomeMessage({ split: 5, split_skipped_over_cap: true })).toContain('넘어');
  });

  it('★ 저장 핸들러가 RPC 반환값을 실제로 읽는다 (버리면 알림 자체가 불가능)', () => {
    const panel = readFileSync(new URL('./SubmissionPanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('const result = await submissionSave(');
    expect(panel).toContain('setToast(saveOutcomeMessage(result))');
    expect(panel).toContain('result?.split_skipped_over_cap');
  });
});

// ── 이름 칸 (진단서 §4-4·5) ──────────────────────────────────────
//
// 8.29 실데이터 641건 전수 측정은 scripts/verify-name-reparse.mjs 가 한다
// (367건 뽑음 · 오탐 0 · 보류 45). 여기서는 규칙의 경계만 못 박는다.

describe('parseSpeaker — 되파싱은 좁게, 애매하면 안 건드린다', () => {
  it('세 형태를 뽑는다', () => {
    expect(parseSpeaker('(윤하은) 일회용 사용이 너무 많다.')).toEqual({
      name: '윤하은',
      body: '일회용 사용이 너무 많다.',
    });
    expect(parseSpeaker('- (박서준) 환경교육이 지루하다.')).toEqual({
      name: '박서준',
      body: '환경교육이 지루하다.',
    });
    expect(parseSpeaker('최삼관: 재활용률이 낮다.')).toEqual({
      name: '최삼관',
      body: '재활용률이 낮다.',
    });
  });

  it('★ 이름이 아닌 것은 뽑지 않고 원문을 그대로 돌려준다', () => {
    const keep = [
      '(촉진질문: 기업들이 움직이지 않는 이유는 무엇일까?)', // 닫는 괄호가 토큰 뒤에 없다
      '(1) 정주현 : 지금 사는 곳이 대학 오름촌에 있는데', // 번호가 앞에 붙었다 — 보류
      '(1) 기후문제로 인한 식재료 가격 변동이 없음.', // 토큰이 숫자
      '기타의견 : 중앙식 방식의 난방시설로 인한', // 4자 — 이름 상한 밖
      '1. 시민참여단 발표하고 템플릿에 정리된 내용 작성', // 양식 잔재
      '문제 및 배경(13:30~14:45)', // 콜론이 문장 안에 있다
    ];
    for (const s of keep) expect(parseSpeaker(s)).toEqual({ name: '', body: s });
  });

  it('★ 이름을 떼면 본문이 비는 줄은 건드리지 않는다 (그 줄이 사라지면 안 된다)', () => {
    expect(parseSpeaker('권민정:')).toEqual({ name: '', body: '권민정:' });
    expect(parseSpeaker('(권민정)')).toEqual({ name: '', body: '(권민정)' });
  });

  it('★ 아직 안 나뉜 통짜(줄바꿈 있음)는 건드리지 않는다', () => {
    const blob = '(윤하은) 첫 줄\n(박서준) 둘째 줄';
    expect(parseSpeaker(blob)).toEqual({ name: '', body: blob });
  });
});

describe('joinSpeaker — 저장 형식은 `(이름) 내용` 하나뿐', () => {
  it('이름 칸의 괄호·콜론·글머리표를 다듬어 합친다', () => {
    for (const raw of ['홍길동', '(홍길동)', '홍길동:', '- 홍길동', ' 홍길동 ']) {
      expect(joinSpeaker(raw, '한 말')).toBe('(홍길동) 한 말');
    }
  });
  it('이름이 비면 본문만, 본문이 비면 아무것도 저장하지 않는다', () => {
    expect(joinSpeaker('', '한 말')).toBe('한 말');
    expect(joinSpeaker('홍길동', '  ')).toBe('');
  });
  it('★ 되파싱 → 합치기 왕복이 멱등이다', () => {
    const once = joinSpeaker(...(({ name, body }) => [name, body] as const)(parseSpeaker('최삼관: 재활용률이 낮다.')));
    expect(once).toBe('(최삼관) 재활용률이 낮다.');
    const twice = joinSpeaker(...(({ name, body }) => [name, body] as const)(parseSpeaker(once)));
    expect(twice).toBe(once);
  });
});

describe('rowsFromItems / toSaveItems — 화면과 DB 사이', () => {
  const item = (content: string): SubmissionItem =>
    ({ ordinal: 1, kind: 'core', content, rationale: null }) as SubmissionItem;

  it('불러오면 이름 칸이 채워지고, 저장하면 다시 합쳐진다', () => {
    const rows = rowsFromItems([item('- (임효은) 기업은 이윤을 추구한다.')]);
    expect(rows[0].name).toBe('임효은');
    expect(rows[0].content).toBe('기업은 이윤을 추구한다.');
    expect(toSaveItems(rows)[0].content).toBe('(임효은) 기업은 이윤을 추구한다.');
  });

  it('★ 이름 칸만 채우고 본문이 빈 행은 저장되지 않는다', () => {
    expect(toSaveItems([{ name: '홍길동', content: '', rationale: '' }])).toEqual([]);
  });
});

describe('isDirty / pickRestoredRows — 이름 칸이 초안을 건너 살아온다', () => {
  it('★ 이름만 고쳐도 dirty 가 선다 (안 그러면 저장 버튼이 안 켜져 이름이 사라진다)', () => {
    expect(isDirty([row('내용', '', '홍길동')], [row('내용')])).toBe(true);
  });
  it('★ 초안 복원이 이름 칸을 싣고 온다', () => {
    const back = pickRestoredRows(JSON.stringify([row('쓰던 내용', '', '홍길동')]), [row('서버 내용')]);
    expect(back?.[0]).toEqual({ name: '홍길동', content: '쓰던 내용', rationale: '' });
  });
  it('★ 이름 칸이 생기기 전의 옛 초안도 연다 (name 없음 → 빈 문자열)', () => {
    const old = JSON.stringify([{ content: '옛 초안', rationale: '' }]);
    expect(pickRestoredRows(old, [emptyRow()])?.[0]).toEqual({
      name: '',
      content: '옛 초안',
      rationale: '',
    });
  });
});

describe('nameOnlyRowIndexes / liftNameOnlyRows — 유형 C (§4-5)', () => {
  it('★ 8.29 1분과 2조 모양을 잡아 아래로 내려 채운다', () => {
    const rows = [
      row('권민정:'),
      row('(1) 기후문제로 인한 식재료 가격 변동이 없음.'),
      row('(2) 분명한 계절(4계절) 정상적인 기후변화'),
      row('김혜인:'),
      row('(1) 대중교통이 편해짐'),
    ];
    expect(nameOnlyRowIndexes(rows).map((m) => m.index)).toEqual([0, 3]);
    const out = liftNameOnlyRows(rows);
    expect(out.rows.map((r) => r.name)).toEqual(['권민정', '권민정', '김혜인']);
    expect(out.rows.map((r) => r.content)).toEqual([rows[1].content, rows[2].content, rows[4].content]);
    expect([out.filled, out.removed]).toEqual([3, 2]);
  });

  it('★ 이미 제 이름을 가진 행에서 내려 채우기가 멈춘다', () => {
    const out = liftNameOnlyRows([row('권민정:'), row('가'), row('나', '', '김혜인'), row('다')]);
    expect(out.rows.map((r) => r.name)).toEqual(['권민정', '김혜인', '']);
  });

  it('★ 양식 잔재·홑단어는 이름 행이 아니다 (지우면 그 줄이 사라진다)', () => {
    for (const s of ['오프닝', '오셔서 느낀점.', '의제1. 기업이 온실가스를 감축하도록']) {
      expect(nameOnlyRowIndexes([row(s)])).toEqual([]);
    }
  });

  it('★ 이름 칸만 채우고 본문이 빈 행도 같은 안내로 잡는다 (조용한 유실 방지)', () => {
    const marks = nameOnlyRowIndexes([row('', '', '홍길동'), emptyRow()]);
    expect(marks).toEqual([{ index: 0, name: '홍길동', inBody: false }]);
  });

  it('빈 편집기를 만들지 않는다', () => {
    expect(liftNameOnlyRows([row('권민정:')]).rows).toEqual([emptyRow()]);
  });
});

describe('§4-6 양식 머리말이 입력칸에 미리 들어가는 경로가 없다', () => {
  it('★ 초기 행은 세 칸 모두 빈 문자열이다', () => {
    expect(emptyRow()).toEqual({ name: '', content: '', rationale: '' });
    expect(rowsFromItems([])).toEqual([emptyRow()]);
  });
  it('★ placeholder 에 번호 매긴 양식이 없다', () => {
    const panel = readFileSync(new URL('./SubmissionPanel.tsx', import.meta.url), 'utf8');
    const ph = [...panel.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
    expect(ph.length).toBeGreaterThan(0);
    for (const p of ph) expect(p).not.toMatch(/^\s*\d+[.)]/);
  });
});
