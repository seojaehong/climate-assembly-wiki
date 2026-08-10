import { describe, expect, it } from 'vitest';
import { buildDesignView } from './design-console-logic';

describe('buildDesignView', () => {
  it('RPC ok를 준비 완료 정본으로 쓰고 제출 현황은 정보로 분리한다', () => {
    const view = buildDesignView('session', [{
      target: { id: 'session-1', label: '제1차 회의' },
      result: {
        ok: true,
        checks: [
          { key: 'topics_open', pass: true, detail: '2개 주제 open' },
          { key: 'teams_active', pass: false, detail: '0개 조 active' },
          { key: 'roster_loaded', pass: true, detail: '12명 배정' },
          { key: 'submissions', pass: true, detail: '3/4 최종 제출' },
        ],
      },
    }]);

    expect(view.stats).toEqual({ sessionCount: 1, readyCount: 1, blockedCount: 0, gatePassCount: 2, gateCount: 3 });
    expect(view.sessions[0].ready).toBe(true);
    expect(view.sessions[0].checks).toEqual([
      expect.objectContaining({ label: '공개 주제', kind: 'gate', statusLabel: '통과' }),
      expect.objectContaining({ label: '활성 조', kind: 'gate', statusLabel: '확인 필요' }),
      expect.objectContaining({ label: '참여자 배정', kind: 'gate', statusLabel: '통과' }),
      expect.objectContaining({ label: '최종 제출 현황', kind: 'informational', statusLabel: '정보' }),
    ]);
  });

  it('알 수 없는 검사는 안전하게 필수 게이트로 보존한다', () => {
    const view = buildDesignView('assembly', [{
      target: { id: 'session-1', label: '제1차 회의' },
      result: { ok: true, checks: [{ key: 'custom_gate', pass: true, detail: '설정 완료' }] },
    }]);

    expect(view.sessions[0].checks[0]).toMatchObject({ key: 'custom_gate', label: 'custom_gate', kind: 'gate' });
  });
});
