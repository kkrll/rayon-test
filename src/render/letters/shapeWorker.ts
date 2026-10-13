// Builds letter shapes off the main thread. One request at a time: the main
// thread keeps the queue, so the shapes on screen can jump ahead of prefetching.

import { type ShapeSpec, buffersOf, buildShape, pack } from './shapes';

export interface ShapeRequest {
  key: string;
  spec: ShapeSpec;
}

self.onmessage = (e: MessageEvent<ShapeRequest>) => {
  const { key, spec } = e.data;
  const shape = buildShape(spec);
  const geometry = pack(shape.geometry);
  const edges = pack(shape.edges);
  (self as unknown as Worker).postMessage({ key, geometry, edges }, buffersOf(geometry, edges));
};
