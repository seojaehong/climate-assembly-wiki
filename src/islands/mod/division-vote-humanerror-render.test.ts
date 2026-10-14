import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionEditor, MotionVoteBlock, UnitCard } from './DivisionVotePanel';
import DivisionCeremony from './DivisionCeremony';
import { ClosedScreen, ConfirmDialog, ItemBlock } from '../ballot/BallotCard';
import { ballotChoices, decisionChoiceOf } from '../ballot/ballot-logic';
import { createMotion, initPrepState, updateMotion, type PrepState } from './division-vote-logic';
import {
  applyBallotResults,
  beginVote,
  confirmHandCount,
  markBallotCreated,
  markBallotOpened,
  requestRevote,
  voteUnits,
} from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import type { BallotResults } from '../../lib/deliberation';
import type { BallotItem } from '../../lib/ballot';

/** 10/14 휴먼에러 점검 — 고친 화면이 실제로 그렇게 그려지는지(서버 렌더 문자열). */

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const NOW = '2026-10-17T05:05:09.000Z';
const noop = () => undefined;

function base(): PrepState {
  let s = initPrepState(div2);
  for (const [cards, title] of [
    [['2-1-1'], '다회용기 확대'],
    [['2-1-2'], '회수 체계'],
  ] as const) {
    const r = createMotion(s, { cardNos: [...cards], title, text: '' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return { ...s, attendance: { enrolled: 60, present: 45 } };
}

function results(record: { ballotId: string | null; statements: string[] }, yes: number, no: number): BallotResults {
  return {
    id: record.ballotId ?? 'b',
    title: 't',
    status: 'closed',
    subgroup: '2분과',
    responses: yes + no,
    items: record.statements.map((statement, i) => ({ id: `i${i}`, ordinal: i + 1, statement, scale: 2, n: yes + no, avg: null, dist: { '1': no, '2': yes } })),
  };
}

function open(s: PrepState, id: string, key: string): PrepState {
  const b = beginVote(s, [id], key, NOW);
  if (!b.ok) throw new Error(b.error);
  return markBallotOpened(markBallotCreated(b.state, key, { id: `B-${key}`, token: `T-${key}` }), key, NOW);
}
function close(s: PrepState, key: string, yes: number, no: number): PrepState {
  const r = applyBallotResults(s, key, results(s.ballots[key], yes, no), NOW);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const motion = (s: PrepState, id: string) => s.motions.find((m) => m.id === id)!;
const block = (s: PrepState, id: string) => renderToStaticMarkup(createElement(MotionVoteBlock, { motion: motion(s, id), state: s, update: noop }));
const unitHtml = (s: PrepState, id: string, isOps = false) => {
  const unit = voteUnits(s, 1).find((u) => u.motionIds.includes(id))!;
  const live = Object.values(s.ballots).filter((b) => b.stage === 'open' || b.stage === 'creating' || b.stage === 'draft');
  return renderToStaticMarkup(
    createElement(UnitCard, {
      unit,
      state: s,
      update: noop,
      ready: true,
      isOps,
      otherLive: live.find((b) => b.requestId !== unit.requestId) ?? null,
      canNetwork: true,
      busy: null,
      msg: null,
      responses: 0,
      nowMs: Date.parse(NOW),
      onStart: noop,
      onClose: noop,
      onVoid: noop,
      onQr: noop,
    }),
  );
};

describe('투표 진행 화면', () => {
  it('operator-3 — 다른 안이 열려 있으면 [투표 시작]이 꺼지고 그 안 번호를 알린다', () => {
    const s = open(base(), '2-1-안1', 'a');
    const html = unitHtml(s, '2-1-안2');
    expect(html).toMatch(/data-testid="vote-start"[^>]*disabled=""/);
    expect(html).toContain('2-1-안1 투표가 열려 있습니다. 먼저 마감하십시오');
  });

  it('ops-1·operator-2 — 투표 중에는 누구나 [잘못 연 투표 무효], 결과가 나온 뒤에는 운영팀만', () => {
    const s = open(base(), '2-1-안1', 'a');
    expect(unitHtml(s, '2-1-안1')).toContain('잘못 연 투표 무효');
    const closed = confirmHandCount(close(s, 'a', 40, 0), '2-1-안1', 1, 'entered');
    expect(unitHtml(closed, '2-1-안1', false)).not.toContain('data-testid="vote-void"');
    expect(unitHtml(closed, '2-1-안1', true)).toContain('data-testid="vote-void"');
  });

  it('moderator-2 — 마감 직후에는 「잠정 부결」, 2차·소수 의견 버튼 없이 [거수 입력 완료]·[거수 없음]', () => {
    const s = close(open(base(), '2-1-안1', 'a'), 'a', 27, 9);
    const html = block(s, '2-1-안1');
    expect(html).toContain('잠정 부결');
    expect(html).toContain('data-provisional="true"');
    expect(html).toContain('data-testid="hand-confirm"');
    expect(html).toContain('data-testid="hand-none"');
    expect(html).not.toContain('data-testid="revote"');
    expect(html).not.toContain('data-testid="minority"');
    const done = block(confirmHandCount(s, '2-1-안1', 1, 'entered'), '2-1-안1');
    expect(done).toContain('data-testid="revote"');
    expect(done).not.toContain('잠정');
  });

  it('moderator-1 — 2차 투표 중에는 1차 막대 제목이 「1차 투표 결과」이고 거수 칸이 없다', () => {
    let s = confirmHandCount(close(open(base(), '2-1-안1', 'r1'), 'r1', 27, 9), '2-1-안1', 1, 'entered');
    s = requestRevote(s, '2-1-안1');
    s = updateMotion(s, '2-1-안1', { title: '고친 문구' });
    s = open(s, '2-1-안1', 'r2');
    const html = block(s, '2-1-안1');
    expect(html).toContain('1차 투표 결과');
    expect(html).not.toContain('aria-label="거수 찬성"');
    expect(html).toContain('data-testid="hand-wait"');
    expect(html).toContain('2차 투표 중');
  });

  it('moderator-3 — 가결 도장은 초록 테두리(빨강 아님)', () => {
    const s = confirmHandCount(close(open(base(), '2-1-안1', 'a'), 'a', 40, 0), '2-1-안1', 1, 'entered');
    const html = block(s, '2-1-안1');
    const stamp = html.match(/data-testid="result-verdict"[^>]*class="([^"]+)"/)?.[1] ?? html.match(/class="([^"]+)"[^>]*data-testid="result-verdict"/)?.[1] ?? '';
    expect(html).toMatch(/border-\[#35C27A\][^"]*">가결</);
    expect(stamp + html).not.toMatch(/border-\[#FF5A5A\][^"]*">가결</);
  });

  it('operator-5 — 투표를 시작한 안의 준비판 제목 칸은 읽기 전용, 투표 진행 제목은 보낸 문장', () => {
    const s = open(base(), '2-1-안1', 'a');
    const html = renderToStaticMarkup(createElement(MotionEditor, { motion: motion(s, '2-1-안1'), state: s, update: noop }));
    expect(html).toMatch(/readOnly=""|readonly=""/);
    expect(html).toContain('투표를 시작한 안은 제목을 고칠 수 없습니다');
    const fresh = renderToStaticMarkup(createElement(MotionEditor, { motion: motion(s, '2-1-안2'), state: s, update: noop }));
    expect(fresh).not.toMatch(/readOnly=""|readonly=""/);
  });
});

describe('세리머니', () => {
  it('moderator-5 — 공개할 안 수가 분과 안 수와 다르면 「상정 N건(분과 안 M건 중)」', () => {
    const html = renderToStaticMarkup(
      createElement(DivisionCeremony, {
        division: 2,
        enrolled: 60,
        present: 45,
        items: [{ key: 'a', label: '2-1-안1', title: '가', yeas: 40, nays: 1 }],
        motionCount: 3,
        sourceLabel: '투표 결과',
        onExit: noop,
      }),
    );
    expect(html).toContain('상정 1건(분과 안 3건 중)');
  });
});

describe('투표자 휴대폰(/b)', () => {
  const item = (over: Partial<BallotItem> = {}): BallotItem => ({ id: 'i1', ordinal: 1, statement: '2-1-안1 합친 문구', description: null, scale: 2, required: true, ...over });

  it('voter-2 — 분과 의결은 찬성이 위, 저장값은 1=반대·2=찬성 그대로', () => {
    expect(ballotChoices(2, true).map((c) => [c.value, c.label])).toEqual([
      [2, '찬성'],
      [1, '반대'],
    ]);
    expect(ballotChoices(2, false).map((c) => c.value)).toEqual([1, 2]);
    const html = renderToStaticMarkup(createElement(ItemBlock, { item: item(), value: 1, onSelect: noop, disabled: false, decision: true }));
    expect(html.indexOf('찬성')).toBeLessThan(html.indexOf('반대'));
    expect(html).toMatch(/aria-pressed="true"[^>]*data-choice="1"[^>]*data-tone="no"/);
  });

  it('voter-2 — 확인 창에 「선택: 찬성/반대」를 크게', () => {
    const it1 = item();
    const choice = decisionChoiceOf([it1], { i1: 1 }, true);
    expect(choice).toMatchObject({ value: 1, label: '반대', tone: 'no' });
    expect(decisionChoiceOf([it1], { i1: 2 }, false)).toBeNull();
    const html = renderToStaticMarkup(createElement(ConfirmDialog, { answered: 1, total: 1, choice, onCancel: noop, onConfirm: noop, submitting: false }));
    expect(html).toContain('선택: 반대');
    expect(html).toContain('data-tone="no"');
  });

  it('voter-4 — 마감 뒤 제출이면 「이 표는 반영되지 않았습니다」, 어느 투표가 마감됐는지', () => {
    const html = renderToStaticMarkup(
      createElement(ClosedScreen, { decision: true, ballotTitle: '2분과 의결 2-1-안1 2차', late: true, onRefresh: noop, refreshing: false, refreshNotice: null }),
    );
    expect(html).toContain('마감 뒤에 제출되어 이 표는 반영되지 않았습니다. 손을 들어 알려 주십시오.');
    expect(html).toContain('마감된 투표: 2분과 의결 2-1-안1 2차');
    const plain = renderToStaticMarkup(createElement(ClosedScreen, { decision: true, onRefresh: noop, refreshing: false, refreshNotice: null }));
    expect(plain).not.toContain('반영되지 않았습니다');
  });
});
