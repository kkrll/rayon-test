// Synthetic edit history for one 3D device: the Nokia N97 mini (mm units).
//
// Same pipeline as the floor plan: (1) timestamped edit slots per author,
// (2) merged by time, (3) walked in order against one live Map, deciding each
// concrete edit from the current state and the project phase. The story:
// body blockout, hinge and display fitting, keyboard and details, then colour
// and finish exploration, and a final week that settles everything back onto
// the shipped design, so the last state is exactly the source model.

import { nameVersions } from './generator';
import { COLORWAYS, type FinishId, PARTS, type PartSpec, RIGS, type RigId } from './device';
import { createRng, type Rng, weighted } from './rng';
import type { Author, Dataset, Op, Part, State } from './types';

// ---------------------------------------------------------------- time

const START = Date.UTC(2026, 6, 6); // a Monday
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAST_DAY = 39; // Friday of week 6
const WORK_START = 9.5 * HOUR;
const WORK_END = 18.5 * HOUR;

/** Parts created by the end of a day: [day, count], linear in between. */
const CREATION_PACE: [day: number, count: number][] = [
  [0, 0], [4, 5], [8, 8], [14, 15], [18, 19], [24, 28], [27, PARTS.length],
];
const CMF_FROM = 18; // colour and finish exploration starts
const REDRAW_FROM = 20; // small parts get deleted and drawn again
const SETTLE_FROM = 38; // everything converges on the shipped design
const SETTLE_CHANCE = 0.35; // per slot, so settling spreads over the last days

const AUTHORS: Author[] = [
  { id: 'd1', name: 'Aino Virtanen', initials: 'AV', color: '#7a9cc6' },
  { id: 'd2', name: 'Kenji Mori', initials: 'KM', color: '#c68b77' },
  { id: 'd3', name: 'Ruth Adeyemi', initials: 'RA', color: '#8fae8b' },
];

const VERSION_DAYS: [name: string, day: number][] = [
  ['Shell blockout', 4],
  ['Display fitted', 14],
  ['Keyboard detailed', 18],
  ['CMF review', 31],
  ['Release candidate', LAST_DAY],
];

/** The shipped colourway: every part's own finish. */
const SHIPPED = 'chestnut';
const COLORWAY_NAMES = [...Object.keys(COLORWAYS), SHIPPED];

// ---------------------------------------------------------------- schedule

interface Session {
  colorway: string;
  pick: Pick | null; // current burst target
}

interface Slot {
  ts: number;
  author: number;
  session: Session;
  burstStart: boolean;
  inBurst: boolean;
}

/** Bursts: many small edits seconds apart. Slow: one edit every 1-8 minutes. */
function buildSession(rng: Rng, author: number, start: number, end: number): Slot[] {
  const session: Session = { colorway: rng.pick(COLORWAY_NAMES), pick: null };
  const slots: Slot[] = [];
  let t = start;
  const push = (burstStart: boolean, inBurst: boolean) => slots.push({ ts: t, author, session, burstStart, inBurst });

  while (t < end) {
    if (rng.chance(0.3)) {
      const size = rng.int(3, 12);
      for (let i = 0; i < size && t < end; i++) {
        push(i === 0, true);
        t += rng.int(3, 20) * SECOND;
      }
      t += rng.int(30, 180) * SECOND;
    } else {
      push(true, false);
      t += rng.int(60, 480) * SECOND;
    }
  }
  return slots;
}

function buildSchedule(rng: Rng): Slot[] {
  const slots: Slot[] = [];
  for (let day = 0; day <= LAST_DAY; day++) {
    if (day % 7 >= 5) continue;
    const edgeDay = day === 0 || day === LAST_DAY;
    for (let author = 0; author < AUTHORS.length; author++) {
      if (!edgeDay && rng.chance(0.25)) continue;
      const dayEnd = START + day * DAY + WORK_END;
      let start = START + day * DAY + WORK_START + rng.int(0, 120) * MINUTE;
      for (let i = rng.int(1, 3); i > 0 && start < dayEnd - 20 * MINUTE; i--) {
        const end = Math.min(start + rng.int(15, 35) * MINUTE, dayEnd);
        slots.push(...buildSession(rng, author, start, end));
        start = end + rng.int(40, 150) * MINUTE;
      }
    }
  }
  return slots.sort((a, b) => a.ts - b.ts || a.author - b.author);
}

