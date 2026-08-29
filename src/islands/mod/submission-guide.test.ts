import { describe, it, expect } from 'vitest';
import { SUBMISSION_GUIDE, MAX_ROWS_PER_TOPIC, topicAnchorId } from './submission-guide';
import { MAX_SUBMISSION_ROWS } from './submission-panel-logic';

describe('SUBMISSION_GUIDE', () => {
  it('gives every item a title and a body', () => {
    for (const item of SUBMISSION_GUIDE) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.body.trim().length).toBeGreaterThan(0);
    }
  });

  // 회의자료가 조 Rule로 명시한 것들 — 문안이 바뀌어도 이 내용이 사라지면 안 된다.
  it('keeps the 소수의견 보호 rule', () => {
    const all = SUBMISSION_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('지우지');
    expect(all).toContain('합의되지 않은');
  });

  it('keeps the 개수 제한 없음 rule', () => {
    const all = SUBMISSION_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('개수 제한이 없습니다');
  });

  // 잠긴다는 것과 「조가 직접 다시 연다」는 것이 함께 있어야 한다. 조 자체 재오픈(34b96da)
  // 이후로 「본부만 연다」는 거짓이므로, 그 문장이 되살아나면 실패한다.
  it('warns that 최종 제출 locks — 그리고 조가 직접 다시 연다', () => {
    const all = SUBMISSION_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('잠기');
    expect(all).toContain('다시 열기');
    expect(all).not.toContain('본부만');
  });

  // 안내에 적힌 상한이 실제 저장 상한과 어긋나면 조가 30줄에서 막히고도 이유를 모른다.
  it('states the same row cap the save path enforces', () => {
    expect(MAX_ROWS_PER_TOPIC).toBe(MAX_SUBMISSION_ROWS);
    expect(SUBMISSION_GUIDE.some((i) => i.body.includes(String(MAX_ROWS_PER_TOPIC)))).toBe(true);
  });

  it('has no duplicate titles', () => {
    const titles = SUBMISSION_GUIDE.map((i) => i.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('topicAnchorId', () => {
  it('derives a stable anchor from the topic id', () => {
    expect(topicAnchorId('abc-123')).toBe('topic-abc-123');
    expect(topicAnchorId('abc-123')).toBe(topicAnchorId('abc-123'));
  });

  it('gives different topics different anchors', () => {
    expect(topicAnchorId('a')).not.toBe(topicAnchorId('b'));
  });
});
