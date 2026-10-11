import { onCleanup, onMount } from 'solid-js';
import type { Op } from '../engine/types';
import { FRAME_ORDER, onFrame } from '../render/frameLoop';
import { type Theme, readTheme } from '../render/theme';
import { TimelineLayout } from '../render/timelineLayout';
import { TOP_PAD, type TimelineView, drawTimeline, yToAxis } from '../render/timelineRenderer';
import { cursor } from './cursor';

interface Props {
  ops: Op[];
  /** Called at most once per frame, after the strip was drawn at a new seq. */
  onSeqDrawn?: (seq: number) => void;
}

/** The playhead stays fixed at this fraction of the strip's height. */
const HEAD_RATIO = 0.3;
const MIN_PPO = 1.5;
const MAX_PPO = 40;
const CLICK_SLOP = 3;
/** Input idle this long ends a scroll gesture. */
const SETTLE_MS = 150;
/** Motion tokens: --duration-micro for the snap, --duration-enter for a jump. */
const SNAP_MS = 80;
const JUMP_MS = 200;

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/** Ease-out, approximating --ease-entrance: fast start, gentle landing. */
const easeOut = (t: number) => 1 - (1 - t) ** 4;

/**
 * Fixed-playhead timeline: scrolling moves history under the head, and the
 * seq under the head is the cursor. Scroll is the single source of truth;
 * keyboard steps and clicks only set a scroll target.
 */
export function Timeline(props: Props) {
  let canvas!: HTMLCanvasElement;
  let theme: Theme;
  const layout = new TimelineLayout(props.ops);
  const view: TimelineView = { ppo: 6, scroll: 0, width: 0, height: 0, headY: 0 };
  let publishedSeq = -1;
  let tween: Tween | null = null;
  let lastInput = 0;
  let dragging = false;
  let dirty = true;

  /** Scroll that puts boundary `seq` exactly on the head. */
  const scrollFor = (seq: number) => TOP_PAD + layout.length(view.ppo) - view.headY - layout.boundaryAt(seq, view.ppo);
  const seqAtY = (y: number) => layout.seqAt(yToAxis(layout, view, y), view.ppo);
  const seqAtHead = () => seqAtY(view.headY);
  const localY = (clientY: number) => clientY - canvas.getBoundingClientRect().top;

  const setScroll = (scroll: number) => {
    view.scroll = Math.min(scrollFor(0), Math.max(scrollFor(props.ops.length), scroll));
    dirty = true;
  };

  const animateTo = (seq: number, duration: number) => {
    tween = { from: view.scroll, to: scrollFor(seq), start: performance.now(), duration };
    cursor.scrubbing = true;
  };

  const markInput = () => {
    lastInput = performance.now();
    tween = null;
    cursor.scrubbing = true;
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    view.width = canvas.clientWidth;
    view.height = canvas.clientHeight;
    view.headY = Math.round(view.height * HEAD_RATIO);
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(view.height * dpr);
    if (publishedSeq >= 0) setScroll(scrollFor(publishedSeq));
    dirty = true;
  };

  const frame = (now: number) => {
    if (!view.height) return;

    // The cursor moved from outside (keyboard): bring that seq under the head.
    if (cursor.seq !== publishedSeq) {
      tween = null;
      setScroll(scrollFor(cursor.seq));
    }

    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.duration);
      setScroll(tween.from + (tween.to - tween.from) * easeOut(t));
      if (t === 1) tween = null;
    }

    // Gesture over: settle so a boundary sits exactly on the head.
    if (cursor.scrubbing && !dragging && !tween && now - lastInput > SETTLE_MS) {
      const seq = seqAtHead();
      if (Math.abs(scrollFor(seq) - view.scroll) > 0.5) animateTo(seq, SNAP_MS);
      else cursor.scrubbing = false;
    }

    if (!dirty) return;
    const seq = seqAtHead();
    cursor.seq = seq;
    drawTimeline(canvas.getContext('2d')!, props.ops, layout, view, window.devicePixelRatio || 1, theme);
    if (seq !== publishedSeq) props.onSeqDrawn?.(seq);
    publishedSeq = seq;
    dirty = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom around the head, so the model shown does not change.
      const seq = seqAtHead();
      view.ppo = Math.min(MAX_PPO, Math.max(MIN_PPO, view.ppo * Math.exp(-e.deltaY * 0.01)));
      setScroll(scrollFor(seq));
      return;
    }
    markInput();
    setScroll(view.scroll + e.deltaY);
  };

  // Drag anywhere moves history under the head; a click brings the clicked
  // point to the head.
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let moved = false;
    dragging = true;

    const move = (m: PointerEvent) => {
      if (!moved && Math.abs(m.clientY - startY) <= CLICK_SLOP) return;
      moved = true;
      markInput();
      setScroll(view.scroll - m.movementY);
    };
    const up = (u: PointerEvent) => {
      dragging = false;
      if (!moved) animateTo(seqAtY(localY(u.clientY)), JUMP_MS);
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
    const stop = onFrame(frame, FRAME_ORDER.input);
    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  return <canvas ref={canvas} class="timeline" onPointerDown={onPointerDown} />;
}
