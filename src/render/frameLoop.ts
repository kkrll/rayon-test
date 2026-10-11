/**
 * The single requestAnimationFrame loop. Each view registers a callback that
 * reads the latest shared values (cursor, camera) and redraws only if they
 * changed since its last frame, so intermediate positions are simply dropped.
 *
 * Callbacks run by ascending `order`: producers of shared values (the
 * timeline publishes cursor.seq) run before their consumers (the model view).
 */
import { stats } from './stats';

type FrameCallback = (now: number) => void;

export const FRAME_ORDER = { input: 0, render: 1 } as const;

const callbacks: { cb: FrameCallback; order: number }[] = [];
let running = false;
let previous = 0;

function tick(now: number) {
  if (previous) stats.loop.record(now - previous);
  previous = now;
  for (const { cb } of callbacks) cb(now);
  if (callbacks.length > 0) requestAnimationFrame(tick);
  else {
    running = false;
    previous = 0;
  }
}

export function onFrame(cb: FrameCallback, order: number = FRAME_ORDER.render): () => void {
  const entry = { cb, order };
  callbacks.push(entry);
  callbacks.sort((a, b) => a.order - b.order);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
  return () => callbacks.splice(callbacks.indexOf(entry), 1);
}
