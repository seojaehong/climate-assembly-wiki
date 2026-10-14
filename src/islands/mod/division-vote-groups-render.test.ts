import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MotionEditor, MotionVoteBlock, PrepBoard, UnitCard } from './DivisionVotePanel';
import {
  createAgendaMotion,
  createMotion,
  importSimilarGroups,
  initPrepState,
  updateMotion,
  type PrepState,
  type SimilarGroup,
} from './division-vote-logic';
import { voteUnits } from './division-vote-flow';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';

/** 10/14 — 유사 묶음 · 카드 공유 · 카드 없는 안건 · 큰 안 번호가 실제로 그렇게 그려지는지(서버 렌더 문자열). 가상 데이터만. */

const div2 = DIVISION_VOTE_FIXTURE[0];
const noop = () => undefined;
const GROUPS: SimilarGroup[] = [
  { id: '유사1', division: 2, name: '가상 공통 취지 하나', recs: ['2-1-1-1', '2-1-2-2'], cards: ['2-1-1', '2-1-2'], teams: ['1조', '2조'] },
  { id: '유사2', division: 2, name: '가상 공통 취지 둘', recs: ['2-1-1-3'], cards: ['2-1-1'], teams: ['3조'] },
];

function withGroups(): PrepState {
  return { ...importSimilarGroups(initPrepState(div2), GROUPS).state, attendance: { enrolled: 60, present: 45 } };
}

function unitHtml(s: PrepState, motionId: string): string {
  const unit = voteUnits(s, 1).find((u) => u.motionIds[0] === motionId)!;
  return renderToStaticMarkup(
    createElement(UnitCard, {
      unit,
      state: s,
      update: noop,
      ready: true,
      isOps: false,
      otherLive: null,
      canNetwork: true,
      busy: null,
      msg: null,
      responses: 0,
      nowMs: Date.parse('2026-10-17T02:00:00.000Z'),
      onStart: noop,
      onClose: noop,
      onVoid: noop,
      onQr: noop,
    }),
  );
}

const startButton = (html: string) => /<button[^>]*data-testid="vote-start"[^>]*>/.exec(html)?.[0] ?? '';

describe('★ 유사 묶음 안 카드', () => {
  it('묶음 번호·공통 취지·세부 번호·제안 조와 세부 권고 원문(펼침)을 보여 준다 — 묶음이 적은 세부만', () => {
    const s = withGroups();
    const m = s.motions.find((x) => x.id === '2-1-안1')!;
    const html = renderToStaticMarkup(createElement(MotionEditor, { motion: m, state: s, update: noop }));
    expect(html).toContain('data-testid="group-reference"');
    expect(html).toContain('유사1');
    expect(html).toContain('가상 공통 취지 하나');
    expect(html).toContain('세부 2건 2-1-1-1, 2-1-2-2');
    expect(html).toContain('제안 1조 2조');
    expect(html).toContain('세부 권고 문구 보기 (2건)');
    expect(html).toContain('예시 권고 문장 2-1-1-1입니다.');
    expect(html).toContain('예시 권고 문장 2-1-2-2입니다.');
    expect(html).not.toContain('예시 권고 문장 2-1-1-2입니다.'); // 같은 카드의 다른 세부는 빼고
  });

  it('★ 제목 칸은 비어 있고(자리표시 값 없음) 빨간 안내가 붙는다 · 제목 칸 바로 왼쪽에 큰 안 번호', () => {
    const s = withGroups();
    const m = s.motions.find((x) => x.id === '2-1-안1')!;
    const html = renderToStaticMarkup(createElement(MotionEditor, { motion: m, state: s, update: noop }));
    expect(html).toMatch(/<textarea[^>]*aria-label="2-1-안1 제목"[^>]*><\/textarea>/); // 값이 비었다
    expect(html).toContain('data-testid="title-empty"');
    expect(html).toContain('2-1-안1 제목이 비어 있습니다');
    const tag = html.indexOf('data-testid="title-id-tag"');
    const field = html.indexOf('aria-label="2-1-안1 제목"');
    expect(tag).toBeGreaterThan(-1);
    expect(tag).toBeLessThan(field);
    expect(html.slice(tag, field)).toContain('text-[24px]');
    expect(html.slice(tag, field)).toContain('2-1-안1');
  });

  it('★ 제목이 빈 안은 [투표 시작]이 꺼지고 이유가 나온다 · 제목을 넣으면 켜진다', () => {
    let s = withGroups();
    const off = unitHtml(s, '2-1-안1');
    expect(startButton(off)).toContain('disabled=""');
    expect(off).toContain('data-testid="vote-empty-title"');
    s = updateMotion(s, '2-1-안1', { title: '합친 문구 예시' });
    const on = unitHtml(s, '2-1-안1');
    expect(startButton(on)).not.toContain('disabled=""');
    expect(on).not.toContain('vote-empty-title');
  });
});

