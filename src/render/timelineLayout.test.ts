import { describe, expect, test } from 'vitest';
import type { Op } from '../engine/types';
import { BREAK_PX, TimelineLayout } from './timelineLayout';

const HOUR = 3_600_000;
const ops = [0, 1, 2, 10, 11].map((minute, i): Op => ({
  seq: i + 1,
  ts: minute === 10 ? 5 * HOUR : minute === 11 ? 5 * HOUR + 60_000 : minute * 60_000,
  authorId: 'a',
  kind: 'update',
  objectId: 'x',
  before: null,
  after: null,
}));

describe('TimelineLayout', () => {
  const layout = new TimelineLayout(ops);

  test('collapses idle gaps over 2 h into one fixed-width break', () => {
    expect(layout.breaks).toEqual([3]);
    expect(layout.width(10)).toBe(5 * 10 + BREAK_PX);
    expect(layout.width(2)).toBe(5 * 2 + BREAK_PX);
  });

  test('ticks after a break are shifted by the break width', () => {
    expect(layout.tickX(3, 10)).toBe(20);
    expect(layout.tickX(4, 10)).toBe(30 + BREAK_PX);
  });

  test('seqAtX inverts boundaryX', () => {
    for (let s = 0; s <= ops.length; s++) expect(layout.seqAtX(layout.boundaryX(s, 10) + 1, 10)).toBe(s);
  });
});
