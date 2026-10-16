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
    expect(html).not.toContain('/b?');
    expect(html).not.toContain('cccccccc');
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
