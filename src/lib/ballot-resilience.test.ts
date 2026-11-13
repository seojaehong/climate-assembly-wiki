import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from './supabase';
import {
  BALLOT_LOAD_TIMEOUT_MS,
  BALLOT_SUBMIT_TIMEOUT_MS,
  BallotTimeoutError,
  ballotRetryDelayMs,
  fetchBallot,
  fetchBallotRoster,
  isTransientBallotError,
  submitBallotNamed,
} from './ballot';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

type Resp = { data: unknown; error: unknown; status?: number };

/** PostgREST 빌더 흉내 — 응답 순서대로 돌려주고, 받은 AbortSignal 을 모은다. 'hang' 은 끝나지 않는 요청. */
function mockRpc(responses: Array<Resp | 'hang'>) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn(() => {
    const next = responses.shift() ?? { data: null, error: null, status: 200 };
    const p: Promise<Resp> = next === 'hang' ? new Promise<Resp>(() => {}) : Promise.resolve(next);
    return Object.assign(p, {
      abortSignal: (signal: AbortSignal) => {
        signals.push(signal);
        return p;
      },
    });
  });
  const schema = vi.fn(() => ({ rpc }));
  vi.mocked(getSupabase).mockReturnValue({ schema } as never);
  return { rpc, signals };
}

const TOKEN = 'b'.repeat(32);
const NETWORK_DOWN: Resp = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
const OK: Resp = { data: { ok: true }, error: null, status: 200 };
const noWait = { sleep: vi.fn(async (_ms: number) => {}), random: () => 0.5 };

