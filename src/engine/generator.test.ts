import { describe, expect, it } from 'vitest';
import { generateDataset } from './generator';
import type { ModelObject, ObjectType, State } from './types';

const DAY = 86_400_000;
const FIRST_DAY = Date.UTC(2026, 2, 2);

const t0 = performance.now();
const data = generateDataset(1);
const elapsedMs = performance.now() - t0;
const { ops } = data;

function replay(): State {
  const live: State = new Map();
  for (const op of ops) {
    if (op.after) live.set(op.objectId, op.after);
    else live.delete(op.objectId);
  }
  return live;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

const finalState = replay();
const finalCounts = countBy([...finalState.values()], (o: ModelObject) => o.type);

describe('generateDataset', () => {
  it('prints stats', () => {
    console.log(
      `ops=${ops.length} time=${elapsedMs.toFixed(0)}ms final=${JSON.stringify(finalCounts)}`,
      `kinds=${JSON.stringify(countBy(ops, (o) => o.kind))}`,
      `authors=${JSON.stringify(countBy(ops, (o) => o.authorId))}`,
      `versions=${JSON.stringify(data.namedVersions)}`,
    );
  });

  it('is deterministic per seed', () => {
    const again = generateDataset(1).ops;
    const sample = (list: typeof ops) => JSON.stringify(list.filter((_, i) => i % 50 === 0));
    expect(again.length).toBe(ops.length);
    expect(sample(again)).toBe(sample(ops));

    const other = generateDataset(2).ops;
    expect(sample(other)).not.toBe(sample(ops));
  });

  it('is fast', () => {
    expect(elapsedMs).toBeLessThan(300);
  });

  it('has a plausible size and timeline', () => {
    expect(ops.length).toBeGreaterThanOrEqual(8000);
    expect(ops.length).toBeLessThanOrEqual(10000);
    ops.forEach((op, i) => expect(op.seq).toBe(i + 1));
    for (let i = 1; i < ops.length; i++) expect(ops[i].ts).toBeGreaterThanOrEqual(ops[i - 1].ts);
    const spanDays = (ops.at(-1)!.ts - ops[0].ts) / DAY;
    expect(spanDays).toBeGreaterThanOrEqual(80);
    expect(spanDays).toBeLessThanOrEqual(100);
  });

  it('replays consistently: before is the live object by reference', () => {
    const live: State = new Map();
    for (const op of ops) {
      if (op.kind === 'create') {
        expect(op.before).toBeNull();
        expect(live.has(op.objectId)).toBe(false);
      } else {
        expect(op.before).toBe(live.get(op.objectId));
      }
      if (op.kind === 'delete') expect(op.after).toBeNull();
      if (op.kind === 'update') {
        expect(op.after).not.toBe(op.before);
        expect(op.after!.id).toBe(op.before!.id);
        expect(op.after!.type).toBe(op.before!.type);
      }
      if (op.after) live.set(op.objectId, op.after);
      else live.delete(op.objectId);
    }
  });

  it('never reuses ids', () => {
    const created = ops.filter((op) => op.kind === 'create').map((op) => op.objectId);
    expect(new Set(created).size).toBe(created.length);
  });

  it('works only on weekdays between 08:00 and 20:00 UTC', () => {
    for (const op of ops) {
      const date = new Date(op.ts);
      expect([0, 6]).not.toContain(date.getUTCDay());
      expect(date.getUTCHours()).toBeGreaterThanOrEqual(8);
      expect(date.getUTCHours()).toBeLessThan(20);
    }
    expect(ops[0].ts).toBeGreaterThanOrEqual(FIRST_DAY);
  });

  it('ends with a believable model and all authors', () => {
    const count = (type: ObjectType) => finalCounts[type] ?? 0;
    expect(count('wall')).toBeGreaterThanOrEqual(40);
    expect(count('wall')).toBeLessThanOrEqual(60);
    expect(count('room')).toBeGreaterThanOrEqual(8);
    expect(count('room')).toBeLessThanOrEqual(11);
    expect(count('furniture')).toBeGreaterThanOrEqual(80);
    expect(count('furniture')).toBeLessThanOrEqual(150);
    expect(new Set(ops.map((op) => op.authorId)).size).toBe(5);
  });

  it('has chronological named versions at op boundaries', () => {
    const { namedVersions } = data;
    expect(namedVersions.length).toBeGreaterThanOrEqual(4);
    expect(namedVersions.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < namedVersions.length; i++) {
      expect(namedVersions[i].seq).toBeGreaterThan(namedVersions[i - 1].seq);
    }
    expect(namedVersions.at(-1)!.seq).toBeLessThanOrEqual(ops.length);
  });
});
