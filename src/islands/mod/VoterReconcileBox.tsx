import { useMemo, useState } from 'react';
import { ballotVoterCorrect, type WorkshopAuthorization } from '../../lib/deliberation';
import {
  displayVoterName,
  namedCsvRows,
  namedCsvText,
  reconcile,
  responseChoiceText,
  rosterTeams,
  type NamedResponse,
} from '../../lib/named-vote-logic';
import { useNamedResponses } from './NamedResultBoard';
import { downloadBlob } from './svg-to-png';

/**
 * 실명 투표(10/17) 「제출자 대조」 — 투표 하나의 명단 대비 제출 현황(운영 노트북 전용, 큰 화면에는 띄우지 않는다).
 * 명단 N · 제출 M · 미제출 K, 조별 미제출 이름(거수한 분도 여기 나온다 = 「QR 미제출」), 명단에 없는 이름(오타 의심),
 * 같은 이름 두 번. 조·이름 정정(찬반은 못 고침, 정정 이력은 서버 감사 기록). 실명 CSV.
 * 판단은 named-vote-logic.ts(순수, vitest).
 */
export default function VoterReconcileBox({
  access,
  ballotId,
  csvName,
}: {
  access: WorkshopAuthorization | null;
  ballotId: string;
  csvName: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, missing, failed, reload } = useNamedResponses(access, ballotId, open, 5000);
  const rec = useMemo(() => (data ? reconcile(data.roster, data.responses) : null), [data]);
  const teams = useMemo(() => (data ? rosterTeams(data.roster) : []), [data]);
  const [edit, setEdit] = useState<{ id: string; team: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (missing) return null;

  const save = async () => {
    if (!access || !edit) return;
    setBusy(true);
    setMsg(null);
    try {
      await ballotVoterCorrect(access, ballotId, edit.id, edit.team, displayVoterName(edit.name));
      setEdit(null);
      setMsg('고쳤습니다(찬반은 그대로).');
      reload();
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message ?? '';
      setMsg(m.includes('name already submitted') ? '그 이름으로 이미 다른 제출이 있습니다.' : m.includes('team not in roster') ? '명단에 없는 조입니다.' : '고치지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const csv = () => {
    if (!data) return;
    const rows = namedCsvRows(data.title, data.items, data.responses);
    downloadBlob(new Blob([namedCsvText(rows)], { type: 'text/csv;charset=utf-8' }), `1017_실명_${csvName}.csv`);
  };

  const row = (r: NamedResponse, hint?: string | null) => (
    <li key={r.id} className="flex flex-wrap items-center gap-2 text-[16px]">
      <span className="font-bold">{r.voter_team ?? '조 없음'} {displayVoterName(r.voter_name)}</span>
      <span className="text-[#5A6B73]">{data ? responseChoiceText(r.answers ?? {}, data.items) : ''}</span>
      {hint ? <span className="text-[#8A5A00]">{hint}</span> : null}
      <button
        type="button"
        className="rounded-lg border border-[#C4D8E4] px-3 py-1 text-[15px] font-bold text-[#1F4E79]"
        onClick={() => setEdit({ id: r.id, team: r.voter_team ?? teams[0]?.team ?? '', name: displayVoterName(r.voter_name) })}
      >
        조·이름 고치기
      </button>
    </li>
  );

  return (
    <details
      className="rounded-xl border border-[#DCE7EE]"
      data-testid="voter-reconcile"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="min-h-12 cursor-pointer px-4 py-3 text-[17px] font-extrabold text-[#1F4E79] tr-num">
        제출자 대조{rec ? ` · 명단 ${rec.rosterCount} · 제출 ${rec.submitted} · 미제출 ${rec.missingCount}` : ''}
        {rec && (rec.offRoster.length || rec.duplicates.length) ? (
          <span className="ml-2 text-[#B45309]">· 확인 필요 {rec.offRoster.length + rec.duplicates.length}</span>
        ) : null}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {!data ? <p className="text-[16px] text-[#5A6B73]">{failed ? '불러오지 못했습니다 — 다시 시도하는 중' : '불러오는 중…'}</p> : null}
        {rec ? (
          <>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="min-h-12 rounded-xl bg-[#135C73] px-4 text-[16px] font-bold text-white" onClick={csv} data-testid="named-csv">
                실명 CSV (조·이름·찬반)
              </button>
              <button type="button" className="min-h-12 rounded-xl border border-[#C4D8E4] px-4 text-[16px] font-bold text-[#1F4E79]" onClick={reload}>
                새로 읽기
              </button>
            </div>
            {rec.anonymous ? <p className="text-[15px] text-[#5A6B73]">이름 없이 들어온 제출 {rec.anonymous}건(실명 받기 전 화면).</p> : null}
            {rec.offRoster.length ? (
              <section>
                <h4 className="text-[16px] font-extrabold text-[#B45309]">명단에 없는 조·이름(오타 의심) {rec.offRoster.length}</h4>
                <ul className="mt-1 space-y-1">{rec.offRoster.map((o) => row(o.response, o.rosterTeam ? `명단에는 ${o.rosterTeam}` : null))}</ul>
              </section>
            ) : null}
            {rec.duplicates.length ? (
              <section>
                <h4 className="text-[16px] font-extrabold text-[#B91C1C]">같은 이름 두 번 {rec.duplicates.length}</h4>
                <ul className="mt-1 space-y-1">{rec.duplicates.flatMap((d) => d.responses.map((r) => row(r)))}</ul>
              </section>
            ) : null}
            {edit ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#F5F8FB] p-3">
                <select
                  className="h-12 rounded-lg border border-[#C4D8E4] px-2 text-[16px]"
                  value={edit.team}
                  onChange={(e) => setEdit({ ...edit, team: e.target.value })}
                  aria-label="조"
                >
                  {teams.map((t) => (
                    <option key={t.team} value={t.team}>{t.team}</option>
                  ))}
                </select>
                <input
                  className="h-12 rounded-lg border border-[#C4D8E4] px-3 text-[16px]"
                  value={edit.name}
                  list={`roster-${ballotId}`}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  aria-label="이름"
                />
                <datalist id={`roster-${ballotId}`}>
                  {(teams.find((t) => t.team === edit.team)?.names ?? []).map((n) => (
                    <option key={n.name} value={n.name} />
                  ))}
                </datalist>
                <button type="button" disabled={busy} className="h-12 rounded-lg bg-[#1F4E79] px-4 text-[16px] font-bold text-white" onClick={() => void save()}>
                  {busy ? '저장 중…' : '저장(조·이름만)'}
                </button>
                <button type="button" className="h-12 rounded-lg border border-[#C4D8E4] px-4 text-[16px]" onClick={() => setEdit(null)}>
                  취소
                </button>
              </div>
            ) : null}
            {msg ? <p className="text-[15px] font-bold text-[#1F4E79]">{msg}</p> : null}
            <section>
              <h4 className="text-[16px] font-extrabold text-[#1F4E79]">QR 미제출 {rec.missingCount} (거수한 분 포함)</h4>
              <ul className="mt-1 space-y-1 text-[16px]">
                {rec.missing.map((t) => (
                  <li key={t.team}>
                    <b>{t.short}</b> {t.names.map((n) => n.name).join(', ')}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </details>
  );
}
