import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { track } from '../analytics';
import { FACETS, type Facet, type Filter, isEmpty, matcher, toggle } from '../engine/filter';
import type { History } from '../engine/history';
import { type Lens, createLens } from '../engine/lens';
import type { Session } from '../engine/sessions';
import { type EditVerb, type SessionEdit, describeAll, summarize } from '../engine/summary';
import type { Author, Room } from '../engine/types';
import { type DrawThumbnail, type Preview, type PreviewSource, SessionPreviews } from '../render/previews';
import { type Theme, readTheme } from '../render/theme';
import { formatDay, formatTime } from './format';
import { type SessionHover, Timeline } from './Timeline';

interface Props {
  history: History;
  sessions: Session[];
  authors: Author[];
  thumbnails: (theme: Theme) => DrawThumbnail;
  /** What summaries call the places edits happen in: "Rooms", "Assemblies". */
  areaLabel: string;
  /** The real seq shown, whenever it changes. */
  onSeq?: (seq: number) => void;
}

/** The card stays this long after the pointer leaves its session, so it can be reached. */
const CARD_GRACE_MS = 250;

/** Narrow screens: model on top, the timeline as a horizontal strip below (see styles.css). */
const NARROW = '(max-width: 720px)';

export function HistoryPanel(props: Props) {
  const ops = props.history.ops;
  const [seq, setSeq] = createSignal(ops.length);
  const [hover, setHover] = createSignal<SessionHover | null>(null);
  const [filter, setFilter] = createSignal<Filter>({});
  const total = ops.length.toLocaleString('en');
  const authorById = new Map(props.authors.map((a) => [a.id, a]));

  // Kept across filter changes (the timeline remounts with each).
  // Thumbnails show the model, so they use the canvas (light) theme.
  const modelTheme = readTheme(document.documentElement);
  const previews = new SessionPreviews(props.history, props.sessions, props.thumbnails(modelTheme), modelTheme);
  const zoom = { ppo: 6 };

  // Every op described (name, area, verb), built on first use of a filter.
  let edits: SessionEdit[] | null = null;
  const describe = () =>
    (edits ??= describeAll(props.sessions, ops, (s) =>
      [...props.history.snapshotAt(s).values()].filter((o): o is Room => o.type === 'room')));

  const lens = createMemo(() => {
    const f = filter();
    return createLens(ops, props.sessions, isEmpty(f) ? null : matcher(f, describe()));
  });

  const narrowScreen = window.matchMedia(NARROW);
  const [orientation, setOrientation] = createSignal<'vertical' | 'horizontal'>(narrowScreen.matches ? 'horizontal' : 'vertical');
  const onNarrow = () => setOrientation(narrowScreen.matches ? 'horizontal' : 'vertical');
  narrowScreen.addEventListener('change', onNarrow);
  onCleanup(() => narrowScreen.removeEventListener('change', onNarrow));
  /** The timeline remounts when either changes. */
  const strip = createMemo(() => ({ lens: lens(), orientation: orientation() }));

  /**
   * Previews per lens session: the original session's thumbnail, with its
   * edits and summary narrowed to the ones that pass the filter.
   */
  const previewsFor = (l: Lens): PreviewSource => {
    if (isEmpty(filter())) return previews;
    const narrowed = new Map<number, Preview>();
    return {
      build: (ms) => previews.build(ms),
      get: (i) => {
        const cached = narrowed.get(i);
        if (cached) return cached;
        const full = previews.get(l.origin[i]);
        if (!full) return undefined;
        const edits = l.sessions[i].seqs.map((pos) => describe()[l.seqOf(pos) - 1]);
        const preview = { ...full, edits, summary: summarize(edits) };
        narrowed.set(i, preview);
        return preview;
      },
    };
  };

  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const onHover = (h: SessionHover | null) => {
    clearTimeout(closeTimer);
    if (h) setHover(h);
    else closeTimer = setTimeout(() => setHover(null), CARD_GRACE_MS);
  };
  onCleanup(() => clearTimeout(closeTimer));

  /** Card items and chips both toggle a value in or out of the filter. */
  const toggleValue = (facet: Facet, value: string, source: 'card' | 'chip') => {
    const active = !(filter()[facet]?.includes(value) ?? false);
    track('filter_toggled', { facet, value, active, source });
    setFilter((f) => toggle(f, facet, value));
    clearTimeout(closeTimer);
    setHover(null);
  };

  const chips = () => {
    const f = filter();
    return FACETS.flatMap((facet) =>
      (f[facet] ?? []).map((value) => ({
        facet,
        value,
        label: facet === 'author' ? (authorById.get(value)?.name ?? value) : value,
      })));
  };

  // Day and time are on the playhead; the footer keeps the position.
  const readout = () => `${seq().toLocaleString('en')}/${total}`;

  return (
    <aside class="history dark">
      {/* Rayon's panel bar. Only the history toggle is live (it is the open panel). */}
      <div class="panel-bar">
        <div class="avatar-stack">
          <For each={props.authors}>
            {(a) => (
              <span class="avatar" style={{ background: a.color }} title={a.name}>
                {a.initials}
              </span>
            )}
          </For>
        </div>
        <span class="panel-bar-spacer" />
        <button class="icon-button" aria-pressed="true" aria-label="Version history">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M17.5 10A7.5 7.5 0 1 1 10 2.5A7.5 7.5 0 0 1 17.5 10Z" opacity="0.7" />
            <path d="M10 5.5V10l2.19 2.19" />
          </svg>
        </button>
        <span class="panel-bar-divider" />
        <button class="icon-button icon-button-filled" aria-label="Present">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              class="icon-fill"
              d="M7.88 16.27C6.89 16.99 5.5 16.28 5.5 15.05V4.95C5.5 3.72 6.89 3.01 7.88 3.73l6.95 5.06c.82.6.82 1.83 0 2.42Z"
            />
          </svg>
        </button>
        <button class="button button-primary">Share</button>
      </div>
      <header class="history-header">
        <h2 class="history-title">Version history</h2>
      </header>
      <div class="panel-rule" />
      <Show when={chips().length > 0}>
        <div class="history-filters">
          <For each={chips()}>
            {(chip) => (
              <button class="chip" onClick={() => toggleValue(chip.facet, chip.value, 'chip')} aria-label={`Remove filter ${chip.label}`}>
                {chip.label}
                <span class="chip-remove">×</span>
              </button>
            )}
          </For>
          <span class="history-filters-count">{lens().ops.length.toLocaleString('en')} edits</span>
        </div>
      </Show>
      <Show when={strip()} keyed>
        {({ lens: l, orientation: o }) =>
          l.ops.length > 0 ? (
            <Timeline
              lens={l}
              orientation={o}
              authors={props.authors}
              previews={previewsFor(l)}
              zoom={zoom}
              onSeqDrawn={(s) => {
                setSeq(s);
                props.onSeq?.(s);
              }}
              onHover={onHover}
            />
          ) : (
            <div class="history-empty">No edits match</div>
          )
        }
      </Show>
      <footer class="panel-footer">
        <span class="history-readout">{readout()} edits</span>
      </footer>
      <Show when={hover()}>
        {(h) => (
          <SessionCard
            hover={h()}
            preview={previews.get(h().index)}
            session={props.sessions[h().index]}
            author={authorById.get(props.sessions[h().index].authorId)}
            areaLabel={props.areaLabel}
            filter={filter()}
            onToggle={(facet, value) => toggleValue(facet, value, 'card')}
            onEnter={() => clearTimeout(closeTimer)}
            onLeave={() => onHover(null)}
          />
        )}
      </Show>
    </aside>
  );
}

