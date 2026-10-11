import { onCleanup, onMount } from 'solid-js';
import type { Op } from '../engine/types';
import { onFrame } from '../render/frameLoop';
import { TimelineLayout } from '../render/timelineLayout';
import { ROWS, type TimelineView, drawTimeline } from '../render/timelineRenderer';
import { cursor } from './cursor';

interface Props {
  ops: Op[];
}

const MIN_PPO = 1.5;
const MAX_PPO = 40;
const FOLLOW_MARGIN = 48;
const CLICK_SLOP = 3;

export function Timeline(props: Props) {
  let canvas!: HTMLCanvasElement;
  const layout = new TimelineLayout(props.ops);
  const view: TimelineView = { ppo: 6, scrollX: 0, width: 0, height: 0 };
  let dirty = true;
  let drawnSeq = -1;
  let dragging = false;
  let initialised = false;

  const xToSeq = (clientX: number) => layout.seqAtX(clientX - canvas.getBoundingClientRect().left + view.scrollX, view.ppo);
  const cursorScreenX = () => layout.boundaryX(cursor.seq, view.ppo) - view.scrollX;

  const clampScroll = () => {
    const max = Math.max(0, layout.width(view.ppo) - view.width + FOLLOW_MARGIN);
    view.scrollX = Math.min(max, Math.max(-FOLLOW_MARGIN, view.scrollX));
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    view.width = canvas.clientWidth;
    view.height = canvas.clientHeight;
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(view.height * dpr);
    if (!initialised) {
      view.scrollX = layout.width(view.ppo) - view.width + FOLLOW_MARGIN;
      initialised = true;
    }
    clampScroll();
    dirty = true;
  };

  const draw = () => {
    if (!view.width) return;
    // Keep the cursor in view when it moves by keyboard.
    if (!dragging && cursor.seq !== drawnSeq) {
      const x = cursorScreenX();
      if (x < FOLLOW_MARGIN) view.scrollX += x - FOLLOW_MARGIN;
      else if (x > view.width - FOLLOW_MARGIN) view.scrollX += x - (view.width - FOLLOW_MARGIN);
      clampScroll();
      dirty = true;
    }
    if (!dirty && cursor.seq === drawnSeq) return;
    drawTimeline(canvas.getContext('2d')!, props.ops, layout, view, cursor.seq, window.devicePixelRatio || 1);
    drawnSeq = cursor.seq;
    dirty = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom around the pointer: keep the boundary under it in place.
      const px = e.clientX - canvas.getBoundingClientRect().left;
      const anchor = layout.seqAtX(px + view.scrollX, view.ppo);
      view.ppo = Math.min(MAX_PPO, Math.max(MIN_PPO, view.ppo * Math.exp(-e.deltaY * 0.01)));
      view.scrollX = layout.boundaryX(anchor, view.ppo) - px;
    } else {
      // Horizontal scroll, and vertical wheel also scrolls along time.
      view.scrollX += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    }
    clampScroll();
    dirty = true;
  };

  // Drag on the ruler, the ticks or the cursor scrubs; drag elsewhere pans;
  // a click anywhere jumps.
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const localY = e.clientY - canvas.getBoundingClientRect().top;
    const nearCursor = Math.abs(e.clientX - canvas.getBoundingClientRect().left - cursorScreenX()) < 6;
    const scrub = localY < ROWS.ticksBottom || nearCursor;
    const startX = e.clientX;
    let moved = false;
    dragging = true;

    if (scrub) {
      cursor.scrubbing = true;
      cursor.seq = xToSeq(e.clientX);
    }

    const move = (m: PointerEvent) => {
      if (Math.abs(m.clientX - startX) > CLICK_SLOP) moved = true;
      if (scrub) cursor.seq = xToSeq(m.clientX);
      else {
        view.scrollX -= m.movementX;
        clampScroll();
        dirty = true;
      }
    };
    const up = (u: PointerEvent) => {
      if (!scrub && !moved) cursor.seq = xToSeq(u.clientX);
      cursor.scrubbing = false;
      dragging = false;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  onMount(() => {
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
