import { BufferAttribute, BufferGeometry, Vector2 } from 'three';

/** Stroke width (letter units) that the parallel rods together fill. */
export const TUBE_WIDTH = 0.19;
/** Segments around a rod. */
const RADIAL = 12;
/** Rounded ends: rings of a hemisphere, as sin/cos of the angle from the rod's axis. */
const CAP = [22.5, 45, 67.5].map((d) => [Math.sin((d * Math.PI) / 180), Math.cos((d * Math.PI) / 180)]);
/** Corners sharper than this (cos of the turn) get rounded; the rest of the path is left alone. */
const CORNER_COS = Math.cos((20 * Math.PI) / 180);
/** How far a rounded corner reaches along each side. */
const CORNER_REACH = 0.07;
const CORNER_STEPS = 5;

/** Stroke centrelines, in letter units (caps 0.71 tall, strokes 0.19 wide). */
const SKELETONS: Record<string, Vector2[][]> = (() => {
  const v = (x: number, y: number) => new Vector2(x, y);
  const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 24) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
      return v(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    });
  const top = 0.615;
  const bottom = 0.095;
  return {
    A: [[v(0.1, 0), v(0.38, top), v(0.66, 0)], [v(0.19, 0.2), v(0.57, 0.2)]],
    B: [
      [v(0.1, 0), v(0.1, top + 0.095)],
      [v(0.1, top), v(0.36, top), ...arc(0.36, 0.4875, 0.13, 0.1275, 90, -90), v(0.1, 0.36)],
      [v(0.1, 0.36), v(0.4, 0.36), ...arc(0.4, 0.2275, 0.14, 0.1325, 90, -90), v(0.1, bottom)],
    ],
    C: [arc(0.38, 0.355, 0.3, 0.26, 40, 320, 40)],
    D: [
      [v(0.1, 0), v(0.1, top + 0.095)],
      [v(0.1, top), v(0.33, top), ...arc(0.33, 0.355, 0.29, 0.26, 90, -90, 36), v(0.1, bottom)],
    ],
  };
})();

/** A polyline moved sideways by `d` (left of travel), mitred at the corners. */
function offsetPolyline(points: Vector2[], d: number): Vector2[] {
  const normal = (a: Vector2, b: Vector2) => new Vector2(a.y - b.y, b.x - a.x).normalize();
  return points.map((p, i) => {
    const before = i > 0 ? normal(points[i - 1], p) : null;
    const after = i < points.length - 1 ? normal(p, points[i + 1]) : null;
    const n = before && after ? before.clone().add(after).normalize() : (before ?? after)!;
    const miter = before && after ? Math.min(2, 1 / Math.max(0.3, n.dot(after))) : 1;
    return p.clone().addScaledVector(n, d * miter);
  });
}

/**
 * The rod centrelines as flat xy arrays: offset polylines with repeated points
 * dropped (a sweep needs a tangent everywhere) and sharp corners rounded off.
 */
function paths(char: string, count: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (const stroke of SKELETONS[char] ?? SKELETONS.A) {
    for (let k = 0; k < count; k++) {
      const offset = -TUBE_WIDTH / 2 + (TUBE_WIDTH / count) * (k + 0.5);
      // Repeated skeleton points (B's joins) would make the mitre double its offset, so drop them first.
      const line = stroke.filter((p, i) => i === 0 || p.distanceTo(stroke[i - 1]) > 1e-4);
      const pts: number[] = [];
      for (const p of offsetPolyline(line, offset)) pts.push(p.x, p.y);
      out.push(round(pts));
    }
  }
  return out;
}

