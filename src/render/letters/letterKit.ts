import {
  CanvasTexture,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineDashedMaterial,
  type Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Letter } from '../../engine/types';
import type { Theme } from '../theme';
import { noise } from './noise';
import type { ShapeRequest } from './shapeWorker';
import {
  type LetterShape,
  type PackedGeometry,
  type ShapeSpec,
  buildPlain,
  buildShape,
  familyKey,
  quantize,
  shapeKey,
  specOf,
  unpack,
} from './shapes';

export type DiffKind = 'added' | 'modified';

export type { LetterShape };
export { SHAPE_DEPTH } from './shapes';

/** Shapes kept around: everything the history uses fits, with room for resets. */
const SHAPE_CACHE = 240;


/**
 * Geometry and materials for the letters, shared by every view that draws
 * them. Units are letter heights (Geist Black caps are 0.71 tall); letters
 * stand on y = 0, centred on their origin.
 */
export class LetterKit {
  private readonly shapes = new Map<string, LetterShape>();
  /** Bare glyphs standing in for shapes still being built (a few ms each, on this thread). */
  private readonly plains = new Map<string, LetterShape>();
  private readonly queue = new Map<string, { spec: ShapeSpec; urgent: boolean }>();
  private inFlight: string | null = null;
  private readonly listeners = new Set<() => void>();
  /** Null where workers aren't available (tests): shapes are then built in place. */
  private worker: Worker | null =
    typeof Worker === 'undefined' ? null : new Worker(new URL('./shapeWorker.ts', import.meta.url), { type: 'module' });
  private readonly materials = new Map<string, Material>();
  private readonly textures = new Map<string, Texture>();

  constructor(private readonly theme: Theme) {
    this.worker?.addEventListener('message', (e: MessageEvent<{ key: string; geometry: PackedGeometry; edges: PackedGeometry }>) =>
      this.receive(e.data.key, e.data.geometry, e.data.edges));
    // If the worker can't run, build in place as before: slower, but never stuck on stand-ins.
    this.worker?.addEventListener('error', () => {
      this.worker?.terminate();
      this.worker = null;
      this.inFlight = null;
      this.queue.clear();
      for (const listener of this.listeners) listener();
    });
  }

  /**
   * The letter's form, shaped by its material: plain, chiselled (displaced
   * on the GPU by `aNoise`), domed glass, or chrome tubes. It depends only on
   * the character, material and bevel (or tube count): see `shapeKey`.
   *
   * Shapes are built in a worker, so the main thread never stalls on one.
   * Until it arrives, a stand-in: the same letter and material with another
   * bevel if there is one, else the bare glyph. `onShape` listeners redraw.
   */
  shape(letter: Letter): LetterShape {
    const spec = specOf(letter);
    const key = shapeKey(spec);
    const shape = this.shapes.get(key);
    if (shape) {
      // Most recently used last, so the oldest is first to go.
      this.shapes.delete(key);
      this.shapes.set(key, shape);
      return shape;
    }
    if (!this.worker) return this.store(key, buildShape(spec));
    this.request(key, spec, true);
    return this.standIn(spec);
  }

  /** True if every letter in `state` has its real shape; asks for the missing ones. */
  ready(letters: Iterable<Letter>): boolean {
    let ready = true;
    for (const letter of letters) {
      const spec = specOf(letter);
      const key = shapeKey(spec);
      if (this.shapes.has(key)) continue;
      ready = false;
      if (this.worker) this.request(key, spec, true);
      else this.store(key, buildShape(spec));
    }
    return ready;
  }

  /** Queues shapes to build in the background, behind anything on screen. */
  prefetch(letters: Iterable<Letter>) {
    for (const letter of letters) {
      const spec = specOf(letter);
      const key = shapeKey(spec);
      if (!this.shapes.has(key)) this.request(key, spec, false);
    }
  }

  /** Called whenever a shape arrives from the worker; returns an unsubscribe. */
  onShape(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private request(key: string, spec: ShapeSpec, urgent: boolean) {
    if (!this.worker || this.inFlight === key) return;
    const queued = this.queue.get(key);
    if (queued && (!urgent || queued.urgent)) return;
    this.queue.delete(key);
    this.queue.set(key, { spec, urgent }); // re-inserted: latest request last
    this.pump();
  }

  /** One build at a time: newest urgent request first, then prefetches in order. */
  private pump() {
    if (!this.worker || this.inFlight !== null || this.queue.size === 0) return;
    let next: string | null = null;
    for (const [key, { urgent }] of this.queue) if (urgent) next = key;
    next ??= this.queue.keys().next().value!;
    const { spec } = this.queue.get(next)!;
    this.queue.delete(next);
    this.inFlight = next;
    this.worker.postMessage({ key: next, spec } satisfies ShapeRequest);
  }

  private receive(key: string, geometry: PackedGeometry, edges: PackedGeometry) {
    this.inFlight = null;
    this.store(key, { geometry: unpack(geometry), edges: unpack(edges) });
    this.pump();
    for (const listener of this.listeners) listener();
  }

  private standIn(spec: ShapeSpec): LetterShape {
    const family = familyKey(spec);
    let near: LetterShape | null = null;
    for (const [key, shape] of this.shapes) if (key.startsWith(family)) near = shape;
    if (near) return near;
    const plainKey = `${spec.char}|plain|${spec.bevel}`;
    let plain = this.plains.get(plainKey);
    if (!plain) this.plains.set(plainKey, (plain = buildPlain(spec)));
    return plain;
  }

  private store(key: string, shape: LetterShape): LetterShape {
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

  /** Edge lines in a diff colour, around changed letters. */
  line(kind: DiffKind): Material {
    return this.cached(`line:${kind}`, () => new LineBasicMaterial({ color: this.diffColor(kind) }));
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
        return displaced(new MeshStandardMaterial({
          color, roughness: 0.95, flatShading: true, map: speckle, bumpMap: speckle, bumpScale: 1.5,
        }), 0.012 + detail * 0.026);
      }
      case 'glass':
        return glassMaterial(color, detail);
      case 'chrome':
        // Chrome is all reflection: lean on the studio cards.
        return new MeshStandardMaterial({ color, metalness: 1, roughness: 0.08, envMapIntensity: 1.8 });
      case 'carved': {
        const grain = this.texture(`grain|${detail}`, () => grainTexture(detail));
        return displaced(new MeshStandardMaterial({
          color, roughness: 0.9, flatShading: true, map: grain, bumpMap: grain, bumpScale: 2.5,
        }), 0.004 + detail * 0.006);
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
 * Chiselled surfaces: each vertex moves along its precomputed noise vector
 * (the topology's `aNoise`) by `amount`, in the vertex shader, so roughness
 * edits never rebuild geometry. Flat shading turns the result into facets.
 * Geometry without `aNoise` reads it as zero and stays as it is.
 */
function displaced(material: MeshStandardMaterial, amount: number): MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDisplace = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aNoise;\nuniform float uDisplace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aNoise * uDisplace;');
  };
  // Same program for every amount: it is a uniform.
  material.customProgramCacheKey = () => 'letter-displaced';
  return material;
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
