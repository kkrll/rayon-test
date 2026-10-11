import type { Op, OpKind } from '../engine/types';
import { dayIndex, formatDay, formatGap } from '../ui/format';
import type { Theme } from './theme';
import { BREAK_PX, type TimelineLayout } from './timelineLayout';

/**
 * Vertical timeline: newest edit at the top, older edits further down.
 * Every gap between days is a compressed break, and that band doubles as
 * the header of the day below it.
 */

/** Horizontal columns of the strip, in CSS pixels. */
export const COLUMNS = {
  ticksLeft: 16,
  ticksWidth: 20,
  /** Everything left of this scrubs; right of it is the sessions area. */
  scrubRight: 48,
  labelLeft: 16,
};

/** Space above the newest edit, holding the newest day's header. */
export const TOP_PAD = BREAK_PX;
export const BOTTOM_PAD = 24;

export interface TimelineView {
  ppo: number; // pixels per op along the time axis
  scroll: number; // CSS px scrolled down from the newest edit
  width: number;
  height: number;
  /** Fixed playhead position; history scrolls underneath it. */
  headY: number;
}

/** Maps a position on the time axis to screen y (time runs upwards). */
export function axisToY(layout: TimelineLayout, view: TimelineView, a: number) {
  return TOP_PAD + layout.length(view.ppo) - a - view.scroll;
}

export function yToAxis(layout: TimelineLayout, view: TimelineView, y: number) {
  return TOP_PAD + layout.length(view.ppo) - view.scroll - y;
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  dpr: number,
  theme: Theme,
) {
  const { ppo, width, height, headY } = view;
  const y = (a: number) => axisToY(layout, view, a);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Visible op range, with one op of margin on each side.
  const first = Math.max(1, layout.seqAt(yToAxis(layout, view, height), ppo));
  const last = Math.min(ops.length, layout.seqAt(yToAxis(layout, view, 0), ppo) + 1);

  drawTicks(ctx, ops, layout, first, last, ppo, y, theme);
  drawBreaks(ctx, ops, layout, view, first, last, y, theme);

  // Edits above the head are not applied to the model shown: dim them.
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, headY);
  ctx.globalAlpha = 1;

  drawStickyDay(ctx, ops, layout, view, last, y, theme);
  drawHead(ctx, headY, width, theme);
}

function drawTicks(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  first: number,
  last: number,
  ppo: number,
  y: (a: number) => number,
  theme: Theme,
) {
  const colors: Record<OpKind, string> = { update: theme.foreground05, create: theme.added, delete: theme.deleted };
  const tickH = Math.max(1, ppo - 1);
  // One pass per kind keeps fillStyle changes to three per frame.
  for (const kind of ['update', 'create', 'delete'] as const) {
    ctx.fillStyle = colors[kind];
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      if (ops[k - 1].kind !== kind) continue;
      ctx.rect(COLUMNS.ticksLeft, y(layout.tickAt(k, ppo) + ppo), COLUMNS.ticksWidth, tickH);
    }
    ctx.fill();
  }
}

/**
 * Break bands. A band at boundary b sits between op b (below, older) and
 * op b+1 (above, newer). If the day changes there, it is also the header
 * of op b's day.
 */
function drawBreaks(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  first: number,
  last: number,
  y: (a: number) => number,
  theme: Theme,
) {
  for (const b of layout.breaks) {
    if (b < first - 1 || b > last) continue;
    const top = y(layout.boundaryAt(b, view.ppo) + BREAK_PX);
    const gap = formatGap(ops[b].ts - ops[b - 1].ts);
    const day = dayIndex(ops[b - 1].ts) !== dayIndex(ops[b].ts) ? formatDay(ops[b - 1].ts) : null;
    drawBand(ctx, top, view.width, day, gap, theme);
  }
  // The newest day has no break above it: its header lives in the top padding.
  if (last === ops.length) drawBand(ctx, y(layout.length(view.ppo) + TOP_PAD), view.width, formatDay(ops[ops.length - 1].ts), null, theme);
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  top: number,
  width: number,
  day: string | null,
  gap: string | null,
  theme: Theme,
) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, top, width, BREAK_PX);
  ctx.fillStyle = theme.foreground03;
  ctx.fillRect(0, Math.round(top) + 0.5, width, 1);

  const mid = top + BREAK_PX / 2 + 1;
  ctx.textBaseline = 'middle';
  ctx.font = `500 11px ${theme.fontMono}`;
  if (day) {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.foreground;
    ctx.fillText(day.toUpperCase(), COLUMNS.labelLeft, mid);
  }
  if (gap) {
    // Secondary by weight, not by a fainter step: -07 fails contrast on dark.
    ctx.font = `400 11px ${theme.fontMono}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.foreground;
    ctx.fillText(gap, width - 16, mid);
  }
}

/**
 * Keeps the header of the day at the top of the view pinned while its own
 * band is scrolled away; the next day's band pushes it out.
 */
function drawStickyDay(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  topOp: number,
  y: (a: number) => number,
  theme: Theme,
) {
  const day = dayIndex(ops[topOp - 1].ts);
  let newest = topOp;
  while (newest < ops.length && dayIndex(ops[newest].ts) === day) newest++;
  let oldest = topOp;
  while (oldest > 1 && dayIndex(ops[oldest - 2].ts) === day) oldest--;

  const headerTop = y(layout.boundaryAt(newest, view.ppo) + BREAK_PX);
  if (headerTop >= 0) return; // its own band is still in view

  // The band below this day (the older day's header) pushes this one up.
  const nextTop = oldest > 1 ? y(layout.boundaryAt(oldest - 1, view.ppo) + BREAK_PX) : Infinity;
  drawBand(ctx, Math.min(0, nextTop - BREAK_PX), view.width, formatDay(ops[topOp - 1].ts), null, theme);
}

function drawHead(ctx: CanvasRenderingContext2D, y: number, width: number, theme: Theme) {
  const cy = Math.round(y);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, cy - 1, width, 2);
  ctx.beginPath();
  ctx.moveTo(0, cy - 6);
  ctx.lineTo(8, cy);
  ctx.lineTo(0, cy + 6);
  ctx.closePath();
  ctx.fill();
}