/** Replaces each sharp corner by a small quadratic curve through its two neighbours' reach. */
function round(pts: number[]): Float32Array {
  const out: number[] = [pts[0], pts[1]];
  const n = pts.length / 2;
  for (let i = 1; i < n - 1; i++) {
    const [px, py, x, y, nx, ny] = [pts[2 * i - 2], pts[2 * i - 1], pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]];
    const l0 = Math.hypot(x - px, y - py);
    const l1 = Math.hypot(nx - x, ny - y);
    const cos = ((x - px) * (nx - x) + (y - py) * (ny - y)) / (l0 * l1);
    if (cos > CORNER_COS) {
      out.push(x, y);
      continue;
    }
    // Stay inside the shorter side so neighbouring corners never overlap.
    const reach = Math.min(CORNER_REACH, l0 * 0.4, l1 * 0.4);
    const [ax, ay] = [x + ((px - x) / l0) * reach, y + ((py - y) / l0) * reach];
    const [bx, by] = [x + ((nx - x) / l1) * reach, y + ((ny - y) / l1) * reach];
    for (let s = 0; s <= CORNER_STEPS; s++) {
      const t = s / CORNER_STEPS;
      const [w0, w1, w2] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
      out.push(w0 * ax + w1 * x + w2 * bx, w0 * ay + w1 * y + w2 * by);
    }
  }
  out.push(pts[2 * n - 2], pts[2 * n - 1]);
  return Float32Array.from(out);
}

const rodRadius = (count: number) => (TUBE_WIDTH / (2 * count)) * 0.92;

/** Unit tangents of a path (central differences), flat xy. */
function tangents(path: Float32Array): Float32Array {
  const n = path.length / 2;
  const t = new Float32Array(path.length);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = path[2 * b] - path[2 * a];
    const dy = path[2 * b + 1] - path[2 * a + 1];
    const l = Math.hypot(dx, dy) || 1;
    t[2 * i] = dx / l;
    t[2 * i + 1] = dy / l;
  }
  return t;
}

/** x shift that centres the rods, per letter and count (edges must match the mesh). */
const centres = new Map<string, number>();

/**
 * Chrome letter: `count` parallel rods along each stroke of `char`, indexed
 * BufferGeometry with position, normal, uv. Unit depth: rods are round in xy
 * with radius r and their z extent is ±r, so the caller stretches z
 * (mesh.scale.z) to reach the letter's depth. Stands on y = 0, centred in x and z.
 *
 * The strokes are planar, so no frame needs to twist: the tangent lies in xy,
 * the side is its xy perpendicular and the binormal is +z.
 */
