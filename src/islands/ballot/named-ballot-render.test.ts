import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoterPicker, ConfirmDialog } from './BallotCard';
import { namedDoneText } from './ballot-logic';
import { rosterTeams } from '../../lib/named-vote-logic';

const teams = rosterTeams([
  { team: '1분과 1조', no: 1, name: '가나다' },
  { team: '1분과 1조', no: 2, name: '라마바' },
  { team: '1분과 3조', no: 1, name: '사아자' },
]);

describe('실명 투표 /b — 조·이름 고르기', () => {
  it('조 버튼은 짧은 이름, 조를 고르기 전에는 이름 목록이 없다', () => {
    const html = renderToStaticMarkup(
      createElement(VoterPicker, { teams, voter: { team: null, name: '' }, onVoter: () => undefined, disabled: false }),
    );
    expect(html).toContain('>1조<');
    expect(html).toContain('>3조<');
    expect(html).not.toContain('가나다');
    expect(html).not.toContain('명단에 없어요');
  });
  it('조를 고르면 그 조 이름만 + 직접 입력 버튼', () => {
    const html = renderToStaticMarkup(
      createElement(VoterPicker, { teams, voter: { team: '1분과 1조', name: '' }, onVoter: () => undefined, disabled: false }),
    );
    expect(html).toContain('가나다');
    expect(html).toContain('라마바');
    expect(html).not.toContain('사아자');
    expect(html).toContain('명단에 없어요 — 이름 직접 입력');
  });
  it('이름을 고르면 「1분과 1조 가나다 님」', () => {
    const html = renderToStaticMarkup(
      createElement(VoterPicker, { teams, voter: { team: '1분과 1조', name: '가나다' }, onVoter: () => undefined, disabled: false }),
    );
    expect(html).toContain('1분과 1조 가나다 님');
  });
  it('직접 입력 모드는 입력칸을 보인다', () => {
    const html = renderToStaticMarkup(
      createElement(VoterPicker, { teams, voter: { team: '1분과 3조', name: '', manual: true }, onVoter: () => undefined, disabled: false }),
    );
    expect(html).toContain('data-testid="voter-name-input"');
  });
  it('확인 창에 투표자 줄', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        answered: 1,
        total: 1,
        voterLine: '1분과 3조 사아자 님',
        onCancel: () => undefined,
        onConfirm: () => undefined,
        submitting: false,
      }),
    );
    expect(html).toContain('1분과 3조 사아자 님');
  });
});

describe('완료 문구', () => {
  it('찬성으로 · 반대로', () => {
    expect(namedDoneText({ team: '1분과 3조', name: '홍길동', choice: '찬성' })).toBe('1분과 3조 홍길동 님 — 찬성으로 제출되었습니다');
    expect(namedDoneText({ team: '1분과 3조', name: '홍길동', choice: '반대' })).toBe('1분과 3조 홍길동 님 — 반대로 제출되었습니다');
    expect(namedDoneText({ team: '기획참여단 분과A', name: '홍길동', choice: null })).toBe('기획참여단 분과A 홍길동 님 — 제출되었습니다');
  });
});

