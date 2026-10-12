import type { Furniture } from '../engine/types';

/**
 * Plan symbols for furniture, drawn in the item's own frame: centre at the
 * origin, width along x, depth along y, before rotation. By convention the
 * back of seating is at +y and the head of a bed at -y.
 */
type Draw = (ctx: CanvasRenderingContext2D, hw: number, hh: number) => void;

const rect = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x0, y1);
  ctx.closePath();
};

const line = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
};

const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
};

const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) => {
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
};

/** Back along +y, arms on both sides, seat split into cushions. */
const seating = (cushions: number): Draw => (ctx, hw, hh) => {
  const back = Math.min(18, hh * 0.4);
  const arm = Math.min(15, hw * 0.2);
  rect(ctx, -hw, hh - back, hw, hh);
  rect(ctx, -hw, -hh, -hw + arm, hh - back);
  rect(ctx, hw - arm, -hh, hw, hh - back);
  for (let i = 1; i < cushions; i++) {
    const x = -hw + arm + ((2 * (hw - arm)) * i) / cushions;
    line(ctx, x, -hh, x, hh - back);
  }
};

const bed: Draw = (ctx, hw, hh) => {
  const pillows = hw * 2 >= 140 ? 2 : 1;
  const gap = 6;
  const pw = (2 * hw - gap * (pillows + 1)) / pillows;
  for (let i = 0; i < pillows; i++) {
    const x = -hw + gap + i * (pw + gap);
    rect(ctx, x, -hh + gap, x + pw, -hh + 26);
  }
  // Folded-back duvet.
  line(ctx, -hw, -hh + 50, hw, -hh + 50);
  line(ctx, -hw, -hh + 50, -hw + 30, -hh + 36);
};

const chair: Draw = (ctx, hw, hh) => {
  const i = Math.min(hw, hh) * 0.25;
  rect(ctx, -hw + i, -hh + i, hw - i, hh - i);
};

const round: Draw = (ctx, hw, hh) => circle(ctx, 0, 0, Math.min(hw, hh) * 0.55);

const plant: Draw = (ctx, hw, hh) => {
  const r = Math.min(hw, hh);
  circle(ctx, 0, 0, r * 0.35);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + 0.3;
    line(ctx, Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
  }
};

const lamp: Draw = (ctx, hw, hh) => {
  const r = Math.min(hw, hh);
  circle(ctx, 0, 0, r * 0.55);
  line(ctx, -r, 0, r, 0);
  line(ctx, 0, -r, 0, r);
};

const toilet: Draw = (ctx, hw, hh) => {
  const tank = Math.min(18, hh * 0.3);
  line(ctx, -hw, -hh + tank, hw, -hh + tank);
  ellipse(ctx, 0, (tank + 4) / 2, hw * 0.75, (hh * 2 - tank - 8) / 2 * 0.9);
};

const basin: Draw = (ctx, hw, hh) => ellipse(ctx, 0, hh * 0.1, hw * 0.7, hh * 0.6);

const bathtub: Draw = (ctx, hw, hh) => {
  const i = Math.min(hw, hh) * 0.2;
  rect(ctx, -hw + i, -hh + i, hw - i, hh - i);
  circle(ctx, -hw + i * 2.2, 0, 3);
};

const washer: Draw = (ctx, hw, hh) => {
  circle(ctx, 0, 0, Math.min(hw, hh) * 0.65);
  circle(ctx, 0, 0, Math.min(hw, hh) * 0.4);
};

/** Cabinets and appliances: an inset line along the front (-y). */
const front: Draw = (ctx, hw, hh) => line(ctx, -hw, -hh + Math.min(5, hh * 0.3), hw, -hh + Math.min(5, hh * 0.3));

/** Shelving and wardrobes: a line along the length, shelves or hanging rail. */
const lengthwise: Draw = (ctx, hw) => line(ctx, -hw + 4, 0, hw - 4, 0);

const counter: Draw = (ctx, hw, hh) => {
  front(ctx, hw, hh);
  // Sink and hob.
  rect(ctx, -hw * 0.6, -hh * 0.5, -hw * 0.25, hh * 0.6);
  circle(ctx, hw * 0.35, -hh * 0.2, hh * 0.25);
  circle(ctx, hw * 0.6, hh * 0.25, hh * 0.2);
};

const fridge: Draw = (ctx, hw, hh) => {
  front(ctx, hw, hh);
  line(ctx, -hw, -hh, hw, hh);
};

const SYMBOLS: Record<string, Draw> = {
  Sofa: seating(3),
  'Sofa bed': seating(2),
  Armchair: seating(1),
  Bed: bed,
  Chair: chair,
  'Office chair': round,
  'Outdoor chair': chair,
  Stool: round,
  'Side table': round,
  'Bistro table': round,
  Plant: plant,
  'Plant pot': plant,
  Planter: lengthwise,
  'Floor lamp': lamp,
  Toilet: toilet,
  Washbasin: basin,
  Bathtub: bathtub,
  'Washing machine': washer,
  Dishwasher: washer,
  Fridge: fridge,
  'Kitchen counter': counter,
  Wardrobe: lengthwise,
  Bookshelf: lengthwise,
  Shelving: lengthwise,
  'Shoe rack': lengthwise,
  'Coat rack': lengthwise,
  'Towel shelf': lengthwise,
  Shelf: lengthwise,
  Sideboard: front,
  Dresser: front,
  'Pantry cabinet': front,
  'Filing cabinet': front,
  Cabinet: front,
  'Vacuum cabinet': front,
  'Storage box': fridge,
};

const ROUND = new Set(['Plant', 'Plant pot', 'Stool', 'Side table', 'Bistro table', 'Floor lamp', 'Office chair']);

/** Drawn as a circle inscribed in the footprint rather than a box. */
export const isRound = (f: Furniture) => ROUND.has(f.style.name);

/** Rugs and mats: dashed outline, no paper fill, so what stands on them reads. */
export const isSoft = (f: Furniture) => /rug|mat\b/i.test(f.style.name);

/** Traces the symbol's detail lines (no beginPath, no stroke) in world space. */
export function traceSymbol(ctx: CanvasRenderingContext2D, f: Furniture) {
  const symbol = SYMBOLS[f.style.name];
  if (!symbol) return false;
  const { x, y, w, h, rotation } = f.geometry;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  symbol(ctx, w / 2, h / 2);
  ctx.restore(); // the path keeps its points; the stroke uses the restored transform
  return true;
}
