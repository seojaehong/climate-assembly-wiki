import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BallotQrFullscreen } from './BallotPanel';

const row = {
  id: 'b1',
  title: '1분과 의결 1-1-안1',
  status: 'open' as const,
  token: 'c'.repeat(32),
  subgroup: '1분과',
  item_count: 1,
  response_count: 7,
  created_at: '',
};

describe('QR 화면(10/17 정리) — 제목 + 큰 QR + 실시간 수', () => {
  it('링크 글자·「N분과 전용」 띠·안내 문구가 없다', () => {
    const html = renderToStaticMarkup(
      createElement(BallotQrFullscreen, { ballot: row, onExit: () => undefined, headline: { main: '탄소 정보 공시', sub: '1-1 안1' } }),
    );
    expect(html).toContain('탄소 정보 공시');
    expect(html).toContain('제출 7명');
    // 주소는 e2e 용 data-ballot-url 속성에만 있고 화면 글자에는 없다.
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('/b?');
    expect(text).not.toContain('cccccccc');
    expect(html).not.toContain('전용');
    expect(html).not.toContain('스캔하세요');
    expect(html).not.toContain('1분과 한정');
  });
  it('운영 토큰이 있으면 「투표결과 보기」 버튼, 발표 창은 나가기 버튼이 없다', () => {
    const html = renderToStaticMarkup(
      createElement(BallotQrFullscreen, { ballot: row, onExit: () => undefined, access: { accessToken: 'a'.repeat(64) }, hideExit: true }),
    );
    expect(html).toContain('투표결과 보기');
    expect(html).not.toContain('나가기');
  });
  it('토큰이 없으면(미리보기) 이름 화면 버튼이 없다', () => {
    const html = renderToStaticMarkup(createElement(BallotQrFullscreen, { ballot: row, onExit: () => undefined }));
    expect(html).not.toContain('투표결과 보기');
    expect(html).toContain('나가기');
  });
});

describe('(11/14 큰 화면 위생) 전체회의 의결 투표지 QR 화면 — QR · 제목만', () => {
  const plenary = { ...row, id: 'p1', title: '전체회의 의결 의제2 자원순환 사회 전환', subgroup: null, item_count: 28, response_count: 42 };
  const access = { accessToken: 'a'.repeat(64) };
  it('투표 중 — 실시간 찬성 · 반대 · 제출 수와 「투표결과 보기」가 없다', () => {
    const html = renderToStaticMarkup(createElement(BallotQrFullscreen, { ballot: plenary, onExit: () => undefined, access }));
    expect(html).toContain('전체회의 의결 의제2 자원순환 사회 전환');
    for (const id of ['qr-live-yes', 'qr-live-no', 'qr-live-total', 'qr-show-names']) expect(html).not.toContain(`data-testid="${id}"`);
    expect(html).not.toContain('제출 42명');
    expect(html).not.toContain('투표결과 보기');
  });
  it('마감 뒤 · 분과 지정이 잘못 남은 투표지 · 큰 제목(headline)을 준 경로도 같다', () => {
    for (const ballot of [
      { ...plenary, status: 'closed' as const },
      { ...plenary, subgroup: '1분과' },
      { ...plenary, subgroup: '' },
    ]) {
      const html = renderToStaticMarkup(
        createElement(BallotQrFullscreen, { ballot, onExit: () => undefined, access, headline: { main: '권고안 28건', sub: '의제2' } }),
      );
      expect(html).not.toContain('data-testid="qr-live-total"');
      expect(html).not.toContain('data-testid="qr-show-names"');
    }
  });
  it('10/17 분과 의결 투표지는 그대로 — 제출 수와 「투표결과 보기」', () => {
    const html = renderToStaticMarkup(createElement(BallotQrFullscreen, { ballot: row, onExit: () => undefined, access }));
    expect(html).toContain('data-testid="qr-live-total"');
    expect(html).toContain('제출 7명');
    expect(html).toContain('data-testid="qr-show-names"');
  });
});
