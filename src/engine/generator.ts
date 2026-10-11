// Synthetic edit history for one apartment floor plan (cm units).
//
// Pipeline: (1) build a schedule of timestamped edit slots per author,
// (2) merge all slots by time, (3) walk them in order against one live Map and
// decide each concrete edit from the current state, the project phase and the
// session's "focus" room. `before` therefore always comes from live state.

import { createRng, type Rng } from './rng';
import type {
  Author, Dataset, Furniture, ModelObject, NamedVersion, ObjectType, Op, Room, State, Vec, Wall,
} from './types';

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

// oak, walnut, linen, concrete, terracotta, sage, charcoal, white
const MATERIALS = ['#c8a165', '#6b4a33', '#e6dccb', '#9a9a96', '#b8664a', '#9caf88', '#3f4448', '#f2efe9'];
const PASTELS = ['#f4d9d0', '#d9e8d4', '#d6e4f0', '#f3ecc9', '#e6d9ee', '#f2dfc8', '#d4ebe6', '#efd5e0'];
const NEUTRAL_FILL = '#e8e8e8';
const WALL_STROKE = '#3a3a3a';

const PLAN_W = 1800;
const PLAN_H = 1200;
const MAX_WALL = 450; // longer runs are drawn as several wall objects
const EXTERIOR_THICKNESS = [24, 25, 26];
const INTERIOR_THICKNESS = [10, 11, 12];
const QUARTER = Math.PI / 2;

interface Rect { x0: number; y0: number; x1: number; y1: number }
type FurnitureTuple = [name: string, w: number, h: number, count?: number];
interface FurnitureSpec { name: string; w: number; h: number }
interface RoomPlan { name: string; aka: string; rect: Rect; furniture: FurnitureTuple[] }

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

const ROOMS: RoomPlan[] = [
  { name: 'Living', aka: 'Living room', rect: rect(0, 0, 640, 620), furniture: [
    ['Sofa', 220, 90], ['Armchair', 90, 90, 2], ['Coffee table', 120, 60], ['TV unit', 180, 40],
    ['Rug', 240, 170], ['Bookshelf', 120, 35, 2], ['Side table', 50, 50]] },
  { name: 'Dining', aka: 'Dining area', rect: rect(640, 0, 1040, 620), furniture: [
    ['Dining table', 180, 90], ['Chair', 45, 45, 6], ['Sideboard', 160, 45], ['Rug', 240, 160]] },
  { name: 'Kitchen', aka: 'Kitchenette', rect: rect(1040, 0, 1440, 620), furniture: [
    ['Kitchen counter', 300, 60], ['Fridge', 70, 70], ['Kitchen island', 180, 80],
    ['Stool', 40, 40, 3], ['Pantry cabinet', 60, 60]] },
  { name: 'Study', aka: 'Home office', rect: rect(1440, 0, 1800, 620), furniture: [
    ['Desk', 160, 80], ['Office chair', 60, 60], ['Bookshelf', 120, 35, 2],
    ['Filing cabinet', 50, 60], ['Sofa bed', 190, 90]] },
  { name: 'Bedroom', aka: 'Master bedroom', rect: rect(0, 620, 400, 1200), furniture: [
    ['Bed', 160, 200], ['Nightstand', 45, 40, 2], ['Wardrobe', 200, 60], ['Dresser', 120, 50], ['Rug', 200, 140]] },
  { name: 'Bedroom 2', aka: 'Guest room', rect: rect(400, 620, 800, 1200), furniture: [
    ['Bed', 140, 200], ['Nightstand', 45, 40], ['Wardrobe', 160, 60], ['Desk', 120, 60], ['Rug', 180, 120]] },
  { name: 'Hall', aka: 'Entrance', rect: rect(800, 620, 1040, 1200), furniture: [
    ['Shoe rack', 90, 35], ['Coat rack', 100, 30], ['Console', 100, 30], ['Bench', 100, 40],
    ['Mirror', 60, 10], ['Runner rug', 80, 200]] },
  { name: 'Bathroom', aka: 'Bath', rect: rect(1040, 620, 1340, 1200), furniture: [
    ['Bathtub', 170, 75], ['Washbasin', 60, 45], ['Toilet', 40, 70], ['Washing machine', 60, 60], ['Towel shelf', 60, 30]] },
  { name: 'WC', aka: 'Toilet', rect: rect(1340, 620, 1560, 1200), furniture: [
    ['Toilet', 40, 70], ['Washbasin', 40, 30], ['Shelf', 60, 20]] },
  { name: 'Storage', aka: 'Utility', rect: rect(1560, 620, 1800, 900), furniture: [
    ['Shelving', 100, 40, 3], ['Storage box', 60, 40, 2]] },
  { name: 'Balcony', aka: 'Terrace', rect: rect(1560, 900, 1800, 1200), furniture: [
    ['Lounge chair', 70, 60, 2], ['Bistro table', 60, 60], ['Planter', 80, 30, 3]] },
];

