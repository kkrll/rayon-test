import type { StateTiming } from '../engine/history';

/**
 * Frame statistics for the debug overlay. Views record each actual draw;
 * the overlay samples these a few times per second.
 */
const WINDOW_MS = 1000;

class Meter {
  private samples: { t: number; ms: number }[] = [];

  record(ms: number) {
    const t = performance.now();
    this.samples.push({ t, ms });
    while (this.samples.length && this.samples[0].t < t - WINDOW_MS) this.samples.shift();
  }

  /** Draws in the last second, and the slowest one. */
  read() {
    const cutoff = performance.now() - WINDOW_MS;
    const recent = this.samples.filter((s) => s.t >= cutoff);
    return { perSecond: recent.length, worstMs: recent.reduce((m, s) => Math.max(m, s.ms), 0) };
  }
}

export const stats = {
  /** Every requestAnimationFrame tick; ms = time since the previous tick. */
  loop: new Meter(),
  model: new Meter(),
  timeline: new Meter(),
  lastState: null as StateTiming | null,
};
