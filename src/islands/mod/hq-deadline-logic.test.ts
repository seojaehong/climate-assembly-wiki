import { describe, expect, it } from 'vitest';
import {
  deadlineEchoLabel,
  deadlineFailureMessage,
  deadlineView,
  describeRpcError,
  isoToLocalInput,
  localInputToIso,
  planDeadline,
  serverDeadlineMap,
} from './hq-deadline-logic';

/**
 * ★ 이 파일은 **어느 시간대에서 돌려도** 같은 결과를 내야 한다. CI·개발자 기기·행사장
 *   노트북의 TZ 가 제각각이라 「14:30 이면 05:30Z」처럼 KST 를 박으면 다른 기기에서 깨진다.
 *   그래서 기대값을 하드코딩하지 않고 **로컬 성분 → Date → 같은 순간인가**로 검사한다.
 *
 * 날짜는 행사일(2026-09-12)로 잡았다. 3월 2시대는 서머타임 시행국에서 존재하지 않는
 * 시각이라 그런 값을 고르면 검사 자체가 기기 의존이 된다.
 */
const EVENT_LOCAL = '2026-09-12T14:30';
const EVENT_MS = new Date(2026, 8, 12, 14, 30, 0, 0).getTime();

describe('localInputToIso', () => {
  it('datetime-local 값을 기기 로컬 시각으로 읽어 같은 순간의 ISO 를 낸다', () => {
    const iso = localInputToIso(EVENT_LOCAL);
    expect(iso).not.toBeNull();
    expect(Date.parse(iso as string)).toBe(EVENT_MS);
  });

  it('ISO 는 UTC 표기(Z)로 낸다 — timestamptz 컬럼이 서버 시간대로 읽지 않도록', () => {
    expect(localInputToIso(EVENT_LOCAL)).toMatch(/Z$/);
  });

  it('초가 붙은 값도 읽는다', () => {
    const iso = localInputToIso('2026-09-12T14:30:45');
    expect(Date.parse(iso as string)).toBe(new Date(2026, 8, 12, 14, 30, 45, 0).getTime());
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(localInputToIso(`  ${EVENT_LOCAL}  `)).toBe(localInputToIso(EVENT_LOCAL));
  });

  it('빈 값·형식이 다른 값은 null', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-09-12')).toBeNull();
    expect(localInputToIso('2026/09/12 14:30')).toBeNull();
    expect(localInputToIso('내일 오후 2시')).toBeNull();
  });

  it('달을 넘겨 굴러가는 날짜는 받지 않는다 — 2026-02-31 이 3월 3일이 되면 안 된다', () => {
    expect(localInputToIso('2026-02-31T14:30')).toBeNull();
    expect(localInputToIso('2026-13-01T14:30')).toBeNull();
    expect(localInputToIso('2026-09-12T25:00')).toBeNull();
  });
});

describe('isoToLocalInput', () => {
  it('로컬 값 → ISO → 로컬 값 왕복이 원래 값과 같다', () => {
    expect(isoToLocalInput(localInputToIso(EVENT_LOCAL))).toBe(EVENT_LOCAL);
  });

  it('0 을 채워 두 자리로 낸다', () => {
    const iso = new Date(2026, 0, 5, 9, 7, 0, 0).toISOString();
    expect(isoToLocalInput(iso)).toBe('2026-01-05T09:07');
  });

  it('없거나 못 읽는 값은 빈 문자열 — 입력칸을 비운다', () => {
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput(undefined)).toBe('');
    expect(isoToLocalInput('')).toBe('');
    expect(isoToLocalInput('알 수 없음')).toBe('');
  });
});