// ---------------------------------------------------------------- edits

type Action = 'move' | 'restyle' | 'redraw';

/** A move keeps its rig and direction for a whole burst; a restyle its colourway. */
interface Pick { action: Action; rig: RigId; direction: number }

const MOVABLE = (Object.keys(RIGS) as RigId[]).filter((rig) => RIGS[rig].axis !== null);

function actionWeights(day: number): [Action, number][] {
  const move = day < 14 ? 0.6 : day < 26 ? 0.15 : 0.05;
  const restyle = day < CMF_FROM ? 0.1 : 0.7;
  const redraw = day >= REDRAW_FROM ? 0.05 : 0;
  return [['move', move], ['restyle', restyle], ['redraw', redraw]];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

class Editor {
  readonly ops: Op[] = [];
  private readonly live: State = new Map();
  private readonly specOf = new Map<string, PartSpec>(); // part id -> spec
  private readonly offset: Record<RigId, number> = { body: 0, display: 0, hinge: 0, keyboard: 0, camera: 0 };
  private readonly redrawn: PartSpec[] = []; // deleted, waiting to be drawn again
  private created = 0;
  private nextId = 0;

  constructor(private readonly rng: Rng) {}

  step(slot: Slot): void {
    const day = (slot.ts - START) / DAY;
    if (slot.burstStart) slot.session.pick = null;
    if (day >= SETTLE_FROM) {
      if (this.rng.chance(SETTLE_CHANCE)) this.settle(slot);
      return;
    }
    if (this.tryCreate(slot, day)) return;

    let pick = slot.session.pick;
    if (!pick) {
      pick = this.choosePick(day);
      slot.session.pick = slot.inBurst ? pick : null;
    }
    if (pick.action === 'move') this.nudge(slot, pick);
    else if (pick.action === 'restyle') this.restyle(slot, slot.session);
    else this.redraw(slot);
  }

  /** True once nothing differs from the shipped design. */
  get settled(): boolean {
    return this.created === PARTS.length && this.redrawn.length === 0 && this.unsettledRig() === null &&
      this.unsettledPart() === null;
  }

  /** One step towards the shipped design: rigs home, finishes back, parts redrawn. */
  settle(slot: Slot): void {
    if (this.created < PARTS.length) {
      this.createPart(slot, PARTS[this.created++]);
      return;
    }
    const rig = this.unsettledRig();
    if (rig) {
      this.moveRig(slot, rig, -this.offset[rig]);
      return;
    }
    const part = this.unsettledPart();
    if (part) {
      this.setFinish(slot, part, this.specOf.get(part.id)!.finish);
      return;
    }
    if (this.redrawn.length > 0) this.createPart(slot, this.redrawn.shift()!);
  }

  private unsettledRig(): RigId | null {
    return MOVABLE.find((rig) => this.offset[rig] !== 0) ?? null;
  }

  private unsettledPart(): Part | null {
    for (const obj of this.live.values()) {
      if (obj.type === 'part' && obj.style.finish !== this.specOf.get(obj.id)!.finish) return obj;
    }
    return null;
  }

  // ---- creation

  private tryCreate(slot: Slot, day: number): boolean {
    if (!this.rng.chance(0.5)) return false;
    if (this.created < this.dueBy(day)) {
      this.createPart(slot, PARTS[this.created++]);
      return true;
    }
    if (this.redrawn.length > 0 && this.rng.chance(0.5)) {
      this.createPart(slot, this.redrawn.shift()!);
      return true;
    }
    return false;
  }

  private dueBy(day: number): number {
    for (let i = 1; i < CREATION_PACE.length; i++) {
      const [d1, c1] = CREATION_PACE[i];
      if (day > d1) continue;
      const [d0, c0] = CREATION_PACE[i - 1];
      return Math.ceil(c0 + ((c1 - c0) * (day - d0)) / (d1 - d0));
    }
    return PARTS.length;
  }

  /** New parts appear where their rig currently is, in their own finish. */
  private createPart(slot: Slot, spec: PartSpec): void {
    this.nextId += 1;
    const part: Part = {
      id: `p${this.nextId}`,
      type: 'part',
      geometry: { source: spec.source, offset: this.rigOffset(spec.rig) },
      style: { name: spec.name, assembly: spec.assembly, finish: spec.finish },
    };
    this.specOf.set(part.id, spec);
    this.commit(slot, null, part);
  }

  private rigOffset(rig: RigId) {
    const offset = { x: 0, y: 0, z: 0 };
    const axis = RIGS[rig].axis;
    if (axis) offset[axis] = this.offset[rig];
    return offset;
  }

  // ---- tweaks

  private choosePick(day: number): Pick {
    const rigs = MOVABLE.filter((rig) => this.partsOf(rig).length > 0);
    const actions = actionWeights(day).filter(([action]) => action !== 'move' || rigs.length > 0);
    const action = weighted(this.rng, actions);
    return {
      action,
      rig: rigs.length > 0 ? this.rng.pick(rigs) : 'display',
      direction: this.rng.chance(0.5) ? 1 : -1,
    };
  }

  private partsOf(rig: RigId): Part[] {
    const parts: Part[] = [];
    for (const obj of this.live.values()) {
      if (obj.type === 'part' && this.specOf.get(obj.id)!.rig === rig) parts.push(obj);
    }
    return parts;
  }

  /** Bursts nudge by tenths of a millimetre; single edits by up to 1.5 mm. */
  private nudge(slot: Slot, pick: Pick): void {
    const step = slot.inBurst ? this.rng.int(1, 4) / 10 : this.rng.int(5, 15) / 10;
    const { limit } = RIGS[pick.rig];
    const limited = () => round1(Math.max(-limit, Math.min(limit, this.offset[pick.rig] + pick.direction * step)));
    let target = limited();
    if (target === this.offset[pick.rig]) {
      pick.direction = -pick.direction; // at the limit: come back (keeps bursts alive)
      target = limited();
    }
    this.moveRig(slot, pick.rig, round1(target - this.offset[pick.rig]));
  }

  /** Moves every part of a rig together: one op per part, same timestamp. */
  private moveRig(slot: Slot, rig: RigId, delta: number): void {
    const axis = RIGS[rig].axis;
    if (!axis || delta === 0) return;
    this.offset[rig] = round1(this.offset[rig] + delta);
    for (const part of this.partsOf(rig)) {
      const offset = { ...part.geometry.offset, [axis]: this.offset[rig] };
      this.commit(slot, part, { ...part, geometry: { ...part.geometry, offset } });
    }
  }

  /** Applies the session's colourway to one more part; picks another when done. */
  private restyle(slot: Slot, session: Session): void {
    for (let tries = 0; tries < COLORWAY_NAMES.length; tries++) {
      const candidates = [...this.live.values()].filter(
        (o): o is Part => o.type === 'part' && o.style.finish !== this.finishIn(session.colorway, o));
      if (candidates.length > 0) {
        const part = this.rng.pick(candidates);
        this.setFinish(slot, part, this.finishIn(session.colorway, part));
        return;
      }
      session.colorway = this.rng.pick(COLORWAY_NAMES.filter((c) => c !== session.colorway));
    }
  }

  private finishIn(colorway: string, part: Part): FinishId {
    const spec = this.specOf.get(part.id)!;
    return (colorway !== SHIPPED && COLORWAYS[colorway][spec.name]) || spec.finish;
  }

  private setFinish(slot: Slot, part: Part, finish: FinishId): void {
    this.commit(slot, part, { ...part, style: { ...part.style, finish } });
  }

  /** Deletes a small part; it is drawn again (a new object) a little later. */
  private redraw(slot: Slot): void {
    const candidates = [...this.live.values()].filter(
      (o): o is Part => o.type === 'part' && !!this.specOf.get(o.id)!.replaceable);
    if (candidates.length === 0) return;
    const part = this.rng.pick(candidates);
    this.commit(slot, part, null);
    this.redrawn.push(this.specOf.get(part.id)!);
  }

  // ---- output

  private commit(slot: Slot, before: Part | null, after: Part | null): void {
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
  }
}

export function generateDeviceDataset(seed = 1): Dataset {
  const rng = createRng(seed);
  const slots = buildSchedule(rng);
  const editor = new Editor(rng);
  for (const slot of slots) editor.step(slot);

  // Whatever the last days left open is settled by the last author, seconds apart.
  const last = slots[slots.length - 1];
  for (let i = 1; !editor.settled; i++) editor.settle({ ...last, ts: last.ts + i * 5 * SECOND });

  return {
    authors: AUTHORS.map((a) => ({ ...a })),
    ops: editor.ops,
    namedVersions: nameVersions(editor.ops, START, VERSION_DAYS),
  };
}
