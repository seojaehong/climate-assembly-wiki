import {
  groupBySubgroup,
  silentTeams,
  type TeamColumn,
  type TopicBoard,
} from './hq-submission-board-logic';

/**
 * 조별 산출물 내보내기 — 순수 로직(모델 · CSV · 파일명).
 *
 * 문서 렌더(docx)는 submission-report-docx.ts 가 이 모델을 그대로 옮기기만 한다.
 * 나누는 이유는 `ballot-report-docx.ts` 와 같다 — 브라우저 API 없이 vitest 로 검증하려는 것.
 *
 * ── 무엇을 내보내는가 ────────────────────────────────────────────────
 * 16:15 모더레이터 정리회의에서 총괄모더레이터가 종이로 받아 보고, 그 뒤 연구진에게
 * 넘어가는 것이 이 문서다. 그래서 **조가 쓴 문장을 그대로** 싣는다.
 *   · 요약하지 않는다 · 순서를 바꾸지 않는다 · 비슷한 것을 합치지 않는다
 *   · 미제출 조를 목록에서 지우지 않고 이름을 남긴다(회의자료의 소수의견 삭제 금지)
 * 편집은 받는 사람이 워드에서 한다 — 그래서 docx 로 낸다.
 *
 * 시각 문자열은 `Intl`·`toLocale*` 없이 만든다(저장소 관례 — 환경마다 결과가 갈린다).
 */

/** 문서 하단에 늘 붙는 문구. 잠정 산출물을 확정본으로 오인하지 않게 한다. */
export const REPORT_NOTICE =
  '본 자료는 조가 작성한 원문 그대로이며, 문구 정리·통합은 이후 절차에서 이루어집니다.';

export const REPORT_TITLE = '기후시민회의 조별 산출물';

export type ReportNote = {
  ordinal: number;
  content: string;
  rationale: string | null;
};

export type ReportTeam = {
  teamName: string;
  tableNo: string | null;
  /** 최종 제출·재오픈 표시. 없으면 빈 문자열. */
  statusLabel: string;
  notes: ReportNote[];
};

export type ReportSubgroup = {
  subgroup: string;
  teamsWithNotes: number;
  teamCount: number;
  totalNotes: number;
  teams: ReportTeam[];
};

export type ReportTopic = {
  ordinal: number;
  prompt: string;
  teamsWithNotes: number;
  teamCount: number;
  totalNotes: number;
  subgroups: ReportSubgroup[];
  /** 한 장도 내지 않은 조 이름. 문서에 그대로 적는다. */
  silent: string[];
};

export type SubmissionReport = {
  title: string;
  /** 「2026-08-29 14:05」 형태. 호출부가 시각을 넘긴다(여기서 시계를 읽지 않는다). */
  generatedAt: string;
  /** 「전체 15개 조」 또는 「1분과」 또는 「1분과 1조」. */
  scopeLabel: string;
  topics: ReportTopic[];
  totalNotes: number;
  notice: string;
};

/** Date → 「2026-08-29 14:05」. 로컬 getter만 쓴다. */
export function formatStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusLabel(status: TeamColumn['status']): string {
  if (status === 'final') return '최종 제출';
  if (status === 'reopened') return '재오픈됨';
  // 빈 칸으로 두면 표에서 「값이 없다」와 「아직 쓰는 중이다」가 구분되지 않는다.
  return '작성 중';
}

function toReportTeam(team: TeamColumn): ReportTeam {
  return {
    teamName: team.teamName,
    tableNo: team.tableNo,
    statusLabel: statusLabel(team.status),
    notes: team.notes.map((note, index) => ({
      // 화면에서 몇 번째로 보이는지를 그대로 매긴다 — 원문 ordinal 이 비어 있어도 흔들리지 않게.
      ordinal: index + 1,
      content: note.content,
      rationale: note.rationale,
    })),
  };
}

/**
 * 보드 → 보고서 모델.
 *
 * @param boards 꼭지별 보드(이미 분과 필터가 걸려 있으면 그 범위만 담긴다)
 * @param opts.generatedAt 문서에 찍을 시각
 * @param opts.scopeLabel 「전체 15개 조」처럼 무엇을 담았는지
 */
