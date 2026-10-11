import type { Session } from '../engine/sessions';

/**
 * Lanes for session brackets: overlapping sessions (two authors at once)
 * get side-by-side lanes. Greedy by start, reusing the first free lane.
 */
export function assignLanes(sessions: Session[]): number[] {
  const laneEnds: number[] = [];
  return sessions.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.startSeq);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.endSeq;
    return lane;
  });
}

export interface Slot {
  top: number;
  height: number;
}

export interface CardCandidate {
  index: number;
  top: number;
  /** Larger sessions win space first. */
  priority: number;
}

/**
 * Picks which session cards to show: biggest first, each only if it doesn't
 * overlap anything already placed (including reserved label rows). The same
 * rule yields "all cards" up close and "only the largest" far out.
 */
export function placeCards(candidates: CardCandidate[], cardHeight: number, reserved: Slot[] = []): CardCandidate[] {
  const taken: Slot[] = [...reserved];
  const placed: CardCandidate[] = [];
  const byPriority = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of byPriority) {
    const free = taken.every((t) => c.top + cardHeight <= t.top || c.top >= t.top + t.height);
    if (!free) continue;
    taken.push({ top: c.top, height: cardHeight });
    placed.push(c);
  }
  return placed;
}
