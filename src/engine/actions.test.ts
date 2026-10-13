import { describe, expect, test } from 'vitest';
import { YOU, copyUntil, resetEdits, resetTo } from './actions';
import { generateDataset } from './generator';
import { History } from './history';
import { generateLettersDataset } from './letters';
import type { Letter, ModelObject, Op } from './types';

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

describe('resetEdits: undo only the selected edits', () => {
  const letters = generateLettersDataset(1);
  const lettersHistory = new History(letters.ops);
  const at = Math.round(letters.ops.length * 0.5);
  const name = (op: Op) => ((op.after ?? op.before) as Letter).style.name;
  const latest = lettersHistory.snapshotAt(lettersHistory.length);
  const byName = (state: Map<string, ModelObject>, n: string) => [...state.values()].find((o) => (o as Letter).style.name === n);

  test('one letter goes back; the others stay exactly as they are', () => {
    const reset = resetEdits(letters, lettersHistory, at, (op) => name(op) === 'A', 7);
    const after = new History(reset.ops).snapshotAt(reset.ops.length);
    expect(reset.ops.slice(letters.ops.length).every((op) => name(op) === 'A')).toBe(true);
    for (const n of ['B', 'C', 'D']) expect(byName(after, n)).toEqual(byName(latest, n));
    // A was only ever edited as "A", so it is back to its state at `at` (ids aside, if redrawn).
    const then = byName(lettersHistory.snapshotAt(at), 'A')!;
    expect({ ...byName(after, 'A'), id: '' }).toEqual({ ...then, id: '' });
  });

  test('several letters at once (OR) match resetting each of them', () => {
    const both = resetEdits(letters, lettersHistory, at, (op) => ['A', 'C'].includes(name(op)), 7);
    const after = new History(both.ops).snapshotAt(both.ops.length);
    const then = lettersHistory.snapshotAt(at);
    for (const n of ['A', 'C']) expect({ ...byName(after, n), id: '' }).toEqual({ ...byName(then, n), id: '' });
    for (const n of ['B', 'D']) expect(byName(after, n)).toEqual(byName(latest, n));
  });

  test("by author: a property someone else changed last keeps their value", () => {
    const l: Letter = {
      id: 'x', type: 'letter',
      geometry: { position: { x: 0, y: 0, z: 0 }, rotation: 0, depth: 0.3, bevel: 0 },
      style: { name: 'A', material: 'clay', color: '#000', detail: 0.5 },
    };
    const edit = (seq: number, authorId: string, before: Letter | null, after: Letter): Op =>
      ({ seq, ts: seq, authorId, kind: before ? 'update' : 'create', objectId: 'x', before, after });
    const l1 = { ...l, geometry: { ...l.geometry, rotation: 10 } }; // mine: rotation
    const l2 = { ...l1, style: { ...l1.style, color: '#f00' } }; // mine: colour
    const l3 = { ...l2, style: { ...l2.style, color: '#0f0' } }; // theirs: colour
    const l4 = { ...l3, geometry: { ...l3.geometry, depth: 0.5 } }; // mine: depth
    const ops = [edit(1, 'them', null, l), edit(2, 'me', l, l1), edit(3, 'me', l1, l2), edit(4, 'them', l2, l3), edit(5, 'me', l3, l4)];
    const ds = { authors: [], ops, namedVersions: [] };
    const reset = resetEdits(ds, new History(ops), 1, (op) => op.authorId === 'me', 9);
    const final = new History(reset.ops).snapshotAt(reset.ops.length).get('x') as Letter;
    expect(final.geometry.rotation).toBe(0); // my rotation undone
    expect(final.style.color).toBe('#0f0'); // their colour, set after mine, kept
    expect(final.geometry.depth).toBe(0.3); // my depth undone
  });

  test('a selected create is undone by deleting; a selected delete by creating again', () => {
    const created = letters.ops.find((op, i) => i > 0 && op.kind === 'create' && op.seq > 4)!;
    const reset = resetEdits(letters, lettersHistory, created.seq - 1, (op) => op.objectId === created.objectId, 7);
    expect(new History(reset.ops).snapshotAt(reset.ops.length).has(created.objectId)).toBe(false);
    const deleted = letters.ops.find((op) => op.kind === 'delete')!;
    const back = resetEdits(letters, lettersHistory, deleted.seq - 1, (op) => op.seq === deleted.seq, 7);
    expect(new History(back.ops).snapshotAt(back.ops.length).get(deleted.objectId)).toEqual(deleted.before);
  });
});
