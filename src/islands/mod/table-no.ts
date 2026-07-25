/**
 * 조 테이블 번호(현장 좌석 번호) 표기.
 *
 * 좌석은 1~15번 테이블로 배치되고 분과·조 번호와 일치하지 않는다. 조 이름만으로는
 * 현장에서 조를 찾지 못하므로 본부가 당일 입력한 번호를 /hq 카드와 /mod 배지에 함께 띄운다.
 * 숫자가 아닐 수 있어(예: 'A-3') 값은 text다 — 20260726_team_table_no.sql.
 */

/**
 * attendance_hq_set_table_no가 `length(v_value) > 20`으로 거부하는 경계.
 * 입력창 maxLength로도 쓴다 — UTF-16 길이는 항상 코드포인트 길이 이상이므로
 * maxLength=20을 건 입력값은 RPC 가드에 닿지 않는다(별도 검증 함수가 필요 없는 이유).
 */
export const TABLE_NO_MAX_LENGTH = 20;

/**
 * 카드에 그릴 때 남기는 코드포인트 수.
 *
 * 송출 카드 내용 폭은 223px이고 이 줄은 28px이다. '테이블 ' 접두(≈92px)를 빼면
 * 값에 쓸 수 있는 폭이 ≈131px뿐이라 20자가 들어오면 소리 없이 잘린다.
 * 실제 좌석 번호는 '15'·'A-3'처럼 2~3자라 6자는 넉넉하다.
 */
export const TABLE_NO_DISPLAY_MAX = 6;

/** 저장·비교용 정리값. 공백만이거나 값이 없으면 null(= 번호 없음). */
export function normalizeTableNo(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 화면 표기. **번호가 없으면 null** — 호출부는 빈 자리를 만들지 말고 아무것도 렌더하지 않는다.
 *
 * 'A-3번 테이블'은 한국어로 어색해서 숫자일 때만 'N번 테이블'을 쓰고, 그 외에는 '테이블 X'로 뒤집는다.
 * 줄인 값은 더 이상 그 번호가 아니므로 '…'가 붙은 뒤에는 숫자 어순을 쓰지 않는다.
 */
export function tableNoLabel(raw: string | null | undefined): string | null {
  const value = normalizeTableNo(raw);
  if (value == null) return null;
  const chars = Array.from(value); // 코드포인트 단위 — 서러게이트 쌍을 쪼개지 않는다.
  const shown =
    chars.length > TABLE_NO_DISPLAY_MAX ? `${chars.slice(0, TABLE_NO_DISPLAY_MAX).join('')}…` : value;
  return /^\d+$/.test(shown) ? `${shown}번 테이블` : `테이블 ${shown}`;
}