describe('planDeadline', () => {
  it('걸기 — 입력값을 ISO 로 바꿔 보낸다', () => {
    const plan = planDeadline('set', EVENT_LOCAL);
    expect(plan.kind).toBe('set');
    expect(Date.parse((plan as { deadlineAt: string }).deadlineAt)).toBe(EVENT_MS);
  });

  it('지우기 — null 을 보낸다', () => {
    expect(planDeadline('clear', EVENT_LOCAL)).toEqual({ kind: 'clear', deadlineAt: null });
  });

  it('★ 지우기는 입력칸을 보지 않는다 — 비어 있어도 되돌릴 수 있어야 한다', () => {
    expect(planDeadline('clear', '')).toEqual({ kind: 'clear', deadlineAt: null });
    expect(planDeadline('clear', '엉터리')).toEqual({ kind: 'clear', deadlineAt: null });
  });

  it('빈 입력으로 걸기 — 보내지 않고 지우기를 안내한다', () => {
    const plan = planDeadline('set', '   ');
    expect(plan.kind).toBe('reject');
    expect((plan as { message: string }).message).toContain('지우기');
  });

  it('못 읽는 입력으로 걸기 — 무엇을 못 읽었는지 문구에 남긴다', () => {
    const plan = planDeadline('set', '2026-02-31T14:30');
    expect(plan.kind).toBe('reject');
    expect((plan as { message: string }).message).toContain('2026-02-31T14:30');
  });

  it('지난 시각도 받는다 — 마감은 잠금이 아니라 표시다', () => {
    expect(planDeadline('set', '2020-01-01T09:00').kind).toBe('set');
  });
});

describe('describeRpcError', () => {
  it('Error 는 message 를 쓴다', () => {
    expect(describeRpcError(new Error('PGRST202: 함수 없음'))).toBe('PGRST202: 함수 없음');
  });

  it('★ PostgREST 평범한 객체에서도 코드와 문구를 꺼낸다', () => {
    expect(describeRpcError({ code: 'PGRST202', message: 'function not found' })).toBe(
      'PGRST202: function not found'
    );
  });

  it('message 가 없으면 details·hint 순으로 본다', () => {
    expect(describeRpcError({ code: '42883', details: '인자 불일치' })).toBe('42883: 인자 불일치');
    expect(describeRpcError({ hint: '토큰을 확인하세요' })).toBe('토큰을 확인하세요');
  });

  it('문자열도 그대로 읽는다', () => {
    expect(describeRpcError('네트워크 끊김')).toBe('네트워크 끊김');
  });

  it('아무것도 못 읽으면 기본 문구', () => {
    expect(describeRpcError(null)).toBe('원인을 알 수 없습니다');
    expect(describeRpcError(undefined)).toBe('원인을 알 수 없습니다');
    expect(describeRpcError(0)).toBe('원인을 알 수 없습니다');
  });

  it('코드도 문구도 없는 객체는 원본을 JSON 으로 남긴다 — 진단 실마리를 버리지 않는다', () => {
    expect(describeRpcError({})).toBe('{}');
    expect(describeRpcError({ status: 500 })).toBe('{"status":500}');
  });

  it('순환 참조가 있어도 죽지 않는다', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeRpcError(circular)).toBe('원인을 알 수 없습니다');
  });
});

describe('deadlineFailureMessage', () => {
  it('걸기 실패와 지우기 실패를 다른 문구로 낸다', () => {
    expect(deadlineFailureMessage('set', new Error('x'))).toContain('걸지 못했습니다');
    expect(deadlineFailureMessage('clear', new Error('x'))).toContain('지우지 못했습니다');
  });

  it('★ 서버가 준 코드가 문구에 남는다 — s17 미적용이면 PGRST202 가 보여야 한다', () => {
    const message = deadlineFailureMessage('set', {
      code: 'PGRST202',
      message: 'Could not find the function',
    });
    expect(message).toContain('PGRST202');
    expect(message).toContain('Could not find the function');
  });
});

describe('deadlineEchoLabel', () => {
  it('아직 안 건드렸으면 그렇게 말한다 — 서버의 현재값인 척하지 않는다', () => {
    expect(deadlineEchoLabel(undefined)).toContain('아직');
  });

  it('지웠으면 지웠다고 말한다', () => {
    expect(deadlineEchoLabel(null)).toContain('지웠습니다');
  });

  it('건 시각을 로컬 벽시계로 되비춘다', () => {
    const iso = localInputToIso(EVENT_LOCAL) as string;
    expect(deadlineEchoLabel(iso)).toContain('2026-09-12 14:30');
  });
});

