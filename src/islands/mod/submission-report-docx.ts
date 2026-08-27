import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { SubmissionReport } from './submission-report';

/**
 * 조별 산출물 DOCX 렌더 — submission-report.ts 의 모델을 그대로 문서로 옮기기만 한다.
 *
 * 판단은 모델 쪽에 있고 여기엔 없다. 문장을 줄이거나 합치거나 순서를 바꾸지 않는다.
 * 받는 사람이 워드에서 손보는 것을 전제로 하므로(「약간의 편집」) 표가 아니라 문단으로 낸다 —
 * 표는 글을 고치기 불편하고, 조가 쓴 줄글의 결을 끊는다.
 */

const FONT = '맑은 고딕';

function text(value: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text: value,
    bold: opts.bold,
    // docx의 size는 half-point다. 22 = 11pt.
    size: opts.size ?? 22,
    color: opts.color,
    font: FONT,
  });
}

function para(runs: TextRun[], opts: { spacingBefore?: number; spacingAfter?: number; indent?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    children: runs,
    alignment: opts.align,
    spacing: { before: opts.spacingBefore ?? 0, after: opts.spacingAfter ?? 60 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });
}

/** 모델 → docx Document. 순수 변환이라 테스트에서 그대로 만들어 볼 수 있다. */
export function buildSubmissionReportDoc(report: SubmissionReport): Document {
  const body: Paragraph[] = [];

  body.push(
    new Paragraph({
      children: [text(report.title, { bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
    })
  );
  body.push(
    para([text(`${report.generatedAt} · ${report.scopeLabel} · 총 ${report.totalNotes}건`, { color: '5A6B73' })], {
      spacingAfter: 240,
    })
  );

  for (const topic of report.topics) {
    body.push(
      new Paragraph({
        children: [
          text(`${topic.ordinal}. ${topic.prompt}`, { bold: true, size: 26 }),
          text(`   ${topic.teamsWithNotes}/${topic.teamCount}개 조 · ${topic.totalNotes}건`, {
            size: 20,
            color: '5A6B73',
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
      })
    );

    for (const block of topic.subgroups) {
      const written = block.teams.filter((t) => t.notes.length > 0);
      if (written.length === 0) continue;
      body.push(
        para(
          [
            text(block.subgroup, { bold: true, size: 24 }),
            text(`  ${block.teamsWithNotes}/${block.teamCount}개 조 · ${block.totalNotes}건`, {
              size: 20,
              color: '5A6B73',
            }),
          ],
          { spacingBefore: 160, spacingAfter: 80 }
        )
      );

      for (const team of written) {
        const seat = team.tableNo ? ` (${team.tableNo}번 테이블)` : '';
        const badge = team.statusLabel ? `  — ${team.statusLabel}` : '';
        body.push(
          para([text(`${team.teamName}${seat}`, { bold: true }), text(badge, { size: 20, color: '5A6B73' })], {
            spacingBefore: 100,
            indent: 240,
          })
        );
        for (const note of team.notes) {
          body.push(para([text(`${note.ordinal}. ${note.content}`)], { indent: 520 }));
          if (note.rationale) {
            body.push(
              para([text(`(근거) ${note.rationale}`, { size: 20, color: '5A6B73' })], { indent: 760 })
            );
          }
        }
      }
    }

    if (topic.silent.length > 0) {
      body.push(
        para([text(`※ 미제출 ${topic.silent.length}개 조 — ${topic.silent.join(', ')}`, { size: 20, color: 'B5651D' })], {
          spacingBefore: 140,
          indent: 240,
        })
      );
    }
  }

  body.push(
    para([text(report.notice, { size: 20, color: '5A6B73' })], {
      spacingBefore: 400,
      align: AlignmentType.CENTER,
    })
  );

  return new Document({
    creator: '기후시민회의 모더레이터 콘솔',
    title: report.title,
    sections: [{ children: body }],
  });
}

/** 브라우저에서 내려받을 Blob. */
export function submissionReportBlob(report: SubmissionReport): Promise<Blob> {
  return Packer.toBlob(buildSubmissionReportDoc(report));
}
