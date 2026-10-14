import { useMemo } from 'react';
import DivisionVotePanel from './DivisionVotePanel';
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
