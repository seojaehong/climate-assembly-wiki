import type { SubmissionItem, SubmissionItemInput, SubmissionStatus } from '../../lib/deliberation';

/**
 * 조별 산출물(submission) 패널의 순수 로직 — 편집 행 조작, 저장 페이로드 변환,
 * 잠금(final)/재오픈(reopened) 판정. 서버 규칙(20260808_s1)의 UI측 거울:
 * final이면 저장·제출 버튼 자체를 내리지 않고, 빈 제출은 최종 제출을 막는다.
 */

/**
 * 편집 행 하나.
 *
 * `name` 은 **화면에만 있는 칸**이다. 저장할 때 `(이름) 내용` 으로 합쳐 보내고
 * 불러올 때 되파싱해 도로 나눈다(joinSpeaker / parseSpeaker). DB 형식은 그대로다 —
 * 분석 파이프라인이 이미 `(이름) 내용` 을 읽고 있으므로 바꾸면 그쪽이 깨진다.
 *
 * ★ `name` 은 선택 필드가 아니라 **필수**로 둔다. optional 로 두면 새 칸을 빠뜨린
 *   생성 지점(초안 복원·붙여넣기 분해·긴 칸 나누기)이 컴파일러에 안 걸린다.
 */
export type EditorRow = { name: string; content: string; rationale: string };

/**
 * submission_save p_items 상한(RPC: max 200).
 *
 * 2026-08-29 현장에서 30줄로는 모자랐다 — 조가 한글·워드에 정리해 둔 것을 통째로
 * 옮기니 두 조가 상한에 걸렸다. ★ 이 값은 **꼭지당 총량**이라 「나눠서 저장」으로는
 * 우회되지 않는다(저장할 때 화면의 전 행을 통째로 보낸다). 넘치면 문장이 갈 곳이
 * 없으므로 서버 RPC와 함께 200으로 올렸다. 서버보다 크게 두지 말 것 — 저장이 실패한다.
 */
export const MAX_SUBMISSION_ROWS = 200;

/**
 * 최종 제출 확인 모달의 본문. **화면이 정본이다** — 8.29에 조가 실제로 읽은 문구이고
 * 조 안내문(`src/pages/mod-help/team.astro`)이 이 문장을 그대로 인용한다.
 *
 * 예전에는 이 상수를 아무도 렌더하지 않고 테스트만 검사했다 — 화면에 안 나가는 것을
 * 재는 거짓 단언이었다. 지금은 모달이 이 상수를 그대로 쓴다(SubmissionPanel.tsx).
 * ★ 「최종 제출할까요?」는 모달 제목이 따로 말하므로 본문에서 뺀다.
 */
export const FINALIZE_CONFIRM_MESSAGE =
  '최종 제출하면 잠깁니다. 잘못 눌렀다면 「다시 열기」로 바로 풀 수 있습니다.';

// LEAVE_CONFIRM_MESSAGE 는 없앴다. 저장 전 이탈은 `beforeunload` 로 막는데, 최신
// 브라우저는 **사이트가 준 문구를 절대 보여 주지 않는다**(제 문구를 쓴다). 즉 그 상수는
// 아무도 못 읽는 문장이었고, 남겨 두면 「이렇게 뜬다」고 믿게 만든다.

export function emptyRow(): EditorRow {
  return { name: '', content: '', rationale: '' };
}

// ── 이름 칸 ↔ 저장 문자열 (진단서 §4-4) ───────────────────────────
//
// 8.29 실측: 화자 미표기 7건(유형 B) · 화자 줄 분리 1건(유형 C, 그 꼭지의 39%).
// 이름을 「문장과 같은 줄에」 적으라고 안내해도 조마다 다르게 쓴다. 칸을 따로 주면
// 형식을 외울 일이 없어진다.
//
// ★ 되파싱이 틀리면 **본문이 잘린다.** 그래서 규칙을 좁게 잡고, 조금이라도 애매하면
//   이름 칸을 비우고 본문을 통째로 둔다. 「애매하면 안 건드린다」가 기본값이다.

