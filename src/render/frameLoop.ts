/**
 * The single requestAnimationFrame loop. Each view registers a callback that
 * reads the latest shared values (cursor, camera) and redraws only if they
 * changed since its last frame, so intermediate positions are simply dropped.
 */
type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
let running = false;

function tick(now: number) {
  for (const cb of callbacks) cb(now);
  if (callbacks.size > 0) requestAnimationFrame(tick);
  else running = false;
}

export function onFrame(cb: FrameCallback): () => void {
  callbacks.add(cb);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
  return () => callbacks.delete(cb);
}
