import type { History } from './history';
import type { Author, Dataset, Op } from './types';

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
  const ops: Op[] = [...dataset.ops];
  const push = (objectId: string, before: Op['before'], after: Op['after']) =>
    ops.push({
      seq: ops.length + 1,
      ts,
      authorId: author.id,
      kind: before === null ? 'create' : after === null ? 'delete' : 'update',
      objectId,
      before,
      after,
    });

  for (const [id, now] of current) {
    const then = target.get(id);
    if (!then) push(id, now, null);
    else if (then !== now) push(id, now, then);
  }
  for (const [id, then] of target) if (!current.has(id)) push(id, null, then);

  const authors = dataset.authors.some((a) => a.id === author.id) ? dataset.authors : [...dataset.authors, author];
  return { authors, ops, namedVersions: dataset.namedVersions };
}