export function buildSubmissionReport(
  boards: TopicBoard[],
  opts: { generatedAt: string; scopeLabel: string; title?: string }
): SubmissionReport {
  const topics: ReportTopic[] = boards.map((board) => ({
    ordinal: board.ordinal,
    prompt: board.prompt,
    teamsWithNotes: board.teamsWithNotes,
    teamCount: board.teams.length,
    totalNotes: board.totalNotes,
    silent: silentTeams(board),
    subgroups: groupBySubgroup(board).map((block) => ({
      subgroup: block.subgroup,
      teamsWithNotes: block.teamsWithNotes,
      teamCount: block.teams.length,
      totalNotes: block.totalNotes,
      teams: block.teams.map(toReportTeam),
    })),
  }));
  return {
    title: opts.title ?? REPORT_TITLE,
    generatedAt: opts.generatedAt,
    scopeLabel: opts.scopeLabel,
    topics,
    totalNotes: topics.reduce((sum, t) => sum + t.totalNotes, 0),
    notice: REPORT_NOTICE,
  };
}

// ============================================================
// 줄글 텍스트 — 붙여넣기용
// ============================================================

/** 사람이 그대로 읽고 붙여넣을 수 있는 전문. 문서와 같은 순서·같은 문장. */
export function reportToText(report: SubmissionReport): string {
  const out: string[] = [
    report.title,
    `${report.generatedAt} · ${report.scopeLabel} · 총 ${report.totalNotes}건`,
    '',
  ];
  for (const topic of report.topics) {
    out.push(
      `■ ${topic.ordinal}. ${topic.prompt}  (${topic.teamsWithNotes}/${topic.teamCount}개 조 · ${topic.totalNotes}건)`
    );
    for (const block of topic.subgroups) {
      const written = block.teams.filter((t) => t.notes.length > 0);
      if (written.length === 0) continue;
      out.push('', `[${block.subgroup}] ${block.teamsWithNotes}/${block.teamCount}개 조 · ${block.totalNotes}건`);
      for (const team of written) {
        const seat = team.tableNo ? ` (${team.tableNo}번 테이블)` : '';
        const badge = team.statusLabel ? ` — ${team.statusLabel}` : '';
        out.push(`  ${team.teamName}${seat}${badge}`);
        for (const note of team.notes) {
          out.push(`    ${note.ordinal}. ${note.content}`);
          if (note.rationale) out.push(`       (근거) ${note.rationale}`);
        }
      }
    }
    if (topic.silent.length > 0) {
      out.push('', `  ※ 미제출 ${topic.silent.length}개 조 — ${topic.silent.join(', ')}`);
    }
    out.push('');
  }
  out.push(report.notice);
  return out.join('\n');
}

// ============================================================
// CSV — 엑셀용
// ============================================================

/** 한 칸을 CSV로 감싼다. 큰따옴표는 두 번 써서 escape 한다. */
function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_HEADER = ['꼭지번호', '꼭지', '분과', '조', '테이블', '상태', '순번', '내용', '근거'];

/**
 * 엑셀에서 바로 열리는 CSV. 한 줄 = 조가 쓴 한 문장.
 *
 * 앞에 BOM(﻿)을 붙인다 — 없으면 엑셀이 한글을 깨서 연다.
 * 아무것도 안 쓴 조도 한 줄로 남긴다(내용 칸이 비어 있는 행) — 목록에서 사라지면 안 된다.
 */
export function reportToCsv(report: SubmissionReport): string {
  const rows: string[] = [CSV_HEADER.map(csvCell).join(',')];
  for (const topic of report.topics) {
    for (const block of topic.subgroups) {
      for (const team of block.teams) {
        if (team.notes.length === 0) {
          rows.push(
            [topic.ordinal, topic.prompt, block.subgroup, team.teamName, team.tableNo, '미제출', '', '', '']
              .map(csvCell)
              .join(',')
          );
          continue;
        }
        for (const note of team.notes) {
          rows.push(
            [
              topic.ordinal,
              topic.prompt,
              block.subgroup,
              team.teamName,
              team.tableNo,
              team.statusLabel,
              note.ordinal,
              note.content,
              note.rationale,
            ]
              .map(csvCell)
              .join(',')
          );
        }
      }
    }
  }
  return `﻿${rows.join('\r\n')}\r\n`;
}

// ============================================================
// 파일명
// ============================================================

/** 파일명에 못 쓰는 글자를 걷어낸다. svg-to-png의 safeSegment와 같은 자리를 노린다. */
function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

/** 「기후시민회의_조별산출물_전체15개조_20260829-1405.docx」 */
export function reportFileName(
  report: SubmissionReport,
  // 'zip' 은 세 형식을 한 번에 묶어 내보내는 「전부 받기」의 겉봉 이름이다(team-download-bundle.ts).
  // 이름 규칙은 개별 파일과 같아야 압축을 풀었을 때 같은 문서로 읽힌다.
  ext: 'docx' | 'csv' | 'txt' | 'zip'
): string {
  const stamp = report.generatedAt.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const scope = safeName(report.scopeLabel).replace(/\s+/g, '') || '전체';
  return `기후시민회의_조별산출물_${scope}_${stamp}.${ext}`;
}
