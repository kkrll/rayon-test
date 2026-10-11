import { describe, expect, test } from 'vitest';
import { generateDataset } from './generator';
import { groupSessions, sessionAt } from './sessions';
import type { Op } from './types';

const MIN = 60_000;

function op(seq: number, authorId: string, minute: number): Op {
  return { seq, ts: minute * MIN, authorId, kind: 'update', objectId: 'x', before: null, after: null };
}

describe('groupSessions', () => {
  test('splits an author on idle gaps longer than the threshold', () => {
    const ops = [op(1, 'a', 0), op(2, 'a', 10), op(3, 'a', 31), op(4, 'a', 50)];
    const sessions = groupSessions(ops, 20 * MIN);
    expect(sessions.map((s) => s.seqs)).toEqual([[1, 2], [3, 4]]);
  });

  test('keeps overlapping sessions of different authors apart', () => {
    const ops = [op(1, 'a', 0), op(2, 'b', 1), op(3, 'a', 2), op(4, 'b', 3)];
    const sessions = groupSessions(ops);
    expect(sessions.map((s) => [s.authorId, s.startSeq, s.endSeq])).toEqual([
      ['a', 1, 3],
      ['b', 2, 4],
    ]);
  });

  test('the gap threshold is configurable', () => {
    const ops = [op(1, 'a', 0), op(2, 'a', 10)];
    expect(groupSessions(ops, 5 * MIN)).toHaveLength(2);
    expect(groupSessions(ops, 15 * MIN)).toHaveLength(1);
  });

  test('every op belongs to exactly one session on the generated data', () => {
    const { ops } = generateDataset(1);
    const sessions = groupSessions(ops);
    expect(sessions.reduce((n, s) => n + s.seqs.length, 0)).toBe(ops.length);
    for (const o of ops) {
      const s = sessions[sessionAt(sessions, ops, o.seq)];
      expect(s.authorId).toBe(o.authorId);
      expect(s.seqs).toContain(o.seq);
    }
  });
});
