import { useMemo } from 'react';
import DivisionVotePanel from './DivisionVotePanel';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { LAB_OPS_SOURCES, createFakeBallotApi, labOpsStates } from './division-vote-lab-fake';

/**
 * division-vote-lab 페이지 섬. 주소에 ?ops=1 이 있으면 운영팀 화면(세 분과 현황판 시연 상태)으로 띄운다.
 * 어느 쪽이든 서버를 부르지 않는다 — 준비판은 이 기기 저장(`lab:`/`lab-ops:`), 투표는 메모리 안 가짜 서버.
 */
export default function DivisionVoteLab() {
  const ops = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('ops') === '1';
    } catch {
      return false;
    }
  }, []);
  const api = useMemo(() => createFakeBallotApi(), []);
  const initial = useMemo(() => (ops ? labOpsStates(Date.now()) : undefined), [ops]);
  return (
    <DivisionVotePanel
      access={null}
      fixtureSource={ops ? LAB_OPS_SOURCES : DIVISION_VOTE_FIXTURE}
      ballotApi={api}
      opsPreview={ops}
      initialStates={initial}
    />
  );
}
