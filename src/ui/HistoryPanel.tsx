import { Show, createSignal } from 'solid-js';
import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import type { Author } from '../engine/types';
import type { DrawThumbnail } from '../render/previews';
import type { Theme } from '../render/theme';
import { formatDay, formatTime } from './format';
import { type SessionHover, Timeline } from './Timeline';

interface Props {
  history: History;
  sessions: Session[];
  authors: Author[];
  thumbnails: (theme: Theme) => DrawThumbnail;
  /** What summaries call the places edits happen in: "Rooms", "Assemblies". */
  areaLabel: string;
}

export function HistoryPanel(props: Props) {
  const ops = props.history.ops;
  const [seq, setSeq] = createSignal(ops.length);
  const [hover, setHover] = createSignal<SessionHover | null>(null);
  const total = ops.length.toLocaleString('en');
  const authorById = new Map(props.authors.map((a) => [a.id, a]));

  const readout = () => {
    const op = ops[seq() - 1];
    const when = op ? `${formatDay(op.ts)} ${formatTime(op.ts)}` : 'Empty';
    return `${when} · ${seq().toLocaleString('en')}/${total}`;
  };

  return (
    <aside class="history dark">
      <header class="history-header">
        <h2 class="history-title">History</h2>
        <span class="history-readout">{readout()}</span>
      </header>
      <Timeline
        history={props.history}
        sessions={props.sessions}
        authors={props.authors}
        thumbnails={props.thumbnails}
        onSeqDrawn={setSeq}
        onHover={setHover}
      />
      <Show when={hover()}>
        {(h) => (
          <SessionCard
            hover={h()}
            session={props.sessions[h().index]}
            author={authorById.get(props.sessions[h().index].authorId)}
            areaLabel={props.areaLabel}
          />
        )}
      </Show>
    </aside>
  );
}

/** Hover details for a session, floating left of the panel. */
function SessionCard(props: { hover: SessionHover; session: Session; author: Author | undefined; areaLabel: string }) {
  const verbs = () => {
    const counts = new Map<string, number>();
    for (const e of props.hover.preview?.edits ?? []) counts.set(e.verb, (counts.get(e.verb) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([verb, n]) => `${verb} ${n}`).join(' · ');
  };

  return (
    <div class="session-card dark" style={{ top: `${Math.max(16, props.hover.clientY - 24)}px` }}>
      <div class="session-card-author">
        <span class="avatar" style={{ background: props.author?.color }}>
          {props.author?.initials}
        </span>
        {props.author?.name}
      </div>
      <div class="session-card-meta">
        {formatDay(props.session.startTs)} · {formatTime(props.session.startTs)}–{formatTime(props.session.endTs)} ·{' '}
        {props.session.seqs.length} edits
      </div>
      {/* The card truncates with "+2 more"; the hover is where lists expand. */}
      <dl class="session-card-lists">
        <dt>Objects</dt>
        <dd>{props.hover.preview?.summary.objects.join(', ') || '…'}</dd>
        <dt>{props.areaLabel}</dt>
        <dd>{props.hover.preview?.summary.areas.join(', ') || '—'}</dd>
      </dl>
      <div class="session-card-meta">{verbs()}</div>
    </div>
  );
}
