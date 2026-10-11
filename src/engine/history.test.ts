import { describe, expect, test } from 'vitest';
import { generateDataset } from './generator';
import { History, applyForward } from './history';
import { createRng } from './rng';
import type { ModelObject, Op } from './types';

const { ops } = generateDataset(1);
const N = ops.length;

/** Reference implementation: replay everything from the empty model. */
function fullReplay(seq: number) {
  const state = new Map<string, ModelObject>();
  for (let s = 0; s < seq; s++) applyForward(state, ops[s]);
  return state;
}

/** Objects are immutable, so equal states hold the very same references. */
function expectSameState(actual: ReadonlyMap<string, ModelObject>, expected: ReadonlyMap<string, ModelObject>, seq: number) {
  const mismatch = [...expected].find(([id, obj]) => actual.get(id) !== obj);
  expect({ seq, size: actual.size, mismatch: mismatch?.[0] }).toEqual({ seq, size: expected.size, mismatch: undefined });
}

/** Reference states at every seq, built once by a forward pass (copy per seq). */
function referenceStates(): ((seq: number) => Map<string, ModelObject>) {
  // Storing ~N full copies is too heavy; store every 50th and replay the rest.
  const every = 50;
  const stored: Map<string, ModelObject>[] = [];
  const state = new Map<string, ModelObject>();
  for (let s = 0; s <= N; s++) {
    if (s % every === 0) stored.push(new Map(state));
    if (s < N) applyForward(state, ops[s]);
  }
  return (seq) => {
    const copy = new Map(stored[Math.floor(seq / every)]);
    for (let s = Math.floor(seq / every) * every; s < seq; s++) applyForward(copy, ops[s]);
    return copy;
  };
}

describe('History.getStateAt', () => {
  const reference = referenceStates();

  test('reference matches a literal full replay at sampled seqs', () => {
    for (const seq of [0, 1, 199, 200, 201, Math.floor(N / 2), N - 1, N]) {
      expectSameState(reference(seq), fullReplay(seq), seq);
    }
  });

  test('checkpoint path equals full replay at every seq', () => {
    const history = new History(ops, { incrementalThreshold: -1 }); // always checkpoint
    for (let seq = 0; seq <= N; seq++) {
      const state = history.getStateAt(seq);
      expect(history.lastTiming?.path).toBe('checkpoint');
      expectSameState(state, reference(seq), seq);
    }
  });

  test('incremental forward, one op at a time, equals full replay', () => {
    const history = new History(ops, { incrementalThreshold: Infinity });
    for (let seq = 0; seq <= N; seq++) expectSameState(history.getStateAt(seq), reference(seq), seq);
  });

  test('incremental backward, one op at a time, equals full replay', () => {
    const history = new History(ops, { incrementalThreshold: Infinity });
    history.getStateAt(N);
    for (let seq = N; seq >= 0; seq--) {
      const state = history.getStateAt(seq);
      expect(history.lastTiming?.path).toBe('incremental');
      expectSameState(state, reference(seq), seq);
    }
  });

  test('random jumps with default thresholds mix both paths and stay correct', () => {
    const history = new History(ops);
    const rng = createRng(42);
    const paths = new Set<string>();
    let seq = 0;
    for (let i = 0; i < 2000; i++) {
      // Mostly small scrubs, sometimes long jumps.
      seq = rng.chance(0.8) ? seq + rng.int(-250, 250) : rng.int(0, N);
      seq = Math.max(0, Math.min(N, seq));
      expectSameState(history.getStateAt(seq), reference(seq), seq);
      paths.add(history.lastTiming!.path);
    }
    expect(paths).toEqual(new Set(['incremental', 'checkpoint']));
  });

  test('checkpoint path never replays more than checkpointEvery ops', () => {
    const history = new History(ops, { checkpointEvery: 200, incrementalThreshold: 300 });
    history.getStateAt(N);
    history.getStateAt(1999);
    expect(history.lastTiming).toMatchObject({ path: 'checkpoint', opsApplied: 199 });
  });

  test('snapshotAt returns an independent copy', () => {
    const history = new History(ops);
    const snap = history.snapshotAt(N);
    history.getStateAt(0);
    expectSameState(snap, reference(N), N);
  });
});

describe('History.diff', () => {
  const history = new History(ops);

  test('applying the diff to the state at "from" gives the state at "to"', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const from = rng.int(0, N);
      const to = Math.min(N, from + rng.int(0, 500));
      const state = history.snapshotAt(from);
      const { added, deleted, modified } = history.diff(from, to);
      for (const o of deleted) state.delete(o.id);
      for (const o of [...added, ...modified]) state.set(o.id, o);
      expectSameState(state, history.snapshotAt(to), to);
    }
  });

  test('an object created and deleted inside the range does not appear', () => {
    const tiny: Op[] = [
      { seq: 1, ts: 0, authorId: 'a', kind: 'create', objectId: 'x', before: null, after: furniture('x', 0) },
    ];
    tiny.push({ seq: 2, ts: 1, authorId: 'a', kind: 'delete', objectId: 'x', before: tiny[0].after, after: null });
    expect(new History(tiny).diff(0, 2)).toEqual({ added: [], deleted: [], modified: [] });
  });
});

function furniture(id: string, x: number): ModelObject {
  return { id, type: 'furniture', geometry: { x, y: 0, w: 10, h: 10, rotation: 0 }, style: { name: 'Box', material: '#999' } };
}
