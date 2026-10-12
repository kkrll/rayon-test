import type { Session } from './sessions';
import type { Op } from './types';

/**
 * The history as the timeline sees it: only the edits that match a filter,
 * renumbered 1..n ("positions"), and the sessions they belong to. The model
 * still lives in real seqs; `seqOf` and `posOf` translate. Without a filter
 * positions and seqs are the same.
 */
export interface Lens {
  /** Matching ops, `seq` renumbered to their position. */
  ops: Op[];
  /** Sessions with at least one matching op, in positions. `index` is the lens index. */
  sessions: Session[];
  /** Lens session index -> index of the original session. */
  origin: number[];
  /** Real seq shown at a position: after that op; position 0 is just before the first match. */
  seqOf(pos: number): number;
  /** Position at or before a real seq. */
  posOf(seq: number): number;
}

export function createLens(ops: Op[], sessions: Session[], match: ((op: Op) => boolean) | null): Lens {
  if (!match) {
    return { ops, sessions, origin: sessions.map((_, i) => i), seqOf: (p) => p, posOf: (s) => s };
  }

  const seqs: number[] = []; // position - 1 -> real seq
  const lensOps: Op[] = [];
  const posOfSeq = new Map<number, number>();
  for (const op of ops) {
    if (!match(op)) continue;
    seqs.push(op.seq);
    lensOps.push({ ...op, seq: seqs.length });
    posOfSeq.set(op.seq, seqs.length);
  }

  const lensSessions: Session[] = [];
  const origin: number[] = [];
  for (const s of sessions) {
    const positions = s.seqs.flatMap((seq) => posOfSeq.get(seq) ?? []);
    if (positions.length === 0) continue;
    const first = lensOps[positions[0] - 1];
    const last = lensOps[positions[positions.length - 1] - 1];
    lensSessions.push({
      index: lensSessions.length,
      authorId: s.authorId,
      startSeq: first.seq,
      endSeq: last.seq,
      startTs: first.ts,
      endTs: last.ts,
      seqs: positions,
    });
    origin.push(s.index);
  }

  return {
    ops: lensOps,
    sessions: lensSessions,
    origin,
    seqOf: (pos) => (pos <= 0 ? Math.max(0, (seqs[0] ?? 1) - 1) : seqs[Math.min(pos, seqs.length) - 1]),
    posOf: (seq) => {
      // Number of matching seqs <= seq.
      let lo = 0;
      let hi = seqs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (seqs[mid] <= seq) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}
