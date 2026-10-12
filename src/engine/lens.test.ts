import { expect, test } from 'vitest';
import { createLens } from './lens';
import { groupSessions } from './sessions';
import type { Op } from './types';

const MIN = 60_000;
const op = (seq: number, authorId: string, ts: number): Op =>
  ({ seq, ts, authorId, kind: 'create', objectId: `o${seq}`, before: null, after: null });

// a: 1, 2, 4 (one session); b: 3, 5 (one session, overlapping a's)
const ops = [op(1, 'a', 0), op(2, 'a', MIN), op(3, 'b', 2 * MIN), op(4, 'a', 3 * MIN), op(5, 'b', 4 * MIN)];
const sessions = groupSessions(ops);

test('without a filter, positions are seqs', () => {
  const lens = createLens(ops, sessions, null);
  expect(lens.ops).toBe(ops);
  expect(lens.seqOf(3)).toBe(3);
  expect(lens.posOf(3)).toBe(3);
});

test('a filter keeps matching ops, renumbered, and the sessions they belong to', () => {
  const lens = createLens(ops, sessions, (o) => o.authorId === 'b');
  expect(lens.ops.map((o) => o.seq)).toEqual([1, 2]);
  expect(lens.ops.map((o) => o.objectId)).toEqual(['o3', 'o5']);
  expect(lens.sessions).toHaveLength(1);
  expect(lens.sessions[0]).toMatchObject({ index: 0, authorId: 'b', startSeq: 1, endSeq: 2, seqs: [1, 2] });
  expect(lens.origin).toEqual([1]);
});

test('positions and real seqs translate both ways', () => {
  const lens = createLens(ops, sessions, (o) => o.authorId === 'b');
  expect([0, 1, 2].map(lens.seqOf)).toEqual([2, 3, 5]); // 0 = just before the first match
  expect([0, 2, 3, 4, 5].map(lens.posOf)).toEqual([0, 0, 1, 1, 2]);
  for (const p of [0, 1, 2]) expect(lens.posOf(lens.seqOf(p))).toBe(p);
});
