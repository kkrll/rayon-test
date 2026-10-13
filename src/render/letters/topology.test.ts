import { describe, expect, it } from 'vitest';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import fontData from './geist-black-abcd.typeface.json';
import { type Family, buildTopology } from './topology';

const font = new FontLoader().parse(fontData as never);
const families: Family[] = ['plain', 'faceted', 'domed'];
const LIMIT: Record<Family, number> = { plain: 30, faceted: 60, domed: 60 };
const make = (char: string, family: Family) => buildTopology(font, { char, depth: 0.3, bevel: 0.02, family });

describe('buildTopology', () => {
  for (const family of families) {
    for (const char of 'ABCD') {
      it(`${char} ${family}`, () => {
        make(char, family); // warm up (JIT, shape cache)
        const runs = 5;
        const t0 = performance.now();
        let t = make(char, family);
        for (let i = 1; i < runs; i++) t = make(char, family);
        const ms = (performance.now() - t0) / runs;
        const { geometry: g, edges } = t;
        console.log(`${char} ${family}: ${ms.toFixed(1)} ms, ${g.getAttribute('position').count} verts, ${g.index!.count / 3} tris, ${edges.getAttribute('position').count / 2} edge segs`);

        expect(ms).toBeLessThan(LIMIT[family]);
        expect(g.index).not.toBeNull();
        expect(g.getAttribute('aNoise').itemSize).toBe(3);
        expect(g.getAttribute('normal')).toBeDefined();
        expect(g.getAttribute('uv')).toBeDefined();
        const pos = g.getAttribute('position').array;
        expect(pos.every(Number.isFinite)).toBe(true);
        g.computeBoundingBox();
        const box = g.boundingBox!;
        expect(Math.abs(box.min.y)).toBeLessThan(1e-3);
        expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(2e-3);
        expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(2e-3);
        expect(edges.getAttribute('position').count).toBeGreaterThan(0);
        expect(edges.getAttribute('lineDistance').count).toBe(edges.getAttribute('position').count);
      });
    }
  }

  it('domed bulges further than plain', () => {
    for (const char of 'ABCD') {
      const front = (f: Family) => {
        const g = make(char, f).geometry;
        g.computeBoundingBox();
        return g.boundingBox!.max.z;
      };
      expect(front('domed')).toBeGreaterThan(front('plain'));
    }
  });

  it('shares vertices between neighbouring triangles', () => {
    const g = make('B', 'faceted').geometry;
    expect(g.getAttribute('position').count).toBeLessThan((g.index!.count / 3) * 3 * 0.4);
    // No duplicated positions at all (1e-6).
    const seen = new Set<string>();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) seen.add([p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e6)).join());
    expect(seen.size).toBe(p.count);
  });
});
