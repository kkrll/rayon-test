import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { generateDataset } from '../engine/generator';
import { History } from '../engine/history';
import { groupSessions } from '../engine/sessions';
import { modelBounds } from '../render/modelRenderer';
import { cursor } from './cursor';
import { DebugOverlay } from './DebugOverlay';
import { ModelView } from './ModelView';
import { HistoryPanel } from './HistoryPanel';

const dataset = generateDataset(1);
const history = new History(dataset.ops);
const sessions = groupSessions(dataset.ops);
const bounds = modelBounds(history.snapshotAt(history.length));
/** Session ends are the display snapshots: Shift+arrow steps between them. */
const sessionEnds = [...new Set(sessions.map((s) => s.endSeq))].sort((a, b) => a - b);

cursor.seq = history.length;

// Time runs upwards in the panel, so Up and Right both mean "newer".
const KEY_DIRECTION: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

const [debugVisible, setDebugVisible] = createSignal(false);

function onKeyDown(e: KeyboardEvent) {
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
}

export function App() {
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  return (
    <div class="app">
      <main class="stage">
        <ModelView history={history} sessions={sessions} bounds={bounds} />
        <Show when={debugVisible()}>
          <DebugOverlay />
        </Show>
      </main>
      <HistoryPanel ops={dataset.ops} />
    </div>
  );
}
