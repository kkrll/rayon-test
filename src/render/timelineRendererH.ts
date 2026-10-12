import { formatList } from '../engine/summary';
import type { Op } from '../engine/types';
import { dayIndex, formatDay, formatMonth, formatTime } from '../ui/format';
import { THUMB_H, THUMB_W } from './previews';
import { type CardCandidate, placeCards } from './sessionLayout';
import type { Theme } from './theme';
import { type TimelineLayout, breakPx } from './timelineLayout';
import {
  type PlacedCard,
  type TimelineScene,
  type TimelineView,
  TAB_RADIUS,
  axisToY,
  drawAvatar,
  drawFeather,
  fit,
  kindColors,
  tickThickness,
  monthIndex,
  tierFor,
  weekIndex,
  yToAxis,
} from './timelineRenderer';

/**
 * Horizontal timeline (narrow screens): newest edit on the right, older to
 * the left. It shares the vertical strip's layout and scroll maths: the view
 * is the same, with `height` the strip's length (canvas width) and `width`
 * its depth (canvas height); an axis position lands at x = height - y.
 *
 * Rows, top to bottom: day labels and the head's tab, ticks (session lanes
 * centred across them), cards (thumbnail over avatar, edit count and time).
 */
const TICKS_TOP = 28;
const TICKS_H = 56;
const LANE_STEP = 4;

export const ROWS = {
  labelTop: 0,
  labelH: 20,
  ticksTop: TICKS_TOP,
  ticksH: TICKS_H,
  laneStep: LANE_STEP,
  cardsTop: TICKS_TOP + TICKS_H + 12,
};

const CARD_W = THUMB_W + 24;
const CARD_GAP = 8;
const CARD_TEXT_H = 36;
const PAD = 12;
const FEATHER = 24;

export function drawTimelineH(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  view: TimelineView,
  dpr: number,
  theme: Theme,
): PlacedCard[] {
  const { ops, layout } = scene;
  const { ppo, width: depth, height: length, headY } = view;
  const tier = tierFor(ppo);
  const x = (a: number) => length - axisToY(layout, view, a);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, length, depth);

  // Visible op range: the left edge is the oldest point in view.
  const first = Math.max(1, layout.seqAt(yToAxis(layout, view, length), ppo));
  const last = Math.min(ops.length, layout.seqAt(yToAxis(layout, view, 0), ppo) + 1);

  if (tier === 'close') drawTicks(ctx, ops, layout, first, last, ppo, x, theme);
  else drawDensity(ctx, ops, layout, first, last, ppo, x, tier === 'middle' ? dayIndex : weekIndex, theme);
  drawLabels(ctx, ops, layout, view, first, last, x, tier, theme);
  const cards = drawSessions(ctx, scene, view, first, last, x, theme);

  // Edits right of the head are not applied to the model shown: dim them.
  const headX = length - headY;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = theme.background;
  ctx.fillRect(headX, 0, length - headX, depth);
  ctx.globalAlpha = 1;
  drawFeather(ctx, 0, FEATHER, depth, theme, 'right');
  drawFeather(ctx, length - FEATHER, FEATHER, depth, theme, 'left');

  const headOp = ops[layout.headSeqAt(yToAxis(layout, view, headY), ppo) - 1];
  drawHead(ctx, headX, depth, headOp?.ts ?? null, theme);
  return cards;
}

function drawTicks(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  first: number,
  last: number,
  ppo: number,
  x: (a: number) => number,
  theme: Theme,
) {
  const colors = kindColors(theme);
  const w = tickThickness(ppo);
  for (const kind of ['update', 'create', 'delete'] as const) {
    ctx.fillStyle = colors[kind];
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      if (ops[k - 1].kind === kind) ctx.rect(x(layout.tickAt(k, ppo)), ROWS.ticksTop, w, ROWS.ticksH);
    }
    ctx.fill();
  }
}

/** Zoomed out: one bar per day (or week); creates and deletes stay as hairlines. */
function drawDensity(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  first: number,
  last: number,
  ppo: number,
  x: (a: number) => number,
  groupOf: (ts: number) => number,
  theme: Theme,
) {
  ctx.fillStyle = theme.foreground05;
  ctx.beginPath();
  let start = first;
  for (let k = first; k <= last; k++) {
    if (k !== last && groupOf(ops[k].ts) === groupOf(ops[k - 1].ts)) continue;
    const left = x(layout.tickAt(start, ppo));
    ctx.rect(left, ROWS.ticksTop, Math.max(1, x(layout.boundaryAt(k, ppo)) - left), ROWS.ticksH);
    start = k + 1;
  }
  ctx.fill();

  const colors = kindColors(theme);
  for (const kind of ['create', 'delete'] as const) {
    ctx.fillStyle = colors[kind];
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      if (ops[k - 1].kind === kind) ctx.rect(x(layout.tickAt(k, ppo)), ROWS.ticksTop, 1, ROWS.ticksH);
    }
    ctx.fill();
  }
}

