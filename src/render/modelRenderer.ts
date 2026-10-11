import type { Furniture, ModelObject, Room, Wall } from '../engine/types';
import { type Bounds, type Camera, toScreen } from './camera';
import type { Theme } from './theme';

/**
 * Full ("at rest") render: room fills and labels, furniture in material
 * colours, walls on top. `dpr` is the device pixel ratio of the canvas.
 */
export function drawModel(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyMap<string, ModelObject>,
  cam: Camera,
  dpr: number,
  theme: Theme,
) {
  const rooms: Room[] = [];
  const walls: Wall[] = [];
  const furniture: Furniture[] = [];
  for (const o of state.values()) {
    if (o.type === 'room') rooms.push(o);
    else if (o.type === 'wall') walls.push(o);
    else furniture.push(o);
  }

  ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.tx, dpr * cam.ty);
  const hairline = 1 / cam.scale;

  for (const r of rooms) {
    traceRoom(ctx, r);
    ctx.fillStyle = r.style.fill;
    ctx.fill();
  }

  // Largest first: rugs end up under the beds and sofas standing on them.
  furniture.sort((a, b) => b.geometry.w * b.geometry.h - a.geometry.w * a.geometry.h);
  ctx.lineWidth = hairline;
  ctx.strokeStyle = theme.foreground03;
  for (const f of furniture) {
    traceFurniture(ctx, f);
    ctx.fillStyle = f.style.material;
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = theme.foreground;
  ctx.lineCap = 'square';
  for (const w of walls) {
    ctx.lineWidth = w.geometry.thickness;
    traceWall(ctx, w);
    ctx.stroke();
  }

  drawRoomLabels(ctx, rooms, cam, dpr, theme);
}

export function traceWall(ctx: CanvasRenderingContext2D, w: Wall) {
  const { a, b } = w.geometry;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

export function traceRoom(ctx: CanvasRenderingContext2D, r: Room) {
  const pts = r.geometry.points;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

export function traceFurniture(ctx: CanvasRenderingContext2D, f: Furniture) {
  const { x, y, w, h, rotation } = f.geometry;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  // Corners of the rotated rectangle, without touching the context transform.
  ctx.moveTo(x - hw * cos + hh * sin, y - hw * sin - hh * cos);
  ctx.lineTo(x + hw * cos + hh * sin, y + hw * sin - hh * cos);
  ctx.lineTo(x + hw * cos - hh * sin, y + hw * sin + hh * cos);
  ctx.lineTo(x - hw * cos - hh * sin, y - hw * sin + hh * cos);
  ctx.closePath();
}

/** Labels are drawn in screen space so they stay readable at any zoom. */
function drawRoomLabels(ctx: CanvasRenderingContext2D, rooms: Room[], cam: Camera, dpr: number, theme: Theme) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.foreground07;
  ctx.font = `500 11px ${theme.fontSans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of rooms) {
    const p = toScreen(cam, centroid(r));
    ctx.fillText(r.style.name, p.x, p.y);
  }
}

function centroid(r: Room) {
  const pts = r.geometry.points;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function modelBounds(state: ReadonlyMap<string, ModelObject>): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const o of state.values()) {
    if (o.type === 'wall') {
      add(o.geometry.a.x, o.geometry.a.y);
      add(o.geometry.b.x, o.geometry.b.y);
    } else if (o.type === 'room') {
      for (const p of o.geometry.points) add(p.x, p.y);
    }
  }
  return b;
}
