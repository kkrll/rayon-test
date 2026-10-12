// Synthetic edit history for one apartment floor plan (cm units).
//
// Pipeline: (1) build a schedule of timestamped edit slots per author,
// (2) merge all slots by time, (3) walk them in order against one live Map and
// decide each concrete edit from the current state, the project phase and the
// session's "focus" room. `before` therefore always comes from live state.

import { createRng, type Rng, weighted } from './rng';
import type {
  Author, Dataset, Furniture, ModelObject, NamedVersion, ObjectType, Op, Room, State, Vec, Wall,
} from './types';

/** The floor plan only has these; device parts come from generator3d. */
type PlanType = Exclude<ObjectType, 'part'>;

// ---------------------------------------------------------------- time

const START = Date.UTC(2026, 2, 2); // a Monday; weekdays come from the day index
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAST_DAY = 88; // Friday of week 13
const HOLIDAY_WEEK = 9; // 0-based; whole team off
const WORK_START = 9 * HOUR;
const WORK_END = 18.5 * HOUR;

// Creation phases overlap, as in a real project: [from, to] in day indices.
const PACE = {
  wall: { from: 0, to: 9 },
  room: { from: 8, to: 24 },
  furniture: { from: 22, to: 44 },
};
const ADJUST_FROM_DAY = 42; // deletions and replacements start here

// ---------------------------------------------------------------- static data

const AUTHORS: Author[] = [
  { id: 'a1', name: 'Maya Chen', initials: 'MC', color: '#7a9cc6' },
  { id: 'a2', name: 'Tomas Weber', initials: 'TW', color: '#c68b77' },
  { id: 'a3', name: 'Lena Ortiz', initials: 'LO', color: '#8fae8b' },
  { id: 'a4', name: 'Sam Okafor', initials: 'SO', color: '#b59ac4' },
  { id: 'a5', name: 'Ines Novak', initials: 'IN', color: '#c9b27a' },
];

// Material sets per kind of furniture (comments name the look).
const MATERIAL_SETS = {
  wood: ['#c8a165' /* oak */, '#6b4a33' /* walnut */, '#d9c4a0' /* ash */],
  fabric: ['#e6dccb' /* linen */, '#9caf88' /* sage */, '#3f4448' /* charcoal */, '#b8664a' /* terracotta */, '#8d949a' /* grey */],
  ceramic: ['#f2efe9' /* white */, '#e4e7ea' /* pale grey */, '#d8dde0' /* light grey */],
  metal: ['#3f4448' /* charcoal */, '#9a9a96' /* concrete */, '#f2efe9' /* white */],
  plant: ['#9caf88' /* sage */, '#7f9a6e' /* fern */],
  pot: ['#b8664a' /* terracotta */, '#9a9a96' /* concrete */, '#3f4448' /* charcoal */],
  rug: ['#e6dccb' /* linen */, '#cfd8c4' /* pale sage */, '#e3c9b8' /* blush */, '#d6d4cf' /* stone */],
};
type Mat = keyof typeof MATERIAL_SETS;

const PASTELS = ['#f4d9d0', '#d9e8d4', '#d6e4f0', '#f3ecc9', '#e6d9ee', '#f2dfc8', '#d4ebe6', '#efd5e0'];
const NEUTRAL_FILL = '#e8e8e8';
const WALL_STROKE = '#3a3a3a';

const PLAN_W = 1800;
const PLAN_H = 1200;
const MAX_WALL = 450; // longer runs are drawn as several wall objects
const EXTERIOR_THICKNESS = [24, 25, 26];
const INTERIOR_THICKNESS = [10, 11, 12];
const QUARTER = Math.PI / 2;
const WALL_TOL = 8; // endpoints closer than this count as joined
const CLEARANCE = 25; // furniture edge to wall centreline
const MOVE_LIMIT = 30; // furniture stays this near its template position

interface Rect { x0: number; y0: number; x1: number; y1: number }

// Template item: x, y are the centre relative to the room's top-left corner.
// `turns` is quarter-turns (rotation); `soft` items may overlap others
// (rugs, chairs tucked under tables, wall mirrors).
type Item = [name: string, w: number, h: number, x: number, y: number, mat: Mat, turns?: number, soft?: boolean];
interface FurnitureSpec { name: string; w: number; h: number; x: number; y: number; mat: Mat; turns: number; soft: boolean }
interface RoomPlan { name: string; aka: string; rect: Rect; items: Item[] }

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

const toSpec = ([name, w, h, x, y, mat, turns = 0, soft = false]: Item): FurnitureSpec =>
  ({ name, w, h, x, y, mat, turns, soft });

