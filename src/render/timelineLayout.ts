import type { Op } from '../engine/types';

export const BREAK_GAP_MS = 2 * 60 * 60 * 1000;
export const BREAK_PX = 36;

/**
 * Layout along the timeline's time axis, in content pixels (before scrolling).
 * Axis-neutral: the renderer decides which screen direction time runs in.
 * Every edit gets the same width (`ppo`, pixels per op); idle gaps longer than
 * BREAK_GAP_MS collapse into a fixed-width break, whatever the zoom.
 *
 * Positions are "boundaries": boundary s is the point after op s, which is
 * where the cursor sits for getStateAt(s). Op k occupies [boundary k-1, k].
 */
export class TimelineLayout {
  readonly n: number;
  /** Boundaries s (1..n-1) followed by a break. */
  readonly breaks: number[] = [];
  /** breaksBefore[s] = number of breaks at boundaries strictly before s. */
  private readonly breaksBefore: Int32Array;

  constructor(ops: Op[], gapMs = BREAK_GAP_MS) {
    this.n = ops.length;
    this.breaksBefore = new Int32Array(this.n + 1);
    for (let s = 1; s <= this.n; s++) {
      const breakAtPrev = s - 1 >= 1 && ops[s - 1].ts - ops[s - 2].ts > gapMs;
      if (breakAtPrev) this.breaks.push(s - 1);
      this.breaksBefore[s] = this.breaksBefore[s - 1] + (breakAtPrev ? 1 : 0);
    }
  }

  boundaryAt(s: number, ppo: number) {
    return s * ppo + this.breaksBefore[s] * BREAK_PX;
  }

  /** Left edge of op k's slot (it sits after any break at boundary k-1). */
  tickAt(k: number, ppo: number) {
    return (k - 1) * ppo + this.breaksBefore[k] * BREAK_PX;
  }

  length(ppo: number) {
    return this.boundaryAt(this.n, ppo);
  }

  /** Nearest boundary to an axis position. */
  seqAt(x: number, ppo: number) {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.boundaryAt(mid, ppo) <= x) lo = mid;
      else hi = mid - 1;
    }
    if (lo < this.n && this.boundaryAt(lo + 1, ppo) - x < x - this.boundaryAt(lo, ppo)) return lo + 1;
    return lo;
  }
}
