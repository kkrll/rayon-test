import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { cursor } from './cursor';
import { DebugOverlay } from './DebugOverlay';
import { DeviceView } from './DeviceView';
import { HistoryPanel } from './HistoryPanel';
import { ModelView } from './ModelView';
import { PROJECTS, type Project, type ProjectId, loadProject } from './projects';

// Time runs upwards in the panel, so Up and Right both mean "newer".
const KEY_DIRECTION: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

const [debugVisible, setDebugVisible] = createSignal(false);

/** The project in the URL hash (#n97), so a reload stays where you were. */
function projectFromHash(): ProjectId {
  const id = location.hash.slice(1);
  return PROJECTS.find((p) => p.id === id)?.id ?? 'apartment';
}

export function App() {
  const [projectId, setProjectId] = createSignal(projectFromHash());
  // While the next project loads, the current one stays on screen.
  const [project] = createResource(projectId, loadProject);

  const select = (id: ProjectId) => {
    window.history.replaceState(null, '', `#${id}`);
    setProjectId(id);
  };

  return (
    <div class="app">
      <main class="stage">
        <Show when={project()} keyed fallback={<div class="stage-message">Loading…</div>}>
          {(p) => <Workspace project={p} />}
        </Show>
        <nav class="projects" aria-label="Projects">
          <For each={PROJECTS}>
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
          />
        )}
      </Show>
    </div>
  );
}

/** One project's canvas and keyboard; mounted fresh when the project changes. */
function Workspace(props: { project: Project }) {
  const { history, sessionEnds } = props.project; // keyed: never changes here
  cursor.seq = history.length;
  cursor.scrubbing = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'd' || e.key === 'D') {
      setDebugVisible((v) => !v);
      return;
    }
    const dir = KEY_DIRECTION[e.key];
    if (!dir) return;
    e.preventDefault();
    if (e.shiftKey) {
      const next = dir > 0 ? sessionEnds.find((s) => s > cursor.seq) : sessionEnds.findLast((s) => s < cursor.seq);
      cursor.seq = next ?? (dir > 0 ? history.length : 0);
    } else {
      cursor.seq = Math.max(0, Math.min(history.length, cursor.seq + dir));
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
