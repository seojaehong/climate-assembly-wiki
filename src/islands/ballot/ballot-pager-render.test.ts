import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BallotItem } from '../../lib/ballot';
import BallotPager, { PagerItemView, PagerSummaryView } from './BallotPager';

const items: BallotItem[] = Array.from({ length: 28 }, (_, i) => ({
  id: `item-${i + 1}`,
  ordinal: i + 1,
  statement: `2-${i + 1}-안1 가상 권고 제목 ${i + 1}`,
  description: i === 4 ? '세부권고 가상 문장' : null,
  scale: 2 as const,
  required: true,
}));

const noop = () => undefined;

describe('넘김식 — 한 건 화면', () => {
  const html = renderToStaticMarkup(
    createElement(PagerItemView, {
      title: '2분과 의결',
      subgroup: '2분과',
      items,
      pos: 4,
      answers: { 'item-1': 2, 'item-2': 1 },
      flashValue: null,
      disabled: false,
      onChoose: noop,
      onGo: noop,
      voterLine: '2분과 3조 가나다 님',
    }),
  );
  it('위치 「5 / 28」과 「권고안 2-5」, 제목', () => {
    expect(html).toContain('data-testid="pager-position"');
    expect(html).toMatch(/>5 \/ 28</);
    expect(html).toContain('권고안 2-5');
    expect(html).toContain('가상 권고 제목 5');
    expect(html).not.toContain('2-5-안1');
  });
  it('큰 [찬성]/[반대]와 이전 · 다음 · 요약', () => {
    expect(html).toContain('data-testid="pager-yes"');
    expect(html).toContain('data-testid="pager-no"');
    expect(html).toContain('data-testid="pager-prev"');
    expect(html).toContain('data-testid="pager-next"');
    expect(html).toContain('data-testid="pager-to-summary"');
  });
  it('세부권고는 접어 둔다', () => {
    expect(html).toContain('<details');
    expect(html).toContain('세부권고 가상 문장');
  });
  it('일괄 선택 단추가 없다', () => {
    expect(html).not.toMatch(/전부 찬성|모두 찬성|일괄/);
  });
  it('고른 값이 있으면 그 단추가 눌린 상태', () => {
    const h = renderToStaticMarkup(
      createElement(PagerItemView, {
        title: '2분과 의결', subgroup: '2분과', items, pos: 1, answers: { 'item-2': 1 },
        flashValue: null, disabled: false, onChoose: noop, onGo: noop, voterLine: null,
      }),
    );
    expect(h).toMatch(/data-testid="pager-no"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="pager-no"/);
  });
});

describe('넘김식 — 요약 화면', () => {
  const answers: Record<string, number> = {};
  items.forEach((it, i) => {
    if (i === 10 || i === 22) return; // 2-11 · 2-23 미응답
    answers[it.id] = i === 6 || i === 18 ? 1 : 2; // 2-7 · 2-19 반대
  });
  const html = renderToStaticMarkup(
    createElement(PagerSummaryView, {
      title: '2분과 의결',
      items,
      answers,
      submitting: false,
      error: null,
      onGo: noop,
      onSubmit: noop,
      voterLine: '2분과 3조 가나다 님',
    }),
  );
  it('「찬성 24 · 반대 2 · 미응답 2」', () => {
    expect(html).toContain('data-testid="pager-counts"');
    expect(html).toMatch(/찬성 24/);
    expect(html).toMatch(/반대 2/);
    expect(html).toMatch(/미응답 2/);
  });
  it('반대 번호와 미응답 번호가 단추로', () => {
    expect(html).toContain('data-goto="6"');
    expect(html).toContain('data-goto="10"');
    expect(html).toContain('>2-11<');
    expect(html).toContain('>2-19<');
  });
  it('전건 필수에서 빠진 건이 있으면 제출 단추가 꺼진다', () => {
    expect(html).toMatch(/data-testid="pager-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="pager-submit"/);
  });
  it('다 고르면 제출 단추가 켜진다', () => {
    const all = { ...answers, 'item-11': 2, 'item-23': 2 };
    const h = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '2분과 의결', items, answers: all, submitting: false, error: null, onGo: noop, onSubmit: noop, voterLine: null,
      }),
    );
    expect(h).not.toMatch(/data-testid="pager-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="pager-submit"/);
    expect(h).toContain('제출하면 바꿀 수 없습니다');
  });
});

