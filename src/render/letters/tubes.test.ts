import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildTubeEdges, buildTubes, TUBE_WIDTH } from './tubes';

describe('buildTubes', () => {
  for (const char of ['A', 'B', 'C', 'D']) {
    for (let count = 3; count <= 7; count++) {
      it(`${char} x${count}`, () => {
        const t0 = performance.now();
        const g = buildTubes(char, count);
        const ms = performance.now() - t0;
        const t1 = performance.now();
        const e = buildTubeEdges(char, count);
        const edgeMs = performance.now() - t1;
        console.log(`${char} x${count}: ${ms.toFixed(1)} ms, ${g.getAttribute('position').count} verts, ${g.index!.count / 3} tris; edges ${edgeMs.toFixed(1)} ms`);

        expect(g.index).not.toBeNull();
        const r = (TUBE_WIDTH / (2 * count)) * 0.92;
        for (const name of ['position', 'normal', 'uv']) {
          expect(g.getAttribute(name).array.some(Number.isNaN)).toBe(false);
        }
        const verts = g.getAttribute('position').count;
        expect(Math.max(...(g.index!.array as Uint16Array))).toBeLessThan(verts);
        g.computeBoundingBox();
        const box = g.boundingBox!;
        expect(box.min.y).toBeGreaterThan(-r - 0.07);
        expect(box.max.y - box.min.y).toBeGreaterThan(0.71 - 0.05);
        expect(box.max.y - box.min.y).toBeLessThan(0.71 + 0.12 + 2 * r); // A's mitred apex overshoots
        expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
        expect(box.max.z).toBeCloseTo(r, 5);
        expect(box.min.z).toBeCloseTo(-r, 5);

        // Outward winding: geometric normals agree with vertex normals on average.
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const idx = g.index!;
        let agree = 0;
        let total = 0;
        const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
        for (let i = 0; i < idx.count; i += 3) {
          a.fromBufferAttribute(p, idx.getX(i));
          b.fromBufferAttribute(p, idx.getX(i + 1));
          c.fromBufferAttribute(p, idx.getX(i + 2));
          const face = b.sub(a).cross(c.sub(a));
          if (face.lengthSq() < 1e-14) continue;
          const vn = new Vector3().fromBufferAttribute(n, idx.getX(i));
          total++;
          if (face.dot(vn) > 0) agree++;
        }
        // The innermost rods at A's apex bend tighter than their radius and fold a few faces.
        expect(agree / total).toBeGreaterThan(0.97);

        expect(e.getAttribute('lineDistance').count).toBe(e.getAttribute('position').count);
        expect(e.getAttribute('position').array.some(Number.isNaN)).toBe(false);
        expect(ms).toBeLessThan(20);
        expect(edgeMs).toBeLessThan(20);
      });
    }
  }
});
