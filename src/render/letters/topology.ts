import { BufferAttribute, BufferGeometry, ExtrudeGeometry, type Shape } from 'three';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { noise } from './noise';

export type Family = 'plain' | 'faceted' | 'domed';

export interface TopologyOptions {
  char: string;
  depth: number;
  bevel: number;
  family: Family;
}

export interface Topology {
  /** Indexed, smooth normals; `aNoise` is the per-vertex displacement noise for the GPU. */
  geometry: BufferGeometry;
  /** Crease edges as LineSegments geometry, with `lineDistance`. */
  edges: BufferGeometry;
}

/** Faces meeting at more than this (degrees) draw an edge line. */
const EDGE_ANGLE = 35;
const COS_EDGE = Math.cos((EDGE_ANGLE * Math.PI) / 180);
const NOISE_FREQUENCY = 5;

/**
 * The letter's mesh, built once: extruded, welded to an indexed mesh, split
 * into small flat-shaded-friendly faces and (for glass) domed. Per-edit
 * variation then happens on the GPU, from `aNoise`.
 */
export function buildTopology(font: Font, opts: TopologyOptions): Topology {
  const { char, depth, bevel, family } = opts;
  const domed = family === 'domed';
  // Glass: a soft rounded rim that keeps the glyph's silhouette, so narrow notches can't fold over.
  const size = domed ? 0.03 + bevel * 0.2 : bevel;
  const base = new ExtrudeGeometry(shapesOf(font, char), {
    depth,
    curveSegments: domed ? 8 : family === 'faceted' ? 6 : 10,
    bevelEnabled: size > 0,
    bevelThickness: domed ? size * 1.5 : size,
    bevelSize: size,
    bevelOffset: domed ? -size : -size * 0.6,
    bevelSegments: domed ? 8 : 3,
  });
  const welded = weld(base.getAttribute('position').array as Float32Array);
  base.dispose();
  const pos = welded.pos;
  let index = welded.index;
  const maxEdge = family === 'plain' ? 0 : domed ? 0.03 : 0.045;
  // Creases come from the flat base mesh (the dome's steep rim would otherwise read as one);
  // subdividing flat faces adds none, it only cuts these edges into pieces.
  let creases = creaseEdges(pos, index);
  if (maxEdge) {
    const mids = new EdgeMap();
    index = subdivide(pos, index, maxEdge, mids);
    creases = splitEdges(creases, mids);
  }

  // Noise on the undisplaced glyph-space position, as letterKit's `displace` had it.
  const count = pos.length / 3;
  const aNoise = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3] * NOISE_FREQUENCY;
    const y = pos[i * 3 + 1] * NOISE_FREQUENCY;
    const z = pos[i * 3 + 2] * NOISE_FREQUENCY;
    aNoise[i * 3] = noise(x, y, z);
    aNoise[i * 3 + 1] = noise(x + 17.3, y, z);
    aNoise[i * 3 + 2] = noise(x, y + 31.7, z);
  }

  if (domed) inflate(pos, outlineOf(font, char), depth, 0.03 + bevel * 0.3);

  // Stand on the floor, centred on the origin.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const dx = -(minX + maxX) / 2;
  const dz = -(minZ + maxZ) / 2;
  const position = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    position[i] = pos[i] + dx;
    position[i + 1] = pos[i + 1] - minY;
    position[i + 2] = pos[i + 2] + dz;
  }

  const geometry = new BufferGeometry();
  geometry.setIndex(new BufferAttribute(count > 65535 ? Uint32Array.from(index) : Uint16Array.from(index), 1));
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  const normal = vertexNormals(position, index);
  geometry.setAttribute('uv', new BufferAttribute(boxUVs(position, normal), 2));
  geometry.setAttribute('aNoise', new BufferAttribute(aNoise, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.computeBoundingSphere();
  return { geometry, edges: lineGeometry(position, creases) };
}

// ------------------------------------------------------------------ build

const shapeCache = new WeakMap<Font, Map<string, Shape[]>>();

function shapesOf(font: Font, char: string): Shape[] {
  let chars = shapeCache.get(font);
  if (!chars) shapeCache.set(font, (chars = new Map()));
  let shapes = chars.get(char);
  if (!shapes) chars.set(char, (shapes = font.generateShapes(char, 1)));
  return shapes;
}

/** Merges coincident vertices of a triangle soup, dropping collapsed triangles. */
function weld(soup: Float32Array): { pos: number[]; index: number[] } {
  const n = soup.length / 3;
  const ids = new Map<number, number>();
  const pos: number[] = [];
  const remap = new Int32Array(n);
  // 1e-4 grid: glyph coordinates stay well inside ±3, so 16 bits per axis is plenty.
  const q = (v: number) => Math.round(v * 1e4) + 32768;
  for (let i = 0; i < n; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const key = (q(x) * 65536 + q(y)) * 65536 + q(z);
    let id = ids.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      ids.set(key, id);
      pos.push(x, y, z);
    }
    remap[i] = id;
  }
  const index: number[] = [];
  for (let i = 0; i < n; i += 3) {
    const a = remap[i], b = remap[i + 1], c = remap[i + 2];
    if (a !== b && b !== c && c !== a) index.push(a, b, c);
  }
  return { pos, index };
}

