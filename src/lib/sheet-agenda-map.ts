export interface SheetRow {
  순번?: string; 일자?: string; 조?: string; 발언자?: string;
  안건?: string; 상태?: string; 도메인?: string; override_양단?: string;
}
export interface AgendaInsert {
  session_id: string; text: string; jo: string | null;
  zone: string | null; status: 'active';
}

/** Board 시트 한 행 → agenda insert. 안건 공백이면 null(스킵). */
export function sheetRowToAgenda(row: SheetRow, sessionId: string): AgendaInsert | null {
  const text = (row.안건 ?? '').trim();
  if (!text) return null;
  const zone = (row.override_양단 ?? '').trim() || (row.도메인 ?? '').trim() || null;
  return {
    session_id: sessionId,
    text,
    jo: (row.조 ?? '').trim() || null,
    zone,
    status: 'active',
  };
}
