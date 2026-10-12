import type { Op } from '../engine/types';

export const BREAK_GAP_MS = 2 * 60 * 60 * 1000;
export const BREAK_PX = 40;
const MIN_BREAK_PX = 2;

/**
 * Break size at a zoom level: the full BREAK_PX up close, shrinking when
 * zoomed out so ~65 overnight breaks don't outweigh the edits themselves.
 */
export function breakPx(ppo: number) {
  return Math.min(BREAK_PX, Math.max(MIN_BREAK_PX, Math.round(ppo * 12)));
}

/**
 * Layout along the timeline's time axis, in content pixels (before scrolling).
 * Axis-neutral: the renderer decides which screen direction time runs in.
 * Every edit gets the same width (`ppo`, pixels per op); idle gaps longer than
 * BREAK_GAP_MS collapse into a fixed-size break (see breakPx).
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
  private readonly breakAt: Uint8Array;

  constructor(ops: Op[], gapMs = BREAK_GAP_MS) {
    this.n = ops.length;
    this.breaksBefore = new Int32Array(this.n + 1);
    this.breakAt = new Uint8Array(this.n + 1);
    for (let s = 1; s <= this.n; s++) {
      const breakAtPrev = s - 1 >= 1 && ops[s - 1].ts - ops[s - 2].ts > gapMs;
      if (breakAtPrev) {
        this.breaks.push(s - 1);
        this.breakAt[s - 1] = 1;
      }
      this.breaksBefore[s] = this.breaksBefore[s - 1] + (breakAtPrev ? 1 : 0);
    }
  }

  boundaryAt(s: number, ppo: number) {
    return s * ppo + this.breaksBefore[s] * breakPx(ppo);
  }

  /** Left edge of op k's slot (it sits after any break at boundary k-1). */
  tickAt(k: number, ppo: number) {
    return (k - 1) * ppo + this.breaksBefore[k] * breakPx(ppo);
  }

  length(ppo: number) {
    return this.boundaryAt(this.n, ppo);
  }

  /**
   * Where the playhead rests for boundary s: the boundary itself, or the
   * middle of the band above it, where a day header sits: a break between
   * days, or above the newest edit the top padding (the renderer's TOP_PAD,
   * BREAK_PX). There the head's day and time cover the header.
   */
  headAt(s: number, ppo: number) {
    if (s === this.n && this.n > 0) return this.boundaryAt(s, ppo) + BREAK_PX / 2;
    return this.boundaryAt(s, ppo) + (this.breakAt[s] ? breakPx(ppo) / 2 : 0);
  }

  /** Nearest resting place of the head (see headAt) to an axis position. */
  headSeqAt(x: number, ppo: number) {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.headAt(mid, ppo) <= x) lo = mid;
      else hi = mid - 1;
    }
    if (lo < this.n && this.headAt(lo + 1, ppo) - x < x - this.headAt(lo, ppo)) return lo + 1;
    return lo;
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