/**
 * Splits every edge longer than `maxEdge` at its midpoint, repeatedly. The
 * decision is per edge and midpoints are shared through `mids`, so neighbours
 * agree and no cracks open. Appends vertices to `pos`; `mids` maps each split
 * edge to its midpoint, across all passes.
 */
function subdivide(pos: number[], index: number[], maxEdge: number, mids: EdgeMap): number[] {
  const max2 = maxEdge * maxEdge;
  const d2 = (a: number, b: number) => {
    const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const mid = (a: number, b: number) => {
    let m = mids.get(a, b);
    if (m < 0) {
      m = pos.length / 3;
      mids.set(a, b, m);
      pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
    }
    return m;
  };
  // Triangles with no long edge are final: lengths decide, so neighbours never split theirs.
  const done: number[] = [];
  for (;;) {
    const before = mids.size;
    const out: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      let a = index[t], b = index[t + 1], c = index[t + 2];
      let mask = (d2(a, b) > max2 ? 1 : 0) | (d2(b, c) > max2 ? 2 : 0) | (d2(c, a) > max2 ? 4 : 0);
      if (!mask) { done.push(a, b, c); continue; }
      let mab = mask & 1 ? mid(a, b) : -1;
      let mbc = mask & 2 ? mid(b, c) : -1;
      let mca = mask & 4 ? mid(c, a) : -1;
      if (mask === 7) {
        out.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
        continue;
      }
      // Rotate so the split edges are ab (one split) or ab + bc (two).
      const want = mask === 1 || mask === 2 || mask === 4 ? 1 : 3;
      while (mask !== want) {
        const ta = a, tab = mab;
        a = b; b = c; c = ta;
        mab = mbc; mbc = mca; mca = tab;
        mask = (mask >> 1) | ((mask & 1) << 2);
      }
      if (want === 1) {
        out.push(a, mab, c, mab, b, c);
      } else {
        out.push(mab, b, mbc);
        // Quad a, mab, mbc, c: cut along the shorter diagonal.
        if (d2(a, mbc) <= d2(mab, c)) out.push(a, mab, mbc, a, mbc, c);
        else out.push(a, mab, c, mab, mbc, c);
      }
    }
    index = out;
    if (mids.size === before) return done.concat(index);
  }
}

/** Cuts each edge at every midpoint recorded for it, recursively. */
function splitEdges(pairs: number[], mids: EdgeMap): number[] {
  const out: number[] = [];
  const cut = (a: number, b: number) => {
    const m = mids.get(a, b);
    if (m < 0) out.push(a, b);
    else { cut(a, m); cut(m, b); }
  };
  for (let i = 0; i < pairs.length; i += 2) cut(pairs[i], pairs[i + 1]);
  return out;
}

/** Area-weighted smooth normals (three's computeVertexNormals allocates a vector per corner). */
function vertexNormals(p: Float32Array, index: number[]): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= len; n[i + 1] /= len; n[i + 2] /= len;
  }
  return n;
}

// ------------------------------------------------------------------ edges