const ROOMS: RoomPlan[] = [
  { name: 'Living', aka: 'Living room', rect: rect(0, 0, 640, 620), items: [
    ['Rug', 240, 170, 320, 215, 'rug', 0, true],
    ['TV unit', 180, 40, 320, 50, 'wood'],
    ['Coffee table', 120, 60, 320, 200, 'wood'],
    ['Sofa', 220, 90, 320, 330, 'fabric'],
    ['Armchair', 90, 90, 110, 230, 'fabric'],
    ['Armchair', 90, 90, 530, 230, 'fabric'],
    ['Side table', 50, 50, 480, 330, 'wood'],
    ['Floor lamp', 35, 35, 470, 400, 'metal'],
    ['Bookshelf', 120, 35, 48, 400, 'wood', 1],
    ['Bookshelf', 120, 35, 48, 530, 'wood', 1],
    ['Plant', 40, 40, 50, 50, 'plant'],
    ['Plant', 40, 40, 590, 50, 'plant']] },
  { name: 'Dining', aka: 'Dining area', rect: rect(640, 0, 1040, 620), items: [
    ['Rug', 240, 160, 200, 250, 'rug', 0, true],
    ['Dining table', 180, 90, 200, 250, 'wood'],
    ['Chair', 45, 45, 140, 190, 'wood', 0, true], ['Chair', 45, 45, 200, 190, 'wood', 0, true],
    ['Chair', 45, 45, 260, 190, 'wood', 0, true], ['Chair', 45, 45, 140, 310, 'wood', 0, true],
    ['Chair', 45, 45, 200, 310, 'wood', 0, true], ['Chair', 45, 45, 260, 310, 'wood', 0, true],
    ['Chair', 45, 45, 88, 250, 'wood', 0, true], ['Chair', 45, 45, 312, 250, 'wood', 0, true],
    ['Sideboard', 160, 45, 200, 568, 'wood'],
    ['Plant', 40, 40, 350, 60, 'plant'],
    ['Plant', 40, 40, 50, 560, 'plant']] },
  { name: 'Kitchen', aka: 'Kitchenette', rect: rect(1040, 0, 1440, 620), items: [
    ['Kitchen counter', 260, 60, 160, 60, 'wood'],
    ['Fridge', 70, 70, 335, 65, 'metal'],
    ['Pantry cabinet', 60, 60, 60, 130, 'wood'],
    ['Dishwasher', 60, 60, 60, 200, 'metal'],
    ['Kitchen island', 180, 80, 200, 300, 'wood'],
    ['Stool', 40, 40, 150, 345, 'wood', 0, true], ['Stool', 40, 40, 200, 345, 'wood', 0, true],
    ['Stool', 40, 40, 250, 345, 'wood', 0, true],
    ['Trash bin', 35, 35, 60, 560, 'metal'],
    ['Plant', 40, 40, 350, 560, 'plant']] },
  { name: 'Study', aka: 'Home office', rect: rect(1440, 0, 1800, 620), items: [
    ['Rug', 200, 140, 150, 330, 'rug', 0, true],
    ['Desk', 160, 80, 180, 70, 'wood'],
    ['Office chair', 60, 60, 180, 135, 'fabric', 0, true],
    ['Filing cabinet', 50, 60, 60, 70, 'metal'],
    ['Bookshelf', 120, 35, 312, 250, 'wood', 1],
    ['Bookshelf', 120, 35, 312, 380, 'wood', 1],
    ['Sofa bed', 190, 90, 180, 545, 'fabric'],
    ['Plant', 40, 40, 60, 560, 'plant'],
    ['Floor lamp', 35, 35, 300, 560, 'metal']] },
  { name: 'Bedroom', aka: 'Master bedroom', rect: rect(0, 620, 400, 1200), items: [
    ['Rug', 200, 140, 200, 270, 'rug', 0, true],
    ['Bed', 160, 200, 200, 130, 'fabric'],
    ['Nightstand', 45, 40, 92, 50, 'wood'], ['Nightstand', 45, 40, 308, 50, 'wood'],
    ['Wardrobe', 200, 60, 200, 520, 'wood'],
    ['Dresser', 120, 50, 345, 330, 'wood', 1],
    ['Armchair', 80, 80, 70, 400, 'fabric'],
    ['Plant', 40, 40, 340, 510, 'plant']] },
  { name: 'Bedroom 2', aka: 'Guest room', rect: rect(400, 620, 800, 1200), items: [
    ['Rug', 180, 120, 150, 300, 'rug', 0, true],
    ['Bed', 140, 200, 130, 130, 'fabric'],
    ['Nightstand', 45, 40, 228, 50, 'wood'],
    ['Wardrobe', 160, 60, 340, 300, 'wood', 1],
    ['Desk', 120, 60, 150, 520, 'wood'],
    ['Chair', 45, 45, 150, 460, 'wood', 0, true],
    ['Plant', 40, 40, 60, 520, 'plant'],
    ['Floor lamp', 35, 35, 340, 510, 'metal']] },
  { name: 'Hall', aka: 'Entrance', rect: rect(800, 620, 1040, 1200), items: [
    ['Runner rug', 80, 200, 120, 400, 'rug', 0, true],
    ['Coat rack', 100, 30, 45, 100, 'wood', 1],
    ['Console', 100, 30, 195, 250, 'wood', 1],
    ['Mirror', 60, 10, 205, 250, 'metal', 1, true],
    ['Shoe rack', 90, 35, 48, 300, 'wood', 1],
    ['Bench', 100, 40, 190, 380, 'wood', 1],
    ['Plant', 40, 40, 190, 500, 'plant']] },
  { name: 'Bathroom', aka: 'Bath', rect: rect(1040, 620, 1340, 1200), items: [
    ['Bathmat', 80, 50, 115, 150, 'rug', 0, true],
    ['Bathtub', 170, 75, 115, 68, 'ceramic'],
    ['Washbasin', 60, 45, 248, 250, 'ceramic', 1],
    ['Mirror cabinet', 60, 15, 262, 250, 'metal', 1, true],
    ['Toilet', 40, 70, 235, 360, 'ceramic', 1],
    ['Washing machine', 60, 60, 60, 520, 'ceramic'],
    ['Laundry basket', 35, 35, 130, 520, 'fabric'],
    ['Towel shelf', 60, 30, 180, 535, 'wood']] },
  { name: 'WC', aka: 'Guest WC', rect: rect(1340, 620, 1560, 1200), items: [
    ['Rug', 60, 40, 110, 150, 'rug', 0, true],
    ['Toilet', 40, 70, 110, 65, 'ceramic'],
    ['Waste bin', 25, 25, 150, 110, 'metal'],
    ['Washbasin', 40, 30, 175, 200, 'ceramic', 1],
    ['Shelf', 60, 20, 40, 200, 'wood', 1],
    ['Cabinet', 50, 30, 45, 350, 'wood', 1]] },
  { name: 'Storage', aka: 'Utility', rect: rect(1560, 620, 1800, 900), items: [
    ['Shelving', 100, 40, 80, 50, 'metal'],
    ['Shelving', 100, 40, 50, 150, 'metal', 1],
    ['Shelving', 100, 40, 190, 130, 'metal', 1],
    ['Vacuum cabinet', 50, 50, 120, 140, 'metal'],
    ['Storage box', 60, 40, 90, 220, 'wood'], ['Storage box', 60, 40, 170, 220, 'wood']] },
  { name: 'Balcony', aka: 'Terrace', rect: rect(1560, 900, 1800, 1200), items: [
    ['Bistro table', 60, 60, 120, 150, 'metal'],
    ['Outdoor chair', 50, 50, 120, 100, 'metal', 0, true], ['Outdoor chair', 50, 50, 120, 200, 'metal', 0, true],
    ['Planter', 80, 30, 80, 45, 'pot'], ['Planter', 80, 30, 170, 45, 'pot'], ['Planter', 80, 30, 120, 250, 'pot'],
    ['Plant pot', 40, 40, 50, 150, 'pot'], ['Plant pot', 40, 40, 190, 150, 'pot']] },
];

