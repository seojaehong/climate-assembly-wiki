export type HitlState = 'draft' | 'ai-draft' | 'human-draft' | 'reviewed' | 'archived';

export interface HitlStatus {
  state: HitlState;
  label: string;
  description: string;
  reviewed: boolean;
  foreground: string;
  background: string;
  border: string;
}

export interface HitlStatusInput {
  reviewStatus: string | null | undefined;
  origin?: string | null;
}

/** Resolves review provenance into the shared human-in-the-loop display contract. */
export function resolveHitlStatus(input: HitlStatusInput): HitlStatus {
  if (input.reviewStatus === 'reviewed') {
    return {
      state: 'reviewed',
      label: '검수 완료',
      description: '운영진이 원문과 대조해 공개 가능한 표현으로 확정했습니다.',
      reviewed: true,
      foreground: '#2F6F25',
      background: '#E3F1E6',
      border: '#2F6F25',
    };
  }
  if (input.reviewStatus === 'archived') {
    return {
      state: 'archived',
      label: '보관',
      description: '현재 공개 및 검수 대상에서 제외된 쟁점입니다.',
      reviewed: false,
      foreground: '#5A6B73',
      background: '#ECEFF1',
      border: '#6B7D88',
    };
  }
  if (input.origin === 'human') {
    return {
      state: 'human-draft',
      label: '검수 대기 · 사람 수정본',
      description: '사람이 수정했지만 변경 후 원문 재검수가 필요한 초안입니다.',
      reviewed: false,
      foreground: '#B91C1C',
      background: '#FDECEC',
      border: '#B91C1C',
    };
  }
  if (input.origin === 'ai') {
    return {
      state: 'ai-draft',
      label: '검수 대기 · AI 초안',
      description: 'AI가 만든 초안이며 운영진의 원문 대조와 확정이 필요합니다.',
      reviewed: false,
      foreground: '#8A4F08',
      background: '#FEF6E7',
      border: '#F5A623',
    };
  }
  return {
    state: 'draft',
    label: '검수 대기 · 초안',
    description: '출처 정보가 없는 초안이며 운영진의 원문 대조와 확정이 필요합니다.',
    reviewed: false,
    foreground: '#8A4F08',
    background: '#FEF6E7',
    border: '#F5A623',
  };
}
