import { onCleanup, onMount } from 'solid-js';
import { track } from '../analytics';
import type { Lens } from '../engine/lens';
import type { Author } from '../engine/types';
import { FRAME_ORDER, onFrame } from '../render/frameLoop';
import type { Preview, PreviewSource } from '../render/previews';
import { assignLanes } from '../render/sessionLayout';
import { stats } from '../render/stats';
import { type Theme, readTheme } from '../render/theme';
import { TimelineLayout } from '../render/timelineLayout';
import {
  type PlacedCard,
  TOP_PAD,
  type TimelineScene,
  type TimelineView,
  cardAtPoint,
  drawTimeline,
  sessionAtPoint,
  yToAxis,
} from '../render/timelineRenderer';
import { cardAtPointH, drawTimelineH } from '../render/timelineRendererH';
import { cursor } from './cursor';

export interface SessionHover {
  /** Index into the project's (unfiltered) sessions. */
  index: number;
  /** Edits of the session that pass the filter (all of them without one). */
  shown: number;
  preview: Preview | undefined;
  clientY: number;
}

interface Props {
  /** The (possibly filtered) history to show; positions translate to seqs. */
  lens: Lens;
  authors: Author[];
  /** Previews per lens session (summaries narrowed to the filter). */
  previews: PreviewSource;
  /** Zoom, kept across filter changes (the timeline remounts on each). */
  zoom: { ppo: number };
  /** Called at most once per frame, after the strip was drawn at a new (real) seq. */
  onSeqDrawn?: (seq: number) => void;
  onHover?: (hover: SessionHover | null) => void;
  /** Vertical in the side panel; horizontal under the model on narrow screens. */
  orientation: 'vertical' | 'horizontal';
}

/**
 * The playhead stays fixed at this fraction of the strip, measured from its
 * newest end: from the top when vertical, from the right when horizontal.
 */
const HEAD_RATIO = { vertical: 0.5, horizontal: 0.5 };
const MIN_PPO = 0.03;
const MAX_PPO = 40;
const CLICK_SLOP = 3;
/** Input idle this long ends a scroll gesture. */
const SETTLE_MS = 100;
/** Motion tokens: --duration-micro for the snap, --duration-enter for a jump. */
const SNAP_MS = 80;
const JUMP_MS = 200;
/** Thumbnail work allowed per frame; the rest waits for the next one. */
const PREVIEW_BUDGET_MS = 4;

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/** Ease-out, approximating --ease-entrance: fast start, gentle landing. */
const easeOut = (t: number) => 1 - (1 - t) ** 4;

// Time runs upwards in the panel, so Up and Right both mean "newer".
const KEY_DIRECTION: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

/**
 * Fixed-playhead timeline: scrolling moves history under the head, and the
 * edit under the head is the cursor. Scroll is the single source of truth;
 * keyboard steps and clicks only set a scroll target.
 *
 * Internally everything is in lens positions (only the edits that pass the
 * filter); the cursor and callbacks get real seqs.
 */
