import { expect, test } from 'vitest';
import { YOU, copyUntil, resetTo } from './actions';
import { generateDataset } from './generator';
import { History } from './history';

const dataset = generateDataset(1);
const history = new History(dataset.ops);
const seq = Math.round(dataset.ops.length * 0.6);

test('a copy keeps the history up to the viewed edit', () => {
  const copy = copyUntil(dataset, seq);
  expect(copy.ops).toHaveLength(seq);
  expect(copy.namedVersions.every((v) => v.seq <= seq)).toBe(true);
  expect(new History(copy.ops).snapshotAt(seq)).toEqual(history.snapshotAt(seq));
});

test('a reset appends edits that end on the viewed state, keeping all history', () => {
  const reset = resetTo(dataset, history, seq, 123);
  const added = reset.ops.slice(dataset.ops.length);
  expect(reset.ops.slice(0, dataset.ops.length)).toEqual(dataset.ops);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((op) => op.authorId === YOU.id && op.ts === 123)).toBe(true);
  expect(reset.authors.some((a) => a.id === YOU.id)).toBe(true);
  expect(new History(reset.ops).snapshotAt(reset.ops.length)).toEqual(history.snapshotAt(seq));
});

test('resetting to the latest edit adds nothing', () => {
  expect(resetTo(dataset, history, history.length, 0).ops).toHaveLength(dataset.ops.length);
});
