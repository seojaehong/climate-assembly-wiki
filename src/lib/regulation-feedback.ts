/**
 * regulation-feedback.ts
 * OCR 파싱 인터페이스 — 6.13 워크숍 3교시 "운영규정" 시민 의견
 *
 * OCR 완료 후 parseOcrMarkdown()을 호출하여 RegulationFeedbackPage 데이터를 채운다.
 * 더미 데이터는 src/pages/ko/regulation-feedback.astro 인라인에 위치.
 *
 * OCR 마크다운 예상 경로:
 *   30_추출/0613_3교시_운영규정_a조_OCR.md
 *   30_추출/0613_3교시_운영규정_b조_OCR.md
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** 시민 포스트잇 / 손글씨 한 건 */
export interface CitizenNote {
  /** OCR 원문 텍스트 */
  text: string;
  /** 의견 유형 (OCR 에이전트가 분류) */
  type: 'strikethrough' | 'insertion' | 'margin-note' | 'postit';
  /** 감정/입장 (분류 가능한 경우만) */
  sentiment?: 'support' | 'concern' | 'question' | 'suggest' | 'neutral';
  /** 수정 후 텍스트 (삭선·삽입 케이스) */
  revised?: string;
}

/** 조항(【제목】) 단위 시민 의견 묶음 */
export interface ArticleFeedback {
  /**
   * 【제목】 형식 사용 — 제X조 번호 없음.
   * 예: "【목적】", "【시민참여단 구성】", "【의제 선정 기준】"
   */
  title: string;
  /** KCRC 초안 원문 요약 (선택 — OCR에 포함된 경우) */
  draftSummary?: string;
  /** A조 또는 B조 */
  group: 'A' | 'B';
  /** 시민 의견 건수 (notes.length와 일치해야 함) */
  noteCount: number;
  /** 의견 상세 목록 */
  notes: CitizenNote[];
  /** 핵심 키워드 (OCR 에이전트가 추출, 없으면 빈 배열) */
  keywords: string[];
}

/** 전체 페이지 데이터 구조 */
export interface RegulationFeedbackData {
  /** 워크숍 날짜 (ISO) */
  date: string;
  /** 총 참여자 수 */
  participantCount: number;
  /** A조 데이터 (OCR 완료 후 채움) */
  groupA: ArticleFeedback[];
  /** B조 데이터 (먼저 완료 예정) */
  groupB: ArticleFeedback[];
}

// ---------------------------------------------------------------------------
// Parser — OCR md 완료 후 호출
// ---------------------------------------------------------------------------

/**
 * OCR 마크다운을 파싱하여 ArticleFeedback[] 반환.
 *
 * 예상 OCR md 포맷:
 * ```
 * ## 【목적】
 * > KCRC 원문: "이 규정은..."
 * - [삭선] 원문 → [수정] 수정안
 * - [포스트잇] 시민 의견 내용
 * - [여백 메모] 메모 내용
 * ```
 *
 * @param md    OCR 마크다운 원문
 * @param group 'A' 또는 'B'
 * @returns     파싱된 ArticleFeedback 배열
 */
export function parseOcrMarkdown(md: string, group: 'A' | 'B'): ArticleFeedback[] {
  const results: ArticleFeedback[] = [];

  // 조항 구분: ## 【...】 헤더로 분리
  const sections = md.split(/^## /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const headerLine = lines[0].trim();

    // 【...】 패턴 추출
    const titleMatch = headerLine.match(/【[^】]+】/);
    if (!titleMatch) continue;
    const title = titleMatch[0];

    let draftSummary: string | undefined;
    const notes: CitizenNote[] = [];
    const keywords: string[] = [];

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();

      // KCRC 원문 요약 (blockquote)
      if (trimmed.startsWith('> KCRC 원문:')) {
        draftSummary = trimmed.replace(/^> KCRC 원문:\s*"?/, '').replace(/"$/, '').trim();
        continue;
      }

      // 키워드 줄
      if (trimmed.startsWith('키워드:') || trimmed.startsWith('> 키워드:')) {
        const kw = trimmed.replace(/^>?\s*키워드:\s*/, '');
        keywords.push(...kw.split(/[,、\s]+/).map(k => k.trim()).filter(Boolean));
        continue;
      }

      // 의견 항목: - [타입] ...
      const noteMatch = trimmed.match(/^-\s*\[([^\]]+)\]\s*(.*)/);
      if (!noteMatch) continue;

      const typeRaw = noteMatch[1].trim();
      const text = noteMatch[2].trim();

      let type: CitizenNote['type'] = 'postit';
      if (typeRaw === '삭선') type = 'strikethrough';
      else if (typeRaw === '삽입' || typeRaw === '수정') type = 'insertion';
      else if (typeRaw === '여백 메모' || typeRaw === '메모') type = 'margin-note';
      else type = 'postit';

      // 삭선: "원문 → 수정안" 형태 파싱
      let revised: string | undefined;
      let noteText = text;
      if (type === 'strikethrough' || type === 'insertion') {
        const arrowIdx = text.indexOf('→');
        if (arrowIdx !== -1) {
          noteText = text.slice(0, arrowIdx).trim();
          revised = text.slice(arrowIdx + 1).trim();
        }
      }

      notes.push({ text: noteText, type, revised });
    }

    results.push({
      title,
      draftSummary,
      group,
      noteCount: notes.length,
      notes,
      keywords,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 조항별 의견 건수 집계 (bar chart용) */
export function countByArticle(
  articles: ArticleFeedback[]
): Array<{ title: string; count: number }> {
  return articles.map(a => ({ title: a.title, count: a.noteCount }));
}

/** 전체 키워드 빈도 집계 (워드클라우드용) */
export function aggregateKeywords(
  articles: ArticleFeedback[]
): Array<{ word: string; freq: number }> {
  const freq: Record<string, number> = {};
  for (const a of articles) {
    for (const kw of a.keywords) {
      freq[kw] = (freq[kw] ?? 0) + 1;
    }
    // 포스트잇 텍스트에서도 간단 추출 가능하나 OCR 에이전트에 위임
  }
  return Object.entries(freq)
    .map(([word, f]) => ({ word, freq: f }))
    .sort((a, b) => b.freq - a.freq);
}