describe('(11/10 결정 · 기권 불인정) 넘김식 요약 — 미응답 건으로 안내 · 이동', () => {
  const optionalItems = items.map((it) => ({ ...it, required: false }));
  const partial: Record<string, number> = {};
  optionalItems.forEach((it, i) => {
    if (i === 10 || i === 22) return; // 2-11 · 2-23 미응답
    partial[it.id] = 2;
  });
  const disabledSubmit = /data-testid="pager-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="pager-submit"/;

  it('전건 필수(allRequired)면 문항이 required=false 여도 제출이 꺼지고 기권 안내가 없다', () => {
    const html = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '전체회의 의결 의제2', items: optionalItems, answers: partial, submitting: false, error: null,
        onGo: noop, onSubmit: noop, voterLine: null, allRequired: true,
      }),
    );
    expect(html).toMatch(disabledSubmit);
    expect(html).toContain('모든 권고안에 찬성 또는 반대를 눌러야 제출됩니다');
    expect(html).not.toContain('기권으로 기록');
  });

  it('빠진 건이 있으면 첫 미응답 건으로 가는 단추가 있다', () => {
    const html = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '전체회의 의결 의제2', items: optionalItems, answers: partial, submitting: false, error: null,
        onGo: noop, onSubmit: noop, voterLine: null, allRequired: true,
      }),
    );
    expect(html).toContain('data-testid="pager-goto-missing"');
    expect(html).toMatch(/data-testid="pager-goto-missing"[^>]*>[^<]*2-11/);
  });

  const pager = (title: string, subgroup: string | null) =>
    renderToStaticMarkup(
      createElement(BallotPager, {
        ballot: { id: 'b-1', title, instructions: null, status: 'open', subgroup, items: optionalItems },
        initialAnswers: partial,
        initialPos: 'summary',
        onChange: noop,
        onSubmit: noop,
        submitting: false,
        error: null,
        teams: [],
        voter: { team: null, name: '' },
        onVoter: noop,
      }),
    );

  it('전체회의 의결 투표지는 「누르지 않은 건 허용」으로 만들어졌어도 기권 제출 길이 없다', () => {
    const html = pager('전체회의 의결 의제2 가상 의제', null);
    expect(html).toMatch(disabledSubmit);
    expect(html).not.toContain('기권으로 기록');
    expect(html).toContain('data-testid="pager-goto-missing"');
  });

  it('(그대로) 분과 의결 투표지의 미표시 허용은 지금처럼 기권 확인을 거쳐 제출', () => {
    const html = pager('2분과 의결', '2분과');
    expect(html).not.toMatch(disabledSubmit);
    expect(html).toContain('누르지 않은 건은 기권으로 기록됩니다');
  });
});

describe('(11/14) 전체회의 의결 의제별 색 띠 · 인사말', () => {
  it('제목에서 의제 번호와 이름을 읽고, 그 밖 투표지는 null', async () => {
    const { agendaTheme } = await import('./BallotPager');
    expect(agendaTheme('전체회의 의결 의제2 일회용품 줄이기 등 자원순환')).toMatchObject({ no: 2, name: '일회용품 줄이기 등 자원순환을 강화하는 방안' });
    expect(agendaTheme('1분과 의결 3차')).toBeNull();
    expect(agendaTheme('전체회의 의결 의제 1 띄어씀')).toBeNull();
  });
});

