import type { ReadinessResult } from '../../../lib/platform';
import type { SessionTarget } from '../platform-nav-logic';
import designBlueprintContract from './design-blueprint-contract.json';

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

export interface DesignBlueprintSessionInput {
  title?: string;
  slug?: string;
  heldOn: string;
  topics: readonly string[];
  teamCount: number;
  participantCount: number;
}

export interface DesignBlueprintInput {
  assemblyTitle: string;
  assemblySlug: string;
  assemblyPurpose?: string;
  assemblyMode?: DesignAssemblyMode;
  readinessChecks?: readonly DesignReadinessKey[];
  sessions: readonly DesignBlueprintSessionInput[];
}

export const DESIGN_ASSEMBLY_MODES = ['consensus', 'vote'] as const;
export type DesignAssemblyMode = (typeof DESIGN_ASSEMBLY_MODES)[number];
export const DESIGN_READINESS_CHECKS = [
  'topics_open',
  'teams_active',
  'roster_loaded',
] as const;
export type DesignReadinessKey = (typeof DESIGN_READINESS_CHECKS)[number];

export interface DesignBlueprint {
  schemaVersion: 4;
  kind: 'platform-design-blueprint';
  dryRun: true;
  databaseMutationExecuted: false;
  requiresApproval: true;
  assembly: {
    title: string;
    slug: string;
    purpose: string | null;
    mode: DesignAssemblyMode;
    config: { readiness: DesignReadinessKey[] };
  };
  sessions: Array<{
    ordinal: number;
    title: string;
    slug: string;
    heldOn: string;
    topics: Array<{ ordinal: number; prompt: string }>;
    teams: Array<{ ordinal: number; name: string; plannedCapacity: number }>;
  }>;
  stats: { sessionCount: number; topicCount: number; teamCount: number; participantCount: number };
}

export type DesignBlueprintResult =
  | { ok: true; blueprint: DesignBlueprint }
  | { ok: false; errors: string[] };

export interface DesignBlueprintDownload {
  filename: string;
  content: string;
}

export type DesignBlueprintImportResult =
  | { ok: true; input: DesignBlueprintInput; blueprint: DesignBlueprint }
  | { ok: false; error: string };

function validateDesignBlueprintContract(): void {
  if (
    designBlueprintContract.schemaVersion !== 4
    || designBlueprintContract.kind !== 'platform-design-blueprint'
    || JSON.stringify(designBlueprintContract.assemblyModes) !== JSON.stringify(DESIGN_ASSEMBLY_MODES)
    || JSON.stringify(designBlueprintContract.readinessChecks) !== JSON.stringify(DESIGN_READINESS_CHECKS)
    || designBlueprintContract.slugPattern !== '^[a-z0-9-]{3,40}$'
    || designBlueprintContract.boundaries.dryRun !== true
    || designBlueprintContract.boundaries.databaseMutationExecuted !== false
    || designBlueprintContract.boundaries.requiresApproval !== true
  ) {
    throw new Error('Design blueprint contract is invalid');
  }
}

validateDesignBlueprintContract();

const ASSEMBLY_SLUG_PATTERN = new RegExp(designBlueprintContract.slugPattern);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DESIGN_BLUEPRINT_LIMITS = designBlueprintContract.limits;

const BLUEPRINT_IMPORT_ERROR = '청사진 JSON 형식 또는 내용이 올바르지 않습니다.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function importFailure(): DesignBlueprintImportResult {
  return { ok: false, error: BLUEPRINT_IMPORT_ERROR };
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function defaultSessionSlug(assemblySlug: string, ordinal: number): string {
  const suffix = `-session-${ordinal}`;
  return `${assemblySlug.slice(0, 40 - suffix.length)}${suffix}`;
}

