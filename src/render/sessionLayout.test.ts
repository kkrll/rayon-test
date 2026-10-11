import { expect, test } from 'vitest';
import type { Session } from '../engine/sessions';
import { assignLanes, placeCards } from './sessionLayout';

const session = (startSeq: number, endSeq: number) => ({ startSeq, endSeq }) as Session;

test('overlapping sessions get separate lanes, and lanes are reused', () => {
  expect(assignLanes([session(1, 10), session(5, 12), session(11, 20), session(13, 14)])).toEqual([0, 1, 0, 1]);
});

test('placeCards keeps the biggest sessions and never overlaps', () => {
  const placed = placeCards(
    [
      { index: 0, top: 0, priority: 5 },
      { index: 1, top: 20, priority: 50 },
      { index: 2, top: 60, priority: 1 },
    ],
    40,
  );
  expect(placed.map((c) => c.index).sort()).toEqual([1, 2]);
});

test('reserved rows are respected', () => {
  const placed = placeCards([{ index: 0, top: 0, priority: 1 }], 40, [{ top: 30, height: 16 }]);
  expect(placed).toEqual([]);
});