export function Timeline(props: Props) {
  let canvas!: HTMLCanvasElement;
  let theme: Theme;
  let scene: TimelineScene;
  let cards: PlacedCard[] = [];
  const { lens } = props;
  const ops = lens.ops;
  const layout = new TimelineLayout(ops);
  const view: TimelineView = { ppo: props.zoom.ppo, scroll: 0, width: 0, height: 0, headY: 0 };
  /** Session ends (positions) are the snapshots: Shift+arrow steps between them. */
  const sessionEnds = [...new Set(lens.sessions.map((s) => s.endSeq))].sort((a, b) => a - b);
  let publishedSeq = -1;
  let tween: Tween | null = null;
  let lastInput = 0;
  let dragging = false;
  let dirty = true;

  /** Scroll that puts boundary `seq` exactly on the head (mid-break if one follows). */
  const scrollFor = (seq: number) => TOP_PAD + layout.length(view.ppo) - view.headY - layout.headAt(seq, view.ppo);
  const seqAtY = (y: number) => layout.headSeqAt(yToAxis(layout, view, y), view.ppo);
  const seqAtHead = () => seqAtY(view.headY);
  const horizontal = props.orientation === 'horizontal';
  // The view is orientation-free: `height` is the strip's length along time
  // and y the distance from its newest end; `width` its depth. A horizontal
  // strip runs newest-right, so its along-time y is the distance from the right.
  /** Pointer position as (along time, across) in view coordinates. */
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];
    return horizontal ? [view.height - x, y] : [y, x];
  };
  /** The card at a pointer position, or -1. */
  const cardAt = (along: number, across: number) =>
    horizontal ? cardAtPointH(cards, view.height - along, across) : cardAtPoint(view, cards, across, along);

  const setScroll = (scroll: number) => {
    view.scroll = Math.min(scrollFor(0), Math.max(scrollFor(ops.length), scroll));
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
    view.width = horizontal ? canvas.clientHeight : canvas.clientWidth;
    view.height = horizontal ? canvas.clientWidth : canvas.clientHeight;
    view.headY = Math.round(view.height * HEAD_RATIO[props.orientation]);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    if (publishedSeq >= 0) setScroll(scrollFor(lens.posOf(publishedSeq)));
    dirty = true;
  };

  const frame = (now: number) => {
    if (!view.height) return;

    // The cursor moved from outside (keyboard, another view): bring it under the head.
    if (cursor.seq !== publishedSeq) {
      tween = null;
      setScroll(scrollFor(lens.posOf(cursor.seq)));
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

    // Thumbnails that came into view last frame; redraw if any got ready.
    if (scene.previews.build(PREVIEW_BUDGET_MS)) dirty = true;

    if (!dirty) return;
    const seq = lens.seqOf(seqAtHead());
    cursor.seq = seq;
    const start = performance.now();
    const draw = horizontal ? drawTimelineH : drawTimeline;
    cards = draw(canvas.getContext('2d')!, scene, view, window.devicePixelRatio || 1, theme);
    stats.timeline.record(performance.now() - start);
    if (seq !== publishedSeq) props.onSeqDrawn?.(seq);
    publishedSeq = seq;
    dirty = false;
  };

  /** Zoom around the head, so the model shown does not change. */
  const zoomTo = (ppo: number) => {
    const seq = seqAtHead();
    view.ppo = Math.min(MAX_PPO, Math.max(MIN_PPO, ppo));
    props.zoom.ppo = view.ppo;
    setScroll(scrollFor(seq));
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomTo(view.ppo * Math.exp(-e.deltaY * 0.01));
      return;
    }
    markInput();
    // Towards older history is +scroll: down, or left on a horizontal strip.
    setScroll(view.scroll + (horizontal ? e.deltaY - e.deltaX : e.deltaY));
  };

  const onHoverMove = (e: PointerEvent) => {
    if (dragging || e.buttons) return;
    const [along, across] = local(e);
    canvas.style.cursor = cardAt(along, across) >= 0 ? 'pointer' : '';
    // The hover card floats beside the side panel; the horizontal strip has none.
    if (horizontal) return;
    const index = sessionAtPoint(scene, view, cards, across, along);
    props.onHover?.(
      index < 0
        ? null
        : { index: lens.origin[index], shown: lens.sessions[index].seqs.length, preview: props.previews.get(index), clientY: e.clientY },
    );
  };

  /** Pointers down on the strip, for pinching. */
  const pointers = new Map<number, { x: number; y: number }>();
  /** Finger distance and zoom when the second finger landed. */
  let pinch: { distance: number; ppo: number } | null = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  };

  // Drag anywhere moves history under the head. A click on a card jumps to
  // that session's snapshot (its end); elsewhere it brings the point to the head.
  // Two fingers pinch to zoom; the first finger's listeners serve both.
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinch = { distance: spread(), ppo: view.ppo };
      markInput();
    }
    if (pointers.size > 1) return;

    const [startAlong] = local(e);
    let moved = false;
    dragging = true;
    props.onHover?.(null);

    const move = (m: PointerEvent) => {
      if (pointers.has(m.pointerId)) pointers.set(m.pointerId, { x: m.clientX, y: m.clientY });
      if (pinch) {
        if (pointers.size === 2) zoomTo(pinch.ppo * (spread() / pinch.distance));
        return;
      }
      if (m.pointerId !== e.pointerId) return;
      if (!moved && Math.abs(local(m)[0] - startAlong) <= CLICK_SLOP) return;
      moved = true;
      markInput();
      // Content follows the pointer.
      setScroll(view.scroll + (horizontal ? m.movementX : -m.movementY));
    };
    const up = (u: PointerEvent) => {
      pointers.delete(u.pointerId);
      if (pinch) {
        // A pinch is never a click; lifting a finger ends it.
        moved = true;
        if (pointers.size < 2) pinch = null;
      } else if (u.pointerId === e.pointerId && !moved && u.type === 'pointerup') {
        const [along, across] = local(u);
        const card = cardAt(along, across);
        if (card >= 0) track('session_card_clicked', { edits: lens.sessions[card].seqs.length, orientation: props.orientation });
        animateTo(card >= 0 ? lens.sessions[card].endSeq : seqAtY(along), JUMP_MS);
      }
      if (pointers.size > 0) return;
      dragging = false;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  };

  /** Arrows step one edit, Shift+arrows one snapshot, among the edits shown. */
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = KEY_DIRECTION[e.key];
    if (!dir) return;
    e.preventDefault();
    const pos = lens.posOf(cursor.seq);
    let next: number;
    if (e.shiftKey) {
      const end = dir > 0 ? sessionEnds.find((s) => s > pos) : sessionEnds.findLast((s) => s < pos);
      next = end ?? (dir > 0 ? ops.length : 0);
    } else {
      next = Math.max(0, Math.min(ops.length, pos + dir));
    }
    cursor.seq = lens.seqOf(next);
  };

  onMount(() => {
    theme = readTheme(canvas);
    scene = {
      ops,
      layout,
      sessions: lens.sessions,
      lanes: assignLanes(lens.sessions),
      authors: new Map(props.authors.map((a) => [a.id, a])),
      previews: props.previews,
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    const stop = onFrame(frame, FRAME_ORDER.input);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      stop();
    });
  });

  return (
    <canvas
      ref={canvas}
      class="timeline"
      onPointerDown={onPointerDown}
      onPointerMove={onHoverMove}
      onPointerLeave={() => props.onHover?.(null)}
    />
  );
}
