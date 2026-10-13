import {
  type BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  type Texture,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Letter } from '../../engine/types';
import type { Theme } from '../theme';
import fontData from './geist-black-abcd.typeface.json';

export type DiffKind = 'added' | 'modified';

export interface LetterShape {
  geometry: BufferGeometry;
  /** Hard edges, for outline drawing. */
  edges: BufferGeometry;
}

/** Faces meeting at more than this (degrees) draw an edge line. */
const EDGE_ANGLE = 35;
/** Shapes kept around; scrubbing revisits the same few dozen. */
const SHAPE_CACHE = 160;

const font = new FontLoader().parse(fontData as never);

/**
 * Geometry and materials for the letters, shared by every view that draws
 * them. Units are letter heights (Geist Black caps are 0.71 tall); letters
 * stand on y = 0, centred on their origin.
 */
export class LetterKit {
  private readonly shapes = new Map<string, LetterShape>();
  private readonly materials = new Map<string, Material>();
  private readonly textures = new Map<string, Texture>();

  constructor(private readonly theme: Theme) {}

  /** The letter's form: depends on its character, material, depth, bevel and detail. */
  shape(letter: Letter): LetterShape {
    const { geometry: g, style: s } = letter;
    const detail = quantize(s.detail);
    const key = `${s.name}|${s.material}|${g.depth}|${s.material === 'chrome' ? '' : g.bevel}|${detail}`;
    let shape = this.shapes.get(key);
    if (shape) {
      // Most recently used last, so the oldest is first to go.
      this.shapes.delete(key);
      this.shapes.set(key, shape);
      return shape;
    }
    const geometry = build(s.name, s.material, g.depth, g.bevel, detail);
    const edges = new EdgesGeometry(geometry, EDGE_ANGLE);
    // Distances along the lines, for dashed deletion ghosts.
    new LineSegments(edges).computeLineDistances();
    shape = { geometry, edges };
    this.shapes.set(key, shape);
    if (this.shapes.size > SHAPE_CACHE) {
      const [oldKey, old] = this.shapes.entries().next().value!;
      this.shapes.delete(oldKey);
      old.geometry.dispose();
      old.edges.dispose();
    }
    return shape;
  }

  /** The letter's own material, or tinted in a diff colour while it is highlighted. */
  surface(letter: Letter, diff: DiffKind | null = null): Material {
    const { material, color } = letter.style;
    const detail = quantize(letter.style.detail);
    return this.cached(`${material}|${color}|${detail}|${diff}`, () => {
      const m = this.make(letter.style.material, color, detail);
      if (diff) {
        m.emissive.set(this.diffColor(diff));
        m.emissiveIntensity = 0.6;
      }
      return m;
    });
  }

  /** Untouched letters while scrubbing: plain matte white, read through their outlines. */
  white(): Material {
    return this.cached('white', () => new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }));
  }

  /** Changed letters while scrubbing: solid diff colour, lifted so it holds in shadow. */
  solid(diff: DiffKind): Material {
    return this.cached(`solid:${diff}`, () => {
      const color = this.diffColor(diff);
      return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0 });
    });
  }

  /** Edge lines: ink for outlines, diff colours for changes at rest. */
  line(kind: DiffKind | 'ink'): Material {
    return this.cached(`line:${kind}`, () =>
      new LineBasicMaterial({ color: kind === 'ink' ? this.theme.foreground : this.diffColor(kind) }));
  }

  /** Deleted letters: a faint shell with dashed edges, so they don't read by colour alone. */
  ghost(): Material {
    return this.cached('ghost', () =>
      new MeshBasicMaterial({ color: this.theme.deleted, transparent: true, opacity: 0.12, depthWrite: false }));
  }

  ghostLine(): Material {
    return this.cached('ghost-line', () =>
      new LineDashedMaterial({ color: this.theme.deleted, dashSize: 0.03, gapSize: 0.02 }));
  }

  private make(material: Letter['style']['material'], color: string, detail: number): MeshStandardMaterial {
    switch (material) {
      case 'stone': {
        const speckle = this.texture(`speckle|${detail}`, () => speckleTexture(detail));
        return new MeshStandardMaterial({
          color, roughness: 0.95, flatShading: true, map: speckle, bumpMap: speckle, bumpScale: 1.5,
        });
      }
      case 'glass':
        return glassMaterial(color, detail);
      case 'chrome':
        // Chrome is all reflection: lean on the studio cards.
        return new MeshStandardMaterial({ color, metalness: 1, roughness: 0.08, envMapIntensity: 1.8 });
      case 'carved': {
        const grain = this.texture(`grain|${detail}`, () => grainTexture(detail));
        return new MeshStandardMaterial({ color, roughness: 0.9, map: grain, bumpMap: grain, bumpScale: 2.5 });
      }
      default:
        return new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
    }
  }

  private diffColor(diff: DiffKind) {
    return new Color(diff === 'added' ? this.theme.added : this.theme.modified);
  }

  private texture(key: string, make: () => Texture): Texture {
    let texture = this.textures.get(key);
    if (!texture) this.textures.set(key, (texture = make()));
    return texture;
  }

  private cached<T extends Material>(key: string, make: () => T): T {
    let material = this.materials.get(key) as T | undefined;
    if (!material) this.materials.set(key, (material = make()));
    return material;
  }
}