/** Builds a deterministic, non-mutating blueprint for a future approved design RPC. */
export function buildDesignBlueprint(input: DesignBlueprintInput): DesignBlueprintResult {
  const assemblyTitle = input.assemblyTitle.trim();
  const assemblySlug = input.assemblySlug.trim();
  const assemblyPurpose = (input.assemblyPurpose ?? '').trim();
  const assemblyMode = input.assemblyMode ?? 'consensus';
  const readinessChecks = input.readinessChecks ?? DESIGN_READINESS_CHECKS;
  const errors: string[] = [];
  if (!assemblyTitle) errors.push('공론화 이름을 입력하세요.');
  if (assemblyTitle.length > DESIGN_BLUEPRINT_LIMITS.assemblyTitleChars) {
    errors.push(`공론화 이름은 ${DESIGN_BLUEPRINT_LIMITS.assemblyTitleChars}자 이하여야 합니다.`);
  }
  if (assemblyPurpose.length > DESIGN_BLUEPRINT_LIMITS.assemblyPurposeChars) {
    errors.push(`공론화 목적은 ${DESIGN_BLUEPRINT_LIMITS.assemblyPurposeChars}자 이하여야 합니다.`);
  }
  if (!DESIGN_ASSEMBLY_MODES.includes(assemblyMode)) {
    errors.push('운영 방식은 합의형 또는 투표형이어야 합니다.');
  }
  if (readinessChecks.length === 0) {
    errors.push('준비도 필수 항목을 하나 이상 선택하세요.');
  }
  if (readinessChecks.some((key) => !DESIGN_READINESS_CHECKS.includes(key))) {
    errors.push('준비도 필수 항목에 지원하지 않는 값이 있습니다.');
  }
  if (new Set(readinessChecks).size !== readinessChecks.length) {
    errors.push('준비도 필수 항목은 중복될 수 없습니다.');
  }
  if (!ASSEMBLY_SLUG_PATTERN.test(assemblySlug)) {
    errors.push('slug는 영문 소문자·숫자·하이픈 3~40자로 입력하세요.');
  }
  if (input.sessions.length === 0) errors.push('회차를 하나 이상 추가하세요.');
  if (input.sessions.length > DESIGN_BLUEPRINT_LIMITS.sessions) {
    errors.push(`회차는 최대 ${DESIGN_BLUEPRINT_LIMITS.sessions}개까지 추가할 수 있습니다.`);
  }
  const sessionsToValidate = input.sessions.slice(0, DESIGN_BLUEPRINT_LIMITS.sessions);
  sessionsToValidate.forEach((session, index) => {
    const label = `제${index + 1}회차`;
    const sessionTitle = (session.title ?? `제${index + 1}회차`).trim();
    const sessionSlug = (session.slug ?? defaultSessionSlug(assemblySlug, index + 1)).trim();
    if (!sessionTitle) errors.push(`${label} 이름을 입력하세요.`);
    if (sessionTitle.length > DESIGN_BLUEPRINT_LIMITS.sessionTitleChars) {
      errors.push(`${label} 이름은 ${DESIGN_BLUEPRINT_LIMITS.sessionTitleChars}자 이하여야 합니다.`);
    }
    if (!ASSEMBLY_SLUG_PATTERN.test(sessionSlug)) {
      errors.push(`${label} slug는 영문 소문자·숫자·하이픈 3~40자로 입력하세요.`);
    }
    if (session.topics.length > DESIGN_BLUEPRINT_LIMITS.topicsPerSession) {
      errors.push(`${label} 주제는 최대 ${DESIGN_BLUEPRINT_LIMITS.topicsPerSession}개까지 입력할 수 있습니다.`);
    }
    const topics = session.topics.slice(0, DESIGN_BLUEPRINT_LIMITS.topicsPerSession).map((topic) => topic.trim());
    if (!isCalendarDate(session.heldOn)) {
      errors.push(`${label} 날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.`);
    }
    if (topics.length === 0) errors.push(`${label} 주제를 하나 이상 입력하세요.`);
    if (topics.some((topic) => !topic)) errors.push(`${label} 주제에 빈 항목이 있습니다.`);
    if (topics.some((topic) => topic.length > DESIGN_BLUEPRINT_LIMITS.topicChars)) {
      errors.push(`${label} 각 주제는 ${DESIGN_BLUEPRINT_LIMITS.topicChars}자 이하여야 합니다.`);
    }
    if (new Set(topics).size !== topics.length) errors.push(`${label} 주제는 중복될 수 없습니다.`);
    if (!Number.isSafeInteger(session.teamCount) || session.teamCount < 1 || session.teamCount > DESIGN_BLUEPRINT_LIMITS.teamsPerSession) {
      errors.push(`${label} 조 수는 1~${DESIGN_BLUEPRINT_LIMITS.teamsPerSession} 범위의 정수여야 합니다.`);
    }
    if (!Number.isSafeInteger(session.participantCount) || session.participantCount < 1 || session.participantCount > DESIGN_BLUEPRINT_LIMITS.participantsPerSession) {
      errors.push(`${label} 참여자 수는 1~${DESIGN_BLUEPRINT_LIMITS.participantsPerSession} 범위의 정수여야 합니다.`);
    } else if (Number.isSafeInteger(session.teamCount) && session.teamCount > session.participantCount) {
      errors.push(`${label} 참여자 수는 조 수 이상이어야 합니다.`);
    }
  });
  const sessionSlugs = sessionsToValidate.map((session, index) => (
    session.slug ?? defaultSessionSlug(assemblySlug, index + 1)
  ).trim()).filter(Boolean);
  if (new Set(sessionSlugs).size !== sessionSlugs.length) {
    errors.push('회차 slug는 중복될 수 없습니다.');
  }
  if (sessionsToValidate.some((session, index) => (
    index > 0
    && isCalendarDate(session.heldOn)
    && isCalendarDate(sessionsToValidate[index - 1].heldOn)
    && session.heldOn < sessionsToValidate[index - 1].heldOn
  ))) {
    errors.push('회차 날짜는 앞 회차보다 이르지 않아야 합니다.');
  }
  const generatedItemCount = sessionsToValidate.reduce((sum, session) => (
    sum
    + session.topics.length
    + (
      Number.isSafeInteger(session.teamCount)
      && session.teamCount > 0
      && session.teamCount <= DESIGN_BLUEPRINT_LIMITS.teamsPerSession
        ? session.teamCount
        : 0
    )
  ), 0);
  if (generatedItemCount > DESIGN_BLUEPRINT_LIMITS.generatedItems) {
    errors.push(`청사진의 주제와 조는 합계 ${DESIGN_BLUEPRINT_LIMITS.generatedItems}개를 넘을 수 없습니다.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const sessions = input.sessions.map((session, sessionIndex) => {
    const baseCapacity = Math.floor(session.participantCount / session.teamCount);
    const remainder = session.participantCount % session.teamCount;
    return {
      ordinal: sessionIndex + 1,
      title: (session.title ?? `제${sessionIndex + 1}회차`).trim(),
      slug: (session.slug ?? defaultSessionSlug(assemblySlug, sessionIndex + 1)).trim(),
      heldOn: session.heldOn,
      topics: session.topics.map((prompt, topicIndex) => ({ ordinal: topicIndex + 1, prompt: prompt.trim() })),
      teams: Array.from({ length: session.teamCount }, (_, teamIndex) => ({
        ordinal: teamIndex + 1,
        name: `${teamIndex + 1}조`,
        plannedCapacity: baseCapacity + (teamIndex < remainder ? 1 : 0),
      })),
    };
  });
  return {
    ok: true,
    blueprint: {
      schemaVersion: 4,
      kind: 'platform-design-blueprint',
      dryRun: true,
      databaseMutationExecuted: false,
      requiresApproval: true,
      assembly: {
        title: assemblyTitle,
        slug: assemblySlug,
        purpose: assemblyPurpose || null,
        mode: assemblyMode,
        config: {
          readiness: DESIGN_READINESS_CHECKS.filter((key) => readinessChecks.includes(key)),
        },
      },
      sessions,
      stats: {
        sessionCount: sessions.length,
        topicCount: sessions.reduce((sum, session) => sum + session.topics.length, 0),
        teamCount: sessions.reduce((sum, session) => sum + session.teams.length, 0),
        participantCount: input.sessions.reduce((sum, session) => sum + session.participantCount, 0),
      },
    },
  };
}

/** Serializes an approved-review blueprint without changing application data. */
export function serializeDesignBlueprint(blueprint: DesignBlueprint): DesignBlueprintDownload {
  return {
    filename: `${blueprint.assembly.slug}_design_blueprint.json`,
    content: `${JSON.stringify(blueprint, null, 2)}\n`,
  };
}

/** Restores editable input only when the exported hierarchy is still canonical and non-mutating. */
export function parseDesignBlueprintImport(content: string): DesignBlueprintImportResult {
  if (content.length === 0 || content.length > DESIGN_BLUEPRINT_LIMITS.importChars) return importFailure();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return importFailure();
  }
  if (!isRecord(parsed)
    || !hasExactKeys(parsed, ['schemaVersion', 'kind', 'dryRun', 'databaseMutationExecuted', 'requiresApproval', 'assembly', 'sessions', 'stats'])
    || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4)
    || parsed.kind !== 'platform-design-blueprint'
    || parsed.dryRun !== true
    || parsed.databaseMutationExecuted !== false
    || parsed.requiresApproval !== true
    || !isRecord(parsed.assembly)
    || !hasExactKeys(parsed.assembly, parsed.schemaVersion === 4
      ? ['title', 'slug', 'purpose', 'mode', 'config']
      : parsed.schemaVersion === 3
        ? ['title', 'slug', 'purpose', 'mode']
        : ['title', 'slug'])
    || typeof parsed.assembly.title !== 'string'
    || typeof parsed.assembly.slug !== 'string'
    || ((parsed.schemaVersion === 3 || parsed.schemaVersion === 4)
      && parsed.assembly.purpose !== null
      && typeof parsed.assembly.purpose !== 'string')
    || ((parsed.schemaVersion === 3 || parsed.schemaVersion === 4)
      && parsed.assembly.mode !== 'consensus'
      && parsed.assembly.mode !== 'vote')
    || (parsed.schemaVersion === 4 && !isRecord(parsed.assembly.config))
    || (parsed.schemaVersion === 4
      && isRecord(parsed.assembly.config)
      && (!hasExactKeys(parsed.assembly.config, ['readiness'])
        || !Array.isArray(parsed.assembly.config.readiness)
        || parsed.assembly.config.readiness.some((key) => typeof key !== 'string')))
    || !Array.isArray(parsed.sessions)
    || !isRecord(parsed.stats)) {
    return importFailure();
  }

  const sessions: DesignBlueprintInput['sessions'][number][] = [];
  const normalizedSessions: DesignBlueprint['sessions'] = [];
  for (let sessionIndex = 0; sessionIndex < parsed.sessions.length; sessionIndex += 1) {
    const session = parsed.sessions[sessionIndex];
    const isLegacySession = parsed.schemaVersion === 1;
    if (!isRecord(session)
      || !hasExactKeys(session, isLegacySession
        ? ['ordinal', 'heldOn', 'topics', 'teams']
        : ['ordinal', 'title', 'slug', 'heldOn', 'topics', 'teams'])
      || session.ordinal !== sessionIndex + 1
      || (!isLegacySession && typeof session.title !== 'string')
      || (!isLegacySession && typeof session.slug !== 'string')
      || typeof session.heldOn !== 'string'
      || !Array.isArray(session.topics)
      || !Array.isArray(session.teams)) {
      return importFailure();
    }
    const topics: string[] = [];
    const normalizedTopics: DesignBlueprint['sessions'][number]['topics'] = [];
    for (let topicIndex = 0; topicIndex < session.topics.length; topicIndex += 1) {
      const topic = session.topics[topicIndex];
      if (!isRecord(topic)
        || !hasExactKeys(topic, ['ordinal', 'prompt'])
        || topic.ordinal !== topicIndex + 1
        || typeof topic.prompt !== 'string') {
        return importFailure();
      }
      topics.push(topic.prompt);
      normalizedTopics.push({ ordinal: topicIndex + 1, prompt: topic.prompt });
    }
    let participantCount = 0;
    const normalizedTeams: DesignBlueprint['sessions'][number]['teams'] = [];
    for (let teamIndex = 0; teamIndex < session.teams.length; teamIndex += 1) {
      const team = session.teams[teamIndex];
      if (!isRecord(team)
        || !hasExactKeys(team, isLegacySession
          ? ['ordinal', 'plannedCapacity']
          : ['ordinal', 'name', 'plannedCapacity'])
        || team.ordinal !== teamIndex + 1
        || (!isLegacySession && typeof team.name !== 'string')
        || typeof team.plannedCapacity !== 'number'
        || !Number.isSafeInteger(team.plannedCapacity)
        || team.plannedCapacity < 1) {
        return importFailure();
      }
      participantCount += team.plannedCapacity;
      if (!Number.isSafeInteger(participantCount)) return importFailure();
      normalizedTeams.push({
        ordinal: teamIndex + 1,
        name: isLegacySession ? `${teamIndex + 1}조` : team.name as string,
        plannedCapacity: team.plannedCapacity,
      });
    }
    sessions.push({
      title: isLegacySession ? `제${sessionIndex + 1}회차` : session.title as string,
      slug: isLegacySession ? defaultSessionSlug(parsed.assembly.slug, sessionIndex + 1) : session.slug as string,
      heldOn: session.heldOn,
      topics,
      teamCount: normalizedTeams.length,
      participantCount,
    });
    normalizedSessions.push({
      ordinal: sessionIndex + 1,
      title: isLegacySession ? `제${sessionIndex + 1}회차` : session.title as string,
      slug: isLegacySession ? defaultSessionSlug(parsed.assembly.slug, sessionIndex + 1) : session.slug as string,
      heldOn: session.heldOn,
      topics: normalizedTopics,
      teams: normalizedTeams,
    });
  }

  const input: DesignBlueprintInput = {
    assemblyTitle: parsed.assembly.title,
    assemblySlug: parsed.assembly.slug,
    assemblyPurpose: (parsed.schemaVersion === 3 || parsed.schemaVersion === 4) && typeof parsed.assembly.purpose === 'string'
      ? parsed.assembly.purpose
      : '',
    assemblyMode: (parsed.schemaVersion === 3 || parsed.schemaVersion === 4) && parsed.assembly.mode === 'vote' ? 'vote' : 'consensus',
    readinessChecks: parsed.schemaVersion === 4 && isRecord(parsed.assembly.config)
      && Array.isArray(parsed.assembly.config.readiness)
      ? parsed.assembly.config.readiness as DesignReadinessKey[]
      : [...DESIGN_READINESS_CHECKS],
    sessions,
  };
  const rebuilt = buildDesignBlueprint(input);
  if (!rebuilt.ok) return importFailure();
  if (!hasExactKeys(parsed.stats, ['sessionCount', 'topicCount', 'teamCount', 'participantCount'])
    || typeof parsed.stats.sessionCount !== 'number'
    || typeof parsed.stats.topicCount !== 'number'
    || typeof parsed.stats.teamCount !== 'number'
    || typeof parsed.stats.participantCount !== 'number') {
    return importFailure();
  }
  const normalizedBlueprint: DesignBlueprint = {
    schemaVersion: 4,
    kind: 'platform-design-blueprint',
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
    assembly: {
      title: parsed.assembly.title,
      slug: parsed.assembly.slug,
      purpose: (parsed.schemaVersion === 3 || parsed.schemaVersion === 4) && typeof parsed.assembly.purpose === 'string'
        ? parsed.assembly.purpose
        : null,
      mode: (parsed.schemaVersion === 3 || parsed.schemaVersion === 4) && parsed.assembly.mode === 'vote' ? 'vote' : 'consensus',
      config: {
        readiness: parsed.schemaVersion === 4 && isRecord(parsed.assembly.config)
          && Array.isArray(parsed.assembly.config.readiness)
          ? parsed.assembly.config.readiness as DesignReadinessKey[]
          : [...DESIGN_READINESS_CHECKS],
      },
    },
    sessions: normalizedSessions,
    stats: {
      sessionCount: parsed.stats.sessionCount,
      topicCount: parsed.stats.topicCount,
      teamCount: parsed.stats.teamCount,
      participantCount: parsed.stats.participantCount,
    },
  };
  if (JSON.stringify(normalizedBlueprint) !== JSON.stringify(rebuilt.blueprint)) return importFailure();
  return { ok: true, input, blueprint: rebuilt.blueprint };
}

const CHECK_LABELS: Readonly<Record<string, string>> = {
  topics_open: '공개 주제',
  teams_active: '활성 조',
  roster_loaded: '참여자 배정',
  submissions: '제출 완료 현황',
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
