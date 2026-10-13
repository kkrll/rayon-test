// Synthetic edit history for four 3D letters, A B C D, each becoming its own
// material study: chiselled stone, iridescent glass, chrome tubes and carved
// dark stone.
//
// Same pipeline as the floor plan: (1) timestamped edit slots per author,
// (2) merged by time, (3) walked in order against one live Map. The story:
// four clay letters are blocked out and laid out, their forms explored, then
// materials tried on each; a letter gets redrawn on the way, and the last days
// settle everything onto the final design, so the last state is exactly DESIGN.

import { nameVersions } from './generator';
import { createRng, type Rng, weighted } from './rng';
import type { Author, Dataset, Letter, LetterMaterial, Op, State } from './types';

// ---------------------------------------------------------------- time

const START = Date.UTC(2026, 8, 7); // a Monday
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAST_DAY = 25; // Friday of week 4
const WORK_START = 9.5 * HOUR;
const WORK_END = 18.5 * HOUR;

const FORM_FROM = 5; // depth and bevel exploration
const MATERIAL_FROM = 9; // materials, colours and texture strength
const REDRAW_DAYS: [number, number] = [13, 17]; // one letter is deleted and drawn again
const SETTLE_FROM = 23; // everything converges on DESIGN
const SETTLE_CHANCE = 0.4;

// ---------------------------------------------------------------- static data

const AUTHORS: Author[] = [
  { id: 'l1', name: 'Mira Castell', initials: 'MC', color: '#8fae8b' },
  { id: 'l2', name: 'Theo Lund', initials: 'TL', color: '#c68b77' },
  { id: 'l3', name: 'Ines Duarte', initials: 'ID', color: '#7a9cc6' },
  { id: 'l4', name: 'Sam Okafor', initials: 'SO', color: '#b49ac8' },
];

/** Each author mostly works on "their" letter (same index), sometimes on the others. */
const OWN_LETTER_CHANCE = 0.7;

export const CHARS = ['A', 'B', 'C', 'D'] as const;

type Shape = Letter['geometry'];
type Look = Omit<Letter['style'], 'name'>;

/** Where the project ends up: what each letter is meant to be. */
export const DESIGN: Record<string, Shape & Look> = {
  A: { position: { x: -1.9, y: 0, z: 0.12 }, rotation: -12, depth: 0.42, bevel: 0.02, material: 'stone', color: '#c9c6c0', detail: 0.7 },
  B: { position: { x: -0.62, y: 0, z: -0.08 }, rotation: 7, depth: 0.34, bevel: 0.1, material: 'glass', color: '#ffffff', detail: 0.3 },
  C: { position: { x: 0.62, y: 0, z: 0.1 }, rotation: -5, depth: 0.3, bevel: 0, material: 'chrome', color: '#d8dde3', detail: 0.6 },
  D: { position: { x: 1.9, y: 0, z: -0.12 }, rotation: 10, depth: 0.46, bevel: 0.06, material: 'carved', color: '#3b3936', detail: 0.55 },
};

/** Colours tried per material; the first is where a letter starts in it. */
const PALETTE: Record<LetterMaterial, string[]> = {
  clay: ['#d9cfc4', '#c9b8a6', '#e4ddd3'],
  stone: ['#c9c6c0', '#b8b4ad', '#d6d2ca'],
  glass: ['#ffffff', '#dff1ff', '#f0e6ff'],
  chrome: ['#d8dde3', '#c9a86b', '#9fb3c8'],
  carved: ['#3b3936', '#4a4744', '#2f2d2b'],
};
const MATERIALS = Object.keys(PALETTE) as LetterMaterial[];

/** Moves stay within a letter's own slot (around its designed spot), so letters never collide. */
const LIMITS = { x: 0.35, z: 0.45, rotation: 35, depth: [0.14, 0.6], bevel: [0, 0.12], detail: [0, 1] } as const;

const VERSION_DAYS: [name: string, day: number][] = [
  ['Clay blockout', 4],
  ['Forms', 8],
  ['Material pass', 16],
  ['Final', LAST_DAY],
];

// ---------------------------------------------------------------- schedule

interface Session {
  focus: string; // the letter this session is about
  idea: LetterMaterial; // the material it tries
  pick: Action | null; // current burst's action
  direction: number;
}

interface Slot {
  ts: number;
  author: number;
  session: Session;
  burstStart: boolean;
  inBurst: boolean;
}

