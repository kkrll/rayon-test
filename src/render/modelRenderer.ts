import type { Diff } from '../engine/history';
import type { Furniture, ModelObject, Room, Wall } from '../engine/types';
import { type Bounds, type Camera, toScreen } from './camera';
import type { Theme } from './theme';

/**
 * full:      at rest. Room fills and labels, materials, walls on top.
 * outline:   while scrubbing. Strokes only, no fills, no labels; objects in
 *            the diff keep their full style so changes stand out.
 * thumbnail: full style without labels, for session previews.
 */
export type RenderMode = 'full' | 'outline' | 'thumbnail';

/** The diff since the start of the cursor's session, as the renderer needs it. */
export interface Highlight {
  added: Set<string>;
  modified: Set<string>;
  deleted: ModelObject[]; // drawn as ghosts, as they were before deletion
}

export const NO_HIGHLIGHT: Highlight = { added: new Set(), modified: new Set(), deleted: [] };

export function toHighlight(diff: Diff): Highlight {
  return {
    added: new Set(diff.added.map((o) => o.id)),
    modified: new Set(diff.modified.map((o) => o.id)),
    deleted: diff.deleted,
  };
}

const HIGHLIGHT_PX = 2;

export function drawModel(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyMap<string, ModelObject>,
  cam: Camera,
  dpr: number,
  theme: Theme,
  mode: RenderMode,
  highlight: Highlight,
) {
  const rooms: Room[] = [];
  const walls: Wall[] = [];
  const furniture: Furniture[] = [];
  for (const o of state.values()) {
    if (o.type === 'room') rooms.push(o);
    else if (o.type === 'wall') walls.push(o);
    else furniture.push(o);
  }
  const changed = (o: ModelObject) => highlight.added.has(o.id) || highlight.modified.has(o.id);
  const full = (o: ModelObject) => mode !== 'outline' || changed(o);

  ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.tx, dpr * cam.ty);
  const hairline = 1 / cam.scale;
  ctx.lineWidth = hairline;
  ctx.setLineDash([]);

  for (const r of rooms) {
    traceRoom(ctx, r);
    if (full(r)) {
      ctx.fillStyle = r.style.fill;
      ctx.fill();
    } else {
      ctx.strokeStyle = theme.foreground03;
      ctx.stroke();
    }
  }

  if (mode !== 'outline') {
    // Largest first: rugs end up under the beds and sofas standing on them.
    furniture.sort((a, b) => b.geometry.w * b.geometry.h - a.geometry.w * a.geometry.h);
  }
  ctx.strokeStyle = theme.foreground03;
  for (const f of furniture) {
    traceFurniture(ctx, f);
    if (full(f)) {
      ctx.fillStyle = f.style.material;
      ctx.fill();
    }
    ctx.stroke();
  }

  for (const w of walls) {
    if (full(w)) {
      ctx.strokeStyle = theme.foreground;
      ctx.lineCap = 'square';
      ctx.lineWidth = w.geometry.thickness;
      traceWall(ctx, w);
    } else {
      // A centreline reads cleaner than two footprint edges meeting at joints.
      ctx.strokeStyle = theme.foreground05;
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1.5 * hairline;
      traceWall(ctx, w);
    }
    ctx.stroke();
  }

  drawHighlight(ctx, state, cam, theme, highlight);
  if (mode === 'full') drawRoomLabels(ctx, rooms, cam, dpr, theme);
}

/** Diff colours on top of everything. Deletions are dashed: never colour alone. */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyMap<string, ModelObject>,
  cam: Camera,
  theme: Theme,
  highlight: Highlight,
) {
  ctx.lineWidth = HIGHLIGHT_PX / cam.scale;
  ctx.lineCap = 'butt';

  const strokeAll = (ids: Set<string>, color: string) => {
    ctx.strokeStyle = color;
    for (const id of ids) {
      const o = state.get(id);
      if (!o) continue;
      traceOutline(ctx, o);
      ctx.stroke();
    }
  };
  strokeAll(highlight.modified, theme.modified);
  strokeAll(highlight.added, theme.added);

  ctx.strokeStyle = theme.deleted;
  ctx.fillStyle = theme.deleted;
  ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
  for (const o of highlight.deleted) {
    traceOutline(ctx, o);
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function traceOutline(ctx: CanvasRenderingContext2D, o: ModelObject) {
  if (o.type === 'wall') traceWallOutline(ctx, o);
  else if (o.type === 'room') traceRoom(ctx, o);
  else traceFurniture(ctx, o);
}

export function traceWall(ctx: CanvasRenderingContext2D, w: Wall) {
  const { a, b } = w.geometry;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

/** The wall's footprint: its centreline extended by half the thickness all round. */
function traceWallOutline(ctx: CanvasRenderingContext2D, w: Wall) {
  const { a, b, thickness } = w.geometry;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const h = thickness / 2;
  const dx = ((b.x - a.x) / len) * h;
  const dy = ((b.y - a.y) / len) * h;
  ctx.beginPath();
  ctx.moveTo(a.x - dx - dy, a.y - dy + dx);
  ctx.lineTo(b.x + dx - dy, b.y + dy + dx);
  ctx.lineTo(b.x + dx + dy, b.y + dy - dx);
  ctx.lineTo(a.x - dx + dy, a.y - dy - dx);
  ctx.closePath();
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

/** Bounds of a set of objects (walls, room outlines, furniture footprints). */
export function boundsOf(objects: Iterable<ModelObject>): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const o of objects) {
    if (o.type === 'wall') {
      add(o.geometry.a.x, o.geometry.a.y);
      add(o.geometry.b.x, o.geometry.b.y);
    } else if (o.type === 'room') {
      for (const p of o.geometry.points) add(p.x, p.y);
    } else {
      const r = Math.max(o.geometry.w, o.geometry.h) / 2;
      add(o.geometry.x - r, o.geometry.y - r);
      add(o.geometry.x + r, o.geometry.y + r);
    }
  }
  return b;
}

/** Grows bounds by `pad` and to at least `minW` x `minH`, around their centre. */
export function expandBounds(b: Bounds, pad: number, minW: number, minH: number): Bounds {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const hw = Math.max(minW, b.maxX - b.minX + pad * 2) / 2;
  const hh = Math.max(minH, b.maxY - b.minY + pad * 2) / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}