const DECOR: FurnitureTuple[] = [
  ['Plant', 40, 40], ['Floor lamp', 35, 35], ['Pouf', 50, 50],
  ['Storage box', 60, 40], ['Side table', 50, 50], ['Wall shelf', 100, 25],
];

// ---------------------------------------------------------------- small helpers

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const same = (a: ModelObject, b: ModelObject) => JSON.stringify(a) === JSON.stringify(b);

function weighted<T>(rng: Rng, entries: [T, number][]): T {
  let r = rng.next() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of entries) {
    r -= w;
    if (r < 0) return value;
  }
  return entries[entries.length - 1][0];
}

function signedStep(rng: Rng, max: number): number {
  return rng.int(1, max) * (rng.chance(0.5) ? 1 : -1);
}

function expandFurniture(tuples: FurnitureTuple[]): FurnitureSpec[] {
  return tuples.flatMap(([name, w, h, count = 1]) => Array.from({ length: count }, () => ({ name, w, h })));
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
  if (day < 14) return 0.2;
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
    const end = Math.min(start + rng.int(15, 52) * MINUTE, dayEnd);
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
  | 'wallEnd' | 'thickness'
  | 'rename' | 'fill' | 'vertex'
  | 'move' | 'rotate' | 'resize' | 'material' | 'delete';

/** A chosen edit. dx/dy are generic deltas; `which` picks an endpoint or vertex. */
interface Pick { action: Action; id: string; dx: number; dy: number; which: number }

const ACTIONS: Record<ObjectType, [Action, number][]> = {
  wall: [['wallEnd', 0.75], ['thickness', 0.25]],
  room: [['rename', 0.3], ['fill', 0.4], ['vertex', 0.3]],
  furniture: [['move', 0.55], ['rotate', 0.12], ['resize', 0.13], ['material', 0.15], ['delete', 0.05]],
};
// Only these make sense as a burst of repeated nudges on one object.
const REPEATABLE = new Set<Action>(['wallEnd', 'vertex', 'move', 'resize']);

function typeWeights(day: number): [ObjectType, number][] {
  if (day < 8) return [['wall', 1]];
  if (day < 21) return [['wall', 0.25], ['room', 0.75]];
  return [['wall', 0.05], ['room', 0.1], ['furniture', 0.85]];
}

// Edits stay near the original design so repeated nudging cannot drift away.
const near = (v: number, home: number, limit: number) => clamp(v, home - limit, home + limit);

function nudgeWallEnd(w: Wall, home: Wall, p: Pick): Wall {
  const end = p.which % 2 === 0 ? 'a' : 'b';
  const cur = w.geometry[end];
  const h = home.geometry[end];
  const moved = { x: near(cur.x + p.dx, h.x, 15), y: near(cur.y + p.dy, h.y, 15) };
  return { ...w, geometry: { ...w.geometry, [end]: moved } };
}

function changeThickness(rng: Rng, w: Wall): Wall {
  const options = w.geometry.thickness >= 20 ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS;
  const thickness = rng.pick(options.filter((t) => t !== w.geometry.thickness));
  return { ...w, geometry: { ...w.geometry, thickness } };
}

function renameRoom(rng: Rng, r: Room, plan: RoomPlan): Room {
  const isPlaceholder = r.style.name.startsWith('Room ');
  const name = isPlaceholder ? plan.name : r.style.name === plan.name ? plan.aka : plan.name;
  return { ...r, style: { ...r.style, name: rng.chance(0.1) ? plan.aka : name } };
}

function recolorRoom(rng: Rng, r: Room): Room {
  const fill = rng.pick(PASTELS.filter((f) => f !== r.style.fill));
  return { ...r, style: { ...r.style, fill } };
}

function nudgeRoomVertex(r: Room, home: Room, p: Pick): Room {
  const i = p.which;
  const cur = r.geometry.points[i];
  const h = home.geometry.points[i];
  const moved = { x: near(cur.x + p.dx, h.x, 20), y: near(cur.y + p.dy, h.y, 20) };
  return { ...r, geometry: { points: r.geometry.points.map((pt, k) => (k === i ? moved : pt)) } };
}

/** Keeps a furniture item fully inside its room, allowing for 90 degree turns. */
function fitInRoom(g: Furniture['geometry'], r: Rect): Furniture['geometry'] {
  const turned = Math.abs(Math.sin(g.rotation)) > 0.5;
  const hw = (turned ? g.h : g.w) / 2 + 10;
  const hh = (turned ? g.w : g.h) / 2 + 10;
  return { ...g, x: Math.round(clamp(g.x, r.x0 + hw, r.x1 - hw)), y: Math.round(clamp(g.y, r.y0 + hh, r.y1 - hh)) };
}

function withGeometry(f: Furniture, patch: Partial<Furniture['geometry']>, room: Rect): Furniture {
  return { ...f, geometry: fitInRoom({ ...f.geometry, ...patch }, room) };
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

function changeMaterial(rng: Rng, f: Furniture): Furniture {
  const material = rng.pick(MATERIALS.filter((m) => m !== f.style.material));
  return { ...f, style: { ...f.style, material } };
}

// ---------------------------------------------------------------- editor (live state walk)

interface Created { wall: number; room: number; furniture: number }

class Editor {
  readonly ops: Op[] = [];
  private readonly live: State = new Map();
  private readonly home = new Map<string, ModelObject>(); // as first created
  private readonly roomIndexOf = new Map<string, number>(); // room or furniture id -> ROOMS index
  private readonly roomIds: (string | undefined)[] = ROOMS.map(() => undefined);
  private readonly wallPlan: Wall['geometry'][];
  private readonly pending: FurnitureSpec[][];
  private readonly replacements: { spec: FurnitureSpec; room: number }[] = [];
  private readonly created: Created = { wall: 0, room: 0, furniture: 0 };
  private readonly total: Created;
  private readonly nextIdNumber: Created = { wall: 0, room: 0, furniture: 0 };

  constructor(private readonly rng: Rng) {
    this.wallPlan = planWalls(rng);
    this.pending = ROOMS.map((plan) => [...expandFurniture(plan.furniture), ...this.pickDecor(plan)]);
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

  private pickDecor(plan: RoomPlan): FurnitureSpec[] {
    const { x0, y0, x1, y1 } = plan.rect;
    const count = Math.round(((x1 - x0) * (y1 - y0)) / 60000);
    return expandFurniture(Array.from({ length: count }, () => this.rng.pick(DECOR)));
  }

  private isDue(type: ObjectType, day: number): boolean {
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

  private nextId(type: ObjectType): string {
    const prefix = { wall: 'w', room: 'r', furniture: 'f' }[type];
    this.nextIdNumber[type] += 1;
    return `${prefix}${this.nextIdNumber[type]}`;
  }

  private createWall(slot: Slot): boolean {
    const geometry = this.wallPlan[this.created.wall];
    this.created.wall += 1;
    this.commit(slot, null, { id: this.nextId('wall'), type: 'wall', geometry, style: { stroke: WALL_STROKE } });
    return true;
  }

  private createRoom(slot: Slot): boolean {
    const index = this.created.room;
    this.created.room += 1;
    const room: Room = {
      id: this.nextId('room'),
      type: 'room',
      geometry: { points: rectPoints(ROOMS[index].rect) },
      style: { name: `Room ${index + 1}`, fill: NEUTRAL_FILL },
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
    this.created.furniture += 1;
    this.createFurniture(slot, this.pending[room].shift()!, room);
    return true;
  }

  private createReplacement(slot: Slot): boolean {
    const { spec, room } = this.replacements.shift()!;
    this.createFurniture(slot, spec, room);
    return true;
  }

  private createFurniture(slot: Slot, spec: FurnitureSpec, room: number): void {
    const bounds = ROOMS[room].rect;
    const rotation = this.rng.pick([0, 0, 0, 0, QUARTER, -QUARTER, Math.PI]);
    const geometry = fitInRoom({
      x: this.rng.range(bounds.x0, bounds.x1),
      y: this.rng.range(bounds.y0, bounds.y1),
      w: spec.w,
      h: spec.h,
      rotation,
    }, bounds);
    const item: Furniture = {
      id: this.nextId('furniture'),
      type: 'furniture',
      geometry,
      style: { name: spec.name, material: this.rng.pick(MATERIALS) },
    };
    this.roomIndexOf.set(item.id, room);
    this.commit(slot, null, item);
  }

  // ---- tweaks

  private liveByType(): Record<ObjectType, ModelObject[]> {
    const groups: Record<ObjectType, ModelObject[]> = { wall: [], room: [], furniture: [] };
    for (const obj of this.live.values()) groups[obj.type].push(obj);
    return groups;
  }

  private choosePick(slot: Slot, day: number): Pick | null {
    const groups = this.liveByType();
    const types = typeWeights(day).filter(([type]) => groups[type].length > 0);
    if (types.length === 0) return null;
    const type = weighted(this.rng, types);

    const actions = ACTIONS[type].filter(([action]) =>
      (!slot.inBurst || REPEATABLE.has(action)) && (action !== 'delete' || day >= ADJUST_FROM_DAY));
    const step = slot.inBurst ? 4 : 30;
    return {
      action: weighted(this.rng, actions),
      id: this.chooseTarget(groups[type], slot.session.focus).id,
      dx: signedStep(this.rng, step),
      dy: signedStep(this.rng, step),
      which: this.rng.int(0, 3),
    };
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
    const home = this.home.get(removed.id) as Furniture;
    const spec = { name: removed.style.name, w: home.geometry.w, h: home.geometry.h };
    this.replacements.push({ spec, room: this.roomIndexOf.get(removed.id)! });
  }

  private edit(pick: Pick, before: ModelObject): ModelObject {
    const home = this.home.get(before.id)!;
    const room = ROOMS[this.roomIndexOf.get(before.id) ?? 0];
    switch (pick.action) {
      case 'wallEnd': return nudgeWallEnd(before as Wall, home as Wall, pick);
      case 'thickness': return changeThickness(this.rng, before as Wall);
      case 'rename': return renameRoom(this.rng, before as Room, room);
      case 'fill': return recolorRoom(this.rng, before as Room);
      case 'vertex': return nudgeRoomVertex(before as Room, home as Room, pick);
      case 'move': return withGeometry(before as Furniture, {
        x: (before as Furniture).geometry.x + pick.dx,
        y: (before as Furniture).geometry.y + pick.dy,
      }, room.rect);
      case 'rotate': return rotateFurniture(this.rng, before as Furniture, room.rect);
      case 'resize': return resizeFurniture(before as Furniture, home as Furniture, pick, room.rect);
      case 'material': return changeMaterial(this.rng, before as Furniture);
      default: return before;
    }
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

/** The last op before midnight of a day always closes a session. */
function nameVersions(ops: Op[]): NamedVersion[] {
  const versions: NamedVersion[] = [];
  for (const [name, day] of VERSION_DAYS) {
    const limit = START + (day + 1) * DAY;
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
    namedVersions: nameVersions(editor.ops),
  };
}
