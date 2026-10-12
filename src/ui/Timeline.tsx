import { onCleanup, onMount } from 'solid-js';
import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import type { Author } from '../engine/types';
import { FRAME_ORDER, onFrame } from '../render/frameLoop';
import { type DrawThumbnail, type Preview, SessionPreviews } from '../render/previews';
import { assignLanes } from '../render/sessionLayout';
import { stats } from '../render/stats';
import { type Theme, readTheme } from '../render/theme';
import { TimelineLayout } from '../render/timelineLayout';
import {
  type PlacedCard,
  TOP_PAD,
  type TimelineScene,
  type TimelineView,
  drawTimeline,
  sessionAtPoint,
  yToAxis,
} from '../render/timelineRenderer';
import { cursor } from './cursor';

export interface SessionHover {
  index: number;
  preview: Preview | undefined;
  clientY: number;
}

interface Props {
  history: History;
  sessions: Session[];
  authors: Author[];
  /** Draws session thumbnails; given the model (canvas) theme. */
  thumbnails: (theme: Theme) => DrawThumbnail;
  /** Called at most once per frame, after the strip was drawn at a new seq. */
  onSeqDrawn?: (seq: number) => void;
  onHover?: (hover: SessionHover | null) => void;
}

/** The playhead stays fixed at this fraction of the strip's height. */
const HEAD_RATIO = 0.3;
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

/**
 * Fixed-playhead timeline: scrolling moves history under the head, and the
 * seq under the head is the cursor. Scroll is the single source of truth;
 * keyboard steps and clicks only set a scroll target.
 */
export function Timeline(props: Props) {
  let canvas!: HTMLCanvasElement;
  let theme: Theme;
  let scene: TimelineScene;
  let cards: PlacedCard[] = [];
  const ops = props.history.ops;
  const layout = new TimelineLayout(ops);
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

    // Thumbnails that came into view last frame; redraw if any got ready.
    if (scene.previews.build(PREVIEW_BUDGET_MS)) dirty = true;

    if (!dirty) return;
    const seq = seqAtHead();
    cursor.seq = seq;
    const start = performance.now();
    cards = drawTimeline(canvas.getContext('2d')!, scene, view, window.devicePixelRatio || 1, theme);
    stats.timeline.record(performance.now() - start);
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

  const onHoverMove = (e: PointerEvent) => {
    if (dragging || e.buttons) return;
    const rect = canvas.getBoundingClientRect();
    const index = sessionAtPoint(scene, view, cards, e.clientX - rect.left, e.clientY - rect.top);
    props.onHover?.(index < 0 ? null : { index, preview: scene.previews.get(index), clientY: e.clientY });
  };

  // Drag anywhere moves history under the head; a click brings the clicked
  // point to the head.
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let moved = false;
    dragging = true;
    props.onHover?.(null);

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
    // Thumbnails show the model, so they use the canvas (light) theme.
    const modelTheme = readTheme(document.documentElement);
    scene = {
      ops,
      layout,
      sessions: props.sessions,
      lanes: assignLanes(props.sessions),
      authors: new Map(props.authors.map((a) => [a.id, a])),
      previews: new SessionPreviews(props.history, props.sessions, props.thumbnails(modelTheme), modelTheme),
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const stop = onFrame(frame, FRAME_ORDER.input);
    onCleanup(() => {
      observer.disconnect();
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