/** Vertex pairs of edges where faces meet sharply, or that border only one face. */
function creaseEdges(pos: number[], index: number[]): number[] {
  const faces = index.length / 3;
  const normals = new Float32Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const a = index[f * 3] * 3, b = index[f * 3 + 1] * 3, c = index[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    // Slivers have no direction: leave them zero and never crease against them.
    if (len > 1e-12) { normals[f * 3] = nx / len; normals[f * 3 + 1] = ny / len; normals[f * 3 + 2] = nz / len; }
  }
  // Edge -> first face; DONE once its second face has been judged.
  const DONE = -2;
  const seen = new EdgeMap();
  const out: number[] = [];
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const a = index[f * 3 + k], b = index[f * 3 + ((k + 1) % 3)];
      const other = seen.get(a, b);
      if (other === -1) { seen.set(a, b, f); continue; }
      if (other === DONE) continue;
      seen.set(a, b, DONE);
      const dot = normals[f * 3] * normals[other * 3] + normals[f * 3 + 1] * normals[other * 3 + 1] + normals[f * 3 + 2] * normals[other * 3 + 2];
      const flat = normals[f * 3] === 0 && normals[f * 3 + 1] === 0 && normals[f * 3 + 2] === 0;
      if (dot <= COS_EDGE && !flat) out.push(a, b);
    }
  }
  seen.each((a, b, f) => { if (f >= 0) out.push(a, b); });
  return out;
}

/** Open-addressing map from an undirected vertex pair to a non-negative int (-1 when absent); no boxing, unlike a Map with pair keys. */
class EdgeMap {
  size = 0;
  private mask = 1023;
  private lo = new Int32Array(1024).fill(-1);
  private hi = new Int32Array(1024);
  private val = new Int32Array(1024);

  get(a: number, b: number): number {
    if (a > b) [a, b] = [b, a];
    for (let i = this.slot(a, b); this.lo[i] >= 0; i = (i + 1) & this.mask) {
      if (this.lo[i] === a && this.hi[i] === b) return this.val[i];
    }
    return -1;
  }

  set(a: number, b: number, value: number) {
    if (a > b) [a, b] = [b, a];
    if ((this.size + 1) * 2 > this.mask) this.grow();
    let i = this.slot(a, b);
    for (; this.lo[i] >= 0; i = (i + 1) & this.mask) {
      if (this.lo[i] === a && this.hi[i] === b) { this.val[i] = value; return; }
    }
    this.lo[i] = a; this.hi[i] = b; this.val[i] = value;
    this.size++;
  }

  each(fn: (a: number, b: number, value: number) => void) {
    for (let i = 0; i <= this.mask; i++) if (this.lo[i] >= 0) fn(this.lo[i], this.hi[i], this.val[i]);
  }

  private slot(a: number, b: number) {
    return (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & this.mask;
  }

  private grow() {
    const { lo, hi, val } = this;
    this.mask = (this.mask + 1) * 2 - 1;
    this.lo = new Int32Array(this.mask + 1).fill(-1);
    this.hi = new Int32Array(this.mask + 1);
    this.val = new Int32Array(this.mask + 1);
    this.size = 0;
    for (let i = 0; i < lo.length; i++) if (lo[i] >= 0) this.set(lo[i], hi[i], val[i]);
  }
}

function lineGeometry(position: Float32Array, pairs: number[]): BufferGeometry {
  const n = pairs.length / 2;
  const lines = new Float32Array(n * 6);
  const distance = new Float32Array(n * 2);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pairs[i * 2] * 3, b = pairs[i * 2 + 1] * 3;
    for (let k = 0; k < 3; k++) { lines[i * 6 + k] = position[a + k]; lines[i * 6 + 3 + k] = position[b + k]; }
    distance[i * 2] = total;
    total += Math.hypot(position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]);
    distance[i * 2 + 1] = total;
  }
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(lines, 3));
  edges.setAttribute('lineDistance', new BufferAttribute(distance, 1));
  return edges;
}

// ------------------------------------------------------------------ dome

const HALF_STROKE = 0.1; // Geist Black strokes are ~0.2 wide
const CELL = 0.05;
const outlines = new WeakMap<Font, Map<string, OutlineGrid>>();

