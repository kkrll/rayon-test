import { BufferAttribute, BufferGeometry } from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Letter, LetterMaterial } from '../../engine/types';
import fontData from './geist-black-abcd.typeface.json';
import { buildTopology } from './topology';
import { TUBE_WIDTH, buildTubeEdges, buildTubes } from './tubes';

// Letter shapes: pure geometry, no DOM, so they can be built in a worker
// (shapeWorker.ts) as well as on the main thread.

export interface LetterShape {
  geometry: BufferGeometry;
  /** Hard edges, for diff outlines. */
  edges: BufferGeometry;
}

/** What a shape depends on: never depth (stretched when placed) or roughness (a uniform). */
export interface ShapeSpec {
  char: string;
  material: LetterMaterial;
  bevel: number;
  detail: number;
}

/** Shapes are built at this depth and stretched to a letter's own. */
export const SHAPE_DEPTH = 0.3;

/** Detail in quarter steps: enough variation, few distinct shapes and textures. */
export const quantize = (detail: number) => Math.round(detail * 4) / 4;

/** Chrome: more detail, more (thinner) tubes. */
const tubeCount = (detail: number) => 3 + Math.round(quantize(detail) * 4);

export function specOf(letter: Letter): ShapeSpec {
  return { char: letter.style.name, material: letter.style.material, bevel: letter.geometry.bevel, detail: letter.style.detail };
}

/** Letters with the same key share a shape. */
export function shapeKey(s: ShapeSpec): string {
  return s.material === 'chrome' ? `${s.char}|chrome|${tubeCount(s.detail)}` : `${s.char}|${s.material}|${s.bevel}`;
}

/** Shapes of the same letter and material differ only by bevel or tube count: a close stand-in. */
export const familyKey = (s: ShapeSpec) => `${s.char}|${s.material}|`;

let font: ReturnType<FontLoader['parse']> | null = null;

export function buildShape(s: ShapeSpec): LetterShape {
  font ??= new FontLoader().parse(fontData as never);
  if (s.material === 'chrome') {
    const count = tubeCount(s.detail);
    // Rods are round (±r in z); stretch them back to SHAPE_DEPTH so the sides read as ribs.
    const stretch = SHAPE_DEPTH / 2 / ((TUBE_WIDTH / (2 * count)) * 0.92);
    return { geometry: buildTubes(s.char, count).scale(1, 1, stretch), edges: buildTubeEdges(s.char, count).scale(1, 1, stretch) };
  }
  // Glass is domed; stone and carved are subdivided for displacement. Carved has a
  // wider rim than its bevel says, cut like a chamfer.
  const family = s.material === 'glass' ? 'domed' : s.material === 'stone' || s.material === 'carved' ? 'faceted' : 'plain';
  const size = s.material === 'carved' ? 0.015 + s.bevel * 0.5 : s.bevel;
  return buildTopology(font, { char: s.char, depth: SHAPE_DEPTH, bevel: size, family });
}

/** The bare extruded glyph: the quickest stand-in while the real shape is on its way. */
export function buildPlain(s: ShapeSpec): LetterShape {
  return buildShape({ ...s, material: 'clay' });
}

// ---------------------------------------------------------------- transfer

/** A geometry as plain typed arrays, to post between threads without copying. */
export interface PackedGeometry {
  index: Uint16Array | Uint32Array | null;
  attributes: { name: string; array: Float32Array; itemSize: number }[];
}

export function pack(geometry: BufferGeometry): PackedGeometry {
  return {
    index: (geometry.index?.array as Uint16Array | Uint32Array | undefined) ?? null,
    attributes: Object.entries(geometry.attributes).map(([name, a]) => ({
      name,
      array: a.array as Float32Array,
      itemSize: a.itemSize,
    })),
  };
}

export function unpack(packed: PackedGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  if (packed.index) geometry.setIndex(new BufferAttribute(packed.index, 1));
  for (const a of packed.attributes) geometry.setAttribute(a.name, new BufferAttribute(a.array, a.itemSize));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The buffers to transfer (not copy) with a packed geometry. */
export function buffersOf(...packed: PackedGeometry[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const p of packed) {
    if (p.index) buffers.add(p.index.buffer as ArrayBuffer);
    for (const a of p.attributes) buffers.add(a.array.buffer as ArrayBuffer);
  }
  return [...buffers];
}
