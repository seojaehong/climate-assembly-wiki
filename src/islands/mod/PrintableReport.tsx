import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SubmissionReport } from './submission-report';

/**
 * 인쇄 전용 화면 — 종이에 나갈 것만 담는다.
 *
 * 예전에는 `window.print()`가 보고 있던 화면을 그대로 찍었다. 작성 안내·빈 입력칸·
 * 잠금 배지·버튼이 종이에 그대로 나와 읽을 수가 없었다. 그래서 화면과 별개로
 * **보고서 모델(submission-report.ts)을 그대로 옮긴 문서**를 만들고, 인쇄할 때는
 * 그것만 보이게 한다(mod.astro·hq.astro의 @media print 규칙).
 *
 * 내려받는 워드 문서와 **같은 모델**을 쓴다. 종이와 파일의 내용이 갈리면
 * 같은 자료를 두고 어느 쪽이 맞는지 다투게 된다.
 *
 * 색을 쓰지 않는다 — 행사장 프린터는 대개 흑백이고, 회색 글자는 종이에서 날아간다.
 *
 * ── 왜 body 직속으로 옮겨 붙이나 ─────────────────────────────────────
 * 처음에는 이 문서를 화면 컴포넌트 안에 그대로 두었다. 그랬더니 인쇄할 때 **부모
 * section 이 display:none 이 되면서 문서가 통째로 사라져 백지가 나갔다.**
 * visibility 는 자식에서 되살릴 수 있지만 **display:none 은 되살릴 수 없다** —
 * 조상이 하나라도 꺼지면 그 아래는 전부 없는 것이 된다.
 *
 * 그래서 CSS로 조상을 일일이 되살리는 대신 **조상을 없앤다.** body 직속으로 옮겨
 * 붙이면 어떤 화면이 어떻게 바뀌든 이 문서는 영향을 받지 않는다. 화면 쪽에 새 래퍼가
 * 생겨도 다시 깨지지 않는다는 뜻이라, 규칙보다 구조로 막는 편이 오래 간다.
 */
export default function PrintableReport({ report }: { report: SubmissionReport }) {
  // 서버 렌더·수화 이전에는 document 가 없다. 붙은 뒤에 옮겨 붙인다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="print-root" aria-hidden="true">
      <h1 style={{ fontSize: '20pt', fontWeight: 800, margin: '0 0 4pt' }}>{report.title}</h1>
      <p style={{ fontSize: '10pt', margin: '0 0 14pt' }}>
        {report.generatedAt} · {report.scopeLabel} · 총 {report.totalNotes}건
      </p>

      {report.topics.map((topic) => (
        <section key={topic.ordinal} style={{ marginBottom: '16pt', breakInside: 'auto' }}>
          <h2
            style={{
              fontSize: '14pt',
              fontWeight: 800,
              borderBottom: '1.5pt solid #000',
              paddingBottom: '3pt',
              margin: '0 0 8pt',
            }}
          >
            {topic.ordinal}. {topic.prompt}
            <span style={{ fontSize: '10pt', fontWeight: 400, marginLeft: '8pt' }}>
              {topic.teamsWithNotes}/{topic.teamCount}개 조 · {topic.totalNotes}건
            </span>
          </h2>

          {topic.subgroups.map((block) => {
            const written = block.teams.filter((team) => team.notes.length > 0);
            if (written.length === 0) return null;
            return (
              <div key={block.subgroup} style={{ marginBottom: '10pt' }}>
                <h3 style={{ fontSize: '12pt', fontWeight: 700, margin: '0 0 5pt' }}>
                  {block.subgroup}
                  <span style={{ fontSize: '10pt', fontWeight: 400, marginLeft: '6pt' }}>
                    {block.teamsWithNotes}/{block.teamCount}개 조 · {block.totalNotes}건
                  </span>
                </h3>
                {written.map((team) => (
                  // 한 조의 글이 페이지 경계에서 갈리지 않게 한다.
                  <div key={team.teamName} style={{ marginBottom: '7pt', breakInside: 'avoid' }}>
                    <p style={{ fontSize: '11pt', fontWeight: 700, margin: '0 0 3pt' }}>
                      {team.teamName}
                      {team.tableNo ? ` (${team.tableNo}번 테이블)` : ''}
                      {team.statusLabel ? ` — ${team.statusLabel}` : ''}
                    </p>
                    <ol style={{ margin: 0, paddingLeft: '18pt' }}>
                      {team.notes.map((note) => (
                        <li key={note.ordinal} style={{ fontSize: '11pt', lineHeight: 1.45, marginBottom: '2pt' }}>
                          {note.content}
                          {note.rationale ? (
                            <div style={{ fontSize: '9.5pt', paddingLeft: '2pt' }}>(근거) {note.rationale}</div>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            );
          })}

          {topic.silent.length > 0 ? (
            <p style={{ fontSize: '10pt', margin: '6pt 0 0' }}>
              ※ 미제출 {topic.silent.length}개 조 — {topic.silent.join(', ')}
            </p>
          ) : null}
        </section>
      ))}

      <p style={{ fontSize: '9pt', marginTop: '16pt', textAlign: 'center' }}>{report.notice}</p>
    </div>,
    document.body,
  );
}