function outlineOf(font: Font, char: string): OutlineGrid {
  let chars = outlines.get(font);
  if (!chars) outlines.set(font, (chars = new Map()));
  let grid = chars.get(char);
  if (!grid) {
    const points: number[] = [];
    for (const shape of shapesOf(font, char)) {
      const { shape: contour, holes } = shape.extractPoints(24);
      for (const ring of [contour, ...holes]) {
        // Points along the closed ring, at most 0.01 apart.
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length];
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01));
          for (let k = 0; k < n; k++) points.push(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
        });
      }
    }
    chars.set(char, (grid = new OutlineGrid(points)));
  }
  return grid;
}

/** Nearest-point lookups over 2D samples, bucketed in a grid (counting sort, no per-point objects). */
class OutlineGrid {
  private readonly x0: number;
  private readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly start: Int32Array;
  private readonly sorted: Float32Array;

  constructor(points: number[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    }
    this.x0 = minX;
    this.y0 = minY;
    this.nx = Math.floor((maxX - minX) / CELL) + 1;
    this.ny = Math.floor((maxY - minY) / CELL) + 1;
    const cells = this.nx * this.ny;
    this.start = new Int32Array(cells + 1);
    const cellOf = (i: number) => Math.floor((points[i + 1] - minY) / CELL) * this.nx + Math.floor((points[i] - minX) / CELL);
    for (let i = 0; i < points.length; i += 2) this.start[cellOf(i) + 1]++;
    for (let c = 0; c < cells; c++) this.start[c + 1] += this.start[c];
    const fill = this.start.slice(0, cells);
    this.sorted = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      const at = fill[cellOf(i)]++ * 2;
      this.sorted[at] = points[i];
      this.sorted[at + 1] = points[i + 1];
    }
  }

  /** Distance to the nearest sample, or Infinity beyond `HALF_STROKE`-ish reach (3 cells). */
  nearest(x: number, y: number): number {
    const cx = Math.floor((x - this.x0) / CELL);
    const cy = Math.floor((y - this.y0) / CELL);
    let best = Infinity;
    for (let r = 0; r <= 3 && best > ((r - 1) * CELL) ** 2; r++) {
      for (let j = -r; j <= r; j++) {
        const gy = cy + j;
        if (gy < 0 || gy >= this.ny) continue;
        // Only the ring: whole rows at the top and bottom, two cells elsewhere.
        const step = Math.abs(j) === r ? 1 : 2 * r || 1;
        for (let i = -r; i <= r; i += step) {
          const gx = cx + i;
          if (gx < 0 || gx >= this.nx) continue;
          const cell = gy * this.nx + gx;
          for (let p = this.start[cell] * 2, end = this.start[cell + 1] * 2; p < end; p += 2) {
            const dx = this.sorted[p] - x, dy = this.sorted[p + 1] - y;
            best = Math.min(best, dx * dx + dy * dy);
          }
        }
      }
    }
    return Math.sqrt(best);
  }
}

/**
 * Pushes front and back faces outwards along z by how far each point is
 * inside the glyph's outline, rounding off towards the middle of a stroke.
 */
function inflate(pos: number[], grid: OutlineGrid, depth: number, amount: number) {
  const mid = depth / 2;
  for (let i = 0; i < pos.length; i += 3) {
    const side = pos[i + 2] - mid;
    if (Math.abs(side) < depth / 2 - 1e-3) continue;
    const t = Math.min(1, grid.nearest(pos[i], pos[i + 1]) / HALF_STROKE);
    pos[i + 2] += Math.sign(side) * amount * Math.sqrt(1 - (1 - t) * (1 - t));
  }
}

/**
 * Box-projected UVs: each vertex takes the plane it mostly faces (caps: xy,
 * side walls: zy or xz), so textures keep their scale all around instead of
 * smearing along the depth.
 */
function boxUVs(position: Float32Array, normal: Float32Array): Float32Array {
  const uv = new Float32Array((position.length / 3) * 2);
  for (let i = 0, j = 0; i < position.length; i += 3, j += 2) {
    const ax = Math.abs(normal[i]);
    const ay = Math.abs(normal[i + 1]);
    const az = Math.abs(normal[i + 2]);
    if (az >= ax && az >= ay) {
      uv[j] = position[i];
      uv[j + 1] = position[i + 1];
    } else if (ax >= ay) {
      uv[j] = position[i + 2];
      uv[j + 1] = position[i + 1];
    } else {
      uv[j] = position[i];
      uv[j + 1] = position[i + 2];
    }
  }
  return uv;
}
