/**
 * 본부 마감시각 설정의 순수 로직 — `HqSubmissionBoard.tsx` 의 「걸기 / 지우기」가 쓴다.
 *
 * 왜 `.ts` 로 빼는가 — 이 저장소의 `vitest.config.ts` include 가 `.test.ts` 만 잡아
 * `.tsx` 테스트는 **조용히 실행되지 않는다**. 그래서 판단(시각 변환·거절·실패 문구)은
 * 전부 여기서 끝내고 `.tsx` 에는 입력칸과 버튼만 남긴다.
 *
 * ★ 이 화면은 마감시각을 **쓰기만 한다.** 본부에는 `deadline_at` 을 되읽을 경로가 없다 —
 *   `hq_submissions` 는 그 컬럼을 안 내려주고 `topic_list` 는 조 접속코드를 요구한다(본부는
 *   토큰만 갖는다). 그래서 화면은 「이 화면이 방금 건 값」만 되비춘다. 서버의 현재값을
 *   보여주는 척하지 않는다 — 없는 사실을 지어내면 본부가 그것을 믿는다.
 */

/** 마감 시각을 서버에 어떻게 보낼지. `reject` 면 아무것도 보내지 않는다. */
export type DeadlinePlan =
  | { kind: 'set'; deadlineAt: string }
  | { kind: 'clear'; deadlineAt: null }
  | { kind: 'reject'; message: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `datetime-local` 값 → ISO(UTC) 문자열. 읽을 수 없으면 null.
 *
 * ★ `datetime-local` 이 내는 값에는 **시간대가 없다**(`2026-09-12T14:30`). 본부가 보는
 *   벽시계 = 기기 로컬 시각이라는 뜻이므로 로컬로 해석해 UTC 로 바꿔 보낸다. 서버 컬럼은
 *   `timestamptz` 라 여기서 안 바꾸면 Postgres 가 **서버 시간대로** 읽어 몇 시간이 어긋난다.
 *
 * `new Date('2026-09-12T14:30')` 도 로컬로 읽히지만 그 규칙에 기대지 않고 성분을 직접
 * 넘긴다 — 그리고 넘긴 성분이 그대로 돌아오는지 확인해 `2026-02-31`(달을 넘겨 굴러가는 값)을
 * 걸러낸다.
 */
export function localInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, hh, mm, ss] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  const second = ss ? Number(ss) : 0;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.toISOString();
}

/** ISO(UTC) → `datetime-local` 값(기기 로컬 시각). 값이 없거나 못 읽으면 빈 문자열. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * 버튼 하나가 무엇을 보낼지 정한다.
 *
 * 「지우기」는 입력칸을 보지 않는다 — 잘못 건 시각을 되돌리는 경로가 이것 하나뿐인데
 * 입력칸이 비었다는 이유로 거절하면 되돌릴 방법이 사라진다(설계 §2.6).
 */
export function planDeadline(mode: 'set' | 'clear', input: string): DeadlinePlan {
  if (mode === 'clear') return { kind: 'clear', deadlineAt: null };
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      kind: 'reject',
      message: '마감 시각을 입력한 뒤 「걸기」를 누르세요. 마감을 없애려면 「지우기」입니다.',
    };
  }
  const iso = localInputToIso(trimmed);
  if (!iso) return { kind: 'reject', message: `마감 시각을 읽을 수 없습니다 — 「${trimmed}」` };
  return { kind: 'set', deadlineAt: iso };
}

/**
 * 어떤 모양으로 오든 사람이 읽을 수 있는 한 줄로 만든다(코드가 있으면 함께 남긴다).
 *
 * ★ PostgREST 오류는 `Error` 인스턴스가 **아니다** — supabase-js 는 응답 본문
 * (`{code, message, details, hint}`)을 평범한 객체로 준다. `instanceof Error` 만 보면
 * 진짜 원인이 통째로 사라지고 「실패했습니다」만 남아 행사 당일 진단이 불가능해진다.
 */
export function describeRpcError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string; hint?: string; details?: string };
    const parts = [e.code, e.message ?? e.details ?? e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(': ');
    try {
      return JSON.stringify(error).slice(0, 200);
    } catch {
      /* 순환 참조 등 — 아래 기본 문구로 떨어진다 */
    }
  }
  return '원인을 알 수 없습니다';
}

/** `role="alert"` 에 그대로 싣는 실패 문구. s17 미적용 DB 에서는 `PGRST202: …` 가 뒤에 붙는다. */
export function deadlineFailureMessage(mode: 'set' | 'clear', error: unknown): string {
  const what = mode === 'clear' ? '마감을 지우지 못했습니다' : '마감 시각을 걸지 못했습니다';
  return `${what} — ${describeRpcError(error)}`;
}

/**
 * 이 화면이 마지막으로 무엇을 걸었는지 되비춘다.
 *
 * `undefined` = 이 화면에서 아직 안 건드림, `null` = 지움, 문자열 = 그 시각으로 걸었음.
 * 「서버의 현재 마감」이 아니라 **이 화면의 마지막 조작**임을 문구로 못 박는다.
 */
export function deadlineEchoLabel(applied: string | null | undefined): string {
  if (applied === undefined) return '이 화면에서는 아직 걸지 않았습니다';
  if (applied === null) return '방금 마감을 지웠습니다';
  const local = isoToLocalInput(applied);
  if (!local) return '방금 마감을 걸었습니다';
  return `방금 ${local.replace('T', ' ')} 로 걸었습니다`;
}
