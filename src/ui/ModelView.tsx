import { onCleanup, onMount } from 'solid-js';
import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import { type Bounds, type Camera, fitCamera, zoomAt } from '../render/camera';
import { onFrame } from '../render/frameLoop';
import { sessionHighlighter } from '../render/highlight';
import { PLAN_PADDING_PX, type RenderMode, drawModel } from '../render/modelRenderer';
import { stats } from '../render/stats';
import { type Theme, readTheme } from '../render/theme';
import { cursor } from './cursor';

interface Props {
  history: History;
  sessions: Session[];
  /** Fixed framing so the camera doesn't jump while scrubbing. */
  bounds: Bounds;
}

/** Outline → full crossfade after a scrub settles (≈ --duration-exit). */
const FADE_MS = 150;

export function ModelView(props: Props) {
  let canvas!: HTMLCanvasElement;
  let theme: Theme;
  let camera: Camera | null = null;
  let dirty = true;
  let drawnSeq = -1;
  let drawnScrubbing = false;
  let fadeStart: number | null = null;
  // Two finished pictures for the crossfade; only composited while fading.
  const outlineLayer = document.createElement('canvas');
  const fullLayer = document.createElement('canvas');

  /** Diff since the start of the session containing the cursor. */
  const highlightAt = sessionHighlighter(props.history, props.sessions);

  const render = (target: HTMLCanvasElement, seq: number, mode: RenderMode) => {
    const start = performance.now();
    const ctx = target.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, target.width, target.height);
    const state = props.history.getStateAt(seq);
    stats.lastState = props.history.lastTiming;
    drawModel(ctx, state, camera!, window.devicePixelRatio || 1, theme, mode, highlightAt(seq));
    stats.model.record(performance.now() - start);
  };

  const composite = (t: number) => {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(outlineLayer, 0, 0);
    ctx.globalAlpha = t;
    ctx.drawImage(fullLayer, 0, 0);
    ctx.globalAlpha = 1;
  };

  const frame = (now: number) => {
    if (!camera) return;
    const seq = cursor.seq;
    const scrubbing = cursor.scrubbing;
    const settled = drawnScrubbing && !scrubbing;
    const changed = dirty || seq !== drawnSeq || scrubbing !== drawnScrubbing;

    if (scrubbing && changed) {
      fadeStart = null;
      render(canvas, seq, 'outline');
    } else if (settled) {
      // Usually the screen already shows the outline at this seq: reuse it as
      // the "from" picture. Render the full one once, then only composite.
      if (seq === drawnSeq && !dirty) copyCanvas(canvas, outlineLayer);
      else render(outlineLayer, seq, 'outline');
      render(fullLayer, seq, 'full');
      fadeStart = now;
    } else if (changed) {
      fadeStart = null;
      render(canvas, seq, 'full');
    }

    if (fadeStart !== null) {
      const t = Math.min(1, (now - fadeStart) / FADE_MS);
      composite(t);
      if (t === 1) fadeStart = null;
    }

    drawnSeq = seq;
    drawnScrubbing = scrubbing;
    dirty = false;
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [canvas, outlineLayer, fullLayer]) {
      c.width = Math.round(canvas.clientWidth * dpr);
      c.height = Math.round(canvas.clientHeight * dpr);
    }
    camera ??= fitCamera(props.bounds, canvas.clientWidth, canvas.clientHeight, PLAN_PADDING_PX);
    dirty = true;
  };

  // Figma-style navigation: two-finger scroll pans, pinch (ctrl+wheel) zooms.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!camera) return;
    if (e.ctrlKey || e.metaKey) {
      const rect = canvas.getBoundingClientRect();
      camera = zoomAt(camera, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
    } else {
      camera = { ...camera, tx: camera.tx - e.deltaX, ty: camera.ty - e.deltaY };
    }
    dirty = true;
  };

  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!camera) return;
      camera = { ...camera, tx: camera.tx + m.movementX, ty: camera.ty + m.movementY };
      dirty = true;
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  onMount(() => {
    theme = readTheme(canvas);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const stop = onFrame(frame);
    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  return <canvas ref={canvas} class="model-view" onPointerDown={onPointerDown} />;
}

function copyCanvas(from: HTMLCanvasElement, to: HTMLCanvasElement) {
  const ctx = to.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, to.width, to.height);
  ctx.drawImage(from, 0, 0);
}
