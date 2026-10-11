import { expect, test } from 'vitest';
import { describeEdit } from './summary';
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
