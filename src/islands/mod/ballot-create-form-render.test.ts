import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateForm } from './BallotPanel';

// 11/14 운영자 절차(docs/1114-ballot-setup.md)가 기대는 칸이 폼에 실제로 그려지는지.
describe('(11/14) /mod 투표 만들기 폼', () => {
  const render = (subgroup: string | null) =>
    renderToStaticMarkup(
      createElement(CreateForm, {
        submitting: false,
        subgroup,
        access: {} as never,
        onCreate: () => undefined,
        onCancel: () => undefined,
      }),
    );

  it('여러 건 붙여넣기 칸 · 「누르지 않은 건 허용」 체크 · 바꾸기 단추 · 「세션 전체」 · 「초안 만들기」가 있다', () => {
    const html = render(null);
    expect(html).toContain('data-testid="ballot-bulk"');
    expect(html).toContain('data-testid="ballot-optional"');
    expect(html).toContain('누르지 않은 건 허용');
    expect(html).toContain('data-testid="ballot-bulk-apply"');
    expect(html).toContain('붙여넣은 줄로 아래 의제 바꾸기');
    expect(html).toContain('초안 만들기');
  });

  it('분과 조 콘솔에서도 「세션 전체」를 고를 수 있다', () => {
    const html = render('1분과');
    expect(html).toContain('세션 전체');
    expect(html).toContain('1분과 (내 분과)');
  });
});