/**
 * Clear glass with a thin-film rainbow towards its edges; detail frosts it.
 * Not physical transmission: the canvas is transparent, so there is nothing
 * behind to refract. Reflections carry the body; the rainbow is added in the
 * shader, by how edge-on the surface is (fresnel), and edges turn opaque.
 */
function glassMaterial(color: string, detail: number): MeshStandardMaterial {
  const material = new MeshPhysicalMaterial({
    color, metalness: 0, roughness: 0.04 + detail * 0.3, transparent: true, opacity: 0.28,
    side: DoubleSide, depthWrite: false,
    iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [250, 900],
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.2,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      vec3 n = normalize(normal);
      float edge = 1.0 - abs(dot(n, normalize(vViewPosition)));
      // Hue from how edge-on and which way the surface faces: a full spectrum across the form.
      float phase = edge * 1.6 + n.x * 0.55 + n.y * 0.4;
      vec3 film = 0.5 + 0.5 * cos(6.2831 * (phase + vec3(0.0, 0.33, 0.67)));
      gl_FragColor.rgb += film * (0.15 + pow(edge, 2.0) * 0.75);
      gl_FragColor.a = max(gl_FragColor.a, pow(edge, 1.6) * 0.9);`,
    );
  };
  material.customProgramCacheKey = () => 'letter-glass';
  return material;
}

/** Detail in quarter steps: enough variation, few distinct shapes and textures. */
const quantize = (detail: number) => Math.round(detail * 4) / 4;

// ---------------------------------------------------------------- geometry

function build(char: string, material: Letter['style']['material'], depth: number, bevel: number, detail: number) {
  const geometry = material === 'chrome' ? tubes(char, depth, detail) : solid(char, material, depth, bevel, detail);
  // Stand on the floor, centred on the origin.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const floor = material === 'chrome' ? 0 : box.min.y;
  geometry.translate(-(box.min.x + box.max.x) / 2, -floor, -(box.min.z + box.max.z) / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The extruded glyph, then shaped by its material. */
function solid(char: string, material: Letter['style']['material'], depth: number, bevel: number, detail: number) {
  const glass = material === 'glass';
  const carved = material === 'carved';
  // Glass: a soft rounded rim, gently domed. Carved stone: one flat chamfer.
  const size = glass ? 0.03 + bevel * 0.2 : carved ? 0.015 + bevel * 0.5 : bevel;
  let geometry: BufferGeometry = new TextGeometry(char, {
    font,
    size: 1,
    depth,
    curveSegments: glass ? 16 : 10,
    bevelEnabled: size > 0,
    bevelThickness: glass ? size * 1.5 : size,
    bevelSize: size,
    // Glass keeps the glyph's silhouette, so narrow notches can't fold over.
    bevelOffset: glass ? -size : -size * 0.6,
    bevelSegments: glass ? 10 : carved ? 1 : 3,
  });

  if (material === 'stone' || carved) {
    // Chiselled: small faces, each pushed by noise; flat shading shows the facets.
    geometry = new TessellateModifier(carved ? 0.05 : 0.045, 8).modify(geometry);
    const amount = carved ? 0.004 + detail * 0.006 : 0.008 + detail * 0.02;
    displace(geometry, carved ? 9 : 5, amount);
  }
  if (glass) {
    // Domed: the flat faces bulge out, most in the middle of each stroke.
    geometry = new TessellateModifier(0.03, 8).modify(geometry);
    inflate(geometry, char, depth, 0.03 + bevel * 0.3);
  }
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  return geometry;
}

/** Moves every vertex by a noise vector of its position, so shared corners move together. */
function displace(geometry: BufferGeometry, frequency: number, amount: number) {
  const position = geometry.getAttribute('position');
  const p = new Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const n = p.clone().multiplyScalar(frequency);
    position.setXYZ(
      i,
      p.x + noise(n.x, n.y, n.z) * amount,
      p.y + noise(n.x + 17.3, n.y, n.z) * amount,
      p.z + noise(n.x, n.y + 31.7, n.z) * amount,
    );
  }
  position.needsUpdate = true;
}

/**
 * Pushes front and back faces outwards along z by how far each point is
 * inside the glyph's outline, rounding off towards the middle of a stroke.
 */
function inflate(geometry: BufferGeometry, char: string, depth: number, amount: number) {
  const position = geometry.getAttribute('position');
  const outline = font.generateShapes(char, 1).flatMap((shape) => {
    const { shape: contour, holes } = shape.extractPoints(24);
    return [contour, ...holes].flatMap((ring) => densify(ring, 0.01));
  });
  const grid = new SpatialGrid(outline, 0.05);
  const halfStroke = 0.1; // Geist Black strokes are ~0.2 wide
  const mid = depth / 2;
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const side = z - mid;
    if (Math.abs(side) < depth / 2 - 1e-3) continue;
    const t = Math.min(1, grid.nearest(position.getX(i), position.getY(i)) / halfStroke);
    position.setZ(i, z + Math.sign(side) * amount * Math.sqrt(1 - (1 - t) * (1 - t)));
  }
  position.needsUpdate = true;
}

/** Points along a closed ring, at most `step` apart. */
function densify(ring: Vector2[], step: number): Vector2[] {
  const out: Vector2[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  });
  return out;
}

/** Nearest-point lookups over 2D samples, bucketed in a grid. */
class SpatialGrid {
  private readonly cells = new Map<string, Vector2[]>();
  constructor(points: Vector2[], private readonly cell: number) {
    for (const p of points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(p);
    }
  }

  nearest(x: number, y: number): number {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let r = 0; r <= 4 && best > (r - 1) * this.cell; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          for (const p of this.cells.get(`${cx + i},${cy + j}`) ?? []) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
        }
      }
    }
    return best;
  }
}

/**
 * Chrome: the letter drawn as parallel tubes following its strokes, like
 * bent metal rods. More detail, more (thinner) tubes; they are stretched
 * back into the depth, so the sides read as ribs.
 */
function tubes(char: string, depth: number, detail: number): BufferGeometry {
  const width = 0.19; // stroke width
  const count = 3 + Math.round(detail * 4);
  const radius = (width / (2 * count)) * 0.92;
  const stretch = Math.max(1, depth / 2 / radius);
  const parts: BufferGeometry[] = [];
  for (const stroke of SKELETONS[char] ?? SKELETONS.A) {
    for (let k = 0; k < count; k++) {
      const offset = -width / 2 + (width / count) * (k + 0.5);
      const points = offsetPolyline(stroke, offset).map((p) => new Vector3(p.x, p.y, 0));
      const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0);
      const tube = new TubeGeometry(curve, points.length * 3, radius, 12, false);
      tube.scale(1, 1, stretch);
      parts.push(tube);
      // Round ends.
      for (const end of [points[0], points[points.length - 1]]) {
        const cap = new SphereGeometry(radius, 12, 8);
        cap.scale(1, 1, stretch);
        cap.translate(end.x, end.y, 0);
        parts.push(cap);
      }
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

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

// ---------------------------------------------------------------- textures

const TEXTURE_SIZE = 256;

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  draw(canvas.getContext('2d')!, TEXTURE_SIZE);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Concrete: light mottling and dark pits, more of them with more detail. */
function speckleTexture(detail: number): Texture {
  return canvasTexture((ctx, size) => {
    mottle(ctx, size, 235, 18);
    const rng = seeded(1);
    for (let i = 0; i < 200 + detail * 900; i++) {
      ctx.fillStyle = `rgba(40,38,36,${0.3 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(rng() * size, rng() * size, 0.4 + rng() * (0.8 + detail * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Carved stone: fine grain plus a few branching cracks. */
function grainTexture(detail: number): Texture {
  return canvasTexture((ctx, size) => {
    mottle(ctx, size, 200, 45);
    const rng = seeded(3);
    ctx.strokeStyle = 'rgba(10,10,10,0.85)';
    for (let c = 0; c < 2 + detail * 6; c++) {
      let x = rng() * size;
      let y = rng() * size;
      let a = rng() * Math.PI * 2;
      ctx.lineWidth = 0.8 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        a += (rng() - 0.5) * 1.2;
        x += Math.cos(a) * 7;
        y += Math.sin(a) * 7;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

/** Per-pixel noise around a grey level. */
function mottle(ctx: CanvasRenderingContext2D, size: number, base: number, spread: number) {
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = base + (noise(x / 24, y / 24, 0) * 0.6 + noise(x / 5, y / 5, 3) * 0.4) * spread;
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [-1, 1]. */
function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const [fx, fy, fz] = [x - xi, y - yi, z - zi].map((f) => f * f * (3 - 2 * f));
  const h = (i: number, j: number, k: number) => {
    let n = Math.imul(xi + i, 374761393) + Math.imul(yi + j, 668265263) + Math.imul(zi + k, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}