describe('무기명 제출 직전 명단 재확인', () => {
  it('명단 비었음 → 무기명, 새 명단 있음 → 조·이름부터, 조회 실패 → 다시 시도(무기명으로 내지 않음)', async () => {
    const { anonymousSubmitGate } = await import('./ballot-logic');
    expect(anonymousSubmitGate([])).toBe('anonymous');
    expect(anonymousSubmitGate([{ team: '1분과 1조', no: 1, name: '가나다' }])).toBe('need-voter');
    expect(anonymousSubmitGate('error')).toBe('retry');
  });
  it('BallotCard 의 제출은 sendBallotOnce 한 길로만 — 명단 재확인 · 실명 필수 여부를 넘긴다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./BallotCard.tsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('const submitOnce'), src.indexOf('const handleRefresh'));
    expect(body).toContain('sendBallotOnce({');
    expect(body).toContain('rosterRequired: rosterRequired(ballot)');
    expect(body).toContain('fetchRoster: () => fetchBallotRoster(token)');
    // 무기명 제출을 직접 부르는 자리가 sendBallotOnce 밖에 남아 있지 않다
    expect(body.match(/submitBallot\(token/g)?.length ?? 0).toBe(1);
    expect(body).toMatch(/submitAnonymous: \(\) => submitBallot\(token/);
  });
});

describe('(W05) 전체회의 의결 투표지 — 명단 0행이면 무기명으로 내지 않는다', () => {
  const row = { team: '1분과 1조', no: 1, name: '가나다' };
  it('실명 필수 = 제목이 「전체회의 의결」로 시작(분과 지정이 잘못 남아 있어도)', async () => {
    const { rosterRequired } = await import('./ballot-logic');
    expect(rosterRequired({ title: '전체회의 의결 의제1 탄소중립 사회', subgroup: '' })).toBe(true);
    expect(rosterRequired({ title: '전체회의 의결 의제2', subgroup: null })).toBe(true);
    expect(rosterRequired({ title: '  전체회의 의결 의제3', subgroup: '1분과' })).toBe(true);
    expect(rosterRequired({ title: '1분과 의결 (1차)', subgroup: '1분과' })).toBe(false);
    expect(rosterRequired({ title: '사전 설문', subgroup: '' })).toBe(false);
    expect(rosterRequired({ title: null })).toBe(false);
  });
  it('gate — 실명 필수이고 명단이 비었으면 no-roster(무기명 아님)', async () => {
    const { anonymousSubmitGate } = await import('./ballot-logic');
    expect(anonymousSubmitGate([], true)).toBe('no-roster');
    expect(anonymousSubmitGate([], false)).toBe('anonymous');
    expect(anonymousSubmitGate('error', true)).toBe('retry');
    expect(anonymousSubmitGate([row], true)).toBe('need-voter');
  });

  function spies(opts: { roster?: unknown[] | Error; anon?: string; named?: string }) {
    const calls = { roster: 0, anon: 0, named: 0 };
    return {
      calls,
      fetchRoster: async () => {
        calls.roster += 1;
        if (opts.roster instanceof Error) throw opts.roster;
        return (opts.roster ?? []) as never[];
      },
      submitAnonymous: async () => {
        calls.anon += 1;
        return (opts.anon ?? 'ok') as 'ok';
      },
      submitNamed: async () => {
        calls.named += 1;
        return (opts.named ?? 'ok') as 'ok';
      },
    };
  }

  it('명단 0행 → 제출 요청 0건(무기명 · 실명 모두)', async () => {
    const { sendBallotOnce } = await import('./ballot-logic');
    const s = spies({ roster: [] });
    const out = await sendBallotOnce({ named: false, rosterRequired: true, ...s });
    expect(out).toEqual({ kind: 'held', reason: 'no-roster' });
    expect(s.calls).toEqual({ roster: 1, anon: 0, named: 0 });
  });
  it('명단 조회 실패 → 제출 요청 0건(다시 시도)', async () => {
    const { sendBallotOnce } = await import('./ballot-logic');
    const s = spies({ roster: new Error('network') });
    const err = console.error;
    console.error = () => undefined;
    try {
      const out = await sendBallotOnce({ named: false, rosterRequired: true, ...s });
      expect(out).toEqual({ kind: 'held', reason: 'retry' });
    } finally {
      console.error = err;
    }
    expect(s.calls.anon + s.calls.named).toBe(0);
  });
  it('그 사이 명단이 올라왔으면 조·이름부터(제출 0건)', async () => {
    const { sendBallotOnce } = await import('./ballot-logic');
    const s = spies({ roster: [row] });
    const out = await sendBallotOnce({ named: false, rosterRequired: true, ...s });
    expect(out).toEqual({ kind: 'need-voter', roster: [row] });
    expect(s.calls.anon + s.calls.named).toBe(0);
  });
  it('실명으로 냈는데 운영팀이 실명 수집을 껐다(named_off) → 전체회의 의결은 무기명으로 다시 내지 않는다', async () => {
    const { sendBallotOnce } = await import('./ballot-logic');
    const s = spies({ named: 'named_off' });
    const out = await sendBallotOnce({ named: true, rosterRequired: true, ...s });
    expect(out).toEqual({ kind: 'held', reason: 'no-roster' });
    expect(s.calls).toEqual({ roster: 0, anon: 0, named: 1 });
  });
  it('일반 투표는 지금 그대로 — 명단 0행이면 무기명 1건, named_off 면 무기명으로 다시 1건', async () => {
    const { sendBallotOnce } = await import('./ballot-logic');
    const a = spies({ roster: [] });
    expect(await sendBallotOnce({ named: false, rosterRequired: false, ...a })).toEqual({ kind: 'sent', result: 'ok', namedSaved: false });
    expect(a.calls).toEqual({ roster: 1, anon: 1, named: 0 });
    const b = spies({ named: 'named_off' });
    expect(await sendBallotOnce({ named: true, rosterRequired: false, ...b })).toEqual({ kind: 'sent', result: 'ok', namedSaved: false });
    expect(b.calls).toEqual({ roster: 0, anon: 1, named: 1 });
    const c = spies({ named: 'name_taken' });
    expect(await sendBallotOnce({ named: true, rosterRequired: true, ...c })).toEqual({ kind: 'sent', result: 'name_taken', namedSaved: true });
    expect(c.calls).toEqual({ roster: 0, anon: 0, named: 1 });
  });

  it('막는 화면 — 명단 준비 안 됨 · 진행요원 · 다시 확인, 투표 단추 없음', async () => {
    const { RosterMissingScreen } = await import('./BallotCard');
    const { ROSTER_MISSING_MESSAGE } = await import('./ballot-logic');
    const html = renderToStaticMarkup(createElement(RosterMissingScreen, { onRetry: () => undefined, retrying: false }));
    expect(html).toContain('명단이 아직 준비되지 않았습니다');
    expect(html).toContain('진행요원');
    expect(html).toContain('다시 확인');
    expect(html).not.toContain('찬성');
    expect(html).not.toContain('제출하기');
    expect(ROSTER_MISSING_MESSAGE).toContain('명단이 아직 준비되지 않았습니다');
    expect(ROSTER_MISSING_MESSAGE).toContain('진행요원');
  });
  it('BallotCard 는 넘김식 · 목록 화면을 그리기 전에 막는다(투표지를 열자마자)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./BallotCard.tsx', import.meta.url), 'utf8');
    const render = src.slice(src.indexOf("if (screen === 'done')"));
    const block = render.indexOf("screen === 'active' && ballot && rosterRequired(ballot) && teams.length === 0");
    expect(block).toBeGreaterThan(-1);
    expect(render.indexOf('<RosterMissingScreen', block)).toBeGreaterThan(block);
    expect(render.indexOf('<BallotPager')).toBeGreaterThan(block);
    expect(render.indexOf('<VotingScreen')).toBeGreaterThan(block);
  });
});