/**
 * 이름으로 볼 토큰인가 — **한글 2~3자만.** 공백·숫자·기호가 섞이면 이름이 아니다.
 *
 * 왜 3자에서 끊는가 — **금지어 목록을 만들지 않기 위해서다.**
 * 8.29 참석 명단 201명의 길이 분포는 2자 1명 · 3자 199명 · 그 밖 1명(로마자 병기)이다.
 * 그리고 641건 전수에서 이 규칙이 사람 이름이 아닌데 뽑은 것은 `기타의견 :` **단 1건**,
 * 그 하나가 4자였다. 상한을 3자로 두면 그 1건이 사라지고 진짜 이름은 하나도 안 잃는다.
 * 추측으로 만든 금지어 목록(「질문」「의견」…)은 두지 않는다 — 실측에서 한 번도 안 걸렸고,
 * 목록이 길어질수록 진짜 이름을 막을 확률만 올라간다.
 *
 * 이 문턱이 실제로 걸러 내는 것(8.29 실측):
 *   `(촉진질문: …)` `(추가질문: …)` — 닫는 괄호가 토큰 뒤에 없어 애초에 안 잡힌다
 *   `(1) 기후문제로 …` `(2) 분명한 계절 …` — 토큰이 숫자
 *   `2. 의견정리(…)` `의제1. …` — 콜론이 앞에 없다
 *   `기타의견 : …` — 4자
 * 남는 위험 : 4자 이름(남궁·황보 등)은 **못 뽑는다.** 그때는 이름 칸이 비고 본문이
 * 통째로 남을 뿐이라 글자를 잃지 않는다 — 「애매하면 안 건드린다」의 값이다.
 */
const NAME_TOKEN = /^[가-힣]{2,3}$/;

export function looksLikeSpeakerName(token: string): boolean {
  return NAME_TOKEN.test(token.trim());
}

/** 이름 칸에 넣을 이름과, 이름을 뗀 본문. `name === ''` 이면 본문은 **원문 그대로**다. */
export type SpeakerSplit = { name: string; body: string };

/**
 * 저장된 한 줄에서 이름을 되파싱한다. 8.29 실데이터가 세 형태로 섞여 있다 —
 *   `(박서준) 환경교육 방식이 …`      (56건)
 *   `- (임효은) 기업은 이윤을 …`       (144건)
 *   `신유섭: 처음에 비해 많이 …`       (255건)
 *
 * 뽑지 않는 경우(전부 원문 그대로 돌려준다):
 *   · 토큰이 이름처럼 생기지 않았다 (looksLikeSpeakerName)
 *   · 이름을 떼면 **본문이 빈다** — 「이름만 있는 행」은 손대지 않고 §4-5 안내로 넘긴다
 *   · 줄바꿈이 남아 있다 — 아직 안 나뉜 통짜다. 이름은 첫 줄에만 걸리므로 건드리지 않는다
 *   · `(1) 정주현 : …` 처럼 번호가 앞에 붙은 형태 — 실측 존재하나 규칙이 흔들려 **보류**한다
 */
export function parseSpeaker(content: string): SpeakerSplit {
  const none: SpeakerSplit = { name: '', body: content };
  if (/\r?\n/.test(content)) return none;

  // 앞머리 글머리표는 이름 판정에서만 무시한다(본문에는 원래 없던 자리다).
  const head = content.replace(/^\s*[-–—·•*]\s*/, '');

  // ① (이름) 내용 — 닫는 괄호가 토큰 **바로 뒤**에 와야 한다.
  const paren = /^\(\s*([^()\s]{1,10})\s*\)\s*(\S[\s\S]*)$/.exec(head);
  if (paren && looksLikeSpeakerName(paren[1])) {
    return { name: paren[1].trim(), body: paren[2].trim() };
  }

  // ② 이름: 내용 — 콜론 앞에 공백이 없어야 한다(「… 정주현 : …」 같은 중간 콜론 차단).
  const colon = /^([^\s:：]{1,10})\s*[:：]\s*(\S[\s\S]*)$/.exec(head);
  if (colon && looksLikeSpeakerName(colon[1])) {
    return { name: colon[1].trim(), body: colon[2].trim() };
  }

  return none;
}

/**
 * 이름 칸에 조가 적은 잡동사니를 다듬는다 — `(홍길동)` `홍길동:` `- 홍길동` 을 전부
 * `홍길동` 으로. 안 다듬으면 합칠 때 `(홍길동:) 내용` 이 저장된다.
 */
