import { onCleanup, onMount } from 'solid-js';
import { MathUtils, PerspectiveCamera, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import { onFrame } from '../render/frameLoop';
import { sessionHighlighter } from '../render/highlight';
import type { LetterKit } from '../render/letters/letterKit';
import { LetterStage } from '../render/letters/letterStage';
import { stats } from '../render/stats';
import { cursor } from './cursor';

interface Props {
  history: History;
  sessions: Session[];
  kit: LetterKit;
}

/**
 * The 3D counterpart of ModelView: the letters at the cursor, orbitable.
 * Draws only when the cursor, the scrub mode or the camera changed.
 */
export function LettersView(props: Props) {
  let container!: HTMLDivElement;
  const highlightAt = sessionHighlighter(props.history, props.sessions);

  onMount(() => {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    // No background: the stage's CSS ground shows through.
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.classList.add('device-canvas');
    container.appendChild(renderer.domElement);

    const stage = new LetterStage(props.kit, renderer, true);
    const camera = new PerspectiveCamera(30, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = MathUtils.degToRad(88);

    let dirty = true;
    let drawnSeq = -1;
    let drawnScrubbing = false;
    let framed = false;
    controls.addEventListener('change', () => (dirty = true));

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      if (!framed) {
        const { target, distance } = stage.frame(camera);
        controls.target.copy(target);
        controls.minDistance = distance * 0.3;
        controls.maxDistance = distance * 3;
        framed = true;
      }
      camera.updateProjectionMatrix();
      dirty = true;
    };

    const frame = () => {
      // update() reports true while orbit inertia is settling.
      const settling = controls.update();
      const seq = cursor.seq;
      const scrubbing = cursor.scrubbing;
      if (seq !== drawnSeq || scrubbing !== drawnScrubbing) {
        const state = props.history.getStateAt(seq);
        stats.lastState = props.history.lastTiming;
        stage.sync(state, highlightAt(seq), scrubbing ? 'outline' : 'full');
        drawnSeq = seq;
        drawnScrubbing = scrubbing;
        dirty = true;
      }
      if (!dirty && !settling) return;
      const start = performance.now();
      renderer.render(stage.scene, camera);
      stats.model.record(performance.now() - start);
      dirty = false;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const stop = onFrame(frame);
    onCleanup(() => {
      stop();
      observer.disconnect();
      controls.dispose();
      stage.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    });
  });

  return <div ref={container} class="device-view" />;
}
