import {
  ACESFilmicToneMapping,
  DirectionalLight,
  MathUtils,
  Matrix4,
  LineSegments,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { ModelObject, Part } from '../../engine/types';
import type { Highlight } from '../highlight';
import type { RenderMode } from '../modelRenderer';
import { type DeviceModel, MM } from './deviceModel';
import { createStudioEnvironment } from './studio';

/** Three-quarter view from above and in front (+Z is the keyboard edge). */
const VIEW_DIRECTION = new Vector3(0.58, 0.62, 0.52).normalize();
const FIT_MARGIN = 1.25;

/**
 * One renderer's scene of the device: studio light, a shadow floor and one
 * mesh per part, kept in step with a model state by `sync`.
 */
export class DeviceStage {
  readonly scene = new Scene();
  private readonly meshes = new Map<string, Mesh>();
  private readonly ghosts: Mesh[] = [];
  private readonly environment;
  private readonly offset = new Matrix4();

  constructor(
    private readonly model: DeviceModel,
    renderer: WebGLRenderer,
    private readonly shadows: boolean,
  ) {
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = shadows;

    // Broad softboxes supply reflections and fill; the key light adds shadows.
    this.environment = createStudioEnvironment(renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    this.scene.environmentRotation.y = MathUtils.degToRad(35);

    const { center, radius } = model.bounds;
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.copy(center).add(new Vector3(0.35, 1, 0.25).multiplyScalar(radius * 3));
    key.target.position.copy(center);
    if (shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 4;
      key.shadow.normalBias = radius * 0.002;
      const cam = key.shadow.camera;
      cam.left = cam.bottom = -radius * 1.5;
      cam.right = cam.top = radius * 1.5;
      cam.near = radius * 0.5;
      cam.far = radius * 8;
      cam.updateProjectionMatrix();

      const floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.18 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(center.x, model.floorY, center.z);
      floor.scale.setScalar(radius * 16);
      floor.receiveShadow = true;
      this.scene.add(floor);
    }
    this.scene.add(key, key.target);
  }

  /**
   * full:    at rest, every part in its finish; parts changed this session
   *          tinted and outlined in their diff colour.
   * outline: while scrubbing, a white model drawn by its edges; changed parts
   *          solid green (added) or blue (modified).
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
      if (o.type !== 'part') continue;
      let mesh = this.meshes.get(o.id);
      if (!mesh) {
        mesh = this.createMesh(o);
        this.meshes.set(o.id, mesh);
      }
      this.place(mesh, o);
      const diff = highlight.added.has(o.id) ? 'added' : highlight.modified.has(o.id) ? 'modified' : null;
      const edges = mesh.children[0] as LineSegments;
      if (mode === 'outline') {
        mesh.material = diff ? this.model.solid(diff) : this.model.white();
        edges.material = this.model.line('ink');
        edges.visible = true;
      } else {
        mesh.material = this.model.finish(o.style.finish, diff);
        edges.visible = diff !== null;
        if (diff) edges.material = this.model.line(diff);
      }
    }

    const deleted = highlight.deleted.filter((o): o is Part => o.type === 'part');
    while (this.ghosts.length > deleted.length) this.scene.remove(this.ghosts.pop()!);
    deleted.forEach((part, i) => {
      if (!this.ghosts[i]) {
        this.ghosts[i] = this.createMesh(part);
        this.ghosts[i].castShadow = false;
      }
      const template = this.model.templates.get(part.geometry.source)!;
      const edges = this.ghosts[i].children[0] as LineSegments;
      this.ghosts[i].geometry = template.geometry;
      this.ghosts[i].material = this.model.ghost();
      edges.geometry = template.edges;
      edges.material = this.model.ghostLine();
      edges.visible = true;
      this.place(this.ghosts[i], part);
    });
  }

  /** Puts `camera` at the default three-quarter framing of the whole device. */
  frame(camera: PerspectiveCamera) {
    const { center, radius } = this.model.bounds;
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

  private createMesh(part: Part): Mesh {
    const template = this.model.templates.get(part.geometry.source)!;
    const mesh = new Mesh(template.geometry);
    mesh.matrixAutoUpdate = false;
    // Edges ride along as a child, so placing the mesh places them too.
    const edges = new LineSegments(template.edges);
    edges.visible = false;
    mesh.add(edges);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    this.scene.add(mesh);
    return mesh;
  }

  /** Home placement from the model file, then the part's offset in world space. */
  private place(mesh: Mesh, part: Part) {
    const { x, y, z } = part.geometry.offset;
    mesh.matrix.copy(this.model.templates.get(part.geometry.source)!.matrix);
    mesh.matrix.premultiply(this.offset.makeTranslation(x * MM, y * MM, z * MM));
    mesh.matrixWorldNeedsUpdate = true;
  }
}