describe('(11/11) 한 장 70건 투표지 「전체회의 의결 정책권고안」', () => {
  const mk = (no: string, i: number): BallotItem =>
    ({ id: `x${i}`, ordinal: i + 1, statement: `${no}-안1 가상 권고 ${no}`, description: null, scale: 2, required: true }) as BallotItem;
  const items = [mk('1-1', 0), mk('1-2', 1), mk('2-1', 2), mk('3-1', 3)];

  it('건마다 번호 앞자리로 의제를 정하고 카드 그림을 고른다', async () => {
    const { itemAgendaTheme, plenaryCardSrc } = await import('./BallotPager');
    expect(itemAgendaTheme('전체회의 의결 정책권고안', '2-5')).toMatchObject({ no: 2, name: '일회용품 줄이기 등 자원순환을 강화하는 방안' });
    expect(plenaryCardSrc('전체회의 의결 정책권고안', '3-23')).toBe('/ballot/cards1114/3-23.webp');
    expect(plenaryCardSrc('전체회의 의결 의제1 가상', '2-5')).toBeNull();
    // 11/11 경량화 — 화면용은 가벼운 판, 「크게 보기」만 원래 해상도
    expect(plenaryCardSrc('전체회의 의결 정책권고안', '3-23', true)).toBe('/ballot/cards1114hd/3-23.webp');
  });

  it('(11/11 경량화) 미리 받을 카드 — 지금 자리 뒤로 n장, 카드가 없는 건은 건너뛴다', async () => {
    const { cardPrefetchList, itemAgendaTheme } = await import('./BallotPager');
    expect(cardPrefetchList('전체회의 의결 정책권고안', items, 0, 2)).toEqual(['/ballot/cards1114/1-1.webp', '/ballot/cards1114/1-2.webp']);
    expect(cardPrefetchList('전체회의 의결 정책권고안', items, 3, 3)).toEqual(['/ballot/cards1114/3-1.webp']);
    expect(cardPrefetchList('일반 투표지', items, 0, 3)).toEqual([]);
    expect(itemAgendaTheme('일반 투표', '2-5')).toBeNull();
  });

  it('넘김 화면 머리에 의제와 그 의제 안 위치, 카드 크게 보기 단추', () => {
    const html = renderToStaticMarkup(
      createElement(PagerItemView, {
        title: '전체회의 의결 정책권고안',
        subgroup: null,
        items,
        pos: 2,
        answers: {},
        flashValue: null,
        disabled: false,
        onChoose: () => {},
        onGo: () => {},
        voterLine: null,
      }),
    );
    expect(html).toContain('data-testid="pager-agenda"');
    expect(html).toContain('일회용품 줄이기 등 자원순환');
    expect(html).toContain('의제2 안에서 1 / 1');
    expect(html).toContain('3 / 4');
    expect(html).toContain('data-testid="pager-zoom"');
    expect(html).toContain('/ballot/cards1114/2-1.webp');
  });

  it('마지막 장(제출 전 확인)에 마무리말', () => {
    const html = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '전체회의 의결 정책권고안',
        items,
        answers: {},
        submitting: false,
        error: null,
        onGo: () => {},
        onSubmit: () => {},
        voterLine: null,
        allRequired: true,
      }),
    );
    expect(html).toContain('data-testid="pager-closing"');
    expect(html).toContain('정책권고안 4건');
  });
});

