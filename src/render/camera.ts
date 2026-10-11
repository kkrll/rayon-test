import type { Vec } from '../engine/types';

/** Maps world (cm) to CSS pixels: screen = world * scale + (tx, ty). */
export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function toScreen(cam: Camera, p: Vec): Vec {
  return { x: p.x * cam.scale + cam.tx, y: p.y * cam.scale + cam.ty };
}

export function fitCamera(bounds: Bounds, width: number, height: number, padding = 40): Camera {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = Math.min((width - padding * 2) / w, (height - padding * 2) / h);
  return {
    scale,
    tx: (width - w * scale) / 2 - bounds.minX * scale,
    ty: (height - h * scale) / 2 - bounds.minY * scale,
  };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const scale = cam.scale * factor;
  return { scale, tx: sx - (sx - cam.tx) * factor, ty: sy - (sy - cam.ty) * factor };
}
