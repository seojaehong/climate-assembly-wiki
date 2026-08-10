import type { ReadinessResult } from '../../../lib/platform';
import type { SessionTarget } from '../platform-nav-logic';

export type DesignScope = 'session' | 'assembly';
export type DesignCheckKind = 'gate' | 'informational';

export interface DesignSessionResult {
  target: SessionTarget;
  result: ReadinessResult;
}

export interface DesignCheckView {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
  kind: DesignCheckKind;
  statusLabel: '통과' | '확인 필요' | '정보';
}

export interface DesignSessionView {
  id: string;
  label: string;
  ready: boolean;
  checks: DesignCheckView[];
}

export interface DesignView {
  scope: DesignScope;
  sessions: DesignSessionView[];
  stats: {
    sessionCount: number;
    readyCount: number;
    blockedCount: number;
    gatePassCount: number;
    gateCount: number;
  };
}

const CHECK_LABELS: Readonly<Record<string, string>> = {
  topics_open: '공개 주제',
  teams_active: '활성 조',
  roster_loaded: '참여자 배정',
  submissions: '최종 제출 현황',
};

function toCheckView(check: ReadinessResult['checks'][number]): DesignCheckView {
  const kind: DesignCheckKind = check.key === 'submissions' ? 'informational' : 'gate';
  return {
    ...check,
    label: CHECK_LABELS[check.key] ?? check.key,
    kind,
    statusLabel: kind === 'informational' ? '정보' : check.pass ? '통과' : '확인 필요',
  };
}

/** Builds a traceable readiness view while preserving the RPC ok decision. */
export function buildDesignView(
  scope: DesignScope,
  sessionResults: readonly DesignSessionResult[],
): DesignView {
  const sessions = sessionResults.map(({ target, result }) => ({
    id: target.id,
    label: target.label,
    ready: result.ok,
    checks: result.checks.map(toCheckView),
  }));
  const gateChecks = sessions.flatMap((session) => session.checks.filter((check) => check.kind === 'gate'));
  const readyCount = sessions.filter((session) => session.ready).length;
  return {
    scope,
    sessions,
    stats: {
      sessionCount: sessions.length,
      readyCount,
      blockedCount: sessions.length - readyCount,
      gatePassCount: gateChecks.filter((check) => check.pass).length,
      gateCount: gateChecks.length,
    },
  };
}
