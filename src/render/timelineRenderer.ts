import type { Op, OpKind } from '../engine/types';
import { dayIndex, formatDay, formatGap } from '../ui/format';
import { BREAK_PX, type TimelineLayout } from './timelineLayout';

/** Vertical bands of the strip, in CSS pixels. */
export const ROWS = {
  rulerTop: 0,
  ticksTop: 24,
  ticksBottom: 50,
};

export const KIND_COLORS: Record<OpKind, string> = {
  create: '#3f9a5c',
  update: '#9ba1aa',
  delete: '#d0524a',
};

const CURSOR_COLOR = '#2f6bff';
const RULE_COLOR = '#e4e4df';
const TEXT_COLOR = '#6f6f6a';
const BREAK_COLOR = '#f0f0ec';

export interface TimelineView {
  ppo: number; // pixels per op
  scrollX: number; // content x at the left edge
  width: number; // CSS px
  height: number;
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  cursorSeq: number,
  dpr: number,
) {
  const { ppo, scrollX, width, height } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Visible op range, with one op of margin on each side.
  const first = Math.max(1, layout.seqAtX(scrollX, ppo));
  const last = Math.min(ops.length, layout.seqAtX(scrollX + width, ppo) + 1);
  const x = (k: number) => layout.tickX(k, ppo) - scrollX;

  drawBreaks(ctx, ops, layout, view, first, last);
  drawDayRuler(ctx, ops, first, last, x, height);

  // One pass per kind keeps fillStyle changes to three per frame.
  const tickW = Math.max(1, ppo - 1);
  const tickH = ROWS.ticksBottom - ROWS.ticksTop;
  for (const kind of ['update', 'create', 'delete'] as const) {
    ctx.fillStyle = KIND_COLORS[kind];
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      if (ops[k - 1].kind === kind) ctx.rect(x(k), ROWS.ticksTop, tickW, tickH);
    }
    ctx.fill();
  }

  drawCursor(ctx, layout.boundaryX(cursorSeq, ppo) - scrollX, height);
}

function drawDayRuler(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  first: number,
  last: number,
  x: (k: number) => number,
  height: number,
) {
  // Day starts in view, plus the day already in progress at the left edge.
  const starts: { x: number; ts: number }[] = [];
  if (first > 1 && dayIndex(ops[first - 1].ts) === dayIndex(ops[first - 2].ts)) {
    starts.push({ x: -Infinity, ts: ops[first - 1].ts });
  }
  for (let k = first; k <= last; k++) {
    if (k > 1 && dayIndex(ops[k - 1].ts) === dayIndex(ops[k - 2].ts)) continue;
    starts.push({ x: Math.round(x(k)) + 0.5, ts: ops[k - 1].ts });
  }

  ctx.font = '500 11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  starts.forEach((start, i) => {
    if (start.x > -Infinity) {
      ctx.fillStyle = RULE_COLOR;
      ctx.fillRect(start.x, ROWS.rulerTop, 1, height);
    }
    // Sticky label: pinned to the left edge, pushed out by the next one.
    const text = formatDay(start.ts);
    let labelX = Math.max(start.x, 0) + 4;
    const next = starts[i + 1];
    if (next) labelX = Math.min(labelX, next.x - ctx.measureText(text).width - 8);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(text, labelX, ROWS.rulerTop + 6);
  });
}

function drawBreaks(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  first: number,
  last: number,
) {
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of layout.breaks) {
    if (b < first - 1 || b > last) continue;
    const left = layout.boundaryX(b, view.ppo) - view.scrollX;
    ctx.fillStyle = BREAK_COLOR;
    ctx.fillRect(left + 2, ROWS.ticksTop, BREAK_PX - 4, view.height - ROWS.ticksTop);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(formatGap(ops[b].ts - ops[b - 1].ts), left + BREAK_PX / 2, (ROWS.ticksTop + ROWS.ticksBottom) / 2);
  }
}

function drawCursor(ctx: CanvasRenderingContext2D, x: number, height: number) {
  const cx = Math.round(x);
  ctx.fillStyle = CURSOR_COLOR;
  ctx.fillRect(cx - 1, ROWS.rulerTop, 2, height);
  ctx.beginPath();
  ctx.moveTo(cx - 6, ROWS.rulerTop);
  ctx.lineTo(cx + 6, ROWS.rulerTop);
  ctx.lineTo(cx, ROWS.rulerTop + 8);
  ctx.closePath();
  ctx.fill();
}
