import {
  AnimationMixer,
  Box3,
  type BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  LinearSRGBColorSpace,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Sphere,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FINISHES, type Finish, type FinishId } from '../../engine/device';
import type { Theme } from '../theme';

/** Where a part's geometry sits in the finished model (metres, Y up). */
export interface PartTemplate {
  geometry: BufferGeometry;
  /** Hard edges (creases over EDGE_ANGLE), for outline drawing. */
  edges: BufferGeometry;
  matrix: Matrix4;
}

/** Faces meeting at more than this (degrees) draw an edge line. */
const EDGE_ANGLE = 35;

export type DiffKind = 'added' | 'modified';

/** The model file is in millimetres under a 0.001 root scale. */
export const MM = 0.001;
/** The baked clip that opens the display; posed at its end. */
const OPEN_CLIP = 'Open';

/**
 * The source model, cut into one template per material primitive and keyed
 * the way parts refer to them: `<node name>/<primitive index>`. Also owns the
 * materials, shared by every view that draws the device.
 */
export class DeviceModel {
  readonly bounds: Sphere;
  /** Lowest point of the posed model: the floor its shadow falls on. */
  readonly floorY: number;
  private readonly materials = new Map<string, Material>();

  private constructor(
    readonly templates: Map<string, PartTemplate>,
    private readonly theme: Theme,
  ) {
    const box = new Box3();
    for (const t of templates.values()) {
      t.geometry.computeBoundingBox();
      box.union(t.geometry.boundingBox!.clone().applyMatrix4(t.matrix));
    }
    this.bounds = box.getBoundingSphere(new Sphere());
    this.floorY = box.min.y;
  }

  static async load(url: string, theme: Theme): Promise<DeviceModel> {
    const gltf = await new GLTFLoader().loadAsync(url);

    // Pose the opening mechanism fully open: display up, keyboard showing.
    const clip = gltf.animations.find((a) => a.name === OPEN_CLIP);
    if (clip) {
      const mixer = new AnimationMixer(gltf.scene);
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.time = clip.duration;
      mixer.update(0);
    }
    gltf.scene.updateMatrixWorld(true);

    const nodeOfMesh = new Map<number, string>();
    for (const node of gltf.parser.json.nodes ?? []) {
      if (node.mesh !== undefined) nodeOfMesh.set(node.mesh, node.name);
    }
    const templates = new Map<string, PartTemplate>();
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const ref = gltf.parser.associations.get(mesh);
      if (ref?.meshes === undefined) return;
      // Set at runtime for every primitive mesh, though missing from the types.
      const primitive = (ref as { primitives?: number }).primitives ?? 0;
      const key = `${nodeOfMesh.get(ref.meshes)}/${primitive}`;
      const edges = new EdgesGeometry(mesh.geometry, EDGE_ANGLE);
      // Distances along the lines, for dashed deletion ghosts.
      new LineSegments(edges).computeLineDistances();
      templates.set(key, { geometry: mesh.geometry, edges, matrix: mesh.matrixWorld.clone() });
    });
    return new DeviceModel(templates, theme);
  }

  /** A part's own finish, or tinted in a diff colour while it is highlighted. */
  finish(id: string, diff: DiffKind | null = null): Material {
    return this.cached(`${id}:${diff}`, () => {
      const material = standard(FINISHES[id as FinishId]);
      if (diff) {
        material.emissive.set(this.diffColor(diff));
        material.emissiveIntensity = 0.9;
      }
      return material;
    });
  }

  /** Untouched parts while scrubbing: plain matte white, read through their outlines. */
  white(): Material {
    return this.cached('white', () =>
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: DoubleSide }));
  }

  /** Changed parts while scrubbing: solid diff colour, lifted so it holds in shadow. */
  solid(diff: DiffKind): Material {
    return this.cached(`solid:${diff}`, () => {
      const color = this.diffColor(diff);
      return new MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0, side: DoubleSide,
      });
    });
  }

  /** Edge lines: ink for outlines, diff colours for changes at rest. */
  line(kind: DiffKind | 'ink'): Material {
    return this.cached(`line:${kind}`, () =>
      new LineBasicMaterial({ color: kind === 'ink' ? this.theme.foreground : this.diffColor(kind) }));
  }

  /** Deleted parts: a faint shell with dashed edges, so they don't read by colour alone. */
  ghost(): Material {
    return this.cached('ghost', () =>
      new MeshBasicMaterial({ color: this.theme.deleted, transparent: true, opacity: 0.12, depthWrite: false }));
  }

  ghostLine(): Material {
    return this.cached('ghost-line', () =>
      new LineDashedMaterial({ color: this.theme.deleted, dashSize: 0.0012, gapSize: 0.0008 }));
  }

  private diffColor(diff: DiffKind) {
    return diff === 'added' ? this.theme.added : this.theme.modified;
  }

  private cached(key: string, make: () => Material): Material {
    let material = this.materials.get(key);
    if (!material) this.materials.set(key, (material = make()));
    return material;
  }
}

function standard(f: Finish): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ metalness: f.metalness, roughness: f.roughness, side: DoubleSide });
  material.color.setRGB(...f.color, LinearSRGBColorSpace);
  if (f.emissive) material.emissive = new Color().setRGB(...f.emissive, LinearSRGBColorSpace);
  return material;
}