// ---------------------------------------------------------------- small helpers

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const same = (a: ModelObject, b: ModelObject) => JSON.stringify(a) === JSON.stringify(b);

function signedStep(rng: Rng, min: number, max: number): number {
  return rng.int(min, max) * (rng.chance(0.5) ? 1 : -1);
}

// ---------------------------------------------------------------- wall layout

interface Edge { axis: 'h' | 'v'; at: number; lo: number; hi: number }

function roomEdges(r: Rect): Edge[] {
  return [
    { axis: 'h', at: r.y0, lo: r.x0, hi: r.x1 },
    { axis: 'h', at: r.y1, lo: r.x0, hi: r.x1 },
    { axis: 'v', at: r.x0, lo: r.y0, hi: r.y1 },
    { axis: 'v', at: r.x1, lo: r.y0, hi: r.y1 },
  ];
}

/** Cuts collinear room edges at every room corner, so shared walls exist once. */
function splitLine(edges: Edge[]): Edge[] {
  const cuts = [...new Set(edges.flatMap((e) => [e.lo, e.hi]))].sort((p, q) => p - q);
  const pieces: Edge[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [lo, hi] = [cuts[i], cuts[i + 1]];
    if (!edges.some((e) => e.lo <= lo && e.hi >= hi)) continue;
    const parts = Math.ceil((hi - lo) / MAX_WALL);
    for (let p = 0; p < parts; p++) {
      const cut = (k: number) => Math.round(lo + ((hi - lo) * k) / parts);
      pieces.push({ ...edges[0], lo: cut(p), hi: cut(p + 1) });
    }
  }
  return pieces;
}

const isExterior = (e: Edge) => e.at === 0 || e.at === (e.axis === 'h' ? PLAN_H : PLAN_W);

/** Wall geometry in drawing order: exterior first, then interior. */
function planWalls(rng: Rng): Wall['geometry'][] {
  const lines = new Map<string, Edge[]>();
  for (const room of ROOMS) {
    for (const e of roomEdges(room.rect)) {
      const key = `${e.axis}${e.at}`;
      lines.set(key, [...(lines.get(key) ?? []), e]);
    }
  }
  const edges = [...lines.values()].flatMap(splitLine);
  const ordered = [...edges.filter(isExterior), ...edges.filter((e) => !isExterior(e))];
  return ordered.map((e) => ({
    a: e.axis === 'h' ? { x: e.lo, y: e.at } : { x: e.at, y: e.lo },
    b: e.axis === 'h' ? { x: e.hi, y: e.at } : { x: e.at, y: e.hi },
    thickness: rng.pick(isExterior(e) ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS),
  }));
}