// ── 서버 되읽기 (s19) ─────────────────────────────────────────────────
// 「본부가 새로고침하면 자기가 무엇을 걸었는지 모른다」가 이 story 가 고친 결함이다.
// 여기서 못 박는 것은 두 가지 — ① 서버 값을 읽었으면 그것을 보여준다
// ② **못 읽었으면 s19 이전과 글자 하나까지 같은 화면으로 퇴화한다.**

describe('serverDeadlineMap', () => {
  it('행을 꼭지 id 맵으로 접는다 — null 은 「마감 없음」으로 그대로 남는다', () => {
    const map = serverDeadlineMap([
      { topic_id: 't1', deadline_at: '2026-09-12T05:30:00+00:00' },
      { topic_id: 't2', deadline_at: null },
    ]);
    expect(map).toEqual({ t1: '2026-09-12T05:30:00+00:00', t2: null });
  });

  it('반환에 없는 꼭지는 맵에도 없다 — 그 꼭지는 「마감 없음」이 아니라 「모름」이다', () => {
    const map = serverDeadlineMap([{ topic_id: 't1', deadline_at: null }]);
    expect(Object.prototype.hasOwnProperty.call(map, 't1')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(map, 't9')).toBe(false);
  });

  it('빈 배열은 빈 맵이다 — 「읽었는데 꼭지가 없다」와 「못 읽었다(null)」는 다르다', () => {
    expect(serverDeadlineMap([])).toEqual({});
  });
});

describe('deadlineView', () => {
  const ISO = localInputToIso(EVENT_LOCAL) as string;

  it('★ 서버 값을 읽었으면 그 시각을 로컬 벽시계로 보여준다 (source=server)', () => {
    const view = deadlineView({ t1: ISO }, 't1', undefined);
    expect(view.source).toBe('server');
    expect(view.label).toContain('2026-09-12 14:30');
    expect(view.label).toContain('현재 마감');
  });

  it('서버가 null 이면 「현재 마감 없음」 — 「모름」과 다른 말이다', () => {
    expect(deadlineView({ t1: null }, 't1', undefined)).toEqual({
      label: '현재 마감 없음',
      source: 'server',
    });
  });

  it('★ 서버 값이 이 화면의 마지막 조작을 이긴다 — 남이 건 마감이 보여야 한다', () => {
    const other = new Date(2026, 8, 12, 16, 0, 0, 0).toISOString();
    const view = deadlineView({ t1: other }, 't1', ISO);
    expect(view.source).toBe('server');
    expect(view.label).toContain('16:00');
    expect(view.label).not.toContain('14:30');
  });

  it('★★ s19 미적용(맵이 null) — s19 이전 문구 그대로 퇴화한다', () => {
    expect(deadlineView(null, 't1', undefined)).toEqual({
      label: deadlineEchoLabel(undefined),
      source: 'unknown',
    });
    expect(deadlineView(null, 't1', null)).toEqual({
      label: deadlineEchoLabel(null),
      source: 'local',
    });
    expect(deadlineView(null, 't1', ISO)).toEqual({
      label: deadlineEchoLabel(ISO),
      source: 'local',
    });
  });

  it('맵은 있는데 그 꼭지가 없으면 그 꼭지만 모름이다', () => {
    const view = deadlineView({ t1: ISO }, 't2', undefined);
    expect(view.source).toBe('unknown');
    expect(view.label).toBe(deadlineEchoLabel(undefined));
  });

  it('서버가 읽을 수 없는 값을 주면 시각을 지어내지 않는다', () => {
    const view = deadlineView({ t1: '읽을 수 없는 값' }, 't1', undefined);
    expect(view.source).toBe('server');
    expect(view.label).toContain('읽을 수 없습니다');
  });
});
