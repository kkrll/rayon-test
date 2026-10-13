import type { Session } from './sessions';
import type { LetterMaterial, ModelObject, ObjectType, Op, Room, Vec } from './types';

/** Letter materials as people call them; they group letter edits like rooms do. */
export const MATERIAL_NAMES: Record<LetterMaterial, string> = {
  clay: 'Clay',
  stone: 'Stone',
  glass: 'Glass',
  chrome: 'Chrome',
  carved: 'Carved stone',
};

/** What a single edit did, in words a person would use. */
export type EditVerb = 'created' | 'deleted' | 'moved' | 'rotated' | 'resized' | 'restyled' | 'renamed' | 'reshaped';

export interface SessionEdit {
  verb: EditVerb;
  type: ObjectType;
  objectId: string;
  /** Display name: "Sofa", "Kitchen", "Wall", "A". */
  name: string;
  /**
   * Where the edit happened: the room an object sits in (or the room itself)
   * at the end of the session, or a letter's material.
   */
  area: string | null;
}

export function describeEdit(op: Op): EditVerb {
  if (op.kind === 'create') return 'created';
  if (op.kind === 'delete') return 'deleted';
  const before = op.before!;
  const after = op.after!;

  if (before.type === 'furniture' && after.type === 'furniture') {
    const [b, a] = [before.geometry, after.geometry];
    if (a.x !== b.x || a.y !== b.y) return 'moved';
    if (a.rotation !== b.rotation) return 'rotated';
    if (a.w !== b.w || a.h !== b.h) return 'resized';
    return 'restyled';
  }
  if (before.type === 'wall' && after.type === 'wall') {
    const [b, a] = [before.geometry, after.geometry];
    if (a.thickness !== b.thickness) return 'resized';
    const dax = a.a.x - b.a.x;
    const day = a.a.y - b.a.y;
    const sameShift = dax === a.b.x - b.b.x && day === a.b.y - b.b.y;
    return sameShift && (dax !== 0 || day !== 0) ? 'moved' : 'reshaped';
  }
  if (before.type === 'letter' && after.type === 'letter') {
    const [b, a] = [before.geometry, after.geometry];
    const [pa, pb] = [a.position, b.position];
    if (pa.x !== pb.x || pa.y !== pb.y || pa.z !== pb.z) return 'moved';
    if (a.rotation !== b.rotation) return 'rotated';
    if (a.depth !== b.depth || a.bevel !== b.bevel) return 'reshaped';
    return 'restyled';
  }
  if (before.type === 'room' && after.type === 'room') {
    if (before.style.name !== after.style.name) return 'renamed';
    if (before.style.fill !== after.style.fill) return 'restyled';
    return 'reshaped';
  }
  return 'reshaped';
}

/** Classifies every edit of a session; `rooms` is the room layout at its end (if any). */
export function sessionEdits(session: Session, ops: Op[], rooms: Room[]): SessionEdit[] {
  return session.seqs.map((seq) => {
    const op = ops[seq - 1];
    const obj = (op.after ?? op.before)!;
    const name = obj.type === 'wall' ? 'Wall' : obj.style.name;
    return { verb: describeEdit(op), type: obj.type, objectId: op.objectId, name, area: areaOf(obj, rooms) };
  });
}

function areaOf(obj: ModelObject, rooms: Room[]): string | null {
  if (obj.type === 'letter') return MATERIAL_NAMES[obj.style.material];
  if (obj.type === 'room') return obj.style.name;
  const p = obj.type === 'wall' ? midpoint(obj.geometry.a, obj.geometry.b) : obj.geometry;
  return rooms.find((r) => contains(r.geometry.points, p))?.style.name ?? null;
}

function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Even-odd ray casting; rooms are simple polygons. */
function contains(points: Vec[], p: Vec) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = [points[i], points[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface SessionSummary {
  edits: number;
  /** Distinct object names, most edited first: ["Sofa", "Table"]. */
  objects: string[];
  /** Distinct areas (rooms, assemblies), most edited first: ["Kitchen", "Bedroom"]. */
  areas: string[];
}

/** What a session was about: how much, which things, where. */
export function summarize(edits: SessionEdit[]): SessionSummary {
  return {
    edits: edits.length,
    objects: rankByFrequency(edits.map((e) => e.name)),
    areas: rankByFrequency(edits.flatMap((e) => (e.area ? [e.area] : []))),
  };
}

/** "Kitchen, Bedroom +2 more" — the first `max` items, then a count. */
export function formatList(items: string[], max: number): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

function rankByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/**
 * Every op described, indexed by seq - 1, for filtering. Rooms are taken at
 * the end of each op's session, as in the session cards.
 */
export function describeAll(sessions: Session[], ops: Op[], roomsAt: (seq: number) => Room[]): SessionEdit[] {
  const all: SessionEdit[] = new Array(ops.length);
  for (const session of sessions) {
    const edits = sessionEdits(session, ops, roomsAt(session.endSeq));
    session.seqs.forEach((seq, i) => (all[seq - 1] = edits[i]));
  }
  return all;
}
