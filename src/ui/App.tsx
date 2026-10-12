import { For, Show, createEffect, createResource, createSignal, on, onCleanup, onMount } from 'solid-js';
import { track } from '../analytics';
import { copyUntil, resetTo } from '../engine/actions';
import { cursor } from './cursor';
import { DebugOverlay } from './DebugOverlay';
import { DeviceView } from './DeviceView';
import { formatDay, formatTime } from './format';
import { HistoryPanel } from './HistoryPanel';
import { ModelView } from './ModelView';
import { PROJECTS, type Project, type ProjectEntry, deriveProject, loadProject } from './projects';

const [debugVisible, setDebugVisible] = createSignal(false);

/** How long the playhead must rest before a stop counts as viewed. */
const HISTORY_VIEWED_MS = 1000;

/** The project in the URL hash (#n97), so a reload stays where you were. */
function projectFromHash(): string {
  const id = location.hash.slice(1);
  return PROJECTS.find((p) => p.id === id)?.id ?? 'apartment';
}

export function App() {
  const [entries, setEntries] = createSignal<ProjectEntry[]>(PROJECTS);
  const [projectId, setProjectId] = createSignal(projectFromHash());
  // While the next project loads, the current one stays on screen.
  const [project, { mutate }] = createResource(projectId, loadProject);
  /** The seq the timeline shows, for the floating actions. */
  const [viewSeq, setViewSeq] = createSignal<number | null>(null);

  const select = (id: string) => {
    track('project_opened', { project: id, kind: entries().find((e) => e.id === id)?.kind });
    window.history.replaceState(null, '', `#${id}`);
    setViewSeq(null); // until the new timeline reports where it is
    setProjectId(id);
  };

  /** A new project with the history up to the viewed edit, opened right away. */
  const createCopy = (p: Project, seq: number) => {
    const taken = new Set(entries().map((e) => e.id));
    let n = 1;
    while (taken.has(`${p.id}-copy-${n}`)) n++;
    const id = `${p.id}-copy-${n}`;
    const name = n === 1 ? `${p.name} copy` : `${p.name} copy ${n}`;
    track('copy_created', { project: p.id, seq, total: p.history.length });
    deriveProject(p, id, name, copyUntil(p.dataset, seq));
    setEntries([...entries(), { id, name, kind: p.kind === 'plan' ? '2D' : '3D' }]);
    select(id);
  };

  /** Appends edits that restore the viewed state; the project reopens at its new latest edit. */
  const resetHere = (p: Project, seq: number) => {
    track('reset_done', { project: p.id, seq, total: p.history.length });
    setViewSeq(null);
    mutate(deriveProject(p, p.id, p.name, resetTo(p.dataset, p.history, seq, Date.now())));
  };

  // Where people stop in history: reported once the playhead rests a second.
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(viewSeq, (seq) => {
    clearTimeout(viewTimer);
    const p = project();
    if (seq === null || !p) return;
    viewTimer = setTimeout(() => track('history_viewed', {
      project: p.id,
      seq,
      total: p.history.length,
      edits_behind: p.history.length - seq,
    }), HISTORY_VIEWED_MS);
  }, { defer: true }));
  onCleanup(() => clearTimeout(viewTimer));

  return (
    <div class="app">
      <main class="stage">
        <Show when={project()} keyed fallback={<div class="stage-message">Loading…</div>}>
          {(p) => <Workspace project={p} />}
        </Show>
        <nav class="projects dark" aria-label="Projects">
          <For each={entries()}>
            {(p) => (
              <button
                class="project-tab"
                aria-pressed={projectId() === p.id}
                onClick={() => select(p.id)}
              >
                {p.name}
                <span class="project-kind">{p.kind}</span>
              </button>
            )}
          </For>
          <Show when={project.loading}>
            <span class="project-loading">Loading…</span>
          </Show>
        </nav>
        <Show when={project()}>
          {(p) => (
            <Show when={viewSeq() !== null && viewSeq()! < p().history.length}>
              <ViewActions
                project={p()}
                seq={viewSeq()!}
                onCopy={() => createCopy(p(), viewSeq()!)}
                onReset={() => resetHere(p(), viewSeq()!)}
              />
            </Show>
          )}
        </Show>
        <Show when={project.error}>
          <div class="stage-message">Could not load the project: {String(project.error)}</div>
        </Show>
        <Show when={debugVisible()}>
          <DebugOverlay />
        </Show>
      </main>
      <Show when={project()} keyed>
        {(p) => (
          <HistoryPanel
            history={p.history}
            sessions={p.sessions}
            authors={p.dataset.authors}
            thumbnails={p.thumbnails}
            areaLabel={p.areaLabel}
            onSeq={setViewSeq}
          />
        )}
      </Show>
    </div>
  );
}

