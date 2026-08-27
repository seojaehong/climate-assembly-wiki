/**
 * L4 — 묶음의 **대표 문장 지목**을 위한 순수 로직.
 *
 * 설계문서(`10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md` §4)의
 * L4 행은 이렇게 못 박는다.
 *
 * > | **L4** | 묶음의 **대표 문장 지목** | ⚠️ **시민이 고른다** | … |
 * > 모더레이터가 하면 「**좋은 의견 선정**」 금지에 걸린다
 *
 * 같은 문서는 「L4는 도구에 버튼을 만들지 않는다」고도 적었다. PRD 는 그 위험을 **장치로 막는 조건**으로
 * 화면을 허용했고, 이 파일이 그 장치다. 두 가지를 **자료구조와 예외로** 막는다.
 *
 * 1. **모더레이터 단독 지정은 불가능하다.** `kind: 'moderator'` 는 `citizenConfirmed: true` 없이는
 *    예외로 튕긴다 — 화면이 「시민이 고른 것입니다」를 확인받지 않으면 지정 자체가 성립하지 않는다.
 * 2. **문장 신작이 불가능하다.** 이 API 는 카드 **id 만** 받는다. 문장을 넣을 인자가 없으니
 *    묶음 밖의 문장이나 새로 쓴 문장이 대표가 될 길이 없다
 *    (`four-category.ts` 의 「지울 대상이 없으니 지울 수 없다」와 같은 수법).
 *
 * 그리고 대표를 골라도 **묶음의 카드는 한 장도 줄지 않는다.** 대표는 묶음 위에 얹는 이름표일 뿐이고
 * 나머지 카드는 제자리에 그대로 남는다(US-010 화면도 나머지를 계속 보여준다).
 *
 *   묶어도 카드 수는 줄지 않는다.
 */

/** 지목한 사람의 종류. 시민이 고르는 것이 원칙이고, 모더레이터는 **대신 기록**만 할 수 있다. */
export const REPRESENTATIVE_ACTOR_KINDS = ['citizen', 'moderator'] as const;

export type RepresentativeActorKind = (typeof REPRESENTATIVE_ACTOR_KINDS)[number];

/**
 * 「누가·언제」. 이력에 남길 값을 지목할 때 함께 받는다.
 *
 * ★ `at` 을 인자로 받는 이유 — 이 모듈은 **시계를 읽지 않는다.** 같은 입력이면 같은 출력이어야
 * 테스트가 시각에 흔들리지 않고, 시각 도장은 화면(US-010)이 조작이 일어난 그 자리에서 찍는다.
 * `pickRepresentative(state, groupId, noteId, actor)` 라는 네 인자 모양을 유지하려고
 * 다섯째 인자 대신 actor 안에 넣었다 — 「누가」와 「언제」는 어차피 한 사건의 두 면이다.
 */
export type RepresentativeActor = {
  kind: RepresentativeActorKind;
  /** 누가 골랐는가. 조 이름·이름표 등 사람이 읽는 문자열. 빈 값이면 지목이 성립하지 않는다. */
  label: string;
  /** 언제. ISO 문자열을 그대로 보관한다(형식 검사는 하지 않는다). */
  at: string;
  /** 모더레이터가 대신 기록할 때, 화면에서 「시민이 고른 것입니다」를 확인받았는가. */
  citizenConfirmed?: boolean;
};

/** 지목 사건 하나 — 누가·언제·어느 묶음의·무엇을. 덮어써도 지워지지 않고 쌓인다. */
export type RepresentativePickEntry = {
  groupId: string;
  noteId: string;
  actorKind: RepresentativeActorKind;
  actorLabel: string;
  at: string;
  /** 시민이 골랐음을 확인한 기록. `kind: 'citizen'` 이면 언제나 true 다. */
  citizenConfirmed: boolean;
};

/**
 * 대표 지목 상태.
 *
 * ★ **「현재 대표」를 따로 들고 있지 않는다.** 현재 대표는 `history` 의 **마지막 사건**에서 파생한다.
 * 서로 맞아야 하는 저장소를 둘 두면 언젠가 어긋나고, 어긋난 순간 화면이 조용히 거짓을 보여준다
 * (`four-category.ts` 가 「범주별 배열」을 버린 것과 같은 이유).
 * 마지막 사건이 이긴다는 규칙은 US-007 의 읽기 RPC(`order by ... e.id desc`)와도 같다 —
 * 나중에 서버에 붙일 때 화면과 DB 의 해석이 하나다.
 */
export type RepresentativeState = {
  /** 묶음 id → 그 묶음에 든 카드 id 들. 이 모듈은 이 목록을 **절대 바꾸지 않는다.** */
  groups: ReadonlyMap<string, readonly string[]>;
  /** append-only 지목 이력(오래된 것부터). 덮어써도 이전 기록이 남는다. */
  history: readonly RepresentativePickEntry[];
};

