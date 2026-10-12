import { expect, test } from 'vitest';
import { matcher, toggle } from './filter';
import type { SessionEdit } from './summary';
import type { Op } from './types';

const op = (seq: number, authorId: string): Op =>
  ({ seq, ts: 0, authorId, kind: 'update', objectId: `o${seq}`, before: null, after: null });
const edit = (area: string): SessionEdit => ({ verb: 'moved', type: 'furniture', objectId: '', name: 'Rug', area });

const ops = [op(1, 'sam'), op(2, 'sam'), op(3, 'lena'), op(4, 'sam')];
const edits = [edit('Kitchen'), edit('WC'), edit('Kitchen'), edit('Hall')];
const kept = (f: Parameters<typeof matcher>[0]) => ops.filter(matcher(f, edits)!).map((o) => o.seq);

test('values of one facet are alternatives', () => {
  expect(kept({ area: ['Kitchen', 'WC'] })).toEqual([1, 2, 3]);
});

test('facets narrow each other', () => {
  expect(kept({ area: ['Kitchen', 'WC'], author: ['sam'] })).toEqual([1, 2]);
});

test('toggle adds a value, and removes it the second time', () => {
  const once = toggle({}, 'area', 'WC');
  expect(once).toEqual({ area: ['WC'] });
  expect(toggle(toggle(once, 'area', 'Hall'), 'area', 'WC')).toEqual({ area: ['Hall'] });
  expect(toggle(once, 'area', 'WC').area).toBeUndefined();
});
