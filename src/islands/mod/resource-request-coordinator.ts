export type ResourceRequestPriority = 'background' | 'manual' | 'final';

export type ResourceRequestTicket = Readonly<{
  sequence: number;
  resourceKey: string;
  priority: ResourceRequestPriority;
}>;

export type ResourceRequestCoordinator = {
  begin: (resourceKey: string, priority: ResourceRequestPriority) => ResourceRequestTicket | null;
  isCurrent: (ticket: ResourceRequestTicket) => boolean;
  finish: (ticket: ResourceRequestTicket) => void;
  invalidate: () => void;
  currentSequence: () => number;
};

const PRIORITY_RANK: Record<ResourceRequestPriority, number> = {
  background: 0,
  manual: 1,
  final: 2,
};

/**
 * Coordinates reads of one logical resource without aborting network requests.
 *
 * Background ticks are single-flight. A foreground request may supersede an
 * older background request, and final verification also blocks a lower-priority
 * manual request until it settles. Superseded promises may still resolve, but
 * their tickets can no longer mutate UI state.
 */
export function createResourceRequestCoordinator(): ResourceRequestCoordinator {
  let sequence = 0;
  let currentResourceKey: string | null = null;
  const active = new Map<number, ResourceRequestTicket>();

  const invalidate = () => {
    sequence += 1;
    currentResourceKey = null;
    active.clear();
  };

  return {
    begin(resourceKey, priority) {
      if (currentResourceKey !== resourceKey) {
        sequence += 1;
        currentResourceKey = resourceKey;
        active.clear();
      }

      if (priority === 'background' && active.size > 0) return null;
      const priorityRank = PRIORITY_RANK[priority];
      if ([...active.values()].some((ticket) => PRIORITY_RANK[ticket.priority] > priorityRank)) {
        return null;
      }

      // A newer request at the same priority wins. A higher-priority request
      // also logically cancels lower work so a hung promise cannot block later
      // background recovery after the foreground request completes.
      for (const [activeSequence, ticket] of active) {
        if (PRIORITY_RANK[ticket.priority] <= priorityRank) active.delete(activeSequence);
      }

      const ticket: ResourceRequestTicket = {
        sequence: sequence + 1,
        resourceKey,
        priority,
      };
      sequence = ticket.sequence;
      active.set(ticket.sequence, ticket);
      return ticket;
    },
    isCurrent(ticket) {
      return currentResourceKey === ticket.resourceKey
        && sequence === ticket.sequence
        && active.has(ticket.sequence);
    },
    finish(ticket) {
      active.delete(ticket.sequence);
    },
    invalidate,
    currentSequence() {
      return sequence;
    },
  };
}
