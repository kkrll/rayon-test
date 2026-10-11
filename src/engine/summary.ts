import type { Session } from './sessions';
import type { ModelObject, ObjectType, Op, Room, Vec } from './types';

/** What a single edit did, in words a person would use. */
export type EditVerb = 'created' | 'deleted' | 'moved' | 'rotated' | 'resized' | 'restyled' | 'renamed' | 'reshaped';

export interface SessionEdit {
  verb: EditVerb;
  type: ObjectType;
  objectId: string;
  /** Room the object sits in (or the room itself), at the end of the session. */
  room: string | null;
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
  if (before.type === 'room' && after.type === 'room') {
    if (before.style.name !== after.style.name) return 'renamed';
    if (before.style.fill !== after.style.fill) return 'restyled';
    return 'reshaped';
  }
  return 'reshaped';
}

/** Classifies every edit of a session; `rooms` is the room layout at its end. */
export function sessionEdits(session: Session, ops: Op[], rooms: Room[]): SessionEdit[] {
  return session.seqs.map((seq) => {
    const op = ops[seq - 1];
    const obj = (op.after ?? op.before)!;
    return { verb: describeEdit(op), type: obj.type, objectId: op.objectId, room: roomName(obj, rooms) };
  });
}

function roomName(obj: ModelObject, rooms: Room[]): string | null {
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

/**
 * One short line for a session card and its hover, e.g.
 * "Moved 12 furniture items, Kitchen".
 *
 * TODO(you): decide what a session "was about". Inputs: every edit's verb,
 * object type and room. Things to weigh:
 *  - lead with the dominant verb, or list the top two ("Moved 8, resized 3")?
 *  - count edits or distinct objects? (a burst nudges one sofa 15 times)
 *  - one room vs. several: "Kitchen", "Kitchen + 2 rooms", or drop it?
 *  - the card has ~140 px; the hover card can afford more.
 */
export function summarize(edits: SessionEdit[]): string {
  return `${edits.length} edits`;
}
