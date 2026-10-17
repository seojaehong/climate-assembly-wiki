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
  it('BallotCard 는 무기명 submitBallot 전에 명단을 다시 읽고 gate 를 거친다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./BallotCard.tsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('const handleSubmit'));
    const refetch = body.indexOf('fetchBallotRoster(token)');
    const gate = body.indexOf('anonymousSubmitGate(fresh)');
    const anon = body.indexOf('await submitBallot(token');
    expect(refetch).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(refetch);
    expect(anon).toBeGreaterThan(gate);
  });
});
