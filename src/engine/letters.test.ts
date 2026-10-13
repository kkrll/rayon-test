import { describe, expect, it } from 'vitest';
import { History } from './history';
import { CHARS, DESIGN, generateLettersDataset } from './letters';
import type { Letter } from './types';

describe('generateLettersDataset', () => {
  const dataset = generateLettersDataset(1);
  const history = new History(dataset.ops);

  it('is deterministic', () => {
    expect(generateLettersDataset(1).ops.length).toBe(dataset.ops.length);
  });

  it('has a few thousand edits, numbered in order', () => {
    expect(dataset.ops.length).toBeGreaterThan(1500);
    expect(dataset.ops.every((op, i) => op.seq === i + 1)).toBe(true);
  });

  it('ends exactly on the design', () => {
    const letters = [...history.snapshotAt(history.length).values()] as Letter[];
    expect(letters.map((l) => l.style.name).sort()).toEqual([...CHARS]);
    for (const l of letters) {
      const d = DESIGN[l.style.name];
      expect({ ...l.geometry, ...l.style, name: undefined }).toEqual({ ...d, name: undefined });
    }
  });

  it('redraws one letter: deleted, then created again', () => {
    expect(dataset.ops.filter((op) => op.kind === 'delete')).toHaveLength(1);
    expect(dataset.ops.filter((op) => op.kind === 'create')).toHaveLength(CHARS.length + 1);
  });
});