/**
 * A label where each day (month, when zoomed out) starts, with a hairline
 * down through the strip; the day the left edge is in stays pinned there.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  first: number,
  last: number,
  x: (a: number) => number,
  tier: string,
  theme: Theme,
) {
  const groupOf = tier === 'far' ? monthIndex : dayIndex;
  const format = tier === 'far' ? formatMonth : formatDay;
  const mid = ROWS.labelTop + ROWS.labelH / 2 + 0.5;
  ctx.font = `500 11px ${theme.fontMono}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Group starts in view, oldest first: [x, label].
  const starts: [number, string][] = [];
  for (let k = first; k <= last; k++) {
    if (k > 1 && groupOf(ops[k - 1].ts) === groupOf(ops[k - 2].ts)) continue;
    // A day starts after its break (the break sits between the two days).
    const left = k > 1 && tier === 'close' ? x(layout.tickAt(k, view.ppo)) - breakPx(view.ppo) : x(layout.tickAt(k, view.ppo));
    starts.push([left, format(ops[k - 1].ts).toUpperCase()]);
  }

  for (const [left] of starts) {
    ctx.fillStyle = theme.foreground03;
    ctx.fillRect(Math.round(left) + 0.5, 0, 1, view.width);
  }
  for (let i = 0; i < starts.length; i++) {
    const [left, label] = starts[i];
    // The leftmost group is pinned at the edge until the next one pushes it out.
    const next = starts[i + 1]?.[0] ?? Infinity;
    const lx = Math.min(Math.max(left + 6, PAD), next - ctx.measureText(label).width - 12);
    ctx.fillStyle = theme.foreground;
    ctx.fillText(label, lx, mid);
  }
  // Before the first start in view, the edge is mid-group: pin that group's label.
  if (starts.length === 0 || starts[0][0] > PAD + 6) {
    const label = format(ops[first - 1].ts).toUpperCase();
    const limit = starts[0]?.[0] ?? Infinity;
    ctx.fillStyle = theme.foreground;
    ctx.fillText(label, Math.min(PAD, limit - ctx.measureText(label).width - 12), mid);
  }
}

/** Author-coloured lanes for every session; cards where they fit, biggest first. */
function drawSessions(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  view: TimelineView,
  first: number,
  last: number,
  x: (a: number) => number,
  theme: Theme,
): PlacedCard[] {
  const { sessions, lanes, layout, authors } = scene;
  // Lanes (2px lines) centred in the ticks row.
  const laneCount = lanes.reduce((m, l) => Math.max(m, l + 1), 1);
  const lanesTop = ROWS.ticksTop + (ROWS.ticksH - ((laneCount - 1) * ROWS.laneStep + 2)) / 2;
  const candidates: CardCandidate[] = [];
  for (const s of sessions) {
    if (s.endSeq < first || s.startSeq > last) continue;
    const left = x(layout.tickAt(s.startSeq, view.ppo));
    const right = x(layout.boundaryAt(s.endSeq, view.ppo));
    ctx.fillStyle = authors.get(s.authorId)?.color ?? theme.foreground05;
    ctx.fillRect(left, lanesTop + lanes[s.index] * ROWS.laneStep, Math.max(2, right - left), 2);
    // A card ends where its session ends (its newest edit), like the snapshot it shows.
    const cardLeft = right - CARD_W;
    if (right > 0 && cardLeft < view.height) candidates.push({ index: s.index, top: cardLeft, priority: s.seqs.length });
  }
  const placed = placeCards(candidates, CARD_W + CARD_GAP);
  for (const c of placed) drawCard(ctx, scene, c.index, c.top, theme);
  return placed.map(({ index, top }) => ({ index, top }));
}

function drawCard(ctx: CanvasRenderingContext2D, scene: TimelineScene, index: number, left: number, theme: Theme) {
  const session = scene.sessions[index];
  const author = scene.authors.get(session.authorId);
  const preview = scene.previews.get(index);
  const lx = Math.round(left);
  const top = ROWS.cardsTop;

  if (preview) ctx.drawImage(preview.image, lx, top, THUMB_W, THUMB_H);
  else {
    ctx.fillStyle = theme.background07;
    ctx.fillRect(lx, top, THUMB_W, THUMB_H);
  }
  ctx.strokeStyle = theme.foreground03;
  ctx.lineWidth = 1;
  ctx.strokeRect(lx + 0.5, top + 0.5, THUMB_W - 1, THUMB_H - 1);

  // Each row (thumbnail, author and count, time) keeps 2px below it.
  const ty = top + THUMB_H + 2 + 10;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (author) drawAvatar(ctx, lx + 7, ty, 7, author, theme);
  ctx.fillStyle = theme.foreground;
  ctx.font = `500 12px ${theme.fontSans}`;
  ctx.fillText(`${session.seqs.length} edits`, lx + 18, ty + 1);
  ctx.font = `400 11px ${theme.fontMono}`;
  const area = preview ? formatList(preview.summary.areas, 1) : '';
  ctx.fillText(fit(ctx, `${formatTime(session.endTs)} ${area}`, CARD_W - 4), lx, ty + 18);
}

/** The card under a point (strip coordinates: x along, y across), or -1. */
export function cardAtPointH(cards: PlacedCard[], px: number, py: number): number {
  if (py < ROWS.cardsTop || py > ROWS.cardsTop + THUMB_H + CARD_TEXT_H) return -1;
  return cards.find((c) => px >= c.top && px <= c.top + CARD_W)?.index ?? -1;
}

const TAB_PAD = 8;

/** The head: a vertical line with one tab on the label row, "TUE 28 APR 12:53". */
function drawHead(ctx: CanvasRenderingContext2D, hx: number, depth: number, ts: number | null, theme: Theme) {
  const cx = Math.round(hx);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(cx - 1, 0, 2, depth);
  if (ts === null) return;

  ctx.font = `500 11px ${theme.fontMono}`;
  const text = `${formatDay(ts).toUpperCase()} ${formatTime(ts)}`;
  const w = ctx.measureText(text).width + TAB_PAD * 2;
  const left = Math.min(Math.max(0, cx - w / 2), ctx.canvas.width / (ctx.getTransform().a || 1) - w);
  ctx.fillStyle = theme.headTab;
  ctx.beginPath();
  ctx.roundRect(left, ROWS.labelTop, w, ROWS.labelH, TAB_RADIUS);
  ctx.fill();
  ctx.fillStyle = theme.headTabText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + TAB_PAD, ROWS.labelTop + ROWS.labelH / 2 + 0.5);
}
