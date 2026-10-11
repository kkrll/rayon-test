import type { Op } from './types';

export interface Session {
  index: number; // position in the returned array (sorted by startSeq)
  authorId: string;
  startSeq: number; // first op of the session
  endSeq: number; // last op; the display snapshot is the state at endSeq
  startTs: number;
  endTs: number;
  /** seqs of this author's ops; other authors' ops may interleave between them. */
  seqs: number[];
}

export const DEFAULT_IDLE_GAP_MS = 20 * 60 * 1000;

/**
 * Groups ops into per-author sessions. A session ends when its author has been
 * idle longer than `idleGapMs`. Sessions of different authors may overlap.
 */
export function groupSessions(ops: Op[], idleGapMs = DEFAULT_IDLE_GAP_MS): Session[] {
  const sessions: Session[] = [];
  const open = new Map<string, Session>();

  for (const op of ops) {
    let session = open.get(op.authorId);
    if (!session || op.ts - session.endTs > idleGapMs) {
      session = {
        index: 0,
        authorId: op.authorId,
        startSeq: op.seq,
        endSeq: op.seq,
        startTs: op.ts,
        endTs: op.ts,
        seqs: [],
      };
      open.set(op.authorId, session);
      sessions.push(session);
    }
    session.endSeq = op.seq;
    session.endTs = op.ts;
    session.seqs.push(op.seq);
  }

  // Already ordered by startSeq because sessions are pushed on their first op.
  sessions.forEach((s, i) => (s.index = i));
  return sessions;
}

/** Index of the session containing `seq` for the author of that op, or -1. */
export function sessionAt(sessions: Session[], ops: Op[], seq: number): number {
  const op = ops[seq - 1];
  if (!op) return -1;
  // Binary search for the last session starting at or before seq, then walk
  // back to find this author's one (overlaps are few, so the walk is short).
  let lo = 0;
  let hi = sessions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sessions[mid].startSeq <= seq) lo = mid;
    else hi = mid - 1;
  }
  for (let i = lo; i >= 0; i--) {
    const s = sessions[i];
    if (s.authorId === op.authorId && s.startSeq <= seq && seq <= s.endSeq) return i;
  }
  return -1;
}
