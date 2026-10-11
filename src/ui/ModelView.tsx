import { onCleanup, onMount } from 'solid-js';
import type { History } from '../engine/history';
import { type Bounds, type Camera, fitCamera, zoomAt } from '../render/camera';
import { onFrame } from '../render/frameLoop';
import { drawModel } from '../render/modelRenderer';

interface Props {
  history: History;
  /** Read once per frame; not reactive on purpose (see frameLoop). */
  seq: () => number;
  /** Fixed framing so the camera doesn't jump while scrubbing. */
  bounds: Bounds;
}

export function ModelView(props: Props) {
  let canvas!: HTMLCanvasElement;
  let camera: Camera | null = null;
  let dirty = true;
  let drawnSeq = -1;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    camera ??= fitCamera(props.bounds, canvas.clientWidth, canvas.clientHeight);
    dirty = true;
  };

  const draw = () => {
    const seq = props.seq();
    if (!camera || (!dirty && seq === drawnSeq)) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawModel(ctx, props.history.getStateAt(seq), camera, dpr);
    drawnSeq = seq;
    dirty = false;
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
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const stop = onFrame(draw);
    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  return <canvas ref={canvas} class="model-view" onPointerDown={onPointerDown} />;
}
