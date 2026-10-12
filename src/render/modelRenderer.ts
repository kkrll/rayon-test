import type { Furniture, ModelObject, Room, Wall } from '../engine/types';
import { type Bounds, type Camera } from './camera';
import { isRound, isSoft, traceSymbol } from './furnitureSymbols';
import type { Highlight } from './highlight';
import { drawDimensions, drawRoomLabels, drawScaleBar } from './planAnnotations';
import type { Theme } from './theme';

/**
 * full:      at rest. A drawing sheet: floors, furniture symbols, solid
 *            walls, dimensions, room labels with areas, scale bar.
 * outline:   while scrubbing. Strokes only, no fills, no labels; objects in
 *            the diff keep their full style so changes stand out.
 * thumbnail: full style without annotations or details, for session previews.
 */
export type RenderMode = 'full' | 'outline' | 'thumbnail';

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
    else if (o.type === 'furniture') furniture.push(o);
  }
  const changed = (o: ModelObject) => highlight.added.has(o.id) || highlight.modified.has(o.id);
  const full = (o: ModelObject) => mode !== 'outline' || changed(o);

  ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.tx, dpr * cam.ty);
  const hairline = 1 / cam.scale;
  ctx.lineWidth = hairline;
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // Floors: the room's colour as a faint wash, then its floor pattern.
  for (const r of rooms) {
    traceRoom(ctx, r);
    if (full(r)) {
      ctx.fillStyle = r.style.fill;
      ctx.globalAlpha = ROOM_WASH;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (mode !== 'thumbnail') drawFloor(ctx, r, cam, theme);
    } else {
      ctx.strokeStyle = theme.foreground03;
      ctx.stroke();
    }
  }

  if (mode !== 'outline') {
    // Largest first: rugs end up under the beds and sofas standing on them.
    furniture.sort((a, b) => b.geometry.w * b.geometry.h - a.geometry.w * a.geometry.h);
  }
  for (const f of furniture) {
    if (full(f)) drawFurniture(ctx, f, cam, theme, mode !== 'thumbnail');
    else {
      ctx.strokeStyle = theme.foreground03;
      ctx.lineWidth = hairline;
      traceFurniture(ctx, f);
      ctx.stroke();
    }
  }

  // Solid walls with no outline, so overlapping pieces merge into one poché.
  // One fill per wall: in a shared path, opposite windings would cut holes.
  ctx.fillStyle = theme.foreground;
  for (const w of walls) {
    if (!full(w)) continue;
    traceWallOutline(ctx, w);
    ctx.fill();
  }
  // Scrubbing: a centreline reads cleaner than footprint edges meeting at joints.
  ctx.beginPath();
  for (const w of walls) if (!full(w)) traceWall(ctx, w, false);
  ctx.strokeStyle = theme.foreground05;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.5 * hairline;
  ctx.stroke();

  drawHighlight(ctx, state, cam, theme, highlight);
  if (mode === 'full') {
    drawDimensions(ctx, rooms, walls, cam, dpr, theme);
    drawRoomLabels(ctx, rooms, cam, dpr, theme);
    drawScaleBar(ctx, cam, dpr, theme);
  }
}

const ROOM_WASH = 0.18;
const MATERIAL_WASH = 0.15;
/** Details below this size (screen px) would only be noise. */
const DETAIL_MIN_PX = 14;

type Floor = 'planks' | 'tiles' | 'deck' | null;
const FLOORS: Record<string, Floor> = {
  Living: 'planks', 'Living room': 'planks', Dining: 'planks', 'Dining area': 'planks',
  Study: 'planks', 'Home office': 'planks', Bedroom: 'planks', 'Master bedroom': 'planks',
  'Bedroom 2': 'planks', 'Guest room': 'planks', Hall: 'planks', Entrance: 'planks',
  Kitchen: 'tiles', Kitchenette: 'tiles', Bathroom: 'tiles', Bath: 'tiles', WC: 'tiles', 'Guest WC': 'tiles',
  Balcony: 'deck', Terrace: 'deck',
};

/** Planks (15 cm, staggered joints), 30 cm tiles or 12 cm decking, clipped to the room. */
function drawFloor(ctx: CanvasRenderingContext2D, r: Room, cam: Camera, theme: Theme) {
  const floor = FLOORS[r.style.name];
  const step = floor === 'tiles' ? 30 : floor === 'deck' ? 12 : 15;
  if (!floor || step * cam.scale < 4) return;
  const { minX, minY, maxX, maxY } = boundsOf([r]);
  ctx.save();
  traceRoom(ctx, r);
  ctx.clip();
  ctx.beginPath();
  for (let y = Math.ceil(minY / step) * step; y < maxY; y += step) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  if (floor === 'tiles') {
    for (let x = Math.ceil(minX / step) * step; x < maxX; x += step) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
  } else if (floor === 'planks' && 120 * cam.scale > 24) {
    // Butt joints, offset row by row.
    for (let y = Math.floor(minY / step) * step, row = 0; y < maxY; y += step, row++) {
      for (let x = Math.floor(minX / 120) * 120 + ((row * 47) % 120); x < maxX; x += 120) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + step);
      }
    }
  }
  ctx.strokeStyle = theme.foreground;
  ctx.globalAlpha = 0.09;
  ctx.lineWidth = 1 / cam.scale;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Paper body with softened corners, a hint of its material, then its symbol. */
function drawFurniture(ctx: CanvasRenderingContext2D, f: Furniture, cam: Camera, theme: Theme, details: boolean) {
  const { x, y, w, h, rotation } = f.geometry;
  const soft = isSoft(f);
  const radius = Math.min(4, w / 4, h / 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  if (isRound(f)) ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
  else ctx.roundRect(-w / 2, -h / 2, w, h, soft ? 0 : radius);
  ctx.restore();

  if (!soft) {
    ctx.fillStyle = theme.paper;
    ctx.fill();
  }
  ctx.fillStyle = f.style.material;
  ctx.globalAlpha = MATERIAL_WASH;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.foreground;
  ctx.lineWidth = 1 / cam.scale;
  if (soft) ctx.setLineDash([4 / cam.scale, 3 / cam.scale]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (details && Math.min(w, h) * cam.scale >= DETAIL_MIN_PX && traceSymbol(ctx, f)) {
    ctx.lineWidth = 0.75 / cam.scale;
    ctx.stroke();
  }
}

/** Room around the plan at rest: dimension chains outside, scale bar below. */
export const PLAN_PADDING_PX = 96;

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
  else if (o.type === 'furniture') traceFurniture(ctx, o);
  else ctx.beginPath(); // device parts have no plan footprint
}

export function traceWall(ctx: CanvasRenderingContext2D, w: Wall, begin = true) {
  const { a, b } = w.geometry;
  if (begin) ctx.beginPath();
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
  if (isRound(f)) {
    ctx.beginPath();
    ctx.arc(x, y, Math.min(w, h) / 2, 0, Math.PI * 2);
    return;
  }
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
    } else if (o.type === 'furniture') {
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