export function normalizeSpeakerName(raw: string): string {
  return raw
    .replace(/[()（）\[\]{}<>]/g, ' ')
    .replace(/^[\s\-–—·•*]+/, '')
    .replace(/[\s:：,.]+$/, '')
    .trim();
}

/**
 * 이름 칸 + 본문 → **저장할 한 줄.** 형식은 `(이름) 내용` 하나뿐이다 —
 * 분석 파이프라인이 읽는 형식이고, 8.29 최상위 조가 쓴 형식이다.
 * 이름이 비면 본문만 저장한다(강제하지 않는다).
 */
export function joinSpeaker(name: string, content: string): string {
  const n = normalizeSpeakerName(name);
  const c = content.trim();
  if (n.length === 0) return c;
  if (c.length === 0) return c; // 본문이 없으면 이름만 저장하지 않는다 — 쓰레기 노드가 된다
  return `(${n}) ${c}`;
}

/** 서버 항목 → 편집 행. 항목이 없으면 빈 행 1개로 시작한다(빈 편집기 방지). */
export function rowsFromItems(items: SubmissionItem[]): EditorRow[] {
  const sorted = [...items].sort((a, b) => a.ordinal - b.ordinal);
  const rows = sorted.map((item) => {
    const { name, body } = parseSpeaker(item.content);
    return { name, content: body, rationale: item.rationale ?? '' };
  });
  return rows.length > 0 ? rows : [emptyRow()];
}

/**
 * 편집 가능 여부. status null(아직 제출물 없음)·draft·reopened = 편집 가능,
 * final(잠금)·archived = 불가.
 */
export function isEditable(status: SubmissionStatus | null): boolean {
  return status !== 'final' && status !== 'archived';
}

/**
 * 편집 행 → submission_save p_items. 내용이 빈 행은 버리고 ordinal을 1부터 다시 매긴다
 * (RPC도 빈 content를 걸러내므로 여기서 미리 맞춰 보내야 저장 건수 표시가 어긋나지 않는다).
 * rationale은 빈 문자열 대신 null.
 */
export function toSaveItems(rows: EditorRow[]): SubmissionItemInput[] {
  return rows
    .map((row) => ({
      content: joinSpeaker(row.name, row.content),
      rationale: row.rationale.trim(),
    }))
    .filter((row) => row.content.length > 0)
    .map((row, index) => ({
      ordinal: index + 1,
      kind: 'core' as const,
      content: row.content,
      rationale: row.rationale.length > 0 ? row.rationale : null,
    }));
}

/** 최종 제출 가능: 편집 가능한 상태 + 내용 있는 행 1개 이상(빈 제출은 RPC도 거부). */
export function canFinalize(rows: EditorRow[], status: SubmissionStatus | null): boolean {
  return isEditable(status) && toSaveItems(rows).length > 0;
}

// ── 행 조작(전부 불변 갱신) ──────────────────────────────────

export function addRow(rows: EditorRow[]): EditorRow[] {
  if (rows.length >= MAX_SUBMISSION_ROWS) return rows;
  return [...rows, emptyRow()];
}

/** 마지막 한 행은 지우는 대신 비운다 — 편집기에 행이 0개가 되는 상태를 만들지 않는다. */
export function removeRow(rows: EditorRow[], index: number): EditorRow[] {
  if (index < 0 || index >= rows.length) return rows;
  if (rows.length <= 1) return [emptyRow()];
  return rows.filter((_, i) => i !== index);
}

