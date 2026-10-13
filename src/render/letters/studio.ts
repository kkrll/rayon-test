import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type WebGLRenderer,
} from 'three';

/** Broad studio reflection cards, baked once; no extra per-frame lights. */
export function createStudioEnvironment(renderer: WebGLRenderer) {
  const studio = new Scene();
  const roomMaterial = new MeshBasicMaterial({ side: BackSide });
  roomMaterial.color.setScalar(0.12);
  const room = new Mesh(new BoxGeometry(20, 20, 20), roomMaterial);
  studio.add(room);

  function card(width: number, height: number, position: [number, number, number], intensity: number) {
    const material = new MeshBasicMaterial();
    material.color.setScalar(intensity);
    const panel = new Mesh(new PlaneGeometry(width, height), material);
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  }

  card(8, 6, [-4, 5, 3], 4); // large key softbox
  card(5, 8, [5, 2, -3], 1.5); // quieter edge reflection
  card(7, 5, [0, 7, -2], 2); // overhead fill

  const generator = new PMREMGenerator(renderer);
  try {
    return generator.fromScene(studio, 0.04);
  } finally {
    generator.dispose();
    studio.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    });
  }
}
