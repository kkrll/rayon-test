import {
  ACESFilmicToneMapping,
  DirectionalLight,
  LineSegments,
  MathUtils,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Letter, ModelObject } from '../../engine/types';
import type { Highlight } from '../highlight';
import type { RenderMode } from '../modelRenderer';
import type { LetterKit } from './letterKit';
import { createStudioEnvironment } from './studio';

/** The row of letters, with room for them to move around. */
export const LETTERS_BOUNDS = new Sphere(new Vector3(0, 0.36, 0), 2.3);
/** From the front, a little above and to the right. */
const VIEW_DIRECTION = new Vector3(0.18, 0.32, 1).normalize();
const FIT_MARGIN = 0.98;

/**
 * One renderer's scene of the letters: studio light, a shadow floor and one
 * mesh per letter, kept in step with a model state by `sync`.
 */
export class LetterStage {
  readonly scene = new Scene();
  private readonly meshes = new Map<string, Mesh>();
  private readonly ghosts: Mesh[] = [];
  private readonly environment;

  constructor(
    private readonly kit: LetterKit,
    renderer: WebGLRenderer,
    private readonly shadows: boolean,
  ) {
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = shadows;

    // Broad softboxes supply reflections (chrome lives on them) and fill.
    this.environment = createStudioEnvironment(renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.8;
    this.scene.environmentRotation.y = MathUtils.degToRad(-25);

    const { center, radius } = LETTERS_BOUNDS;
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.copy(center).add(new Vector3(-0.4, 1, 0.6).multiplyScalar(radius * 2));
    key.target.position.copy(center);
    if (shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.radius = 4;
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.01;
      const cam = key.shadow.camera;
      cam.left = cam.bottom = -radius * 1.2;
      cam.right = cam.top = radius * 1.2;
      cam.near = radius * 0.2;
      cam.far = radius * 5;
      cam.updateProjectionMatrix();

      const floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.2 }));
      floor.rotation.x = -Math.PI / 2;
      floor.scale.setScalar(radius * 12);
      floor.receiveShadow = true;
      this.scene.add(floor);
    }
    this.scene.add(key, key.target);
  }

  /**
   * full:    at rest, every letter in its material; letters changed this
   *          session tinted and outlined in their diff colour.
   * outline: while scrubbing, white letters drawn by their edges; changed
   *          ones solid green (added) or blue (modified).
   * Either way, deletions are ghosts with dashed edges.
   */
  sync(state: ReadonlyMap<string, ModelObject>, highlight: Highlight, mode: RenderMode) {
    for (const [id, mesh] of this.meshes) {
      if (!state.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
    for (const o of state.values()) {
      if (o.type !== 'letter') continue;
      let mesh = this.meshes.get(o.id);
      if (!mesh) {
        mesh = this.createMesh();
        this.meshes.set(o.id, mesh);
      }
      this.place(mesh, o);
      const diff = highlight.added.has(o.id) ? 'added' : highlight.modified.has(o.id) ? 'modified' : null;
      const edges = mesh.children[0] as LineSegments;
      if (mode === 'outline') {
        mesh.material = diff ? this.kit.solid(diff) : this.kit.white();
        edges.material = this.kit.line('ink');
        edges.visible = true;
      } else {
        mesh.material = this.kit.surface(o, diff);
        edges.visible = diff !== null;
        if (diff) edges.material = this.kit.line(diff);
      }
    }

    const deleted = highlight.deleted.filter((o): o is Letter => o.type === 'letter');
    while (this.ghosts.length > deleted.length) this.scene.remove(this.ghosts.pop()!);
    deleted.forEach((letter, i) => {
      if (!this.ghosts[i]) {
        this.ghosts[i] = this.createMesh();
        this.ghosts[i].castShadow = false;
      }
      const edges = this.ghosts[i].children[0] as LineSegments;
      this.place(this.ghosts[i], letter);
      this.ghosts[i].material = this.kit.ghost();
      edges.material = this.kit.ghostLine();
      edges.visible = true;
    });
  }

  /** Puts `camera` at the default framing of the whole row. */
  frame(camera: PerspectiveCamera) {
    const { center, radius } = LETTERS_BOUNDS;
    const vertical = MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const distance = (radius * FIT_MARGIN) / Math.sin(Math.min(vertical, horizontal) / 2);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    return { target: center.clone(), distance };
  }

  dispose() {
    this.environment.dispose();
  }

  private createMesh(): Mesh {
    const mesh = new Mesh();
    // Edges ride along as a child, so placing the mesh places them too.
    const edges = new LineSegments();
    edges.visible = false;
    mesh.add(edges);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    this.scene.add(mesh);
    return mesh;
  }

  private place(mesh: Mesh, letter: Letter) {
    const { geometry, edges } = this.kit.shape(letter);
    mesh.geometry = geometry;
    (mesh.children[0] as LineSegments).geometry = edges;
    const { position, rotation } = letter.geometry;
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.y = MathUtils.degToRad(rotation);
  }
}