/** 위/아래 이동. 경계 밖이면 그대로 반환한다. */
export function moveRow(rows: EditorRow[], index: number, direction: -1 | 1): EditorRow[] {
  const target = index + direction;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * ★ 이름 칸이 **반드시 여기 들어가야 한다.** 빠뜨리면 이름만 고쳤을 때 dirty 가 안 서고,
 *   그러면 저장 버튼이 계속 잠기고 초안 보관 useEffect 도 안 돈다 —
 *   조가 적은 이름이 조용히 사라진다(2026-08-30 `dropDraft` 와 같은 계열의 함정).
 */
function serializeRows(rows: EditorRow[]): string {
  return JSON.stringify(rows.map((row) => [row.name, row.content, row.rationale]));
}

/** 저장 이후 달라진 것이 있는가 — 저장 버튼 활성화·이탈 confirm의 판정 기준. */
export function isDirty(rows: EditorRow[], baseline: EditorRow[]): boolean {
  return serializeRows(rows) !== serializeRows(baseline);
}

export type SubmissionBadge = { label: string; tone: 'locked' | 'reopened' | 'draft' } | null;

/** 상태 배지. draft/없음은 배지 없이 두고, 잠금·재오픈만 눈에 띄게 표시한다. */
export function submissionBadge(status: SubmissionStatus | null): SubmissionBadge {
  if (status === 'final') return { label: '최종 제출됨 · 잠금', tone: 'locked' };
  if (status === 'reopened') return { label: '재오픈됨 · 다시 편집 가능', tone: 'reopened' };
  return null;
}

/**
 * 탭을 옮겼다 왔을 때 되살릴 미저장분을 고른다.
 *
 * 조별 산출물 탭을 떠나면 편집 구역이 통째로 언마운트되어 저장 안 한 줄이 사라졌다.
 * 8.29에는 타이머·출석을 보고 돌아오는 동선이 있어 그대로 두면 현장에서 글이 날아간다.
 *
 * 서버 내용이 언제나 기준이다. 보관분은 **서버와 다를 때만** 되살린다 —
 * 저장을 마치면 둘이 같아지므로 낡은 초안이 되살아나지 않는다.
 *
 * @param raw       보관함에서 꺼낸 문자열(없으면 null)
 * @param serverRows 방금 서버에서 읽은 줄
 * @returns 되살릴 줄. 되살릴 게 없으면 null
 */
export function pickRestoredRows(raw: string | null, serverRows: EditorRow[]): EditorRow[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 깨진 값 — 서버 내용으로 연다
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  // ★ 이름 칸이 생기기 **전에** 보관된 초안이 있을 수 있다(같은 탭에서 배포를 건너온 경우).
  //   옛 모양은 {content, rationale} 뿐이라 name 이 undefined 로 들어오고, 그대로 쓰면
  //   controlled input 이 uncontrolled 로 바뀌어 React 가 경고를 뱉는다. 여기서 메운다.
  const rows = parsed
    .filter(
      (row): row is Partial<EditorRow> =>
        typeof row === 'object' && row !== null && typeof (row as EditorRow).content === 'string',
    )
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name : '',
      content: row.content as string,
      rationale: typeof row.rationale === 'string' ? row.rationale : '',
    }));
  if (rows.length !== parsed.length || rows.length === 0) return null;
  return isDirty(rows, serverRows) ? rows : null;
}

/**
 * 여러 줄 붙여넣기 분해 — 조가 한글·워드에 써 둔 것을 옮겨 담는 실제 경로다.
 *
 * 2026-08-29 현장 관찰: 조는 대부분 자기 한글/워드 파일에서 작업하고 화면에는
 * 마지막에 옮긴다. 그런데 textarea에 통째로 붙이면 **한 칸에 줄바꿈째로** 들어가
 * 문장 10개가 1건이 된다. 발표 카드도 한 장, 조끼리 겹침 판정도 무의미해진다.
 * 이 시스템은 「한 문장 = 한 행」에 전부 매여 있으므로 입구에서 나눠 받는다.
 *
 * 안전 규칙 — **어떤 경우에도 다른 행의 내용을 건드리지 않는다.**
 * - 붙여넣는 칸이 비어 있으면: 첫 줄을 그 칸에, 나머지는 바로 뒤에 새 행으로
 * - 칸에 이미 글이 있으면: 그 칸은 그대로 두고 전부 뒤에 새 행으로
 *
 * 한 줄짜리(또는 빈) 붙여넣기는 `applied:false`로 돌려보내 브라우저 기본
 * 붙여넣기에 맡긴다 — 커서 위치 편집을 빼앗지 않는다.
 */
export type PasteSplit = {
  /** 분해가 일어났는가. false면 호출부는 기본 붙여넣기를 그대로 둔다. */
  applied: boolean;
  rows: EditorRow[];
  /** 실제로 들어간 줄 수. */
  inserted: number;
  /** 30줄 상한에 걸려 들어가지 못한 줄 수. 0이 아니면 반드시 알려야 한다. */
  dropped: number;
};

