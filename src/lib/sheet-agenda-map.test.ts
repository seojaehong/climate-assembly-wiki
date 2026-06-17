import { describe, it, expect } from 'vitest';
import { sheetRowToAgenda } from './sheet-agenda-map';

describe('sheetRowToAgenda', () => {
  it('Board 시트 행을 agenda insert 객체로 매핑한다', () => {
    const row = {
      순번: '5', 일자: '2026-06-14', 조: 'A조', 발언자: '익명',
      안건: '자원순환형 배달 문화', 상태: '선정', 도메인: '자원순환',
      override_양단: '감축',
    };
    const out = sheetRowToAgenda(row, 'sess-1');
    expect(out).toMatchObject({
      session_id: 'sess-1', text: '자원순환형 배달 문화',
      jo: 'A조', zone: '감축', status: 'active',
    });
  });

  it('override_양단 비면 도메인 기반 zone, 안건 공백이면 null 반환(스킵)', () => {
    expect(sheetRowToAgenda({ 안건: '' } as any, 's')).toBeNull();
  });
});
