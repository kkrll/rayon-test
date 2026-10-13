import type { History } from './history';
import type { Author, Dataset, ModelObject, Op } from './types';

/** Whoever is using the explorer; edits made from it are theirs. */
export const YOU: Author = { id: 'you', name: 'You', initials: 'Y', color: '#3888FF' };

/** The history up to and including `seq`: a new project branching off there. */
export function copyUntil(dataset: Dataset, seq: number): Dataset {
  return {
    authors: dataset.authors.map((a) => ({ ...a })),
    ops: dataset.ops.slice(0, seq),
    namedVersions: dataset.namedVersions.filter((v) => v.seq <= seq),
  };
}

/**
 * Brings the model back to how it was after `seq` by appending edits, so the
 * history keeps everything that happened since: objects created since are
 * deleted, deleted ones created again, changed ones set back.
 */
export function resetTo(dataset: Dataset, history: History, seq: number, ts: number, author: Author = YOU): Dataset {
  const target = history.snapshotAt(seq);
  const current = history.snapshotAt(history.length);
  const out = appender(dataset, ts, author);

  for (const [id, now] of current) {
    const then = target.get(id);
    if (!then) out.push(id, now, null);
    else if (then !== now) out.push(id, now, then);
  }
  for (const [id, then] of target) if (!current.has(id)) out.push(id, null, then);
  return out.dataset();
}

/**
 * Undoes exactly the edits that `match` picks out after `seq`, and nothing
 * else, by appending edits (like resetTo).
 *
 * Works per property (an object's existence counts as one): a property goes
 * back to what the last edit outside the selection set it to after `seq`, or
 * to its value at `seq` if there was none. If an edit outside the selection
 * changed it last, it already shows that edit and is left alone.
 */
export function resetEdits(
  dataset: Dataset,
  history: History,
  seq: number,
  match: (op: Op) => boolean,
  ts: number,
  author: Author = YOU,
): Dataset {
  const target = history.snapshotAt(seq);
  const current = history.snapshotAt(history.length);
  const out = appender(dataset, ts, author);

  // The edits since `seq`, per object that has a selected one.
  const since = new Map<string, Op[]>();
  for (const op of history.ops.slice(seq)) if (match(op)) since.set(op.objectId, []);
  for (const op of history.ops.slice(seq)) since.get(op.objectId)?.push(op);

  for (const [id, ops] of since) {
    // property -> [value to go back to, last edit selected?]
    const props = new Map<string, { value: unknown; selectedLast: boolean }>();
    const atSeq = target.get(id);
    for (const op of ops) {
      const selected = match(op);
      for (const [key, value] of changes(op)) {
        const entry = props.get(key) ?? { value: key === EXISTS ? atSeq !== undefined : atSeq && read(atSeq, key), selectedLast: false };
        if (!selected) entry.value = value;
        entry.selectedLast = selected;
        props.set(key, entry);
      }
    }

    const now = current.get(id);
    const back = [...props].filter(([, p]) => p.selectedLast);
    if (back.length === 0) continue;
    const exists = props.get(EXISTS)?.selectedLast ? (props.get(EXISTS)!.value as boolean) : now !== undefined;
    if (!exists) {
      if (now) out.push(id, now, null);
      continue;
    }
    // Deleted by a selected edit: comes back as it was just before.
    let object = now ?? ops.findLast((op) => op.kind === 'delete')!.before!;
    for (const [key, p] of back) if (key !== EXISTS && p.value !== undefined) object = write(object, key, p.value);
    if (!now) out.push(id, null, object);
    else if (JSON.stringify(object) !== JSON.stringify(now)) out.push(id, now, object);
  }
  return out.dataset();
}

/** Appends edits by `author` at `ts` to a copy of the dataset's history. */
function appender(dataset: Dataset, ts: number, author: Author) {
  const ops: Op[] = [...dataset.ops];
  return {
    push(objectId: string, before: Op['before'], after: Op['after']) {
      ops.push({
        seq: ops.length + 1,
        ts,
        authorId: author.id,
        kind: before === null ? 'create' : after === null ? 'delete' : 'update',
        objectId,
        before,
        after,
      });
    },
    dataset(): Dataset {
      const authors = dataset.authors.some((a) => a.id === author.id) ? dataset.authors : [...dataset.authors, author];
      return { authors, ops, namedVersions: dataset.namedVersions };
    },
  };
}

// Properties are `geometry.<key>` and `style.<key>`, plus whether the object exists.
const EXISTS = 'exists';

/** What an edit changed: [property, new value]. A create sets every property. */
function changes(op: Op): [string, unknown][] {
  if (op.kind === 'delete') return [[EXISTS, false]];
  const after = op.after!;
  const all = properties(after);
  if (op.kind === 'create') return [[EXISTS, true], ...all];
  return all.filter(([key, value]) => JSON.stringify(read(op.before!, key)) !== JSON.stringify(value));
}

function properties(o: ModelObject): [string, unknown][] {
  return (['geometry', 'style'] as const).flatMap((group) =>
    Object.entries(o[group]).map(([key, value]): [string, unknown] => [`${group}.${key}`, value]));
}

function read(o: ModelObject, key: string): unknown {
  const [group, name] = key.split('.') as ['geometry' | 'style', string];
  return (o[group] as Record<string, unknown>)[name];
}

function write(o: ModelObject, key: string, value: unknown): ModelObject {
  const [group, name] = key.split('.') as ['geometry' | 'style', string];
  return { ...o, [group]: { ...o[group], [name]: value } } as ModelObject;
}
