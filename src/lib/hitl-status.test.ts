import { describe, expect, it } from 'vitest';
import { resolveHitlStatus } from './hitl-status';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('resolveHitlStatus', () => {
  it('미검수 AI 초안을 공개 가능한 확정 결과와 구분한다', () => {
    expect(resolveHitlStatus({ reviewStatus: 'draft', origin: 'ai' })).toEqual({
      state: 'ai-draft',
      label: '검수 대기 · AI 초안',
      description: 'AI가 만든 초안이며 운영진의 원문 대조와 확정이 필요합니다.',
      reviewed: false,
      foreground: '#8A4F08',
      background: '#FEF6E7',
      border: '#F5A623',
    });
  });

  it('출처 정보가 없는 공개 스냅샷 초안을 AI 생성물로 단정하지 않는다', () => {
    expect(resolveHitlStatus({ reviewStatus: 'draft' })).toMatchObject({
      state: 'draft',
      label: '검수 대기 · 초안',
      description: '출처 정보가 없는 초안이며 운영진의 원문 대조와 확정이 필요합니다.',
      reviewed: false,
    });
  });

  it('사람 검수 완료 상태를 원문 대조가 끝난 확정 결과로 설명한다', () => {
    expect(resolveHitlStatus({ reviewStatus: 'reviewed', origin: 'ai' })).toEqual({
      state: 'reviewed',
      label: '검수 완료',
      description: '운영진이 원문과 대조해 공개 가능한 표현으로 확정했습니다.',
      reviewed: true,
      foreground: '#2F6F25',
      background: '#E3F1E6',
      border: '#2F6F25',
    });
  });

  it('사람이 수정한 초안도 재검수 전에는 확정 결과로 표시하지 않는다', () => {
    expect(resolveHitlStatus({ reviewStatus: 'draft', origin: 'human' })).toEqual({
      state: 'human-draft',
      label: '검수 대기 · 사람 수정본',
      description: '사람이 수정했지만 변경 후 원문 재검수가 필요한 초안입니다.',
      reviewed: false,
      foreground: '#B91C1C',
      background: '#FDECEC',
      border: '#B91C1C',
    });
  });

  it('보관 상태는 공개 확정 상태와 별도로 표시한다', () => {
    expect(resolveHitlStatus({ reviewStatus: 'archived', origin: 'human' })).toMatchObject({
      state: 'archived',
      label: '보관',
      reviewed: false,
    });
  });

  it('모든 HITL 상태 텍스트가 배지 배경에서 AA 명암비를 충족한다', () => {
    const statuses = [
      resolveHitlStatus({ reviewStatus: 'draft' }),
      resolveHitlStatus({ reviewStatus: 'draft', origin: 'ai' }),
      resolveHitlStatus({ reviewStatus: 'draft', origin: 'human' }),
      resolveHitlStatus({ reviewStatus: 'reviewed', origin: 'human' }),
      resolveHitlStatus({ reviewStatus: 'archived', origin: 'human' }),
    ];

    for (const status of statuses) {
      expect(contrastRatio(status.foreground, status.background), status.state).toBeGreaterThanOrEqual(4.5);
    }
  });
});
