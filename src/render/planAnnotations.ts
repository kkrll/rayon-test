import type { Room, Wall } from '../engine/types';
import { type Camera, toScreen } from './camera';
import type { Theme } from './theme';

// Everything here is drawn in screen space (CSS px), so line weights and
// text stay the same at any zoom, like annotations on a drawing sheet.

const SCALE_STEPS_M = [0.5, 1, 2, 5, 10];

/** Bottom left: a two-segment bar in whole metres, about 80 px per segment. */
export function drawScaleBar(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, theme: Theme) {
  const meters = SCALE_STEPS_M.find((m) => m * 100 * cam.scale >= 60) ?? SCALE_STEPS_M[SCALE_STEPS_M.length - 1];
  const seg = meters * 100 * cam.scale;
  const y = Math.round(ctx.canvas.height / dpr - 20) + 0.5;
  const x0 = 24.5;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = theme.foreground;
  ctx.fillStyle = theme.foreground;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + 2 * seg, y);
  for (let i = 0; i <= 2; i++) {
    ctx.moveTo(Math.round(x0 + i * seg) + 0.5, y);
    ctx.lineTo(Math.round(x0 + i * seg) + 0.5, y - 5);
  }
  ctx.stroke();
  ctx.font = `400 10px ${theme.fontMono}`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i <= 2; i++) ctx.fillText(i === 0 ? '0' : `${i * meters} m`, x0 + i * seg, y - 9);
}

/** Name in small caps and the floor area, haloed so furniture can't swallow it. */
export function drawRoomLabels(ctx: CanvasRenderingContext2D, rooms: Room[], cam: Camera, dpr: number, theme: Theme) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.background;
  ctx.lineWidth = 4;
  ctx.fillStyle = theme.foreground;

  for (const r of rooms) {
    const { x, y, w } = extent(r);
    if (w * cam.scale < 56) continue;
    const p = toScreen(cam, { x, y });
    const name = r.style.name.toUpperCase();
    const area = `${(polygonArea(r) / 10_000).toFixed(1)} m²`;
    ctx.font = `500 10px ${theme.fontSans}`;
    ctx.letterSpacing = '0.08em';
    ctx.strokeText(name, p.x, p.y - 7);
    ctx.fillText(name, p.x, p.y - 7);
    ctx.font = `400 10px ${theme.fontMono}`;
    ctx.letterSpacing = '0px';
    ctx.strokeText(area, p.x, p.y + 7);
    ctx.fillText(area, p.x, p.y + 7);
  }
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * Dimension chains outside the exterior walls: one per side through the room
 * edges that reach it, plus the overall size on the top and left.
 */
export function drawDimensions(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  walls: Wall[],
  cam: Camera,
  dpr: number,
  theme: Theme,
) {
  if (rooms.length === 0 || walls.length === 0) return;
  // Outer faces of the walls: where the chains start from.
  const outer = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const w of walls) {
    const h = w.geometry.thickness / 2;
    for (const p of [w.geometry.a, w.geometry.b]) {
      outer.minX = Math.min(outer.minX, p.x - h);
      outer.minY = Math.min(outer.minY, p.y - h);
      outer.maxX = Math.max(outer.maxX, p.x + h);
      outer.maxY = Math.max(outer.maxY, p.y + h);
    }
  }
  const plan = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rooms) {
    for (const p of r.geometry.points) {
      plan.minX = Math.min(plan.minX, p.x);
      plan.minY = Math.min(plan.minY, p.y);
      plan.maxX = Math.max(plan.maxX, p.x);
      plan.maxY = Math.max(plan.maxY, p.y);
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = theme.foreground05;
  ctx.fillStyle = theme.foreground05;
  ctx.font = `400 10px ${theme.fontMono}`;
  ctx.letterSpacing = '0px';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  const sides: [Side, number][] = [['top', plan.minY], ['bottom', plan.maxY], ['left', plan.minX], ['right', plan.maxX]];
  for (const [side, at] of sides) {
    const horizontal = side === 'top' || side === 'bottom';
    const cuts = new Set<number>();
    for (const r of rooms) {
      const pts = r.geometry.points;
      for (let i = 0; i < pts.length; i++) {
        const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
        const onSide = horizontal ? a.y === b.y && Math.abs(a.y - at) < 10 : a.x === b.x && Math.abs(a.x - at) < 10;
        if (!onSide) continue;
        cuts.add(horizontal ? a.x : a.y);
        cuts.add(horizontal ? b.x : b.y);
      }
    }
    const chain = [...cuts].sort((p, q) => p - q);
    chainLine(ctx, cam, outer, side, chain, 24);
    if (side === 'top' || side === 'left') {
      chainLine(ctx, cam, outer, side, [chain[0], chain[chain.length - 1]], 48);
    }
  }
}

function chainLine(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  outer: { minX: number; minY: number; maxX: number; maxY: number },
  side: Side,
  values: number[],
  offsetPx: number,
) {
  if (values.length < 2) return;
  const horizontal = side === 'top' || side === 'bottom';
  const sign = side === 'top' || side === 'left' ? -1 : 1;
  // Screen position of the wall face and of the dimension line.
  const face = horizontal
    ? (side === 'top' ? outer.minY : outer.maxY) * cam.scale + cam.ty
    : (side === 'left' ? outer.minX : outer.maxX) * cam.scale + cam.tx;
  const at = Math.round(face + sign * offsetPx) + 0.5;
  const pos = (v: number) => (horizontal ? v * cam.scale + cam.tx : v * cam.scale + cam.ty);
  const pt = (along: number, across: number): [number, number] => (horizontal ? [along, across] : [across, along]);

  ctx.beginPath();
  ctx.moveTo(...pt(pos(values[0]) - 6, at));
  ctx.lineTo(...pt(pos(values[values.length - 1]) + 6, at));
  for (const v of values) {
    const s = Math.round(pos(v)) + 0.5;
    // Extension line from just off the wall to just past the dimension line.
    ctx.moveTo(...pt(s, face + sign * 4));
    ctx.lineTo(...pt(s, at + sign * 4));
    // 45° tick.
    ctx.moveTo(...pt(s - 3, at + 3));
    ctx.lineTo(...pt(s + 3, at - 3));
  }
  ctx.stroke();

  for (let i = 0; i + 1 < values.length; i++) {
    const [s0, s1] = [pos(values[i]), pos(values[i + 1])];
    const label = String(Math.round(values[i + 1] - values[i]));
    if (Math.abs(s1 - s0) < ctx.measureText(label).width + 8) continue;
    const [x, y] = pt((s0 + s1) / 2, at - 5);
    ctx.save();
    ctx.translate(x, y);
    if (!horizontal) ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

function extent(r: Room) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of r.geometry.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX };
}

/** Shoelace formula, cm². */
function polygonArea(r: Room) {
  const pts = r.geometry.points;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
