import { useEffect, useMemo, useState } from 'react';
import { BallotQrFullscreen } from './BallotPanel';
import { NamedResultBoard } from './NamedResultBoard';
import type { WorkshopAuthorization } from '../../lib/deliberation';
import { groupLabel, groupRecTexts, divisionLabel, type Motion, type PrepState } from './division-vote-logic';
import { qrHeadlineOf, qrRowOf } from './division-vote-flow';
import { currentTimetableBlock } from './division-timetable';
import {
  isPresentMessage,
  presentChannelName,
  presentScene,
  presentNamesBallot,
  presentTitleSize,
  type PresentNamesLocal,
  type PresentStateMessage,
} from './division-present';

/**
 * 발표 창(10/15) — 분과 PC 의 프로젝터 모니터에 띄운다. 운영 화면이 보내는 상태를 그대로 그리고, 아무것도 저장하지 않는다.
 * 200명·8~15m 시청 기준: 제목 44~96px, 숫자 140px, 본문 28px 이상, 진한 배경에 흰 글자.
 */
export default function DivisionPresentScreen({ scope, access = null }: { scope: string; access?: WorkshopAuthorization | null }) {
  const [namesLocal, setNamesLocal] = useState<PresentNamesLocal | null>(null);
  const [msg, setMsg] = useState<PresentStateMessage | null>(null);
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel(presentChannelName(scope));
    ch.onmessage = (e) => {
      if (!isPresentMessage(e.data) || e.data.kind !== 'state') return;
      setMsg(e.data);
      setLastAt(Date.now());
    };
    const ping = () => ch.postMessage({ kind: 'alive', v: 1 });
    ping();
    const id = setInterval(ping, 1500);
    return () => {
      clearInterval(id);
      ch.close();
    };
  }, [scope]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(id);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const scene = useMemo(() => presentScene(msg), [msg]);
  const namesBallot = presentNamesBallot(
    msg?.names,
    namesLocal,
    scene.kind === 'result' ? msg?.state.ballots[scene.round.requestId]?.ballotId : null,
  );
  const stale = msg !== null && now - lastAt > 8000;

  return (
    <div data-testid="present-screen" data-scene={scene.kind} className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[#0B2233] text-white">
      {!full ? (
        <button
          type="button"
          data-testid="present-fullscreen"
          onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
          className="absolute right-6 top-6 z-10 min-h-12 rounded-xl bg-white px-5 text-[20px] font-extrabold text-[#0B2233]"
        >
          전체 화면 (이 창을 프로젝터로 옮긴 뒤)
        </button>
      ) : null}
      {stale ? (
        <p data-testid="present-stale" className="absolute left-6 top-6 z-10 rounded-xl bg-[#B45309] px-5 py-2 text-[22px] font-extrabold">
          운영 화면 연결 끊김 — 마지막 화면입니다
        </p>
      ) : null}

      {scene.kind === 'vote' ? (
        (() => {
          const row = qrRowOf(scene.record, scene.count ?? 0);
          return row ? (
            <BallotQrFullscreen ballot={row} headline={qrHeadlineOf(scene.record)} onExit={() => undefined} access={access} hideExit />
          ) : (
            <Center>
              <p className="text-[56px] font-black">투표를 여는 중입니다</p>
            </Center>
          );
        })()
      ) : scene.kind === 'result' && access && namesBallot ? (
        <NamedResultBoard
          key={namesBallot}
          access={access}
          ballotId={namesBallot}
          title={scene.round.title}
          sub={`${divisionLabel(scene.division)} · ${scene.motion.id}${scene.round.round > 1 ? ` · ${scene.round.round}차` : ''} · QR 투표`}
          onBack={() => setNamesLocal({ msgNames: msg?.names ?? null, show: null })}
          backLabel="결과로 돌아가기"
          live={false}
        />
      ) : scene.kind === 'result' ? (
        <>
        {access && msg?.state.ballots[scene.round.requestId]?.ballotId ? (
          <button
            type="button"
            data-testid="present-show-names"
            onClick={() => setNamesLocal({ msgNames: msg.names ?? null, show: msg.state.ballots[scene.round.requestId]?.ballotId ?? null })}
            className="absolute bottom-6 right-6 z-10 min-h-12 rounded-xl bg-white/90 px-5 text-[20px] font-extrabold text-[#0B2233]"
          >
            투표결과 보기
          </button>
        ) : null}
        <ResultView
          division={scene.division}
          motion={scene.motion}
          title={scene.round.title}
          yes={scene.yes}
          no={scene.no}
          threshold={scene.threshold}
          provisional={scene.provisional}
          passed={scene.round.verdict === 'passed'}
          roundNo={scene.round.round}
        />
        </>
      ) : scene.kind === 'motion' && msg ? (
        <MotionView state={msg.state} motion={scene.motion} />
      ) : (
        <IdleView state={msg?.state ?? null} />
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-6 px-16 text-center">{children}</div>;
}

function IdleView({ state }: { state: PrepState | null }) {
  const block = currentTimetableBlock(new Date());
  if (!state) {
    return (
      <Center>
        <p className="text-[64px] font-black">10/17 분과 의결</p>
        <p className="text-[32px] font-bold text-[#BFE3F0]">운영 화면(노트북)의 분과 화면을 열어 두면 이 창이 따라갑니다</p>
      </Center>
    );
  }
  return (
    <Center>
      <p className="text-[48px] font-extrabold text-[#7FC8DE]">{divisionLabel(state.division)}</p>
      <p className="text-[72px] font-black leading-tight">{state.source.agenda}</p>
      {block ? (
        <p className="mt-6 rounded-2xl bg-white/10 px-8 py-4 text-[40px] font-extrabold">
          {block.start}~{block.end} · {block.label}
        </p>
      ) : null}
    </Center>
  );
}

/** 안 하나 — 제목(운영자가 치는 대로)과 세부 권고. */
function MotionView({ state, motion }: { state: PrepState; motion: Motion }) {
  const recs = useMemo(() => {
    if (motion.group) return groupRecTexts(state.source, motion.group.recs).map((r) => ({ no: r.no, text: r.text ?? '' }));
    const set = new Set(motion.cardNos);
    return state.source.topics.flatMap((t) => t.cards.filter((c) => set.has(c.no)).flatMap((c) => c.recs.map((r) => ({ no: r.no, text: r.text }))));
  }, [state.source, motion.group, motion.cardNos]);
  const title = motion.title.trim();
  return (
    <div className="flex flex-1 flex-col gap-8 overflow-hidden px-20 pb-12 pt-16">
      <p className="text-[36px] font-extrabold text-[#7FC8DE] tr-num">
        {divisionLabel(state.division)} · {motion.id}
        {motion.group?.name ? <span className="ml-4 text-[30px] text-[#BFE3F0]">{motion.group.letter ? `묶음 ${groupLabel(motion.group)}` : `공통 취지: ${motion.group.name}`}</span> : null}
      </p>
      <h1
        data-testid="present-title"
        className="font-black leading-[1.25]"
        // 사이트 공통 h1 색이 클래스보다 앞서 어두운 글자가 됐다(10/15 캡처) — 색은 인라인으로 박는다.
        style={{ fontSize: `${presentTitleSize(title || '합친 문구를 입력하는 중')}px`, wordBreak: 'keep-all', color: title ? '#FFFFFF' : 'rgba(255,255,255,0.45)', margin: 0 }}
      >
        {title || '합친 문구를 입력하는 중'}
      </h1>
      {recs.length ? (
        <ol data-testid="present-recs" className="min-h-0 flex-1 space-y-3 overflow-hidden border-t-2 border-white/20 pt-6 text-[28px] leading-snug text-[#E6F2F7]">
          {recs.map((r) => (
            <li key={r.no} className="flex gap-4" style={{ wordBreak: 'keep-all' }}>
              <span className="shrink-0 font-extrabold text-[#7FC8DE] tr-num">{r.no}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ResultView(props: {
  division: number;
  motion: Motion;
  title: string;
  yes: number;
  no: number;
  threshold: number | null;
  provisional: boolean;
  passed: boolean;
  roundNo: number;
}) {
  const { division, motion, title, yes, no, threshold, provisional, passed, roundNo } = props;
  const color = provisional ? '#FBBF24' : passed ? '#34D399' : '#F87171';
  return (
    <div className="flex flex-1 flex-col gap-8 px-20 pb-12 pt-14">
      <p className="text-[36px] font-extrabold text-[#7FC8DE] tr-num">
        {divisionLabel(division)} · {motion.id}
        {roundNo > 1 ? ` · ${roundNo}차` : ''} · 투표 결과
      </p>
      <p className="font-black leading-tight" style={{ fontSize: `${Math.min(64, presentTitleSize(title))}px`, wordBreak: 'keep-all' }}>
        {title}
      </p>
      <div className="mt-auto flex flex-wrap items-end gap-16">
        <div>
          <p className="text-[40px] font-extrabold text-[#BFE3F0]">찬성</p>
          <p data-testid="present-yes" className="text-[150px] font-black leading-none text-[#34D399] tr-num">{yes}</p>
        </div>
        <div>
          <p className="text-[40px] font-extrabold text-[#BFE3F0]">반대</p>
          <p data-testid="present-no" className="text-[150px] font-black leading-none text-[#F87171] tr-num">{no}</p>
        </div>
        <div className="ml-auto text-right">
          <p data-testid="present-verdict" className="rounded-3xl border-[10px] px-12 py-4 text-[120px] font-black leading-none" style={{ borderColor: color, color }}>
            {provisional ? '집계 중' : passed ? '가결' : '부결'}
          </p>
          {threshold !== null ? <p className="mt-4 text-[34px] font-extrabold text-[#FDE68A] tr-num">가결선 찬성 {threshold}표 이상</p> : null}
        </div>
      </div>
    </div>
  );
}