function buildSession(rng: Rng, author: number, start: number, end: number): Slot[] {
  const focus = rng.chance(OWN_LETTER_CHANCE) ? CHARS[author] : rng.pick(CHARS);
  const session: Session = { focus, idea: rng.pick(MATERIALS.slice(1)), pick: null, direction: 1 };
  const slots: Slot[] = [];
  let t = start;
  const push = (burstStart: boolean, inBurst: boolean) => slots.push({ ts: t, author, session, burstStart, inBurst });

  while (t < end) {
    if (rng.chance(0.35)) {
      // A drag or a slider: many small edits seconds apart.
      const size = rng.int(4, 14);
      for (let i = 0; i < size && t < end; i++) {
        push(i === 0, true);
        t += rng.int(2, 12) * SECOND;
      }
      t += rng.int(30, 180) * SECOND;
    } else {
      push(true, false);
      t += rng.int(60, 420) * SECOND;
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
      if (!edgeDay && rng.chance(0.3)) continue;
      const dayEnd = START + day * DAY + WORK_END;
      let start = START + day * DAY + WORK_START + rng.int(0, 150) * MINUTE;
      for (let i = rng.int(1, 3); i > 0 && start < dayEnd - 20 * MINUTE; i--) {
        const end = Math.min(start + rng.int(12, 30) * MINUTE, dayEnd);
        slots.push(...buildSession(rng, author, start, end));
        start = end + rng.int(40, 150) * MINUTE;
      }
    }
  }
  return slots.sort((a, b) => a.ts - b.ts || a.author - b.author);
}

// ---------------------------------------------------------------- edits

type Action = 'move' | 'rotate' | 'reshape' | 'material' | 'detail';

function actionWeights(day: number): [Action, number][] {
  const form = day >= FORM_FROM;
  const material = day >= MATERIAL_FROM;
  return [
    ['move', material ? 0.12 : form ? 0.2 : 0.55],
    ['rotate', material ? 0.08 : form ? 0.15 : 0.35],
    ['reshape', material ? 0.2 : form ? 0.6 : 0.1],
    ['material', material ? 0.3 : 0.02],
    ['detail', material ? 0.3 : 0],
  ];
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));
/** Rounded to the grid edits snap to, without float noise. */
const snap = (v: number, step: number) => Number(round(v, step).toFixed(4));

class Editor {
  readonly ops: Op[] = [];
  private readonly live: State = new Map();
  /** Letter char -> object id; a redrawn letter gets a new id. */
  private readonly idOf = new Map<string, string>();
  private redrawn: string | null = null; // deleted, waiting to be drawn again
  private redrawDone = false;
  private nextId = 0;

  constructor(private readonly rng: Rng) {}

  step(slot: Slot): void {
    const day = (slot.ts - START) / DAY;
    if (slot.burstStart) slot.session.pick = null;

    if (this.idOf.size < CHARS.length && !this.redrawn) {
      this.create(slot, CHARS[this.idOf.size]);
      return;
    }
    if (day >= SETTLE_FROM) {
      if (this.rng.chance(SETTLE_CHANCE)) this.settle(slot);
      return;
    }
    if (this.redrawn && this.rng.chance(0.3)) {
      this.create(slot, this.redrawn, true);
      this.redrawn = null;
      return;
    }
    if (!this.redrawDone && day >= REDRAW_DAYS[0] && day < REDRAW_DAYS[1] && this.rng.chance(0.02)) {
      this.redraw(slot);
      return;
    }

    const letter = this.letter(slot.session.focus);
    if (!letter) return; // the focused letter is being redrawn
    let pick = slot.session.pick;
    if (!pick) {
      pick = weighted(this.rng, actionWeights(day));
      slot.session.direction = this.rng.chance(0.5) ? 1 : -1;
      slot.session.pick = slot.inBurst ? pick : null;
    }
    this.tweak(slot, letter, pick);
  }

  get settled(): boolean {
    return this.idOf.size === CHARS.length && !this.redrawn && CHARS.every((c) => this.settleEdit(this.letter(c)!) === null);
  }

  /** One step towards DESIGN, letter by letter. */
  settle(slot: Slot): void {
    if (this.redrawn) {
      this.create(slot, this.redrawn, true);
      this.redrawn = null;
      return;
    }
    for (const c of CHARS) {
      const letter = this.letter(c)!;
      const next = this.settleEdit(letter);
      if (next) {
        this.commit(slot, letter, next);
        return;
      }
    }
  }

  /** The letter one step closer to its design, or null if it is there. */
  private settleEdit(letter: Letter): Letter | null {
    const d = DESIGN[letter.style.name];
    const { geometry: g, style: s } = letter;
    const toward = (v: number, target: number, step: number) =>
      Math.abs(target - v) <= step ? target : Number((v + Math.sign(target - v) * step).toFixed(4));
    if (s.material !== d.material) return this.restyled(letter, { material: d.material, color: d.color });
    if (s.color !== d.color) return this.restyled(letter, { color: d.color });
    if (s.detail !== d.detail) return this.restyled(letter, { detail: toward(s.detail, d.detail, 0.1) });
    if (g.depth !== d.depth) return this.reshaped(letter, { depth: toward(g.depth, d.depth, 0.04) });
    if (g.bevel !== d.bevel) return this.reshaped(letter, { bevel: toward(g.bevel, d.bevel, 0.02) });
    if (g.rotation !== d.rotation) return this.reshaped(letter, { rotation: toward(g.rotation, d.rotation, 4) });
    const p = g.position;
    if (p.x !== d.position.x || p.z !== d.position.z) {
      return this.reshaped(letter, {
        position: { x: toward(p.x, d.position.x, 0.15), y: 0, z: toward(p.z, d.position.z, 0.1) },
      });
    }
    return null;
  }

