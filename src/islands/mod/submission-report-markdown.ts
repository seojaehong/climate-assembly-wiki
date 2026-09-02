import type { SubmissionReport } from './submission-report';

/**
 * 조별 산출물 내보내기 — 마크다운 렌더.
 *
 * `submission-report.ts` 의 모델을 그대로 옮기기만 한다. 모델을 새로 만들지 않는다.
 * docx·csv·txt 와 같은 층이다 — **모델은 하나, 렌더러만 늘린다.**
 *
 * 이 문자열은 kordoc `markdownToHwpx()` 의 입력이 된다(한글 1단계,
 * `../docs/02-design/features/hangul-full-stack.design.md` §6). 그래서
 * GFM 표 문법을 kordoc 파서가 읽는 형태로 정확히 맞춘다 — 아래 escapeCell 주석 참조.
 *
 * ── 불변식(회의자료 260811) ──────────────────────────────────────────
 *   · 조가 쓴 문장을 그대로 싣는다. 요약·묶음 이름 생성 금지
 *   · 순서를 바꾸지 않는다 · 비슷한 것을 합치지 않는다
 *   · **카드 수가 줄지 않는다** — 표 데이터 행 수 = 모델의 항목 수
 *   · 한 장도 내지 않은 조를 지우지 않고 이름을 남긴다
 */

/** 표 머리 — 순번·이름·내용·근거. */
export const MARKDOWN_TABLE_HEADER = ['순번', '이름', '내용', '근거'];

/**
 * 표 한 칸으로 안전하게 만든다.
 *
 * kordoc 의 GFM 표 파서는 행을 `(?<!\)\|` 로 쪼갠 뒤 `\|` 를 `|` 로 되돌린다
 * (`vendor/kordoc-4.12.0/dist/index.js:23515`). 그래서 파이프는 `\|` 로 이스케이프한다.
 * 줄바꿈은 행을 끊어 버리므로 **공백 한 칸**으로 바꾼다 —
 * 글자를 지우거나 만들지 않는, 표 형식이 요구하는 최소 변형이다.
 * (kordoc 이 반대 방향에서 쓰는 `<br>` 는 md→hwpx 쪽 처리가 확인되지 않아 쓰지 않는다.)
 */
function escapeCell(value: string | number | null): string {
  if (value == null) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ').trim();
}

/** 표 한 줄. 앞뒤 파이프를 반드시 붙인다 — 파서가 `.slice(1, -1)` 로 양끝을 버린다. */
function tableRow(cells: (string | number | null)[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

/** 조 이름 옆에 붙는 기존 표시. 새 문장이 아니라 모델이 이미 가진 라벨이다. */
function teamLabel(teamName: string, tableNo: string | null, statusLabel: string): string {
  const seat = tableNo ? ` (${tableNo}번 테이블)` : '';
  const badge = statusLabel ? ` — ${statusLabel}` : '';
  return `${teamName}${seat}${badge}`;
}

/**
 * 모델 → 마크다운 전문.
 *
 * 계층은 제목(`#`) → 꼭지(`##`) → 분과(`###`) 이고, 분과마다 항목 표가 하나 붙는다.
 * 표의 데이터 행 수를 전부 더하면 `report.totalNotes` 와 같다.
 */
export function reportToMarkdown(report: SubmissionReport): string {
  const out: string[] = [
    `# ${report.title}`,
    '',
    `${report.generatedAt} · ${report.scopeLabel} · 총 ${report.totalNotes}건`,
    '',
  ];

  for (const topic of report.topics) {
    out.push(
      `## ${topic.ordinal}. ${topic.prompt}`,
      '',
      `${topic.teamsWithNotes}/${topic.teamCount}개 조 · ${topic.totalNotes}건`,
      ''
    );

    for (const block of topic.subgroups) {
      const written = block.teams.filter((t) => t.notes.length > 0);
      if (written.length === 0) continue;
      out.push(
        `### ${block.subgroup}`,
        '',
        `${block.teamsWithNotes}/${block.teamCount}개 조 · ${block.totalNotes}건`,
        '',
        tableRow(MARKDOWN_TABLE_HEADER),
        `|${MARKDOWN_TABLE_HEADER.map(() => '---').join('|')}|`
      );
      for (const team of written) {
        const label = teamLabel(team.teamName, team.tableNo, team.statusLabel);
        for (const note of team.notes) {
          out.push(tableRow([note.ordinal, label, note.content, note.rationale]));
        }
      }
      out.push('');
    }

    // 미제출 조는 표 행이 아니라 한 줄로 남긴다 — 지우면 안 되고, 행 수를 흔들어도 안 된다.
    // `hq-submission-board-logic.ts` 의 boardToText 와 같은 정보(개수 + 이름)를 낸다.
    if (topic.silent.length > 0) {
      out.push(`※ 미제출 ${topic.silent.length}개 조 — ${topic.silent.join(', ')}`, '');
    }
  }

  out.push(report.notice, '');
  return out.join('\n');
}

/** 마크다운 안의 표 데이터 행 수. 카드 수 보존 검사(G2)가 이 값을 쓴다. */
export function countMarkdownTableRows(markdown: string): number {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .filter((line) => !/^\|\s*(---\|)+$/.test(line))
    .filter((line) => line !== tableRow(MARKDOWN_TABLE_HEADER)).length;
}