const rectPoints = (r: Rect): Vec[] => [
  { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
];

// ---------------------------------------------------------------- schedule

interface Session {
  focus: number; // index into ROOMS; most edits concern this room
  pick: Pick | null; // current burst target
}

interface Slot {
  ts: number;
  author: number;
  session: Session;
  burstStart: boolean;
  inBurst: boolean;
}

function burstChance(day: number): number {
  if (day < 14) return 0.1;
  return day < ADJUST_FROM_DAY ? 0.3 : 0.35;
}

/** Bursts: many small edits seconds apart. Slow: one edit every 1-10 minutes. */
function buildSession(rng: Rng, author: number, start: number, end: number, day: number): Slot[] {
  const session: Session = { focus: rng.int(0, ROOMS.length - 1), pick: null };
  const slots: Slot[] = [];
  let t = start;
  const push = (burstStart: boolean, inBurst: boolean) => slots.push({ ts: t, author, session, burstStart, inBurst });

  while (t < end) {
    if (rng.chance(burstChance(day))) {
      const size = rng.int(4, 20);
      for (let i = 0; i < size && t < end; i++) {
        push(i === 0, true);
        t += rng.int(2, 15) * SECOND;
      }
      t += rng.int(30, 180) * SECOND;
    } else {
      const size = rng.int(1, 4);
      for (let i = 0; i < size && t < end; i++) {
        push(true, false);
        t += rng.int(60, 600) * SECOND;
      }
    }
  }
  return slots;
}

/** One author's day: 1-3 sessions with breaks of more than 30 minutes. */
function buildAuthorDay(rng: Rng, author: number, day: number): Slot[] {
  const dayStart = START + day * DAY;
  const dayEnd = dayStart + WORK_END;
  let start = dayStart + WORK_START + rng.int(0, 90) * MINUTE;
  const slots: Slot[] = [];
  for (let i = rng.int(1, 3); i > 0 && start < dayEnd - 20 * MINUTE; i--) {
    const end = Math.min(start + rng.int(15, 22) * MINUTE, dayEnd);
    slots.push(...buildSession(rng, author, start, end, day));
    start = end + rng.int(35, 120) * MINUTE;
  }
  return slots;
}

/** Holiday week plus a few random quiet weekdays for the whole team. */
function pickQuietDays(rng: Rng): Set<number> {
  const quiet = new Set<number>();
  for (let d = 0; d < 5; d++) quiet.add(HOLIDAY_WEEK * 7 + d);
  while (quiet.size < 8) {
    const day = rng.int(3, LAST_DAY - 1);
    if (day % 7 < 5) quiet.add(day);
  }
  return quiet;
}

function buildSchedule(rng: Rng): Slot[] {
  const quiet = pickQuietDays(rng);
  const slots: Slot[] = [];
  for (let day = 0; day <= LAST_DAY; day++) {
    if (day % 7 >= 5 || quiet.has(day)) continue;
    const edgeDay = day === 0 || day === LAST_DAY;
    for (let author = 0; author < AUTHORS.length; author++) {
      if (!edgeDay && rng.chance(0.2)) continue;
      slots.push(...buildAuthorDay(rng, author, day));
    }
  }
  // Array.sort is stable, so equal timestamps keep author order.
  return slots.sort((a, b) => a.ts - b.ts || a.author - b.author);
}

// ---------------------------------------------------------------- concrete edits

type Action =
  | 'wallMove' | 'thickness' | 'wallLength'
  | 'rename' | 'fill' | 'edge'
  | 'move' | 'rotate' | 'resize' | 'material' | 'delete';

/** A chosen edit. dx/dy are generic deltas; `which` picks an endpoint or room edge. */
interface Pick { action: Action; id: string; dx: number; dy: number; which: number }

const ACTIONS: Record<PlanType, [Action, number][]> = {
  wall: [['wallMove', 0.3], ['thickness', 0.65], ['wallLength', 0.05]],
  room: [['rename', 0.3], ['fill', 0.4], ['edge', 0.3]],
  furniture: [['move', 0.55], ['rotate', 0.12], ['resize', 0.13], ['material', 0.15], ['delete', 0.05]],
};
// Only these make sense as a burst of repeated nudges on one object.
const REPEATABLE = new Set<Action>(['wallMove', 'edge', 'move', 'resize']);

function typeWeights(day: number): [PlanType, number][] {
  if (day < 8) return [['wall', 1]];
  if (day < 21) return [['wall', 0.1], ['room', 0.9]];
  return [['wall', 0.03], ['room', 0.1], ['furniture', 0.87]];
}

// Edits stay near the original design so repeated nudging cannot drift away.
const near = (v: number, home: number, limit: number) => clamp(v, home - limit, home + limit);

type Axis = 'x' | 'y';
type End = 'a' | 'b';

const isHorizontal = (w: Wall) => w.geometry.a.y === w.geometry.b.y;
const ends = (w: Wall): Vec[] => [w.geometry.a, w.geometry.b];
const joined = (p: Vec, q: Vec) => Math.abs(p.x - q.x) <= WALL_TOL && Math.abs(p.y - q.y) <= WALL_TOL;

/** Shifts one wall end along `axis`, keeping the wall axis-aligned. */
function shiftEnd(w: Wall, end: End, axis: Axis, d: number): Wall {
  const moved: Vec = { ...w.geometry[end], [axis]: w.geometry[end][axis] + d };
  return { ...w, geometry: { ...w.geometry, [end]: moved } };
}

const shiftWall = (w: Wall, axis: Axis, d: number): Wall => shiftEnd(shiftEnd(w, 'a', axis, d), 'b', axis, d);

function changeThickness(rng: Rng, w: Wall): Wall {
  const options = w.geometry.thickness >= 20 ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS;
  const thickness = rng.pick(options.filter((t) => t !== w.geometry.thickness));
  return { ...w, geometry: { ...w.geometry, thickness } };
}

function renameRoom(rng: Rng, r: Room, plan: RoomPlan): Room {
  // Toggle between the room's two candidate names ("WC" / "Guest WC").
  const name = r.style.name === plan.name ? plan.aka : plan.name;
  return { ...r, style: { ...r.style, name: rng.chance(0.1) ? plan.aka : name } };
}

function recolorRoom(rng: Rng, r: Room): Room {
  const fill = rng.pick(PASTELS.filter((f) => f !== r.style.fill));
  return { ...r, style: { ...r.style, fill } };
}

/** Moves one whole room edge (two vertices) a few cm, so the room stays orthogonal. */
function nudgeRoomEdge(r: Room, home: Room, p: Pick): Room {
  const points = r.geometry.points;
  const i = p.which;
  const j = (i + 1) % 4;
  const axis: Axis = points[i].y === points[j].y ? 'y' : 'x';
  const delta = axis === 'y' ? p.dy : p.dx;
  const shift = near(points[i][axis] + delta, home.geometry.points[i][axis], 6) - points[i][axis];
  const moved = points.map((pt, k) => (k === i || k === j ? { ...pt, [axis]: pt[axis] + shift } : pt));
  return { ...r, geometry: { points: moved } };
}

// ---- furniture geometry

function halfExtents(g: Furniture['geometry']): { hw: number; hh: number } {
  const turned = Math.abs(Math.sin(g.rotation)) > 0.5;
  return { hw: (turned ? g.h : g.w) / 2, hh: (turned ? g.w : g.h) / 2 };
}

function overlaps(a: Furniture['geometry'], b: Furniture['geometry']): boolean {
  const [ea, eb] = [halfExtents(a), halfExtents(b)];
  return Math.abs(a.x - b.x) < ea.hw + eb.hw && Math.abs(a.y - b.y) < ea.hh + eb.hh;
}

/** Keeps a furniture item inside its room with some clearance from the walls. */
function fitInRoom(g: Furniture['geometry'], r: Rect): Furniture['geometry'] {
  const { hw, hh } = halfExtents(g);
  const x = clamp(g.x, r.x0 + hw + CLEARANCE, r.x1 - hw - CLEARANCE);
  const y = clamp(g.y, r.y0 + hh + CLEARANCE, r.y1 - hh - CLEARANCE);
  return { ...g, x: Math.round(x), y: Math.round(y) };
}

function withGeometry(f: Furniture, patch: Partial<Furniture['geometry']>, room: Rect): Furniture {
  return { ...f, geometry: fitInRoom({ ...f.geometry, ...patch }, room) };
}

function moveFurniture(f: Furniture, home: Furniture, p: Pick, room: Rect): Furniture {
  return withGeometry(f, {
    x: near(f.geometry.x + p.dx, home.geometry.x, MOVE_LIMIT),
    y: near(f.geometry.y + p.dy, home.geometry.y, MOVE_LIMIT),
  }, room);
}

function rotateFurniture(rng: Rng, f: Furniture, room: Rect): Furniture {
  const turns = [0, QUARTER, -QUARTER, Math.PI].filter((a) => a !== f.geometry.rotation);
  return withGeometry(f, { rotation: rng.pick(turns) }, room);
}

function resizeFurniture(f: Furniture, home: Furniture, p: Pick, room: Rect): Furniture {
  const { w, h } = home.geometry;
  return withGeometry(f, {
    w: Math.max(20, near(f.geometry.w + p.dx, w, w * 0.3)),
    h: Math.max(20, near(f.geometry.h + p.dy, h, h * 0.3)),
  }, room);
}

// ---------------------------------------------------------------- editor (live state walk)

interface Created { wall: number; room: number; furniture: number }

class Editor {
  readonly ops: Op[] = [];
  private readonly live: State = new Map();
  private readonly home = new Map<string, ModelObject>(); // baseline the edit limits refer to
  private readonly roomIndexOf = new Map<string, number>(); // room or furniture id -> ROOMS index
  private readonly softIds = new Set<string>(); // furniture allowed to overlap others
  private readonly materialsOf = new Map<string, string[]>();
  private readonly roomIds: (string | undefined)[] = ROOMS.map(() => undefined);
  private readonly wallPlan: Wall['geometry'][];
  private readonly pending: FurnitureSpec[][];
  private readonly replacements: { spec: FurnitureSpec; room: number }[] = [];
  private readonly created: Created = { wall: 0, room: 0, furniture: 0 };
  private readonly total: Created;
  private readonly nextIdNumber: Created = { wall: 0, room: 0, furniture: 0 };
  // Wall lines are planned at fixed coordinates but can be moved later. Objects
  // created afterwards must appear on the moved lines. Keys look like "x640".
  private readonly lineOffset = new Map<string, number>();
  private readonly lineKeyOf = new Map<string, string>(); // wall id -> planned line key

  constructor(private readonly rng: Rng) {
    this.wallPlan = planWalls(rng);
    this.pending = ROOMS.map((plan) => plan.items.map(toSpec));
    this.total = {
      wall: this.wallPlan.length,
      room: ROOMS.length,
      furniture: this.pending.reduce((sum, list) => sum + list.length, 0),
    };
  }

  step(slot: Slot): void {
    const day = (slot.ts - START) / DAY;
    if (slot.burstStart) slot.session.pick = null;
    if (this.tryCreate(slot, day)) return;

    let pick = slot.session.pick;
    if (!pick || !this.live.has(pick.id)) {
      pick = this.choosePick(slot, day);
      slot.session.pick = slot.inBurst ? pick : null;
    }
    if (pick) this.apply(pick, slot);
  }

  // ---- creation

  private isDue(type: PlanType, day: number): boolean {
    const { from, to } = PACE[type];
    const expected = Math.ceil(this.total[type] * clamp((day - from) / (to - from), 0, 1));
    return this.created[type] < expected;
  }

  private tryCreate(slot: Slot, day: number): boolean {
    if (!this.rng.chance(0.5)) return false;
    if (this.isDue('wall', day)) return this.createWall(slot);
    if (this.isDue('room', day)) return this.createRoom(slot);
    if (this.isDue('furniture', day)) return this.createPlannedFurniture(slot);
    if (this.replacements.length > 0) return this.createReplacement(slot);
    return false;
  }

  private nextId(type: PlanType): string {
    const prefix = { wall: 'w', room: 'r', furniture: 'f' }[type];
    this.nextIdNumber[type] += 1;
    return `${prefix}${this.nextIdNumber[type]}`;
  }

  private createWall(slot: Slot): boolean {
    const planned = this.wallPlan[this.created.wall];
    this.created.wall += 1;
    const geometry = { ...planned, a: this.placed(planned.a), b: this.placed(planned.b) };
    const wall: Wall = { id: this.nextId('wall'), type: 'wall', geometry, style: { stroke: WALL_STROKE } };
    this.lineKeyOf.set(wall.id, planned.a.y === planned.b.y ? `y${planned.a.y}` : `x${planned.a.x}`);
    this.commit(slot, null, wall);
    return true;
  }

  /** A planned point, moved along with any wall lines that were shifted already. */
  private placed(p: Vec): Vec {
    return { x: p.x + (this.lineOffset.get(`x${p.x}`) ?? 0), y: p.y + (this.lineOffset.get(`y${p.y}`) ?? 0) };
  }

  private createRoom(slot: Slot): boolean {
    const index = this.created.room;
    this.created.room += 1;
    const room: Room = {
      id: this.nextId('room'),
      type: 'room',
      geometry: { points: rectPoints(ROOMS[index].rect).map((p) => this.placed(p)) },
      style: { name: ROOMS[index].name, fill: NEUTRAL_FILL },
    };
    this.roomIds[index] = room.id;
    this.roomIndexOf.set(room.id, index);
    this.commit(slot, null, room);
    return true;
  }

  /** Furniture goes into the session's focus room while it has items left. */
  private createPlannedFurniture(slot: Slot): boolean {
    const open = ROOMS.map((_, i) => i).filter((i) => this.roomIds[i] && this.pending[i].length > 0);
    if (open.length === 0) return false;
    const room = open.includes(slot.session.focus) ? slot.session.focus : this.rng.pick(open);
    slot.session.focus = room;
    const spec = this.pending[room].shift()!;
    if (!this.createFurniture(slot, spec, room)) {
      this.pending[room].push(spec); // a moved neighbour is in the way; try again later
      return false;
    }
    this.created.furniture += 1;
    return true;
  }

  /** A deleted item is replaced by a fresh one at the same template spot, if free. */
  private createReplacement(slot: Slot): boolean {
    const { spec, room } = this.replacements.shift()!;
    this.createFurniture(slot, spec, room);
    return true;
  }

  private createFurniture(slot: Slot, spec: FurnitureSpec, room: number): boolean {
    const bounds = ROOMS[room].rect;
    const sets = MATERIAL_SETS[spec.mat];
    const item: Furniture = {
      id: this.nextId('furniture'),
      type: 'furniture',
      geometry: {
        x: bounds.x0 + spec.x,
        y: bounds.y0 + spec.y,
        w: spec.w,
        h: spec.h,
        rotation: spec.turns * QUARTER,
      },
      style: { name: spec.name, material: this.rng.pick(sets) },
    };
    if (this.blocked(item, room, spec.soft)) return false;
    this.roomIndexOf.set(item.id, room);
    this.materialsOf.set(item.id, sets);
    if (spec.soft) this.softIds.add(item.id);
    this.commit(slot, null, item);
    return true;
  }

  /** True if a non-soft item would overlap another non-soft item in its room. */
  private blocked(item: Furniture, room: number, soft: boolean): boolean {
    if (soft) return false;
    for (const other of this.live.values()) {
      if (other.type !== 'furniture' || other.id === item.id || this.softIds.has(other.id)) continue;
      if (this.roomIndexOf.get(other.id) === room && overlaps(item.geometry, other.geometry)) return true;
    }
    return false;
  }

  // ---- tweaks

  private liveByType(): Record<PlanType, ModelObject[]> {
    const groups: Record<PlanType, ModelObject[]> = { wall: [], room: [], furniture: [] };
    for (const obj of this.live.values()) groups[obj.type as PlanType].push(obj);
    return groups;
  }

  private choosePick(slot: Slot, day: number): Pick | null {
    const groups = this.liveByType();
    const types = typeWeights(day).filter(([type]) => groups[type].length > 0);
    if (types.length === 0) return null;
    const type = weighted(this.rng, types);

    const actions = ACTIONS[type].filter(([action]) =>
      (!slot.inBurst || REPEATABLE.has(action)) && (action !== 'delete' || day >= ADJUST_FROM_DAY));
    const step = () => this.stepSize(type, slot.inBurst);
    return {
      action: weighted(this.rng, actions),
      id: this.chooseTarget(groups[type], slot.session.focus).id,
      dx: step(),
      dy: step(),
      which: this.rng.int(0, 3),
    };
  }

  /** Bursts nudge by a few cm; single edits are bigger (walls 5-20 cm, room edges a few cm). */
  private stepSize(type: PlanType, burst: boolean): number {
    if (burst || type === 'room') return signedStep(this.rng, 1, 4);
    return type === 'wall' ? signedStep(this.rng, 5, 20) : signedStep(this.rng, 1, MOVE_LIMIT);
  }

  /** Prefer objects of the session's focus room, if it has any. */
  private chooseTarget(candidates: ModelObject[], focus: number): ModelObject {
    const inFocus = candidates.filter((o) => o.type === 'furniture' && this.roomIndexOf.get(o.id) === focus);
    return this.rng.pick(inFocus.length > 0 ? inFocus : candidates);
  }

  private apply(pick: Pick, slot: Slot): void {
    const before = this.live.get(pick.id)!;
    if (pick.action === 'delete') {
      this.commit(slot, before, null);
      this.queueReplacement(before as Furniture);
      return;
    }
    if (pick.action === 'wallMove') {
      this.moveWallRun(pick, slot);
      return;
    }
    let after = this.edit(pick, before);
    if (same(before, after)) {
      // Blocked by a limit: push the other way (keeps bursts alive).
      pick.dx = -pick.dx;
      pick.dy = -pick.dy;
      after = this.edit(pick, before);
    }
    if (!same(before, after)) this.commit(slot, before, after);
  }

  private queueReplacement(removed: Furniture): void {
    const room = this.roomIndexOf.get(removed.id)!;
    const spec = ROOMS[room].items.map(toSpec).find((s) => s.name === removed.style.name)!;
    this.replacements.push({ spec, room });
  }

  /** Returns the edited object, or `before` itself if the edit is not possible. */
  private edit(pick: Pick, before: ModelObject): ModelObject {
    const home = this.home.get(before.id)!;
    const roomIndex = this.roomIndexOf.get(before.id) ?? 0;
    const room = ROOMS[roomIndex];
    switch (pick.action) {
      case 'thickness': return changeThickness(this.rng, before as Wall);
      case 'wallLength': return this.changeWallLength(before as Wall, home as Wall, pick);
      case 'rename': return renameRoom(this.rng, before as Room, room);
      case 'fill': return recolorRoom(this.rng, before as Room);
      case 'edge': return nudgeRoomEdge(before as Room, home as Room, pick);
      case 'move': return this.unlessBlocked(before as Furniture, moveFurniture(before as Furniture, home as Furniture, pick, room.rect), roomIndex);
      case 'rotate': return this.unlessBlocked(before as Furniture, rotateFurniture(this.rng, before as Furniture, room.rect), roomIndex);
      case 'resize': return this.unlessBlocked(before as Furniture, resizeFurniture(before as Furniture, home as Furniture, pick, room.rect), roomIndex);
      case 'material': return this.changeMaterial(before as Furniture);
      default: return before;
    }
  }

  private unlessBlocked(before: Furniture, after: Furniture, room: number): Furniture {
    return this.blocked(after, room, this.softIds.has(after.id)) ? before : after;
  }

  private changeMaterial(f: Furniture): Furniture {
    const options = this.materialsOf.get(f.id)!.filter((m) => m !== f.style.material);
    return options.length === 0 ? f : { ...f, style: { ...f.style, material: this.rng.pick(options) } };
  }

  // ---- walls

  private liveOf<T extends ModelObject>(type: T['type']): T[] {
    return [...this.live.values()].filter((o): o is T => o.type === type);
  }

  /**
   * Moves a whole wall line sideways. Wall ends and room edges that sit on the
   * line follow it, so everything stays joined. Lines are 100+ cm apart, so
   * "sits on the line" is a simple distance test.
   */
  private moveWallRun(pick: Pick, slot: Slot): void {
    const wall = this.live.get(pick.id) as Wall;
    const axis: Axis = isHorizontal(wall) ? 'y' : 'x';
    const line = wall.geometry.a[axis];
    const key = this.lineKeyOf.get(wall.id)!;
    const offset = this.lineOffset.get(key) ?? 0; // how far the line is from its plan
    const limited = (wanted: number) => near(offset + wanted, 0, 15) - offset;
    let shift = limited(axis === 'y' ? pick.dy : pick.dx);
    if (shift === 0) {
      pick.dx = -pick.dx;
      pick.dy = -pick.dy;
      shift = limited(axis === 'y' ? pick.dy : pick.dx);
    }
    if (shift === 0) return;

    const walls = this.liveOf<Wall>('wall');
    const run = walls.filter((w) => this.lineKeyOf.get(w.id) === key);
    const others = walls.filter((w) => this.lineKeyOf.get(w.id) !== key);
    const rooms = this.liveOf<Room>('room');
    const onLine = (p: Vec) => Math.abs(p[axis] - line) <= WALL_TOL;

    for (const w of run) this.commit(slot, w, shiftWall(w, axis, shift));
    this.lineOffset.set(key, offset + shift);
    for (const w of others) this.stretchTouching(slot, w, onLine, axis, shift);
    for (const room of rooms) this.followRoom(slot, room, onLine, axis, shift);
  }

  private stretchTouching(slot: Slot, w: Wall, onLine: (p: Vec) => boolean, axis: Axis, shift: number): void {
    let next = w;
    let nextHome = this.home.get(w.id) as Wall;
    for (const end of ['a', 'b'] as const) {
      if (!onLine(w.geometry[end])) continue;
      next = shiftEnd(next, end, axis, shift);
      nextHome = shiftEnd(nextHome, end, axis, shift);
    }
    if (next === w) return;
    this.commit(slot, w, next);
    this.home.set(w.id, nextHome);
  }

  private followRoom(slot: Slot, room: Room, onLine: (p: Vec) => boolean, axis: Axis, shift: number): void {
    const move = (r: Room): Room => ({
      ...r,
      geometry: { points: r.geometry.points.map((p) => (onLine(p) ? { ...p, [axis]: p[axis] + shift } : p)) },
    });
    const next = move(room);
    if (same(room, next)) return;
    this.commit(slot, room, next);
    this.home.set(room.id, move(this.home.get(room.id) as Room));
  }

  /** Rare: a wall end slides a few cm along its axis, only where no wall continues it. */
  private changeWallLength(w: Wall, home: Wall, pick: Pick): Wall {
    const end: End = pick.which % 2 === 0 ? 'a' : 'b';
    const hasContinuation = this.liveOf<Wall>('wall').some(
      (o) => o.id !== w.id && isHorizontal(o) === isHorizontal(w) && ends(o).some((p) => joined(p, w.geometry[end])));
    if (hasContinuation) return w;
    const axis: Axis = isHorizontal(w) ? 'x' : 'y';
    const cur = w.geometry[end][axis];
    const wanted = near(cur + (axis === 'x' ? pick.dx : pick.dy), home.geometry[end][axis], 5);
    return shiftEnd(w, end, axis, wanted - cur);
  }

  // ---- output

  private commit(slot: Slot, before: ModelObject | null, after: ModelObject | null): void {
    const object = (after ?? before)!;
    this.ops.push({
      seq: this.ops.length + 1,
      ts: slot.ts,
      authorId: AUTHORS[slot.author].id,
      kind: before === null ? 'create' : after === null ? 'delete' : 'update',
      objectId: object.id,
      before,
      after,
    });
    if (after) this.live.set(after.id, after);
    else this.live.delete(object.id);
    if (before === null) this.home.set(object.id, object);
  }
}

// ---------------------------------------------------------------- named versions

const VERSION_DAYS: [name: string, day: number][] = [
  ['Walls agreed', 11],
  ['Room layout v1', 27],
  ['Client review', 46],
  ['Furniture v2', 60],
  ['Final for permit', LAST_DAY],
];

/**
 * Names the last op of each listed day (counted from `start`). The last op
 * before midnight always closes a session.
 */
export function nameVersions(ops: Op[], start: number, days: [name: string, day: number][]): NamedVersion[] {
  const versions: NamedVersion[] = [];
  for (const [name, day] of days) {
    const limit = start + (day + 1) * DAY;
    let seq = 0;
    for (const op of ops) if (op.ts < limit) seq = op.seq;
    if (seq > (versions.at(-1)?.seq ?? 0)) versions.push({ seq, name });
  }
  return versions;
}

export function generateDataset(seed = 1): Dataset {
  const rng = createRng(seed);
  const slots = buildSchedule(rng);
  const editor = new Editor(rng);
  for (const slot of slots) editor.step(slot);
  return {
    authors: AUTHORS.map((a) => ({ ...a })),
    ops: editor.ops,
    namedVersions: nameVersions(editor.ops, START, VERSION_DAYS),
  };
}