describe('(11/11) 간지 = 의제 확인 화면 — 한 의제를 마친 뒤 다음 의제 첫 건 앞', () => {
  const mk = (no: string, i: number): BallotItem =>
    ({ id: `d${i}`, ordinal: i + 1, statement: `${no}-안1 가상 ${no}`, description: null, scale: 2, required: true }) as BallotItem;
  const items = [mk('1-1', 0), mk('1-2', 1), mk('2-1', 2), mk('2-2', 3), mk('3-1', 4)];

  it('다음 의제 첫 건에서만(첫 의제 앞은 없음), 넘긴 확인 화면은 다시 안 나온다', async () => {
    const { agendaCheckAt } = await import('./BallotPager');
    expect(agendaCheckAt(items, 0, new Set())).toBeNull();
    expect(agendaCheckAt(items, 1, new Set())).toBeNull();
    expect(agendaCheckAt(items, 2, new Set())).toEqual({ done: 1, next: 2, positions: [0, 1] });
    expect(agendaCheckAt(items, 2, new Set([2]))).toBeNull();
    expect(agendaCheckAt(items, 4, new Set())).toEqual({ done: 2, next: 3, positions: [2, 3] });
  });

  it('확인 화면 — 그 의제의 찬성·반대·미응답과 번호(위치는 투표지 전체 기준)', async () => {
    const { AgendaCheckView } = await import('./BallotPager');
    const html = renderToStaticMarkup(
      createElement(AgendaCheckView, {
        check: { done: 2, next: 3, positions: [2, 3] },
        items,
        answers: { d0: 2, d2: 1 },
        voterLine: null,
        onGo: () => {},
        onNext: () => {},
      }),
    );
    expect(html).toContain('data-testid="pager-agenda-check"');
    expect(html).toContain('의제2 확인');
    expect(html).toMatch(/찬성 0.*반대 1.*미응답 1/);
    expect(html).toContain('data-goto="3"');
    expect(html).toContain('data-goto="2"');
    expect(html).toContain('다음 · 의제3 기후시민 의식제고를 위한 교육 및 참여 활성화 방안');
  });

  it('제출 전 확인에 의제별 줄', () => {
    const html = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '전체회의 의결 정책권고안',
        items,
        answers: { d0: 2, d1: 2 },
        submitting: false,
        error: null,
        onGo: () => {},
        onSubmit: () => {},
        voterLine: null,
        allRequired: true,
      }),
    );
    expect(html).toContain('data-testid="pager-agenda-tallies"');
    expect(html).toMatch(/의제1 기업이 온실가스를 감축하도록 촉진하는 방안 · 2건/);
  });
});

describe('11/14 의제별 투표지 — 찬성 · 반대만(11/11 수정 의견)', () => {
  const a1: BallotItem[] = Array.from({ length: 19 }, (_, i) => ({
    id: `a-${i + 1}`,
    ordinal: i + 1,
    statement: `1-${i + 1}-안1 가상 권고 ${i + 1}`,
    description: null,
    scale: 2 as const,
    required: true,
  }));
  const title = '전체회의 의결 의제1 기업 온실가스 감축 촉진';
  it('한 건 화면에 이전 · 다음 건 단추가 없다', () => {
    const h = renderToStaticMarkup(
      createElement(PagerItemView, {
        title, subgroup: null, items: a1, pos: 3, answers: {},
        flashValue: null, disabled: false, onChoose: noop, onGo: noop, voterLine: null,
      }),
    );
    expect(h).toContain('data-testid="pager-yes"');
    expect(h).toContain('data-testid="pager-no"');
    expect(h).not.toContain('data-testid="pager-prev"');
    expect(h).not.toContain('data-testid="pager-next"');
    expect(h).toContain('내 투표 확인하기');
    expect(h).not.toContain('요약 보고 제출하기');
  });
  it('제출 전 확인에 「반대로 고른 권고안」 다시 고르기 줄이 없다', () => {
    const answers = Object.fromEntries(a1.map((it, i) => [it.id, i === 2 ? 1 : 2]));
    const h = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title, items: a1, answers, submitting: false, error: null,
        onGo: noop, onSubmit: noop, voterLine: null, allRequired: true,
      }),
    );
    expect(h).not.toContain('반대로 고른 권고안');
    expect(h).not.toContain('data-testid="pager-nos"');
  });
  it('70건 투표지는 그대로 이전 · 다음이 있다', () => {
    const h = renderToStaticMarkup(
      createElement(PagerItemView, {
        title: '전체회의 의결 정책권고안', subgroup: null, items: a1, pos: 3, answers: {},
        flashValue: null, disabled: false, onChoose: noop, onGo: noop, voterLine: null,
      }),
    );
    expect(h).toContain('data-testid="pager-prev"');
  });
});

describe('11/14 의제별 투표지 첫 화면 — 의제 간지(11/11 피알원)', () => {
  const teams = [{ team: '1분과 1조', short: '1조', names: [{ team: '1분과 1조', no: 1, name: '가나다' }] }];
  const first = (title: string) =>
    renderToStaticMarkup(
      createElement(BallotPager, {
        ballot: { id: 'b-g', title, instructions: '인사말', status: 'open', subgroup: null, items },
        initialAnswers: {},
        initialPos: 0,
        onChange: noop,
        onSubmit: noop,
        submitting: false,
        error: null,
        teams,
        voter: { team: null, name: '' },
        onVoter: noop,
      }),
    );
  it('의제2 투표지는 의제2 간지 그림을 맨 위에 보인다', () => {
    const h = first('전체회의 의결 의제2 일회용품 줄이기 등 자원순환');
    expect(h).toContain('data-testid="pager-ganji"');
    expect(h).toContain('/ballot/ganji/agenda2.jpg');
    expect(h).toContain('선정배경');
    expect(h).toContain('먼저 조와 이름을 눌러 주세요');
  });
  it('70건 투표지에는 간지가 없다', () => {
    expect(first('전체회의 의결 정책권고안')).not.toContain('pager-ganji');
  });
});