/**
 * ★★ 「한 줄」의 정의 — 이 시스템에서 단 하나뿐인 규칙 ★★
 *
 * 1) `\r?\n` 으로 자른다 (한글·워드 클립보드는 CRLF 를 실어 보낸다)
 * 2) 각 조각의 앞뒤 공백을 없앤다
 * 3) 빈 조각은 버린다
 * 4) 남은 줄이 **2개 이상일 때만** 나눈 것으로 본다. 1개면 원문을 손대지 않는다
 *
 * 이 규칙은 세 곳이 함께 쓴다 — 붙여넣기 분해(`splitPastedRows`), 긴 칸 나누기
 * (`splitOverlongRows`), 그리고 **서버 RPC**(`supabase/migrations/20260830_s15_*.sql`
 * 의 `climate_vote.submission_lines`). 규칙이 갈리면 같은 글이 경로에 따라 다르게
 * 저장된다. 여기를 고치면 그 마이그레이션도 함께 고칠 것.
 */
export function splitSubmissionLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

export function splitPastedRows(
  rows: EditorRow[],
  index: number,
  text: string,
  cap: number = MAX_SUBMISSION_ROWS,
): PasteSplit {
  const none: PasteSplit = { applied: false, rows, inserted: 0, dropped: 0 };
  if (index < 0 || index >= rows.length) return none;
  const lines = splitSubmissionLines(text);
  if (lines.length < 2) return none;

  const target = rows[index];
  const fillsTarget = target.content.trim().length === 0;
  // 채울 자리 = 상한 - 현재 행수 (+ 빈 칸을 채우는 경우 그 한 칸)
  const room = cap - rows.length + (fillsTarget ? 1 : 0);
  if (room <= 0) return { applied: false, rows, inserted: 0, dropped: lines.length };

  const taken = lines.slice(0, room);
  const dropped = lines.length - taken.length;

  // ★ 붙여넣는 줄에도 이름 되파싱을 건다. 안 걸면 **같은 글이 저장 전과 저장 후에 다르게
  //   보인다** — 저장하면 서버에서 돌아올 때 rowsFromItems 가 되파싱하기 때문이다.
  const toRow = (line: string): EditorRow => {
    const { name, body } = parseSpeaker(line);
    return { name, content: body, rationale: '' };
  };

  const next = [...rows];
  let head = taken;
  if (fillsTarget) {
    const first = toRow(taken[0]);
    next[index] = {
      ...target,
      // ★ 조가 이름 칸에 먼저 적어 둔 이름을 붙여넣기가 지우면 안 된다.
      //   붙인 줄이 제 이름을 갖고 있을 때만 갈아끼운다(splitOverlongRows 와 같은 규칙).
      name: first.name || target.name,
      content: first.content,
    };
    head = taken.slice(1);
  }
  next.splice(index + 1, 0, ...head.map(toRow));

  return { applied: true, rows: next, inserted: taken.length, dropped };
}

// ── 한 칸에 여러 사람 말이 든 경우 (2차 방어선) ────────────────────
//
// 8.29 실측: 통짜 6건이 전부 668자 이상이었고, 잘 쓴 조의 한 줄 중앙값은 39~90자였다.
// 정당한 장문 한 건일 수도 있으므로 **강제로 나누지 않는다** — 알려 주고 조가 고른다.

/**
 * 「길다」고 볼 글자수. 실측 근거 —
 * 상위 조의 한 줄 중앙값 39~90자, 최장 220자. 통짜 6건은 전부 668자 이상.
 * 300자는 그 사이의 빈 구간이다. 넘는다고 잘못은 아니고, **묻기만 한다.**
 */
export const LONG_ROW_CHARS = 300;

/** 길다고 볼 행의 index 목록. */
export function overlongRowIndexes(rows: EditorRow[]): number[] {
  return rows.reduce<number[]>((acc, row, i) => {
    if (row.content.trim().length > LONG_ROW_CHARS) acc.push(i);
    return acc;
  }, []);
}

/**
 * 길면서 **나눌 수 있는**(줄이 2개 이상인) 행. 줄바꿈 없는 긴 한 문장은 여기 안 든다 —
 * 나눌 근거가 없으므로 버튼도 주지 않는다(경고만 남는다).
 */
export function splittableRowIndexes(rows: EditorRow[]): number[] {
  return overlongRowIndexes(rows).filter((i) => splitSubmissionLines(rows[i].content).length >= 2);
}

