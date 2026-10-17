import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPracticeBallot, practiceBallots, practiceTally } from './division-practice';

const row = (title: string, subgroup: string | null, status: 'open' | 'closed' | 'archived' | 'draft' = 'open') => ({ title, subgroup, status });

describe('연습 투표 상자', () => {
  const rows = [
    row('2분과 연습 투표', '2분과'),
    row('1분과 연습 투표', '1분과'),
    row('3분과 연습 투표', '3분과', 'closed'),
    row('1분과 의결 1-5-안1', '1분과'),
    row('연습 투표 안내', '1분과'),
    row('1분과 연습 투표', '1분과', 'archived'),
  ];
  it('제목이 「연습 투표」로 끝나고 보관 안 된 것만', () => {
    expect(rows.filter(isPracticeBallot).map((r) => r.title)).toEqual(['2분과 연습 투표', '1분과 연습 투표', '3분과 연습 투표']);
  });
  it('분과 화면은 자기 분과만, 운영팀은 셋 다(제목순)', () => {
    expect(practiceBallots(rows, 1).map((r) => r.title)).toEqual(['1분과 연습 투표']);
    expect(practiceBallots(rows, 2).map((r) => r.subgroup)).toEqual(['2분과']);
    expect(practiceBallots(rows, null).map((r) => r.title)).toEqual(['1분과 연습 투표', '2분과 연습 투표', '3분과 연습 투표']);
  });
  it('찬성 = 2, 반대 = 1', () => {
    expect(practiceTally({ '1': 3, '2': 9 })).toEqual({ yes: 9, no: 3 });
    expect(practiceTally(undefined)).toEqual({ yes: 0, no: 0 });
  });
  it('준비판을 건드리지 않는다 — 로직·화면 어디에도 준비판 저장·차수 함수가 없다', () => {
    const logic = readFileSync(new URL('./division-practice.ts', import.meta.url), 'utf8');
    const box = readFileSync(new URL('./PracticeBallotBox.tsx', import.meta.url), 'utf8');
    for (const src of [logic, box]) {
      expect(src).not.toMatch(/PrepState|update\(|divisionPrepSave|beginVote|rounds|ballots\[/);
    }
    // 세리머니 투표 고르기에는 연습 투표를 빼고 보인다
    const panel = readFileSync(new URL('./DivisionVotePanel.tsx', import.meta.url), 'utf8');
    expect(panel).toMatch(/!isPracticeBallot\(b\)/);
  });
});
