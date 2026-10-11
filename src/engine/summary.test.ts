import { expect, test } from 'vitest';
import { type SessionEdit, describeEdit, formatList, summarize } from './summary';
import type { Furniture, Op, Room } from './types';

const sofa: Furniture = {
  id: 'f1',
  type: 'furniture',
  geometry: { x: 0, y: 0, w: 200, h: 90, rotation: 0 },
  style: { name: 'Sofa', material: '#999' },
};
const room: Room = { id: 'r1', type: 'room', geometry: { points: [] }, style: { name: 'Living', fill: '#eee' } };

const update = (before: Furniture | Room, after: Furniture | Room): Op =>
  ({ seq: 1, ts: 0, authorId: 'a', kind: 'update', objectId: before.id, before, after });

test('describeEdit names what changed', () => {
  expect(describeEdit(update(sofa, { ...sofa, geometry: { ...sofa.geometry, x: 5 } }))).toBe('moved');
  expect(describeEdit(update(sofa, { ...sofa, geometry: { ...sofa.geometry, rotation: Math.PI / 2 } }))).toBe('rotated');
  expect(describeEdit(update(sofa, { ...sofa, geometry: { ...sofa.geometry, w: 220 } }))).toBe('resized');
  expect(describeEdit(update(sofa, { ...sofa, style: { ...sofa.style, material: '#000' } }))).toBe('restyled');
  expect(describeEdit(update(room, { ...room, style: { ...room.style, name: 'Lounge' } }))).toBe('renamed');
});

test('summarize ranks distinct objects and rooms by how often they were edited', () => {
  const edit = (name: string, room: string | null): SessionEdit =>
    ({ verb: 'moved', type: 'furniture', objectId: name, name, room });
  const summary = summarize([edit('Sofa', 'Living'), edit('Table', 'Kitchen'), edit('Table', 'Kitchen'), edit('Rug', null)]);
  expect(summary).toEqual({ edits: 4, objects: ['Table', 'Sofa', 'Rug'], rooms: ['Kitchen', 'Living'] });
});

test('formatList shows the first items and counts the rest', () => {
  expect(formatList(['Kitchen', 'Bedroom', 'Hall', 'WC'], 2)).toBe('Kitchen, Bedroom +2 more');
  expect(formatList(['Kitchen'], 2)).toBe('Kitchen');
});
