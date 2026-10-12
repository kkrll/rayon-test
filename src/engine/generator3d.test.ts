import { describe, expect, it } from 'vitest';
import { PARTS } from './device';
import { generateDeviceDataset } from './generator3d';
import { History } from './history';
import type { ModelObject, Part } from './types';

const dataset = generateDeviceDataset(1);
const { ops } = dataset;
const finalState = new History(ops).snapshotAt(ops.length);
const finalParts = [...finalState.values()] as Part[];

describe('generateDeviceDataset', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(generateDeviceDataset(1).ops)).toBe(JSON.stringify(ops));
  });

  it('numbers ops contiguously in time order', () => {
    ops.forEach((op, i) => {
      expect(op.seq).toBe(i + 1);
      if (i > 0) expect(op.ts).toBeGreaterThanOrEqual(ops[i - 1].ts);
    });
  });

  it('takes every `before` from the live state', () => {
    const live = new Map<string, ModelObject>();
    for (const op of ops) {
      expect(live.get(op.objectId) ?? null).toBe(op.before);
      if (op.after) live.set(op.objectId, op.after);
      else live.delete(op.objectId);
    }
  });

  it('ends exactly on the shipped design: every part once, in place, in its own finish', () => {
    expect(finalParts.map((p) => p.geometry.source).sort()).toEqual(PARTS.map((p) => p.source).sort());
    for (const part of finalParts) {
      const spec = PARTS.find((s) => s.source === part.geometry.source)!;
      expect(part.style.finish).toBe(spec.finish);
      expect(part.geometry.offset).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('tells the whole story: moves, finish changes and redrawn parts', () => {
    const updates = ops.filter((op) => op.kind === 'update') as (typeof ops[number] & { before: Part; after: Part })[];
    const moved = updates.filter((op) => op.before.geometry.offset !== op.after.geometry.offset);
    const restyled = updates.filter((op) => op.before.style.finish !== op.after.style.finish);
    expect(moved.length).toBeGreaterThan(200);
    expect(restyled.length).toBeGreaterThan(100);
    expect(ops.filter((op) => op.kind === 'delete').length).toBeGreaterThan(3);
    expect(dataset.namedVersions.map((v) => v.name)).toEqual(
      ['Shell blockout', 'Display fitted', 'Keyboard detailed', 'CMF review', 'Release candidate']);
  });
});