export type OverlongSplit = {
  /** 나눴는가. */
  applied: boolean;
  rows: EditorRow[];
  /** 나누기 전 행수 → 나눈 뒤 행수. */
  before: number;
  after: number;
  /** 나누면 상한을 넘어 포기했는가. 서버 RPC 와 같은 판단이다. */
  overCap: boolean;
};

/**
 * 긴 칸을 줄 단위로 나눈다. 위치는 지킨다 — 나뉜 조각이 그 자리에 그대로 늘어서고
 * 다른 행은 순서도 내용도 바뀌지 않는다. rationale 은 첫 조각만 물려받는다
 * (N 벌로 복제하면 원문에 없던 근거가 늘어난다 — 서버 RPC 와 같은 규칙).
 *
 * ★ 나눈 결과가 상한을 넘으면 **아무것도 하지 않는다.** 잘라내면 조가 쓴 문장이
 * 사라진다. 서버 RPC 도 같은 선택을 한다(조용한 잘림 금지).
 */
export function splitOverlongRows(
  rows: EditorRow[],
  cap: number = MAX_SUBMISSION_ROWS,
): OverlongSplit {
  const targets = new Set(splittableRowIndexes(rows));
  const before = rows.length;
  if (targets.size === 0) return { applied: false, rows, before, after: before, overCap: false };

  const next: EditorRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!targets.has(i)) {
      next.push(row);
      continue;
    }
    const lines = splitSubmissionLines(row.content);
    lines.forEach((line, k) => {
      const { name, body } = parseSpeaker(line);
      next.push({
        // 조각이 제 이름을 갖고 있으면 그것을 쓰고, 없을 때만 첫 조각이 원래 이름을 물려받는다.
        // (N 벌로 복제하면 원문에 없던 화자가 늘어난다 — rationale 과 같은 규칙)
        name: name || (k === 0 ? row.name : ''),
        content: body,
        rationale: k === 0 ? row.rationale : '',
      });
    });
  }
  if (next.length > cap) return { applied: false, rows, before, after: before, overCap: true };
  return { applied: true, rows: next, before, after: next.length, overCap: false };
}

// ── 이름만 있는 행 (진단서 §4-5, 유형 C) ──────────────────────────
//
// 8.29 `1분과 2조 꼭지②` — 70행 중 비숙의 39%. 이런 모양이었다:
//     권민정:                                  ← 이름만 있는 행 = 쓰레기 노드
//     (1) 기후문제로 인한 식재료 가격 변동이 없음.  ← 화자 미상이 됨
//     (2) 분명한 계절(4계절) …                  ← 화자 미상이 됨
//     김혜인:                                  ← 다음 사람
// 사람 눈에는 정성스러운데 **한 번에 두 가지가 깨진다.** 저장 전에 알리고, 옮겨 주는
// 버튼을 함께 준다. ★ 강제하지 않는다 — 「이대로 두기」가 있다.

/** 본문이 이름뿐인 행. `홍길동:` `(홍길동)` `- (홍길동)` 만 본다. */
const NAME_ONLY = /^\s*[-–—·•*]?\s*(?:\(\s*([^()\s]{1,10})\s*\)|([^\s:：]{1,10}))\s*[:：]?\s*$/;

export type NameOnlyRow = {
  index: number;
  /** 그 행이 들고 있는 이름. 이름 칸에만 있고 본문이 빈 행이면 이름 칸의 값이다. */
  name: string;
  /** 본문이 이름뿐인 행인가(true) · 이름 칸만 채우고 본문이 빈 행인가(false). */
  inBody: boolean;
};

/**
 * 저장하면 화자가 끊기거나 행 자체가 사라지는 행들.
 *
 * 두 가지를 **같이** 잡는다 —
 *  ① 본문이 `권민정:` 처럼 이름뿐 → 쓰레기 노드 + 아래 문장이 화자를 잃는다
 *  ② 이름 칸만 채우고 본문이 빈 행 → `toSaveItems` 가 조용히 버린다(조는 모른다)
 */