interface CardProps {
  hover: SessionHover;
  /** The whole session, not narrowed by the filter: the card is where you widen it. */
  preview: Preview | undefined;
  session: Session;
  author: Author | undefined;
  areaLabel: string;
  filter: Filter;
  onToggle: (facet: Facet, value: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}

/**
 * Details for a session, floating left of the panel. Its author, objects,
 * areas and verbs are filters: clicking one adds it to the filter (or removes it).
 */
function SessionCard(props: CardProps) {
  const verbs = () => {
    const counts = new Map<EditVerb, number>();
    for (const e of props.preview?.edits ?? []) counts.set(e.verb, (counts.get(e.verb) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  };

  const facet = (kind: Facet, value: string, label: string = value) => (
    <button
      class="facet"
      aria-pressed={props.filter[kind]?.includes(value) ?? false}
      onClick={() => props.onToggle(kind, value)}
    >
      {label}
    </button>
  );

  /** "Rug, Cabinet, Shelf" with each item clickable. */
  const list = (kind: Facet, items: string[] | undefined, empty: string) => (
    <Show when={items?.length} fallback={empty}>
      <For each={items}>
        {(item, i) => (
          <>
            {i() > 0 ? ', ' : ''}
            {facet(kind, item)}
          </>
        )}
      </For>
    </Show>
  );

  return (
    <div
      class="session-card dark"
      style={{ top: `${Math.max(16, props.hover.clientY - 24)}px` }}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    >
      <Show when={props.author}>
        {(author) => (
          <button
            class="facet session-card-author"
            aria-pressed={props.filter.author?.includes(author().id) ?? false}
            onClick={() => props.onToggle('author', author().id)}
          >
            <span class="avatar" style={{ background: author().color }}>
              {author().initials}
            </span>
            {author().name}
          </button>
        )}
      </Show>
      <div class="session-card-meta">
        {formatDay(props.session.startTs)} · {formatTime(props.session.startTs)}–{formatTime(props.session.endTs)} ·{' '}
        {props.hover.shown < props.session.seqs.length
          ? `${props.hover.shown} of ${props.session.seqs.length} edits`
          : `${props.session.seqs.length} edits`}
      </div>
      {/* The card truncates with "+2 more"; the hover is where lists expand. */}
      <dl class="session-card-lists">
        <dt>Objects</dt>
        <dd>{list('object', props.preview?.summary.objects, '…')}</dd>
        <dt>{props.areaLabel}</dt>
        <dd>{list('area', props.preview?.summary.areas, '—')}</dd>
      </dl>
      <div class="session-card-meta">
        <For each={verbs()}>
          {([verb, n], i) => (
            <>
              {i() > 0 ? ' · ' : ''}
              {facet('verb', verb, `${verb} ${n}`)}
            </>
          )}
        </For>
      </div>
    </div>
  );
}
