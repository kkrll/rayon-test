/** Small deterministic PRNG (mulberry32). Same seed, same sequence. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, maxInclusive: number) => min + Math.floor(next() * (maxInclusive - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Picks a value with probability proportional to its weight. */
export function weighted<T>(rng: Rng, entries: [T, number][]): T {
  let r = rng.next() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of entries) {
    r -= w;
    if (r < 0) return value;
  }
  return entries[entries.length - 1][0];
}