export function nameOnlyRowIndexes(rows: EditorRow[]): NameOnlyRow[] {
  const out: NameOnlyRow[] = [];
  rows.forEach((row, index) => {
    const body = row.content.trim();
    if (body.length === 0) {
      // ② 이름만 적고 본문을 안 쓴 행. 빈 행(둘 다 빈)은 그냥 여분 칸이므로 뺀다.
      if (normalizeSpeakerName(row.name).length > 0) {
        out.push({ index, name: normalizeSpeakerName(row.name), inBody: false });
      }
      return;
    }
    // ① 본문이 이름뿐인 행. 이름 칸을 이미 쓴 행은 조가 의도한 것이므로 건드리지 않는다.
    if (normalizeSpeakerName(row.name).length > 0) return;
    const m = NAME_ONLY.exec(body);
    const token = m ? (m[1] ?? m[2] ?? '') : '';
    // 장식(괄호 또는 콜론)이 하나도 없는 홑단어는 이름이라 볼 근거가 없다 — 「오프닝」 같은
    // 양식 잔재를 이름으로 오인하면 그 줄이 사라진다.
    const decorated = /[():：（）]/.test(body);
    if (token && decorated && looksLikeSpeakerName(token)) {
      out.push({ index, name: token.trim(), inBody: true });
    }
  });
  return out;
}

export type NameLift = {
  applied: boolean;
  rows: EditorRow[];
  /** 이름 칸을 채워 준 행 수. */
  filled: number;
  /** 지운 「이름만 있는 행」 수. */
  removed: number;
};

/**
 * 이름만 있는 행의 이름을 **아래 행들의 이름 칸으로 내려 채우고** 그 행을 지운다.
 *
 * 한 행만 옮기면 안 된다 — 실데이터는 이름 하나 아래에 문장이 **여러 줄** 달려 있다.
 * 다음 「이름만 있는 행」을 만나거나, 이미 제 이름을 가진 행을 만나면 거기서 멈춘다.
 * 이름 칸만 채우고 본문이 빈 행(②)은 지우지 않는다 — 조가 아직 쓰는 중일 수 있다.
 */
export function liftNameOnlyRows(rows: EditorRow[]): NameLift {
  const marks = nameOnlyRowIndexes(rows).filter((m) => m.inBody);
  if (marks.length === 0) return { applied: false, rows, filled: 0, removed: 0 };
  const heads = new Map(marks.map((m) => [m.index, m.name]));

  const next: EditorRow[] = [];
  let carry = '';
  let filled = 0;
  let removed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const head = heads.get(i);
    if (head !== undefined) {
      carry = head;
      removed += 1;
      continue; // 이름 행 자체는 저장할 것이 없다
    }
    const row = rows[i];
    if (normalizeSpeakerName(row.name).length > 0) {
      carry = ''; // 제 이름을 가진 행을 만나면 내려 채우기를 멈춘다
      next.push(row);
      continue;
    }
    if (carry && row.content.trim().length > 0) {
      next.push({ ...row, name: carry });
      filled += 1;
      continue;
    }
    next.push(row);
  }
  if (next.length === 0) next.push(emptyRow());
  return { applied: true, rows: next, filled, removed };
}

// ── 저장 결과 알림 ─────────────────────────────────────────────
//
// 서버 줄 분해(마이그레이션 s15)는 결과를 반환값에 실어 보낸다. 화면이 그걸 안 읽으면
// **조는 자기 글이 왜 달라졌는지 모른 채** 칸이 늘어난 화면을 보게 된다.
// 상한을 넘겨 나누기를 포기한 경우는 더 그렇다 — 그건 조가 뭔가 해야 하는 상황이다.

/** submission_save 반환값 중 알림에 필요한 부분만. */
export type SubmissionSaveOutcome = {
  split?: number;
  split_skipped_over_cap?: boolean;
};

/**
 * 저장 직후 띄울 문장. 「무슨 일이 있었고 → 뭘 하면 되는지」 순서로 적는다.
 * 반환값이 없거나 옛 RPC 라 필드가 없으면 평소 문구로 돌아간다.
 */
export function saveOutcomeMessage(result: SubmissionSaveOutcome | null | undefined): string {
  if (result?.split_skipped_over_cap) {
    return `줄이 ${MAX_SUBMISSION_ROWS}개를 넘어 나누지 않고 그대로 저장했습니다. 긴 칸은 나누기 안내가 다시 뜹니다.`;
  }
  const split = result?.split ?? 0;
  if (split > 0) {
    return `한 칸에 여러 줄이 있어 저장하면서 나눴습니다 — 칸이 ${split}개 늘었습니다.`;
  }
  return '저장되었습니다. 최종 제출 전까지 계속 고칠 수 있습니다.';
}