export function buildTubes(char: string, count: number): BufferGeometry {
  const r = rodRadius(count);
  const rods = paths(char, count);
  const ring = RADIAL + 1; // the seam vertex is doubled for uvs

  let vertices = 0;
  let triangles = 0;
  for (const path of rods) {
    const rings = path.length / 2 + 2 * CAP.length;
    vertices += rings * ring + 2;
    triangles += (rings - 1) * RADIAL * 2 + 2 * RADIAL;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = vertices > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);

  let v = 0;
  let t = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const path of rods) {
    const tan = tangents(path);
    const samples = path.length / 2;
    const rings = samples + 2 * CAP.length;
    const first = v;

    for (let j = 0; j < rings; j++) {
      // Which path sample the ring sits on, and how far along the axis (sin) and out (cos) it is.
      let i: number, along: number, scale: number;
      if (j < CAP.length) {
        const [s, c] = CAP[CAP.length - 1 - j];
        [i, along, scale] = [0, -s, c];
      } else if (j >= samples + CAP.length) {
        const [s, c] = CAP[j - samples - CAP.length];
        [i, along, scale] = [samples - 1, s, c];
      } else {
        [i, along, scale] = [j - CAP.length, 0, 1];
      }
      const [tx, ty] = [tan[2 * i], tan[2 * i + 1]];
      const cx = path[2 * i] + tx * along * r;
      const cy = path[2 * i + 1] + ty * along * r;
      for (let k = 0; k <= RADIAL; k++, v++) {
        const a = ((k % RADIAL) / RADIAL) * Math.PI * 2;
        // Direction around the rod: cos along the side (-ty, tx), sin along z.
        const dx = -ty * Math.cos(a);
        const dy = tx * Math.cos(a);
        const dz = Math.sin(a);
        const x = cx + r * scale * dx;
        position[3 * v] = x;
        position[3 * v + 1] = cy + r * scale * dy;
        position[3 * v + 2] = r * scale * dz;
        // Caps tilt the normal towards the axis, so they blend into the tube.
        normal[3 * v] = scale * dx + along * tx;
        normal[3 * v + 1] = scale * dy + along * ty;
        normal[3 * v + 2] = scale * dz;
        uv[2 * v] = j / (rings - 1);
        uv[2 * v + 1] = k / RADIAL;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    // Tips of the two caps.
    for (const [i, sign] of [[0, -1], [samples - 1, 1]]) {
      const [tx, ty] = [tan[2 * i], tan[2 * i + 1]];
      const x = path[2 * i] + sign * tx * r;
      position[3 * v] = x;
      position[3 * v + 1] = path[2 * i + 1] + sign * ty * r;
      normal[3 * v] = sign * tx;
      normal[3 * v + 1] = sign * ty;
      uv[2 * v] = sign < 0 ? 0 : 1;
      uv[2 * v + 1] = 0.5;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      v++;
    }

    // Quads between rings; the angle runs so that (a, c, b) faces outwards.
    for (let j = 0; j < rings - 1; j++) {
      for (let k = 0; k < RADIAL; k++) {
        const a = first + j * ring + k;
        const b = a + ring;
        index.set([a, a + 1, b, b, a + 1, b + 1], t);
        t += 6;
      }
    }
    const startTip = first + rings * ring;
    const lastRing = first + (rings - 1) * ring;
    for (let k = 0; k < RADIAL; k++) {
      index.set([first + k, startTip, first + k + 1], t);
      index.set([lastRing + k, lastRing + k + 1, startTip + 1], t + 3);
      t += 6;
    }
  }

  const shift = (minX + maxX) / 2;
  for (let p = 0; p < vertices; p++) position[3 * p] -= shift;
  centres.set(`${char}|${count}`, shift);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Outline lines for the rods as LineSegments geometry: along each rod's front
 * and back (the z extremes, which read as its silhouette from the side) and
 * round both ends. `lineDistance` runs along the segments like
 * Line.computeLineDistances does, for dashes.
 */
export function buildTubeEdges(char: string, count: number): BufferGeometry {
  const key = `${char}|${count}`;
  if (!centres.has(key)) buildTubes(char, count);
  const shift = centres.get(key)!;
  const r = rodRadius(count);
  const rods = paths(char, count);

  let segments = 0;
  for (const path of rods) segments += 2 * (path.length / 2 - 1) + 2 * RADIAL;
  const position = new Float32Array(segments * 6);
  const distance = new Float32Array(segments * 2);

  let s = 0;
  let travelled = 0;
  const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    position.set([ax, ay, az, bx, by, bz], s * 6);
    distance[2 * s] = travelled;
    distance[2 * s + 1] = travelled += Math.hypot(bx - ax, by - ay, bz - az);
    s++;
  };

  for (const path of rods) {
    const tan = tangents(path);
    const samples = path.length / 2;
    for (const z of [r, -r]) {
      for (let i = 0; i < samples - 1; i++) {
        line(path[2 * i] - shift, path[2 * i + 1], z, path[2 * i + 2] - shift, path[2 * i + 3], z);
      }
    }
    for (const i of [0, samples - 1]) {
      const [tx, ty] = [tan[2 * i], tan[2 * i + 1]];
      const point = (k: number): [number, number, number] => {
        const a = (k / RADIAL) * Math.PI * 2;
        return [
          path[2 * i] - ty * Math.cos(a) * r - shift,
          path[2 * i + 1] + tx * Math.cos(a) * r,
          Math.sin(a) * r,
        ];
      };
      for (let k = 0; k < RADIAL; k++) line(...point(k), ...point(k + 1));
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('lineDistance', new BufferAttribute(distance, 1));
  return geometry;
}
