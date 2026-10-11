import { createSignal } from 'solid-js';
import type { Op } from '../engine/types';
import { formatDay, formatTime } from './format';
import { Timeline } from './Timeline';

interface Props {
  ops: Op[];
}

export function HistoryPanel(props: Props) {
  const [seq, setSeq] = createSignal(props.ops.length);
  const total = props.ops.length.toLocaleString('en');

  const readout = () => {
    const op = props.ops[seq() - 1];
    const when = op ? `${formatDay(op.ts)} ${formatTime(op.ts)}` : 'Empty';
    return `${when} · ${seq().toLocaleString('en')}/${total}`;
  };

  return (
    <aside class="history dark">
      <header class="history-header">
        <h2 class="history-title">History</h2>
        <span class="history-readout">{readout()}</span>
      </header>
      <Timeline ops={props.ops} onSeqDrawn={setSeq} />
    </aside>
  );
}
