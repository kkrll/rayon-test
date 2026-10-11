import { createSignal, onCleanup, onMount } from 'solid-js';
import { stats } from '../render/stats';

const SAMPLE_MS = 250;

/** Toggled with D. Samples the frame stats a few times per second. */
export function DebugOverlay() {
  const [snapshot, setSnapshot] = createSignal(sample());

  onMount(() => {
    const timer = setInterval(() => setSnapshot(sample()), SAMPLE_MS);
    onCleanup(() => clearInterval(timer));
  });

  const row = (label: string, value: () => string) => (
    <div class="debug-row">
      <span>{label}</span>
      <span>{value()}</span>
    </div>
  );

  return (
    <div class="debug dark">
      {row('Frame loop', () => `${snapshot().loop.perSecond} fps · worst ${ms(snapshot().loop.worstMs)}`)}
      {row('Canvas', () => `${snapshot().model.perSecond} fps · worst ${ms(snapshot().model.worstMs)}`)}
      {row('Timeline', () => `${snapshot().timeline.perSecond} fps · worst ${ms(snapshot().timeline.worstMs)}`)}
      {row('getStateAt', () => {
        const s = snapshot().state;
        return s ? `${s.path} · ${s.opsApplied} ops · ${ms(s.ms)}` : '—';
      })}
    </div>
  );
}

function sample() {
  return {
    loop: stats.loop.read(),
    model: stats.model.read(),
    timeline: stats.timeline.read(),
    state: stats.lastState,
  };
}

/** Browsers coarsen performance.now() to ~0.1 ms, so don't claim more precision. */
function ms(value: number) {
  return value < 0.1 ? '<0.1 ms' : `${value.toFixed(1)} ms`;
}
