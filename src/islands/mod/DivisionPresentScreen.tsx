import { useEffect, useMemo, useState } from 'react';
import { BallotQrFullscreen } from './BallotPanel';
import DivisionCeremony from './DivisionCeremony';
import { NamedResultBoard } from './NamedResultBoard';
import type { WorkshopAuthorization } from '../../lib/deliberation';
import { groupLabel, groupRecTexts, divisionLabel, type Motion, type PrepState } from './division-vote-logic';
import { qrHeadlineOf, qrRowOf } from './division-vote-flow';
import { currentTimetableBlock } from './division-timetable';
import { motionRecViews } from './division-rec-edits';
import DivisionRecList from './DivisionRecList';
import {
  isPresentMessage,
  presentChannelName,
  presentScene,
  presentNamesBallot,
  presentVerdict,
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

      {msg?.practice && !scene.kind.startsWith('ceremony') ? (
        <BallotQrFullscreen key={msg.practice.id} ballot={msg.practice} headline={{ main: msg.practice.title, sub: '연습 투표', eyebrow: '연습' }} onExit={() => undefined} access={access} hideExit hideNames />
      ) : scene.kind === 'vote' ? (
        (() => {
          const row = qrRowOf(scene.record, scene.count ?? 0);
          return row ? (
            <BallotQrFullscreen
              ballot={row}
              headline={qrHeadlineOf(scene.record)}
              onExit={() => undefined}
              access={access} hideExit hideNames
              top={<VoteTimer openedAt={scene.record.openedAt} />}
              extra={msg && scene.motion ? <DivisionRecList views={motionRecViews(msg.state.source, msg.state.recEdits, scene.motion.cardNos)} room="qr" tone="light" /> : null}
            />
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
      ) : scene.kind === 'ceremony' ? (
        <DivisionCeremony
          division={scene.ceremony.division}
          enrolled={scene.ceremony.enrolled}
          present={scene.ceremony.present}
          items={scene.ceremony.items}
          motionCount={scene.ceremony.motionCount}
          sourceLabel={scene.ceremony.sourceLabel}
          controlledStep={scene.ceremony.step}
          displayOnly
          onExit={() => undefined}
        />
      ) : scene.kind === 'counting' ? (
        <Center>
          <p className="text-[36px] font-extrabold text-[#7FC8DE] tr-num">
            {divisionLabel(scene.division)} · {scene.motion.id}
            {scene.round.round > 1 ? ` · ${scene.round.round}차` : ''}
          </p>
          <p className="max-w-[90vw] font-black leading-tight" style={{ fontSize: `${Math.min(64, presentTitleSize(scene.round.title))}px`, wordBreak: 'keep-all', color: '#FFFFFF', margin: 0 }}>
            {scene.round.title}
          </p>
          <p data-testid="present-counting" className="rounded-3xl border-[10px] border-[#FBBF24] px-12 py-4 text-[110px] font-black leading-none text-[#FBBF24]">
            집계 중
          </p>
        </Center>
      ) : scene.kind === 'result' ? (
        <ResultView
          onShowNames={
            access && msg?.state.ballots[scene.round.requestId]?.ballotId
              ? () => setNamesLocal({ msgNames: msg.names ?? null, show: msg.state.ballots[scene.round.requestId]?.ballotId ?? null })
              : undefined
          }
          enrolled={scene.round.enrolled}
          present={scene.round.present}
          division={scene.division}
          motion={scene.motion}
          title={scene.round.title}
          yes={scene.yes}
          no={scene.no}
          threshold={scene.threshold}
          verdict={presentVerdict(scene.round, scene.provisional)}
          roundNo={scene.round.round}
          recs={msg ? <DivisionRecList views={motionRecViews(msg.state.source, msg.state.recEdits, scene.motion.cardNos)} room="result" tone="dark" /> : null}
        />
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

export function ResultView(props: {
  division: number;
  motion: Motion;
  title: string;
  yes: number;
  no: number;
  threshold: number | null;
  verdict: ReturnType<typeof presentVerdict>;
  roundNo: number;
  /** 그 차수 마감 때 박은 재적·참석(10/17 — 가결선 옆에 보인다). */
  enrolled?: number | null;
  present?: number | null;
  /** 있으면 머리줄 오른쪽에 「투표결과 보기」(가결선 글자와 겹치지 않게 위로 옮김). */
  onShowNames?: () => void;
  /** 10/17 오후 — 제목 아래 세부권고 처리 목록(없으면 안 그림). */
  recs?: React.ReactNode;
}) {
  const { division, motion, title, yes, no, threshold, verdict, roundNo, enrolled, present, onShowNames, recs } = props;
  const color = verdict.tone === 'pass' ? '#34D399' : verdict.tone === 'fail' ? '#F87171' : '#FBBF24';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-hidden px-20 pb-12 pt-14">
      {/* 오른쪽 위 「전체 화면」 단추(전체 화면 전)와 한 줄에 겹치지 않게 오른쪽을 비운다(10/17 v2). */}
      <div className="flex items-center gap-6 pr-[min(520px,30vw)]">
        <p className="min-w-0 flex-1 text-[36px] font-extrabold text-[#7FC8DE] tr-num">
          {divisionLabel(division)} · {motion.id}
          {roundNo > 1 ? ` · ${roundNo}차` : ''} · 투표 결과
        </p>
        {onShowNames ? (
          <button
            type="button"
            data-testid="present-show-names"
            onClick={onShowNames}
            className="shrink-0 min-h-12 rounded-xl bg-white/90 px-5 text-[20px] font-extrabold text-[#0B2233]"
          >
            투표결과 보기
          </button>
        ) : null}
      </div>
      <p className="font-black leading-tight" style={{ fontSize: `${Math.min(64, presentTitleSize(title))}px`, wordBreak: 'keep-all' }}>
        {title}
      </p>
      {recs ? <div className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: '-1rem' }}>{recs}</div> : null}
      <div className="mt-auto flex flex-wrap items-end gap-16">
        {/* 거수 확인 전(집계 중)에는 잠정 숫자를 띄우지 않는다 — 거수로 바뀔 수 있다(10/17 v2). */}
        {verdict.word === '집계 중' ? null : (
        <>
        <div>
          <p className="text-[40px] font-extrabold text-[#BFE3F0]">찬성</p>
          <p data-testid="present-yes" className="text-[150px] font-black leading-none text-[#34D399] tr-num">{yes}</p>
        </div>
        <div>
          <p className="text-[40px] font-extrabold text-[#BFE3F0]">반대</p>
          <p data-testid="present-no" className="text-[150px] font-black leading-none text-[#F87171] tr-num">{no}</p>
        </div>
        </>
        )}
        <div className="ml-auto text-right">
          <p data-testid="present-verdict" data-verdict={verdict.word} className="rounded-3xl border-[10px] px-12 py-4 text-[120px] font-black leading-none" style={{ borderColor: color, color }}>
            {verdict.word}
          </p>
          {verdict.reason ? <p data-testid="present-verdict-reason" className="mt-3 text-[34px] font-extrabold text-[#FDE68A]">{verdict.reason}</p> : null}
          {threshold !== null ? <p className="mt-4 text-[34px] font-extrabold text-[#FDE68A] tr-num">가결선 찬성 {threshold}표 이상</p> : null}
          {present != null || enrolled != null ? (
            <p data-testid="present-attendance" className="mt-2 text-[30px] font-extrabold text-[#BFE3F0] tr-num">
              참석 {present ?? '—'} · 재적 {enrolled ?? '—'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 큰 화면 투표 타이머 — 투표를 연 시각부터 1분 30초(10/17 현장 지시). 0이 되면 「시간 종료」. */
const VOTE_SECONDS = 90;
function VoteTimer({ openedAt }: { openedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  if (!openedAt) return null;
  const left = Math.max(0, VOTE_SECONDS - Math.floor((now - Date.parse(openedAt)) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const done = left === 0;
  return (
    <p data-testid="vote-timer" className="tr-num mb-2 font-extrabold" style={{ fontSize: 'clamp(40px,4.2vw,80px)', lineHeight: 1.05, color: done ? '#B91C1C' : left <= 15 ? '#B45309' : '#1F4E79' }}>
      {done ? '시간 종료' : `남은 시간 ${mm}:${ss}`}
    </p>
  );
}
