import { describe, expect, it } from 'vitest';
import {
  BALLOT_SCALES,
  MAX_BALLOT_ITEMS,
  MAX_STATEMENT_LENGTH,
  MAX_TITLE_LENGTH,
  ballotStatusLabel,
  ballotUrl,
  canTransition,
  distRows,
  primaryAction,
  scaleLabel,
  validateBallotForm,
  type BallotFormItem,
} from './ballot-panel-logic';
import type { BallotStatus } from '../../lib/deliberation';

const ALL_STATUSES: BallotStatus[] = ['draft', 'open', 'closed', 'published', 'archived'];

describe('canTransition — 전이 가드(역행 불가)', () => {
  it('정순 전이는 전부 허용한다 (draft→open→closed→published→archived)', () => {
    expect(canTransition('draft', 'open')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(true);
    expect(canTransition('closed', 'published')).toBe(true);
    expect(canTransition('published', 'archived')).toBe(true);
  });

  it('앞으로 건너뛰는 전이도 RPC 규칙대로 허용한다', () => {
    expect(canTransition('draft', 'closed')).toBe(true);
    expect(canTransition('draft', 'published')).toBe(true);
    expect(canTransition('open', 'published')).toBe(true);
  });

  it('역행은 모두 거부한다 — 마감 후 재개 불가', () => {
    expect(canTransition('closed', 'open')).toBe(false);
    expect(canTransition('published', 'closed')).toBe(false);
    expect(canTransition('published', 'open')).toBe(false);
    expect(canTransition('archived', 'published')).toBe(false);
  });

  it('제자리 전이와 draft로의 회귀는 거부한다', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
      expect(canTransition(status, 'draft')).toBe(false);
    }
  });

  it('미지의 상태 값은 거부한다', () => {
    expect(canTransition('draft', 'unknown' as BallotStatus)).toBe(false);
    expect(canTransition('unknown' as BallotStatus, 'open')).toBe(false);
  });
});

describe('primaryAction — 콘솔의 다음 한 걸음', () => {
  it('draft→투표 시작, open→마감, closed→결과 공개', () => {
    expect(primaryAction('draft')?.to).toBe('open');
    expect(primaryAction('open')?.to).toBe('closed');
    expect(primaryAction('closed')?.to).toBe('published');
  });

  it('published·archived에는 운영 버튼이 없다', () => {
    expect(primaryAction('published')).toBeNull();
    expect(primaryAction('archived')).toBeNull();
  });

  it('제시하는 전이는 항상 canTransition을 통과한다 (가드 정합성)', () => {
    for (const status of ALL_STATUSES) {
      const action = primaryAction(status);
      if (action) expect(canTransition(status, action.to)).toBe(true);
    }
  });

  it('마감 확인 문구는 재개 불가를 못박는다', () => {
    expect(primaryAction('open')?.confirm).toContain('재개할 수 없습니다');
  });

  it('결과 공개 확인 문구는 되돌릴 수 없음을 못박는다', () => {
    expect(primaryAction('closed')?.confirm).toContain('되돌릴 수 없습니다');
  });
});

describe('validateBallotForm — 생성 폼 검증', () => {
  const item = (statement: string, scale = 5): BallotFormItem => ({ statement, scale: scale as BallotFormItem['scale'] });

  it('정상 폼은 ordinal 1부터의 p_items 페이로드를 만든다', () => {
    const result = validateBallotForm('  폐회 투표  ', [item(' 의제 A '), item('의제 B', 7)]);
    expect(result).toEqual({
      ok: true,
      title: '폐회 투표',
      items: [
        { ordinal: 1, statement: '의제 A', scale: 5, required: true },
        { ordinal: 2, statement: '의제 B', scale: 7, required: true },
      ],
    });
  });

  it('제목이 비면 거부한다', () => {
    const result = validateBallotForm('   ', [item('의제')]);
    expect(result.ok).toBe(false);
  });

  it('제목이 200자를 넘으면 거부한다', () => {
    const result = validateBallotForm('가'.repeat(MAX_TITLE_LENGTH + 1), [item('의제')]);
    expect(result.ok).toBe(false);
  });

  it('의제 0개는 거부한다', () => {
    expect(validateBallotForm('제목', []).ok).toBe(false);
  });

  it('의제 20개까지는 허용, 21개는 거부한다', () => {
    const twenty = Array.from({ length: MAX_BALLOT_ITEMS }, (_, i) => item(`의제 ${i + 1}`));
    expect(validateBallotForm('제목', twenty).ok).toBe(true);
    expect(validateBallotForm('제목', [...twenty, item('초과')]).ok).toBe(false);
  });

  it('빈 문장은 몇 번째 줄인지 짚어 거부한다', () => {
    const result = validateBallotForm('제목', [item('의제 1'), item('   ')]);
    expect(result).toEqual({ ok: false, error: '2번 의제 문장을 입력해 주세요.' });
  });

  it('문장이 300자를 넘으면 거부한다', () => {
    const result = validateBallotForm('제목', [item('가'.repeat(MAX_STATEMENT_LENGTH + 1))]);
    expect(result.ok).toBe(false);
  });

  it('척도는 2·4·5·7만 허용한다', () => {
    expect(validateBallotForm('제목', [item('의제', 3)]).ok).toBe(false);
    for (const scale of BALLOT_SCALES) {
      expect(validateBallotForm('제목', [item('의제', scale)]).ok).toBe(true);
    }
  });
});

describe('ballotUrl — 참가자 진입 URL', () => {
  it('/b?t=<token> 형태를 만든다', () => {
    expect(ballotUrl('https://climate-assembly.org', 'abc123')).toBe('https://climate-assembly.org/b?t=abc123');
  });
});

describe('distRows — 결과 분포 완결성', () => {
  it('응답이 없는 값도 1..scale 전 구간을 0으로 채워 낸다', () => {
    const rows = distRows(5, { '2': 3, '5': 1 });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.value)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.count)).toEqual([0, 3, 0, 0, 1]);
  });

  it('pct 분모는 해당 문항의 응답 수다', () => {
    const rows = distRows(2, { '1': 1, '2': 3 });
    expect(rows.map((r) => r.pct)).toEqual([25, 75]);
  });

  it('응답 0건이면 전 구간 pct 0', () => {
    const rows = distRows(7, {});
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });

  it('dist가 null/undefined여도 깨지지 않는다', () => {
    expect(distRows(4, null)).toHaveLength(4);
    expect(distRows(4, undefined)).toHaveLength(4);
  });

  it('척도 밖(1..scale 외) 키는 무시한다', () => {
    const rows = distRows(2, { '1': 1, '9': 100 });
    expect(rows.map((r) => r.count)).toEqual([1, 0]);
    expect(rows[0].pct).toBe(100);
  });
});

describe('라벨', () => {
  it('상태 라벨 한국어', () => {
    expect(ballotStatusLabel('draft')).toBe('초안');
    expect(ballotStatusLabel('open')).toBe('진행 중');
    expect(ballotStatusLabel('closed')).toBe('마감됨');
    expect(ballotStatusLabel('published')).toBe('결과 공개됨');
  });

  it('척도 라벨 — 2점은 찬반으로 읽는다', () => {
    expect(scaleLabel(2)).toBe('찬반(2점)');
    expect(scaleLabel(7)).toBe('7점 척도');
  });
});
