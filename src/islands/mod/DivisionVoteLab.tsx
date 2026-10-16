import { useMemo } from 'react';
import DivisionVotePanel from './DivisionVotePanel';
import { BallotQrFullscreen } from './BallotPanel';
import { NamedResultBoard } from './NamedResultBoard';
import type { BallotNamedResponses } from '../../lib/deliberation';

/** ?board=qr|names — 큰 화면 두 장(QR · 투표결과 보기)을 가상 데이터로 본다(1920×1080 육안 확인용). */
function labBoardFixture(n: number, longTitle: boolean): BallotNamedResponses {
  const syl = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
  const responses = Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    voter_team: `1분과 ${(i % 5) + 1}조`,
    voter_name: `${syl[i % 14]}${syl[(i * 3 + 1) % 14]}${syl[(i * 5 + 2) % 14]}`,
    voter_in_roster: true,
    answers: { item1: i % 4 === 0 ? 1 : 2 },
    submitted_at: '2026-10-17T07:00:00Z',
  }));
  return {
    id: 'lab-ballot',
    title: 'lab',
    status: 'closed',
    subgroup: '1분과',
    settings: { collect: true, show_names: true },
    items: [{ id: 'item1', ordinal: 1, statement: '안', scale: 2 }],
    roster: [],
    responses: responses.slice(0, longTitle ? n : n),
  };
}
const LAB_LONG_TITLE =
  '가상 안건 — 탄소 정보 공시 의무를 단계적으로 넓히고 중소기업에는 준비 기간과 비용 지원을 함께 제공하며, 인증 기관의 독립성과 검증 절차를 법으로 정하고, 공시 결과를 시민이 한곳에서 볼 수 있도록 공개 누리집을 만들며, 이행 실적을 해마다 국회에 보고하도록 한다. 지역별 차이를 고려해 지자체 협의체를 두고 결과를 다음 해 계획에 반영한다.';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { LAB_OPS_SOURCES, createFakeBallotApi, createFakePrepServer, labOpsStates, labPairState } from './division-vote-lab-fake';

/**
 * division-vote-lab 페이지 섬. 주소에 ?ops=1 이 있으면 운영팀 화면(세 분과 현황판 시연 상태)으로 띄운다.
 * ?pair=1 이면 같은 2분과 화면 두 개(PC-A·PC-B)를 나란히 띄우고 메모리 안 가짜 공유 저장으로 잇는다 —
 * 두 화면이 동시에 고칠 때 충돌·다시 적용(10/14 operator-4)을 눈으로 확인하는 시연.
 * 어느 쪽이든 서버를 부르지 않는다 — 준비판은 이 기기 저장(`lab:`/`lab-ops:`/`lab-pair-*:`), 투표는 메모리 안 가짜 서버.
 */
export default function DivisionVoteLab() {
  const mode = useMemo(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return q.get('pair') === '1' ? 'pair' : q.get('ops') === '1' ? 'ops' : 'one';
    } catch {
      return 'one';
    }
  }, []);
  const api = useMemo(() => createFakeBallotApi(), []);
  const initial = useMemo(() => (mode === 'ops' ? labOpsStates(Date.now()) : undefined), [mode]);
  const pair = useMemo(() => (mode === 'pair' ? createFakePrepServer({ 2: labPairState(Date.now()) }) : null), [mode]);
  const pairApi = useMemo(() => (pair ? pair.apiFor('2분과') : null), [pair]);
  const board = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('board');
    } catch {
      return null;
    }
  }, []);
  const boardN = useMemo(() => {
    try {
      return Number(new URLSearchParams(window.location.search).get('n') ?? '61') || 61;
    } catch {
      return 61;
    }
  }, []);
  if (board === 'qr') {
    return (
      <BallotQrFullscreen
        ballot={{ id: 'lab', title: 'lab', status: 'open', token: 'f'.repeat(32), subgroup: '1분과', item_count: 1, response_count: 42, created_at: '' }}
        headline={{ main: LAB_LONG_TITLE, sub: '1-1 안1' }}
        onExit={() => undefined}
      />
    );
  }
  if (board === 'names') {
    return <NamedResultBoard access={null} ballotId="lab-ballot" title={LAB_LONG_TITLE} sub="1분과 · 1-1 · QR 투표" fixture={labBoardFixture(boardN, true)} onBack={() => undefined} />;
  }

  if (pair && pairApi) {
    return (
      <div className="grid gap-4 xl:grid-cols-2" data-testid="lab-pair">
        {(['A', 'B'] as const).map((pc) => (
          <div key={pc} data-pc={pc} className="min-w-0">
            <p className="mb-2 text-[18px] font-extrabold text-[#1F4E79]">PC-{pc}</p>
            <DivisionVotePanel
              access={null}
              fixtureSource={DIVISION_VOTE_FIXTURE}
              subgroup="2분과"
              teamName={`PC-${pc}`}
              ballotApi={api}
              labPrepApi={pairApi}
              labStorageNs={`lab-pair-${pc}:`}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <DivisionVotePanel
      access={null}
      fixtureSource={mode === 'ops' ? LAB_OPS_SOURCES : DIVISION_VOTE_FIXTURE}
      ballotApi={api}
      opsPreview={mode === 'ops'}
      initialStates={initial}
    />
  );
}