function submit(retry = noWait) {
  return submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동', retry);
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  noWait.sleep.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('일시 장애 판정 isTransientBallotError', () => {
  it('다시 보내는 것: 연결 끊김(status 0) · 5xx · 503/504 · PGRST003 · 57014 · 제한 시간', () => {
    expect(isTransientBallotError(NETWORK_DOWN.error, 0)).toBe(true);
    expect(isTransientBallotError({ message: '<html>Bad Gateway</html>' }, 502)).toBe(true);
    expect(isTransientBallotError({ message: 'unavailable', code: 'PGRST001' }, 503)).toBe(true);
    expect(isTransientBallotError({ message: 'pool timeout', code: 'PGRST003' }, 504)).toBe(true);
    expect(isTransientBallotError({ message: 'pool timeout', code: 'PGRST003' })).toBe(true);
    expect(isTransientBallotError({ message: 'canceling statement due to statement timeout', code: '57014' }, 500)).toBe(true);
    expect(isTransientBallotError({ message: 'canceling statement due to statement timeout', code: '57014' })).toBe(true);
    expect(isTransientBallotError(new BallotTimeoutError(12_000))).toBe(true);
  });

  it('다시 보내지 않는 것: 업무상 거절(P0001 · 400) · 권한 · 함수 없음 · status 모름', () => {
    expect(isTransientBallotError({ message: 'voter team not in roster', code: 'P0001' }, 400)).toBe(false);
    expect(isTransientBallotError({ message: 'missing answer for item x', code: 'P0001' }, 400)).toBe(false);
    expect(isTransientBallotError({ message: 'named voting required', code: 'P0001' }, 400)).toBe(false);
    // 업무상 거절은 상태 코드가 어떻든 다시 보내지 않는다.
    expect(isTransientBallotError({ message: 'ballot not open', code: 'P0001' }, 500)).toBe(false);
    expect(isTransientBallotError({ message: 'permission denied', code: '42501' }, 401)).toBe(false);
    expect(isTransientBallotError({ message: 'Could not find the function', code: 'PGRST202' }, 404)).toBe(false);
    expect(isTransientBallotError({ message: 'voter team not in roster' })).toBe(false);
  });

  it('재시도 기다림은 0.5~1.5초', () => {
    expect(ballotRetryDelayMs(() => 0)).toBe(500);
    expect(ballotRetryDelayMs(() => 0.5)).toBe(1000);
    expect(ballotRetryDelayMs(() => 0.9999)).toBe(1499);
    for (let i = 0; i < 50; i += 1) {
      const ms = ballotRetryDelayMs();
      expect(ms).toBeGreaterThanOrEqual(500);
      expect(ms).toBeLessThan(1500);
    }
  });
});

describe('실명 제출 자동 재시도 submitBallotNamed', () => {
  it('연결이 끊겼다 이어지면 다시 보내 성공 — 같은 client_id · 같은 답, 0.5~1.5초 쉬고', async () => {
    const { rpc } = mockRpc([NETWORK_DOWN, OK]);
    expect(await submit()).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(noWait.sleep).toHaveBeenCalledTimes(1);
    expect(noWait.sleep).toHaveBeenCalledWith(1000);
  });

  it('5xx · PGRST003(504) · 57014 도 다시 보낸다', async () => {
    let m = mockRpc([{ data: null, error: { message: 'Bad Gateway' }, status: 502 }, OK]);
    expect(await submit()).toBe('ok');
    expect(m.rpc).toHaveBeenCalledTimes(2);
    m = mockRpc([{ data: null, error: { message: 'timed out acquiring connection', code: 'PGRST003' }, status: 504 }, OK]);
    expect(await submit()).toBe('ok');
    expect(m.rpc).toHaveBeenCalledTimes(2);
    m = mockRpc([{ data: null, error: { message: 'statement timeout', code: '57014' }, status: 500 }, OK]);
    expect(await submit()).toBe('ok');
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });

  it('다시 보낸 요청이 「이 기기는 이미 제출」이면 앞선 시도가 들어간 것 — 성공(ok)으로 본다', async () => {
    const { rpc } = mockRpc([NETWORK_DOWN, { data: null, error: { message: 'already submitted', code: 'P0001' }, status: 400 }]);
    expect(await submit()).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('세 번째 시도에서 「이미 제출」이어도 성공', async () => {
    const { rpc } = mockRpc([
      { data: null, error: { message: 'Service Unavailable' }, status: 503 },
      NETWORK_DOWN,
      { data: null, error: { message: 'already submitted', code: 'P0001' }, status: 400 },
    ]);
    expect(await submit()).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('첫 시도의 「이미 제출」은 그대로 duplicate(재시도 없음)', async () => {
    const { rpc } = mockRpc([{ data: null, error: { message: 'already submitted', code: 'P0001' }, status: 400 }]);
    expect(await submit()).toBe('duplicate');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(noWait.sleep).not.toHaveBeenCalled();
  });

  it('업무상 거절은 다시 보내지 않는다 — 마감 · 같은 이름 · 수집 꺼짐 · 명단 밖 · 입력 검사', async () => {
    const reject = (message: string): Resp => ({ data: null, error: { message, code: 'P0001' }, status: 400 });
    let m = mockRpc([reject('ballot not open or event unavailable'), OK]);
    expect(await submit()).toBe('closed');
    expect(m.rpc).toHaveBeenCalledTimes(1);
    m = mockRpc([reject('name already submitted'), OK]);
    expect(await submit()).toBe('name_taken');
    expect(m.rpc).toHaveBeenCalledTimes(1);
    m = mockRpc([reject('named voting off'), OK]);
    expect(await submit()).toBe('named_off');
    expect(m.rpc).toHaveBeenCalledTimes(1);
    for (const message of ['voter team not in roster', 'voter name required', 'missing answer for item x', 'answer out of scale for item x']) {
      m = mockRpc([reject(message), OK]);
      await expect(submit()).rejects.toMatchObject({ message });
      expect(m.rpc).toHaveBeenCalledTimes(1);
    }
    expect(noWait.sleep).not.toHaveBeenCalled();
  });

  it('다시 보낸 뒤의 업무상 거절도 그대로 — 재시도 중 마감되면 closed', async () => {
    const { rpc } = mockRpc([NETWORK_DOWN, { data: null, error: { message: 'ballot not open or event unavailable', code: 'P0001' }, status: 400 }]);
    expect(await submit()).toBe('closed');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('세 번 다 일시 장애면 마지막 오류를 던진다(화면은 「제출에 실패했습니다」)', async () => {
    const last: Resp = { data: null, error: { message: 'Gateway Timeout' }, status: 504 };
    const { rpc } = mockRpc([NETWORK_DOWN, NETWORK_DOWN, last, OK]);
    await expect(submit()).rejects.toMatchObject({ message: 'Gateway Timeout' });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(noWait.sleep).toHaveBeenCalledTimes(2);
  });

  it('12초 안에 답이 없으면 끊고(AbortSignal) 다시 보낸다', async () => {
    vi.useFakeTimers();
    const { rpc, signals } = mockRpc(['hang', OK]);
    const pending = submit();
    await vi.advanceTimersByTimeAsync(BALLOT_SUBMIT_TIMEOUT_MS - 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('기다림을 주입하지 않으면 실제로 0.5~1.5초 쉬고 다시 보낸다', async () => {
    vi.useFakeTimers();
    const { rpc } = mockRpc([NETWORK_DOWN, OK]);
    const pending = submitBallotNamed(TOKEN, 'device-123456', { i: 2 }, '1분과 3조', '홍길동', { random: () => 0 });
    await vi.advanceTimersByTimeAsync(499);
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('ok');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('처음 불러오기 제한 시간 — 「불러오는 중」에 멈추지 않는다', () => {
  it('fetchBallot: 10초 안에 답이 없으면 끊고 BallotTimeoutError(화면은 「다시 불러오기」)', async () => {
    vi.useFakeTimers();
    const { rpc, signals } = mockRpc(['hang']);
    const pending = fetchBallot(TOKEN);
    const settled = expect(pending).rejects.toBeInstanceOf(BallotTimeoutError);
    await vi.advanceTimersByTimeAsync(BALLOT_LOAD_TIMEOUT_MS);
    await settled;
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(true);
  });

  it('fetchBallotRoster: 같은 10초 제한(명단 없이 투표 화면을 띄우지 않게 던진다)', async () => {
    vi.useFakeTimers();
    const { signals } = mockRpc(['hang']);
    const pending = fetchBallotRoster(TOKEN);
    const settled = expect(pending).rejects.toBeInstanceOf(BallotTimeoutError);
    await vi.advanceTimersByTimeAsync(BALLOT_LOAD_TIMEOUT_MS);
    await settled;
    expect(signals[0].aborted).toBe(true);
  });

  it('제때 오면 그대로 — 끊지 않고 타이머도 남기지 않는다', async () => {
    vi.useFakeTimers();
    const ballot = { id: 'x', title: 't', instructions: null, status: 'open', items: [] };
    const { signals } = mockRpc([{ data: ballot, error: null, status: 200 }]);
    expect(await fetchBallot(TOKEN)).toEqual(ballot);
    expect(signals[0].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('불러오기는 자동 재시도하지 않는다(화면의 「다시 불러오기」가 맡는다)', async () => {
    const { rpc } = mockRpc([NETWORK_DOWN, { data: null, error: null, status: 200 }]);
    await expect(fetchBallot(TOKEN)).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