describe('★ 카드 잠금 해제', () => {
  it('다른 안에 들어간 카드도 체크칸이 켜져 있고, 들어간 안 번호를 모두 적는다', () => {
    const s = withGroups(); // 2-1-1 은 유사1·유사2 둘 다
    const html = renderToStaticMarkup(createElement(PrepBoard, { state: s, update: noop }));
    const li = /<li[^>]*data-card-no="2-1-1"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
    expect(li).toContain('data-in-motion="2-1-안1 · 2-1-안2"');
    const box = /<input[^>]*aria-label="2-1-1 고르기"[^>]*>/.exec(li)?.[0] ?? '';
    expect(box).not.toContain('disabled');
    expect(li).toContain('→ 2-1-안1 · 2-1-안2에 들어감');
    expect(html).toContain('제목 빈 안 2');
  });

  it('시행중-제외 카드는 여전히 고를 수 없다', () => {
    const s0 = initPrepState(div2);
    const s = { ...s0, cards: { ...s0.cards, '2-1-3': { status: 'excluded' as const } } };
    const html = renderToStaticMarkup(createElement(PrepBoard, { state: s, update: noop }));
    const box = /<input[^>]*aria-label="2-1-3 고르기"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('disabled');
  });
});

describe('★ 카드 없는 안건', () => {
  it('준비판 「카드 없는 안건」 칸과 두 가지 미리 넣기 버튼 · 만든 안건은 그 칸에 「카드 없는 안건」으로', () => {
    const a = createAgendaMotion(initPrepState(div2), { title: '분과별 최종 권고안 의결', text: '' });
    if (!a.ok) throw new Error(a.error);
    const html = renderToStaticMarkup(createElement(PrepBoard, { state: a.state, update: noop }));
    expect(html).toContain('data-testid="agenda-section"');
    expect(html).toContain('「분과별 최종 권고안 의결」 넣기');
    expect(html).toContain('「최종 권고안 문구 작성 위임 의결」 넣기');
    expect(html).toContain('2-최종-안2 안건 만들기');
    const sec = html.slice(html.indexOf('data-testid="agenda-section"'));
    expect(sec).toContain('data-motion-id="2-최종-안1"');
    expect(sec).toContain('카드 없는 안건');
    expect(sec).not.toContain('원 카드 </span>');
  });

  it('투표 진행 화면에서도 「카드 없는 안건」으로 적힌다', () => {
    const a = createAgendaMotion(initPrepState(div2), { title: '최종 권고안 문구 작성 위임 의결', text: '' });
    if (!a.ok) throw new Error(a.error);
    const s = { ...a.state, attendance: { enrolled: 60, present: 45 } };
    const html = renderToStaticMarkup(createElement(MotionVoteBlock, { motion: s.motions[0], state: s, update: noop }));
    expect(html).toContain('카드 없는 안건');
    expect(startButton(unitHtml(s, '2-최종-안1'))).not.toContain('disabled=""');
  });

  it('손으로 만든 안은 그대로 — 카드 1장 안의 원 카드 표기', () => {
    const r = createMotion(initPrepState(div2), { cardNos: ['2-1-1'], title: 't', text: '' });
    if (!r.ok) throw new Error(r.error);
    const html = renderToStaticMarkup(createElement(MotionEditor, { motion: r.motion, state: r.state, update: noop }));
    expect(html).toContain('원 카드 2-1-1');
    expect(html).not.toContain('group-reference');
  });
});
