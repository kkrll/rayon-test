import { onCleanup, onMount } from 'solid-js';
import type { Op } from '../engine/types';
import { onFrame } from '../render/frameLoop';
import { type Theme, readTheme } from '../render/theme';
import { TimelineLayout } from '../render/timelineLayout';
import { BOTTOM_PAD, COLUMNS, TOP_PAD, type TimelineView, axisToY, drawTimeline, yToAxis } from '../render/timelineRenderer';
import { cursor } from './cursor';

interface Props {
  ops: Op[];
  /** Called at most once per frame, after the cursor was drawn at a new seq. */
  onSeqDrawn?: (seq: number) => void;
}

const MIN_PPO = 1.5;
const MAX_PPO = 40;
const FOLLOW_MARGIN = 48;
const CLICK_SLOP = 3;

export function Timeline(props: Props) {
  let canvas!: HTMLCanvasElement;
  let theme: Theme;
  const layout = new TimelineLayout(props.ops);
  const view: TimelineView = { ppo: 6, scroll: 0, width: 0, height: 0 };
  let dirty = true;
  let drawnSeq = -1;
  let dragging = false;

  const localY = (clientY: number) => clientY - canvas.getBoundingClientRect().top;
  const seqAtY = (clientY: number) => layout.seqAt(yToAxis(layout, view, localY(clientY)), view.ppo);
  const cursorY = () => axisToY(layout, view, layout.boundaryAt(cursor.seq, view.ppo));

  const clampScroll = () => {
    const max = Math.max(0, TOP_PAD + layout.length(view.ppo) + BOTTOM_PAD - view.height);
    view.scroll = Math.min(max, Math.max(0, view.scroll));
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    view.width = canvas.clientWidth;
    view.height = canvas.clientHeight;
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(view.height * dpr);
    clampScroll();
    dirty = true;
  };

  const draw = () => {
    if (!view.height) return;
    // Keep the cursor in view when it moves by keyboard.
    if (!dragging && cursor.seq !== drawnSeq) {
      const y = cursorY();
      if (y < FOLLOW_MARGIN) view.scroll += y - FOLLOW_MARGIN;
      else if (y > view.height - FOLLOW_MARGIN) view.scroll += y - (view.height - FOLLOW_MARGIN);
      clampScroll();
      dirty = true;
    }
    if (!dirty && cursor.seq === drawnSeq) return;
    drawTimeline(canvas.getContext('2d')!, props.ops, layout, view, cursor.seq, window.devicePixelRatio || 1, theme);
    if (cursor.seq !== drawnSeq) props.onSeqDrawn?.(cursor.seq);
    drawnSeq = cursor.seq;
    dirty = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom around the pointer: keep the boundary under it in place.
      const py = localY(e.clientY);
      const anchor = layout.seqAt(yToAxis(layout, view, py), view.ppo);
      view.ppo = Math.min(MAX_PPO, Math.max(MIN_PPO, view.ppo * Math.exp(-e.deltaY * 0.01)));
      view.scroll += axisToY(layout, view, layout.boundaryAt(anchor, view.ppo)) - py;
    } else {
      view.scroll += e.deltaY;
    }
    clampScroll();
    dirty = true;
  };

  // Drag on the tick column or the cursor scrubs; drag elsewhere scrolls;
  // a click anywhere jumps.
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const localX = e.clientX - canvas.getBoundingClientRect().left;
    const nearCursor = Math.abs(localY(e.clientY) - cursorY()) < 6;
    const scrub = localX < COLUMNS.scrubRight || nearCursor;
    const startY = e.clientY;
    let moved = false;
    dragging = true;

    if (scrub) {
      cursor.scrubbing = true;
      cursor.seq = seqAtY(e.clientY);
    }

    const move = (m: PointerEvent) => {
      if (Math.abs(m.clientY - startY) > CLICK_SLOP) moved = true;
      if (scrub) cursor.seq = seqAtY(m.clientY);
      else {
        view.scroll -= m.movementY;
        clampScroll();
        dirty = true;
      }
    };
    const up = (u: PointerEvent) => {
      if (!scrub && !moved) cursor.seq = seqAtY(u.clientY);
      cursor.scrubbing = false;
      dragging = false;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  onMount(() => {
    theme = readTheme(canvas);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const stop = onFrame(draw);
    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  return <canvas ref={canvas} class="timeline" onPointerDown={onPointerDown} />;
}