/** How long the playhead must rest before the pane's label catches up. */
const LABEL_DEBOUNCE_MS = 150;

/**
 * Floating over the canvas while an earlier state is shown: branch a copy
 * off it, or bring the project back to it.
 */
function ViewActions(props: { project: Project; seq: number; onCopy: () => void; onReset: () => void }) {
  /** Reset asks first; moving to another point in history drops the question. */
  const [confirming, setConfirming] = createSignal(false);
  createEffect(on(() => props.seq, () => setConfirming(false), { defer: true }));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && confirming()) cancel('escape');
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  // The label follows the playhead once it rests, not every edit scrubbed past.
  const [shownSeq, setShownSeq] = createSignal(props.seq);
  let labelTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => props.seq, (seq) => {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => setShownSeq(seq), LABEL_DEBOUNCE_MS);
  }, { defer: true }));
  onCleanup(() => clearTimeout(labelTimer));

  const ask = () => {
    track('reset_asked', { project: props.project.id, seq: props.seq });
    setConfirming(true);
  };
  const cancel = (via: 'button' | 'escape') => {
    track('reset_cancelled', { project: props.project.id, seq: props.seq, via });
    setConfirming(false);
  };

  const when = () => {
    const op = props.project.history.ops[shownSeq() - 1];
    return op ? `${formatDay(op.ts)} · ${formatTime(op.ts)}` : 'Before the first edit';
  };
  const since = () => (props.project.history.length - shownSeq()).toLocaleString('en');

  return (
    <div class="view-actions dark" role="region" aria-label="Earlier state">
      <svg class="view-actions-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 6v4.25l2.75 1.75" />
      </svg>
      <Show
        when={confirming()}
        fallback={
          <>
            <span class="view-actions-label">
              {when()} · {since()} edits since
            </span>
            <span class="view-actions-divider" />
            <button class="button button-secondary" onClick={ask}>
              Reset to this state
            </button>
            <button class="button button-primary" onClick={props.onCopy}>
              Create a copy
            </button>
          </>
        }
      >
        <span class="view-actions-label view-actions-label-strong">Are you sure? The changes would be lost</span>
        <span class="view-actions-divider" />
        <button class="button button-secondary" onClick={() => cancel('button')}>
          Cancel
        </button>
        <button class="button button-secondary" onClick={props.onCopy}>
          Copy
        </button>
        <button class="button button-negative" onClick={props.onReset}>
          Reset
        </button>
      </Show>
    </div>
  );
}

/** One project's canvas and keyboard; mounted fresh when the project changes. */
function Workspace(props: { project: Project }) {
  cursor.seq = props.project.history.length; // keyed: a fresh project starts at its latest edit
  cursor.scrubbing = false;

  // History keys (arrows) belong to the timeline; D toggles the debug overlay.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'd' || e.key === 'D') {
      setDebugVisible((v) => !v);
      track('debug_toggled', { visible: debugVisible() });
    }
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  const p = props.project;
  return p.kind === 'plan' ? (
    <ModelView history={p.history} sessions={p.sessions} bounds={p.bounds} />
  ) : (
    <DeviceView history={p.history} sessions={p.sessions} model={p.model} />
  );
}
