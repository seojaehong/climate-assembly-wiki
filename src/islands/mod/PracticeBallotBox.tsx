import { useEffect, useState } from 'react';
import { ballotList, ballotResults, ballotSetStatus, type BallotListRow, type WorkshopAuthorization } from '../../lib/deliberation';
import { BallotQrFullscreen } from './BallotPanel';
import { NamedResultBoard } from './NamedResultBoard';
import { practiceBallots, practiceTally } from './division-practice';

/**
 * 10/17 연습 투표 상자 — 「N분과 연습 투표」(단독 투표)를 띄우고 마감만 한다. 준비판에는 아무것도 쓰지 않는다.
 * 분과 화면은 자기 분과 것, 운영팀은 셋 다. 3초마다 목록·찬반을 다시 읽는다.
 */
export default function PracticeBallotBox({
  access,
  division,
  presenting,
  onPresent,
}: {
  access: WorkshopAuthorization;
  division: number | null;
  /** 지금 발표 화면에 띄운 연습 투표 id. */
  presenting: string | null;
  onPresent: (row: BallotListRow | null) => void;
}) {
  const [rows, setRows] = useState<BallotListRow[]>([]);
  const [tally, setTally] = useState<Record<string, { yes: number; no: number }>>({});
  const [qr, setQr] = useState<string | null>(null);
  const [names, setNames] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = practiceBallots(await ballotList(access), division);
        if (!alive) return;
        setRows(list);
        const t: Record<string, { yes: number; no: number }> = {};
        for (const b of list) {
          const r = await ballotResults(b.token, access).catch(() => null);
          t[b.id] = practiceTally(r?.items?.[0]?.dist);
        }
        if (alive) setTally(t);
      } catch (error) {
        console.warn('[practice ballots] list failed', error);
      }
    };
    void load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [access, division]);

  useEffect(() => {
    // 띄운 투표가 바뀌면(마감·제출 수) 발표 화면에도 새 줄을 보낸다.
    const cur = rows.find((r) => r.id === presenting);
    if (presenting && cur) onPresent(cur);
  }, [rows, presenting, onPresent]);

  if (!rows.length) return null;
  const qrRow = rows.find((r) => r.id === qr) ?? null;
  const namesRow = rows.find((r) => r.id === names) ?? null;
  return (
    <section data-testid="practice-box" className="rounded-2xl border-2 border-dashed border-[#7A4B00] bg-[#FFF8EB] p-4">
      <p className="text-[18px] font-black text-[#7A4B00]">연습 투표 <span className="text-[15px] font-bold">(의결·세리머니·결과 CSV 에 들어가지 않습니다)</span></p>
      <ul className="mt-2 space-y-2">
        {rows.map((b) => {
          const t = tally[b.id] ?? { yes: 0, no: 0 };
          const on = presenting === b.id;
          return (
            <li key={b.id} data-testid="practice-row" data-status={b.status} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-3 py-2">
              <span className="text-[18px] font-extrabold text-[#1F2933]">{b.title}</span>
              <span className="rounded-lg bg-[#F1F5F9] px-2 py-0.5 text-[15px] font-bold text-[#4B5563]">{b.status === 'open' ? '진행 중' : b.status === 'closed' ? '마감' : b.status}</span>
              <span data-testid="practice-counts" className="text-[17px] font-extrabold tr-num">
                <span className="text-[#2F6F25]">찬성 {t.yes}</span> · <span className="text-[#B91C1C]">반대 {t.no}</span> · <span className="text-[#1F4E79]">제출 {b.response_count}</span>
              </span>
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" data-testid="practice-qr" className="min-h-11 rounded-xl bg-[#135C73] px-4 text-[16px] font-bold text-white" onClick={() => setQr(b.id)}>
                  QR 크게
                </button>
                <button
                  type="button"
                  data-testid="practice-present"
                  className={`min-h-11 rounded-xl px-4 text-[16px] font-bold ${on ? 'bg-[#B45309] text-white' : 'border border-[#135C73] bg-white text-[#135C73]'}`}
                  onClick={() => onPresent(on ? null : b)}
                >
                  {on ? '발표 화면에서 내리기' : '발표 화면에 띄우기'}
                </button>
                <button type="button" data-testid="practice-names" className="min-h-11 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]" onClick={() => setNames(b.id)}>
                  투표결과 보기(조·이름)
                </button>
                {b.status === 'open' ? (
                  <button
                    type="button"
                    data-testid="practice-close"
                    className="min-h-11 rounded-xl border-2 border-[#B91C1C] bg-white px-4 text-[16px] font-bold text-[#B91C1C]"
                    onClick={() => {
                      if (!window.confirm(`「${b.title}」을 마감합니다.`)) return;
                      ballotSetStatus(access, b.id, 'closed')
                        .then(() => setMsg(`${b.title} 마감`))
                        .catch(() => setMsg('마감하지 못했습니다. 다시 누르십시오.'));
                    }}
                  >
                    연습 마감
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {msg ? <p className="mt-2 text-[15px] font-bold text-[#7A4B00]">{msg}</p> : null}
      {qrRow ? (
        <BallotQrFullscreen ballot={qrRow} headline={{ main: qrRow.title, sub: '연습 투표', eyebrow: '연습' }} onExit={() => setQr(null)} access={access} />
      ) : null}
      {namesRow ? (
        <div className="fixed inset-0 z-50 bg-white">
          <NamedResultBoard access={access} ballotId={namesRow.id} title={namesRow.title} sub="연습 투표" onBack={() => setNames(null)} live={namesRow.status === 'open'} />
        </div>
      ) : null}
    </section>
  );
}
