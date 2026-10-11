import { onCleanup, onMount } from 'solid-js';
import { generateDataset } from '../engine/generator';
import { History } from '../engine/history';
import { groupSessions } from '../engine/sessions';
import { modelBounds } from '../render/modelRenderer';
import { cursor } from './cursor';
import { ModelView } from './ModelView';
import { Timeline } from './Timeline';

const dataset = generateDataset(1);
const history = new History(dataset.ops);
const sessions = groupSessions(dataset.ops);
const bounds = modelBounds(history.snapshotAt(history.length));
/** Session ends are the display snapshots: Shift+arrow steps between them. */
const sessionEnds = [...new Set(sessions.map((s) => s.endSeq))].sort((a, b) => a - b);

cursor.seq = history.length;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const dir = e.key === 'ArrowRight' ? 1 : -1;
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
      <ModelView history={history} seq={() => cursor.seq} bounds={bounds} />
      <Timeline ops={dataset.ops} />
    </div>
  );
}