describe('(11/11 상규 대표님 메일) 이름을 고른 뒤 「OOO 님이 맞나요?」를 한 번 더 묻는다', () => {
  it('조와 이름을 크게 보이고 「네」·「다시 고르기」 두 단추를 둔다', async () => {
    const { VoterConfirm } = await import('./BallotPager');
    const html = renderToStaticMarkup(
      createElement(VoterConfirm, { team: '2분과 4조', name: '홍길동', onYes: () => {}, onNo: () => {} }),
    );
    expect(html).toContain('data-testid="voter-confirm"');
    expect(html).toContain('홍길동');
    expect(html).toContain('님이 맞나요?');
    expect(html).toContain('2분과 4조');
    expect(html).toContain('data-testid="pager-confirm-yes"');
    expect(html).toContain('data-testid="pager-confirm-no"');
  });
});

describe('(11/12) 새로고침 — 조·이름을 되살려도 「네」를 누르기 전이면 확인 화면부터', () => {
  const teams = [{ team: '1분과 1조', short: '1조', names: [{ team: '1분과 1조', no: 1, name: '가나다' }] }];
  const render = (voter: { team: string | null; name: string; confirmed?: boolean }) =>
    renderToStaticMarkup(
      createElement(BallotPager, {
        ballot: { id: 'b-r', title: '전체회의 의결 의제2 일회용품 줄이기 등 자원순환', instructions: null, status: 'open', subgroup: null, items },
        initialAnswers: {},
        initialPos: 0,
        onChange: noop,
        onSubmit: noop,
        submitting: false,
        error: null,
        teams,
        voter,
        onVoter: noop,
      }),
    );
  it('골랐지만 확인 안 함 → 「OOO 님이 맞나요?」', () => {
    const h = render({ team: '1분과 1조', name: '가나다' });
    expect(h).toContain('data-testid="voter-confirm"');
    expect(h).not.toContain('data-testid="pager-position"');
  });
  it('「네」까지 누른 사람 → 카드로 바로', () => {
    const h = render({ team: '1분과 1조', name: '가나다', confirmed: true });
    expect(h).toContain('data-testid="pager-position"');
    expect(h).not.toContain('data-testid="voter-confirm"');
  });
  it('아직 안 고름 → 고르는 화면', () => {
    const h = render({ team: null, name: '' });
    expect(h).toContain('data-testid="pager-start"');
    expect(h).not.toContain('data-testid="voter-confirm"');
  });
});

describe('(11/11) 의제 이름 = 권고카드 머리띠 원문(투표지 제목의 줄임말을 쓰지 않는다)', () => {
  it('의제별 투표지·70건 투표지 모두 카드 원문 이름', async () => {
    const { agendaTheme, itemAgendaTheme } = await import('./BallotPager');
    expect(agendaTheme('전체회의 의결 의제1 기업 온실가스 감축 촉진')?.name).toBe('기업이 온실가스를 감축하도록 촉진하는 방안');
    expect(agendaTheme('전체회의 의결 의제2 일회용품 줄이기 등 자원순환')?.name).toBe('일회용품 줄이기 등 자원순환을 강화하는 방안');
    expect(agendaTheme('전체회의 의결 의제3 기후시민 의식제고 교육')?.name).toBe('기후시민 의식제고를 위한 교육 및 참여 활성화 방안');
    expect(itemAgendaTheme('전체회의 의결 정책권고안', '3-1')?.name).toBe('기후시민 의식제고를 위한 교육 및 참여 활성화 방안');
  });
});
