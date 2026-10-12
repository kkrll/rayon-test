import type { Diff, History } from '../engine/history';
import { type Session, sessionAt } from '../engine/sessions';
import type { ModelObject } from '../engine/types';

/** The diff since the start of the cursor's session, as the renderers need it. */
export interface Highlight {
  added: Set<string>;
  modified: Set<string>;
  deleted: ModelObject[]; // drawn as ghosts, as they were before deletion
}

export const NO_HIGHLIGHT: Highlight = { added: new Set(), modified: new Set(), deleted: [] };

export function toHighlight(diff: Diff): Highlight {
  return {
    added: new Set(diff.added.map((o) => o.id)),
    modified: new Set(diff.modified.map((o) => o.id)),
    deleted: diff.deleted,
  };
}

/**
 * Diff since the start of the session containing `seq`, cached for the last
 * seq asked. Nothing at a session's end: those are the snapshot moments, shown
 * as the finished model, like their thumbnails.
 */
export function sessionHighlighter(history: History, sessions: Session[]): (seq: number) => Highlight {
  let key = '';
  let highlight = NO_HIGHLIGHT;
  return (seq) => {
    const index = sessionAt(sessions, history.ops, seq);
    if (index < 0 || sessions[index].endSeq === seq) return NO_HIGHLIGHT;
    const from = sessions[index].startSeq - 1;
    if (`${from}:${seq}` !== key) {
      highlight = toHighlight(history.diff(from, seq));
      key = `${from}:${seq}`;
    }
    return highlight;
  };
}