export type RepresentativePickErrorReason =
  /** actor 자체가 없다 — 누가 골랐는지 없이는 지정할 수 없다. */
  | 'actor-required'
  /** actor 는 있는데 이름이 비었다 — 이력에 「누가」가 안 남는다. */
  | 'actor-label-required'
  /** 모더레이터 단독 지정. 「좋은 의견 선정」 금지에 걸린다. */
  | 'moderator-alone'
  /** 그런 묶음이 없다. */
  | 'unknown-group'
  /** 그 묶음에 없는 카드(또는 새 문장)를 대표로 세우려 했다. */
  | 'outside-group';

/** 지목이 성립하지 않을 때 던진다. `reason` 으로 화면이 한국어 안내를 고른다. */
export class RepresentativePickError extends Error {
  readonly reason: RepresentativePickErrorReason;

  constructor(reason: RepresentativePickErrorReason, message: string) {
    super(message);
    this.name = 'RepresentativePickError';
    this.reason = reason;
  }
}

/**
 * 묶음 목록으로 상태를 만든다. 아직 아무도 아무것도 고르지 않은 상태다 —
 * **AI 가 대표를 미리 정해두지 않는다.**
 */
export function representativeStateFromGroups(
  groups: Iterable<readonly [string, readonly string[]]>,
): RepresentativeState {
  const map = new Map<string, readonly string[]>();
  for (const [groupId, members] of groups) map.set(groupId, [...members]);
  return { groups: map, history: [] };
}

export function emptyRepresentativeState(): RepresentativeState {
  return representativeStateFromGroups([]);
}

/** 그 묶음에 든 카드 id 들. 없는 묶음이면 빈 배열(읽기는 너그럽게, 쓰기는 엄격하게). */
export function groupMembers(state: RepresentativeState, groupId: string): readonly string[] {
  return state.groups.get(groupId) ?? [];
}

/**
 * 대표를 지목한다. **새 상태**를 돌려주고 입력 상태는 건드리지 않는다.
 *
 * `groups` 는 같은 참조로 그대로 넘어간다 — 지목이 묶음의 카드를 건드릴 방법이 없다는 뜻이다.
 * 이미 대표가 있어도 예외가 아니라 **덮어쓴다**. 다만 이전 사건은 이력에 남는다(누가 바꿨는지 추적).
 */
export function pickRepresentative(
  state: RepresentativeState,
  groupId: string,
  noteId: string,
  actor: RepresentativeActor,
): RepresentativeState {
  if (!actor) {
    throw new RepresentativePickError(
      'actor-required',
      '누가 골랐는지 없이 대표를 지정할 수 없습니다.',
    );
  }
  if (!actor.label || actor.label.trim() === '') {
    throw new RepresentativePickError(
      'actor-label-required',
      '누가 골랐는지(이름)를 남기지 않고 대표를 지정할 수 없습니다.',
    );
  }
  const citizenConfirmed = actor.kind === 'citizen' ? true : actor.citizenConfirmed === true;
  if (!citizenConfirmed) {
    throw new RepresentativePickError(
      'moderator-alone',
      '모더레이터 단독으로는 대표를 지정할 수 없습니다. 시민이 골랐음을 확인해야 합니다.',
    );
  }

  const members = state.groups.get(groupId);
  if (!members) {
    throw new RepresentativePickError('unknown-group', `그런 묶음이 없습니다: ${groupId}`);
  }
  if (!members.includes(noteId)) {
    throw new RepresentativePickError(
      'outside-group',
      '대표는 그 묶음에 든 카드 중에서만 고를 수 있습니다.',
    );
  }

  const entry: RepresentativePickEntry = {
    groupId,
    noteId,
    actorKind: actor.kind,
    actorLabel: actor.label,
    at: actor.at,
    citizenConfirmed,
  };
  return { groups: state.groups, history: [...state.history, entry] };
}

/**
 * 지금 그 묶음의 대표는 누구인가. 아직 아무도 안 골랐으면 null.
 *
 * **마지막 사건이 이긴다.** 묶음의 카드 목록이 나중에 바뀌어 대표가 그 묶음에서 빠졌다면
 * 예전 지목을 되살리지 않고 그냥 null 을 낸다 — 이력은 남되 화면은 「아직 안 골랐다」로 보인다
 * (US-007 읽기 규칙과 같은 방향: 마지막 사건을 먼저 뽑고 화면이 판단하게 둔다).
 */
export function representativeOf(state: RepresentativeState, groupId: string): string | null {
  for (let i = state.history.length - 1; i >= 0; i -= 1) {
    const entry = state.history[i];
    if (entry.groupId !== groupId) continue;
    return groupMembers(state, groupId).includes(entry.noteId) ? entry.noteId : null;
  }
  return null;
}

/**
 * 지목 이력(오래된 것부터). `groupId` 를 주면 그 묶음 것만 추린다.
 *
 * 덮어써도 이전 기록이 남는다 — 「누가·언제 묶었는지」를 되짚을 수 있어야 되돌릴 수 있고,
 * 되돌릴 수 있어야 책임이 남는다(설계문서 §4).
 */
export function pickHistory(
  state: RepresentativeState,
  groupId?: string,
): readonly RepresentativePickEntry[] {
  if (groupId === undefined) return state.history;
  return state.history.filter((entry) => entry.groupId === groupId);
}
