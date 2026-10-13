import { PerspectiveCamera, WebGLRenderer } from 'three';
import { NO_HIGHLIGHT } from '../highlight';
import { type DrawThumbnail, THUMB_H, THUMB_W } from '../previews';
import type { LetterKit } from './letterKit';
import { LetterStage } from './letterStage';

/**
 * Letter thumbnails: one small offscreen renderer with its own stage, posed
 * on the state at each session's end and copied into the preview canvas.
 */
export function letterThumbnails(kit: LetterKit): DrawThumbnail {
  let renderer: WebGLRenderer | null = null;
  let stage: LetterStage;
  const camera = new PerspectiveCamera(30, THUMB_W / THUMB_H);

  return (ctx, state, _session, dpr) => {
    if (!renderer) {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(dpr);
      renderer.setSize(THUMB_W, THUMB_H, false);
      renderer.setClearAlpha(0);
      stage = new LetterStage(kit, renderer, false);
      stage.frame(camera);
    }
    stage.sync(state, NO_HIGHLIGHT, 'full');
    renderer.render(stage.scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0, ctx.canvas.width, ctx.canvas.height);
  };
}