  // ---- creation

  /** Clay letters in a plain row; a redrawn one comes back where its design puts it. */
  private create(slot: Slot, char: string, again = false): void {
    this.nextId += 1;
    const index = CHARS.indexOf(char as (typeof CHARS)[number]);
    const d = DESIGN[char];
    const letter: Letter = {
      id: `l${this.nextId}`,
      type: 'letter',
      geometry: again
        ? { position: { ...d.position }, rotation: 0, depth: 0.3, bevel: 0.02 }
        : { position: { x: (index - 1.5) * 1.15, y: 0, z: 0 }, rotation: 0, depth: 0.3, bevel: 0.02 },
      style: { name: char, material: 'clay', color: PALETTE.clay[0], detail: 0.5 },
    };
    this.idOf.set(char, letter.id);
    this.commit(slot, null, letter);
  }

  private redraw(slot: Slot): void {
    const char = this.rng.pick(CHARS);
    const letter = this.letter(char)!;
    this.commit(slot, letter, null);
    this.idOf.delete(char);
    this.redrawn = char;
    this.redrawDone = true;
  }

  // ---- tweaks

  private tweak(slot: Slot, letter: Letter, action: Action): void {
    const { session } = slot;
    const dir = session.direction;
    const burst = slot.inBurst;
    const g = letter.geometry;
    const s = letter.style;
    let next: Letter;

    if (action === 'move') {
      // Drags go along a direction, a few hundredths at a time.
      const step = burst ? this.rng.int(1, 4) / 100 : this.rng.int(5, 25) / 100;
      const alongZ = this.rng.chance(0.3);
      const p = g.position;
      const home = DESIGN[s.name].position.x;
      const x = alongZ ? p.x : snap(clamp(p.x + dir * step, [home - LIMITS.x, home + LIMITS.x]), 0.01);
      const z = alongZ ? snap(clamp(p.z + dir * step, [-LIMITS.z, LIMITS.z]), 0.01) : p.z;
      if (x === p.x && z === p.z) session.direction = -dir;
      next = this.reshaped(letter, { position: { x, y: 0, z } });
    } else if (action === 'rotate') {
      const step = burst ? this.rng.int(1, 3) : this.rng.int(4, 15);
      const rotation = clamp(g.rotation + dir * step, [-LIMITS.rotation, LIMITS.rotation]);
      if (rotation === g.rotation) session.direction = -dir;
      next = this.reshaped(letter, { rotation });
    } else if (action === 'reshape') {
      if (this.rng.chance(0.55)) {
        const depth = snap(clamp(g.depth + dir * (burst ? 0.02 : 0.06), LIMITS.depth), 0.02);
        if (depth === g.depth) session.direction = -dir;
        next = this.reshaped(letter, { depth });
      } else {
        const bevel = snap(clamp(g.bevel + dir * (burst ? 0.01 : 0.03), LIMITS.bevel), 0.01);
        if (bevel === g.bevel) session.direction = -dir;
        next = this.reshaped(letter, { bevel });
      }
    } else if (action === 'material') {
      // Try the session's idea; once it is on, try its colours.
      if (s.material !== session.idea) next = this.restyled(letter, { material: session.idea, color: PALETTE[session.idea][0] });
      else next = this.restyled(letter, { color: this.rng.pick(PALETTE[s.material].filter((c) => c !== s.color)) });
    } else {
      const detail = snap(clamp(s.detail + dir * (burst ? 0.05 : 0.15), LIMITS.detail), 0.05);
      if (detail === s.detail) session.direction = -dir;
      next = this.restyled(letter, { detail });
    }
    this.commit(slot, letter, next);
  }

  private reshaped(letter: Letter, change: Partial<Shape>): Letter {
    return { ...letter, geometry: { ...letter.geometry, ...change } };
  }

  private restyled(letter: Letter, change: Partial<Look>): Letter {
    return { ...letter, style: { ...letter.style, ...change } };
  }

  private letter(char: string): Letter | undefined {
    const id = this.idOf.get(char);
    return id ? (this.live.get(id) as Letter | undefined) : undefined;
  }

  // ---- output

  private commit(slot: Slot, before: Letter | null, after: Letter | null): void {
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) return; // at a limit: nothing changed
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

export function generateLettersDataset(seed = 1): Dataset {
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

