import type { Session } from '../engine/sessions';
import { formatList } from '../engine/summary';
import type { Author, Op, OpKind } from '../engine/types';
import { dayIndex, formatDay, formatGap, formatMonth, formatTime } from '../ui/format';
import { type PreviewSource, THUMB_H, THUMB_W } from './previews';
import { type CardCandidate, type Slot, placeCards } from './sessionLayout';
import type { Theme } from './theme';
import { BREAK_PX, type TimelineLayout, breakPx } from './timelineLayout';

/**
 * Vertical timeline: newest edit at the top, older edits further down.
 *
 * Semantic zoom by pixels per op:
 *   close   individual ticks; overnight breaks are day headers; all cards that fit
 *   middle  one density bar per day, day labels; only some cards
 *   far     one density bar per week, month labels; only the largest sessions' cards
 */
export type Tier = 'close' | 'middle' | 'far';

export function tierFor(ppo: number): Tier {
  return ppo >= 2 ? 'close' : ppo >= 0.35 ? 'middle' : 'far';
}

/** Horizontal columns of the strip, in CSS pixels. */
export const COLUMNS = {
  ticksLeft: 16,
  ticksWidth: 24,
  labelLeft: 16,
  lanesLeft: 44,
  laneStep: 4,
  cardsLeft: 64,
  right: 16,
};

const CARD_GAP = 8;
const LABEL_ROW = 16;

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

export interface TimelineScene {
  ops: Op[];
  layout: TimelineLayout;
  sessions: Session[];
  lanes: number[];
  authors: Map<string, Author>;
  previews: PreviewSource;
}

export interface PlacedCard {
  index: number;
  top: number;
}

/** Maps a position on the time axis to screen y (time runs upwards). */
export function axisToY(layout: TimelineLayout, view: TimelineView, a: number) {
  return TOP_PAD + layout.length(view.ppo) - a - view.scroll;
}

export function yToAxis(layout: TimelineLayout, view: TimelineView, y: number) {
  return TOP_PAD + layout.length(view.ppo) - view.scroll - y;
}

/** Draws the strip; returns the cards it placed, for hit testing. */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  view: TimelineView,
  dpr: number,
  theme: Theme,
): PlacedCard[] {
  const { ops, layout } = scene;
  const { ppo, width, height, headY } = view;
  const tier = tierFor(ppo);
  const y = (a: number) => axisToY(layout, view, a);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Visible op range, with one op of margin on each side.
  const first = Math.max(1, layout.seqAt(yToAxis(layout, view, height), ppo));
  const last = Math.min(ops.length, layout.seqAt(yToAxis(layout, view, 0), ppo) + 1);

  let reserved: Slot[];
  if (tier === 'close') {
    drawTicks(ctx, ops, layout, first, last, ppo, y, theme);
    reserved = drawBreaks(ctx, ops, layout, view, first, last, y, theme);
  } else {
    drawDensity(ctx, ops, layout, first, last, ppo, y, tier === 'middle' ? dayIndex : weekIndex, theme);
    reserved = drawGroupLabels(ctx, ops, layout, view, first, last, y, tier, theme);
  }

  const cards = drawSessions(ctx, scene, view, first, last, y, reserved, theme);

  // Edits above the head are not applied to the model shown: dim them.
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, headY);
  ctx.globalAlpha = 1;
  drawFeather(ctx, 0, FEATHER_TOP, width, theme, 'down');
  drawFeather(ctx, height - FEATHER_BOTTOM, FEATHER_BOTTOM, width, theme, 'up');

  if (tier === 'close') drawStickyDay(ctx, ops, layout, view, last, y, theme);
  else drawPinnedHeader(ctx, ops, layout, view, tier, theme);
  // The edit under the head (none at the very start).
  const headOp = ops[layout.headSeqAt(yToAxis(layout, view, headY), ppo) - 1];
  drawHead(ctx, headY, width, headOp?.ts ?? null, theme);
  return cards;
}

/** Soft edges where history scrolls out of view (the top one ends under the day header). */
const FEATHER_TOP = 64;
const FEATHER_BOTTOM = 48;

/** A fade to the ground colour across `size` px, solid at the outer edge. */
export function drawFeather(
  ctx: CanvasRenderingContext2D,
  at: number,
  size: number,
  across: number,
  theme: Theme,
  towards: 'down' | 'up' | 'right' | 'left',
) {
  const horizontal = towards === 'right' || towards === 'left';
  const solidFirst = towards === 'down' || towards === 'right';
  const gradient = horizontal
    ? ctx.createLinearGradient(at, 0, at + size, 0)
    : ctx.createLinearGradient(0, at, 0, at + size);
  gradient.addColorStop(solidFirst ? 0 : 1, theme.background);
  gradient.addColorStop(solidFirst ? 1 : 0, transparent(theme.background));
  ctx.fillStyle = gradient;
  if (horizontal) ctx.fillRect(at, 0, size, across);
  else ctx.fillRect(0, at, across, size);
}

/** The same colour at zero alpha, so the fade doesn't pass through grey. */
function transparent(hex: string) {
  return hex.length === 7 ? `${hex}00` : 'transparent';
}

// ---------------------------------------------------------------- ticks

/** A tick fills about half its slot: thin marks with clear gaps between edits. */
export function tickThickness(ppo: number) {
  return Math.max(1, Math.floor(ppo / 4));
}

export function kindColors(theme: Theme): Record<OpKind, string> {
  return { update: theme.foreground05, create: theme.added, delete: theme.deleted };
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
  const colors = kindColors(theme);
  const tickH = tickThickness(ppo);
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

export function weekIndex(ts: number) {
  // Day 0 (1 Jan 1970) was a Thursday; +3 makes weeks start on Monday.
  return Math.floor((dayIndex(ts) + 3) / 7);
}

export function monthIndex(ts: number) {
  const d = new Date(ts);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Zoomed out, ticks merge: one solid bar per day (or week). Creates and
 * deletes stay visible on top as hairlines; they mark structural moments.
 */
function drawDensity(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  first: number,
  last: number,
  ppo: number,
  y: (a: number) => number,
  groupOf: (ts: number) => number,
  theme: Theme,
) {
  ctx.fillStyle = theme.foreground05;
  ctx.beginPath();
  let start = first;
  for (let k = first; k <= last; k++) {
    const endOfGroup = k === last || groupOf(ops[k].ts) !== groupOf(ops[k - 1].ts);
    if (!endOfGroup) continue;
    const top = y(layout.boundaryAt(k, ppo));
    const bottom = y(layout.tickAt(start, ppo));
    ctx.rect(COLUMNS.ticksLeft, top, COLUMNS.ticksWidth, Math.max(1, bottom - top));
    start = k + 1;
  }
  ctx.fill();

  const colors = kindColors(theme);
  for (const kind of ['create', 'delete'] as const) {
    ctx.fillStyle = colors[kind];
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      if (ops[k - 1].kind === kind) ctx.rect(COLUMNS.ticksLeft, y(layout.tickAt(k, ppo) + ppo), COLUMNS.ticksWidth, 1);
    }
    ctx.fill();
  }
}

// ---------------------------------------------------------------- labels

/**
 * Close tier: break bands. A band at boundary b sits between op b (below,
 * older) and op b+1 (above, newer); if the day changes there, it is also the
 * header of op b's day. Returns the bands as reserved rows for cards.
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
): Slot[] {
  const size = breakPx(view.ppo);
  const slots: Slot[] = [];
  for (const b of layout.breaks) {
    if (b < first - 1 || b > last) continue;
    const top = y(layout.boundaryAt(b, view.ppo) + size);
    const gap = formatGap(ops[b].ts - ops[b - 1].ts);
    const day = dayIndex(ops[b - 1].ts) !== dayIndex(ops[b].ts) ? formatDay(ops[b - 1].ts) : null;
    drawBand(ctx, top, size, view.width, day, gap, theme);
    slots.push({ top, height: size });
  }
  // The newest day has no break above it: its header lives in the top padding.
  if (last === ops.length) {
    const top = y(layout.length(view.ppo) + TOP_PAD);
    drawBand(ctx, top, TOP_PAD, view.width, formatDay(ops[ops.length - 1].ts), null, theme);
    slots.push({ top, height: TOP_PAD });
  }
  return slots;
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  top: number,
  size: number,
  width: number,
  day: string | null,
  gap: string | null,
  theme: Theme,
) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, top, width, size);
  // A band pinned at the top edge sits under the panel's own rule: no second line.
  if (top > 0.5) {
    ctx.fillStyle = theme.foreground03;
    ctx.fillRect(0, Math.round(top) + 0.5, width, 1);
  }
  if (size < 20) return; // too thin for text

  // Mid-band: where the playhead rests between days, so its tabs cover these.
  const mid = top + size / 2 + 0.5;
  ctx.textBaseline = 'middle';
  if (day) {
    ctx.font = `500 11px ${theme.fontMono}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.foreground;
    ctx.fillText(day.toUpperCase(), COLUMNS.labelLeft, mid);
  }
  if (gap) {
    // Secondary by weight, not by a fainter step: -07 fails contrast on dark.
    ctx.font = `400 11px ${theme.fontMono}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.foreground;
    ctx.fillText(gap, width - COLUMNS.right, mid);
  }
}

/**
 * Middle and far tiers: a ruled label row above each day (or month), in the
 * cards column. Returns the rows as reserved slots so cards avoid them.
 */
function drawGroupLabels(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  first: number,
  last: number,
  y: (a: number) => number,
  tier: Tier,
  theme: Theme,
): Slot[] {
  const groupOf = tier === 'middle' ? dayIndex : monthIndex;
  const format = tier === 'middle' ? formatDay : formatMonth;
  const slots: Slot[] = [];
  ctx.font = `500 11px ${theme.fontMono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let k = first; k <= last; k++) {
    // The newest op of a group carries its label.
    if (k < ops.length && groupOf(ops[k].ts) === groupOf(ops[k - 1].ts)) continue;
    const top = y(layout.boundaryAt(k, view.ppo)) - LABEL_ROW;
    ctx.fillStyle = theme.foreground03;
    ctx.fillRect(COLUMNS.lanesLeft, Math.round(top) + 0.5, view.width - COLUMNS.lanesLeft, 1);
    ctx.fillStyle = theme.foreground;
    ctx.fillText(format(ops[k - 1].ts).toUpperCase(), COLUMNS.cardsLeft, top + LABEL_ROW / 2 + 1);
    slots.push({ top, height: LABEL_ROW });
  }
  return slots;
}

/**
 * Close tier: keeps the header of the day at the top of the view pinned while
 * its own band is scrolled away; the next day's band pushes it out.
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
  const size = breakPx(view.ppo);
  const day = dayIndex(ops[topOp - 1].ts);
  let newest = topOp;
  while (newest < ops.length && dayIndex(ops[newest].ts) === day) newest++;
  let oldest = topOp;
  while (oldest > 1 && dayIndex(ops[oldest - 2].ts) === day) oldest--;

  const ownBand = newest === ops.length ? TOP_PAD : size;
  const headerTop = y(layout.boundaryAt(newest, view.ppo) + ownBand);
  if (headerTop >= 0) return; // its own band is still in view

  // The band below this day (the older day's header) pushes this one up.
  const nextTop = oldest > 1 ? y(layout.boundaryAt(oldest - 1, view.ppo) + size) : Infinity;
  drawBand(ctx, Math.min(0, nextTop - BREAK_PX), BREAK_PX, view.width, formatDay(ops[topOp - 1].ts), null, theme);
}

/** Middle and far tiers: the day or month just below the header. */
function drawPinnedHeader(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  layout: TimelineLayout,
  view: TimelineView,
  tier: Tier,
  theme: Theme,
) {
  const seq = Math.max(1, layout.seqAt(yToAxis(layout, view, TOP_PAD), view.ppo));
  const ts = ops[Math.min(ops.length, seq) - 1].ts;
  drawBand(ctx, 0, BREAK_PX, view.width, tier === 'middle' ? formatDay(ts) : formatMonth(ts), null, theme);
}

// ---------------------------------------------------------------- sessions

/**
 * Every session gets a bracket in its author's colour (so none disappears);
 * cards (thumbnail + avatar + summary) go wherever they fit, biggest first.
 */
function drawSessions(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  view: TimelineView,
  first: number,
  last: number,
  y: (a: number) => number,
  reserved: Slot[],
  theme: Theme,
): PlacedCard[] {
  const { sessions, lanes, layout, authors } = scene;
  const candidates: CardCandidate[] = [];

  for (const s of sessions) {
    if (s.endSeq < first || s.startSeq > last) continue;
    const top = y(layout.boundaryAt(s.endSeq, view.ppo));
    const bottom = y(layout.tickAt(s.startSeq, view.ppo));
    ctx.fillStyle = authors.get(s.authorId)?.color ?? theme.foreground05;
    ctx.fillRect(COLUMNS.lanesLeft + lanes[s.index] * COLUMNS.laneStep, top, 2, Math.max(2, bottom - top));
    if (top > -THUMB_H && top < view.height) candidates.push({ index: s.index, top, priority: s.seqs.length });
  }

  const placed = placeCards(candidates, THUMB_H + CARD_GAP, reserved);
  for (const c of placed) drawCard(ctx, scene, c, view.width, theme);
  return placed.map(({ index, top }) => ({ index, top }));
}

function drawCard(ctx: CanvasRenderingContext2D, scene: TimelineScene, card: CardCandidate, width: number, theme: Theme) {
  const session = scene.sessions[card.index];
  const author = scene.authors.get(session.authorId);
  const preview = scene.previews.get(card.index);
  const x = COLUMNS.cardsLeft;
  const top = Math.round(card.top);

  if (preview) ctx.drawImage(preview.image, x, top, THUMB_W, THUMB_H);
  else {
    ctx.fillStyle = theme.background07;
    ctx.fillRect(x, top, THUMB_W, THUMB_H);
  }
  ctx.strokeStyle = theme.foreground03;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, top + 0.5, THUMB_W - 1, THUMB_H - 1);

  // Three lines: avatar + edits (time on the right), objects, areas.
  const tx = x + THUMB_W + 10;
  const right = width - COLUMNS.right;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (author) drawAvatar(ctx, tx + 7, top + 8, 7, author, theme);
  ctx.fillStyle = theme.foreground;
  ctx.font = `500 12px ${theme.fontSans}`;
  ctx.fillText(`${session.seqs.length} edits`, tx + 20, top + 9);
  ctx.font = `400 11px ${theme.fontMono}`;
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(session.endTs), right, top + 9);
  ctx.textAlign = 'left';

  const summary = preview?.summary;
  ctx.font = `400 12px ${theme.fontSans}`;
  ctx.fillText(fit(ctx, summary ? formatList(summary.objects, 2) : '…', right - tx), tx, top + 27);
  ctx.fillText(fit(ctx, summary ? formatList(summary.areas, 2) : '', right - tx), tx, top + 43);
}

export function drawAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, author: Author, theme: Theme) {
  ctx.fillStyle = author.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.background;
  ctx.font = `600 ${Math.round(r * 0.9)}px ${theme.fontSans}`;
  ctx.textAlign = 'center';
  ctx.fillText(author.initials, cx, cy + 0.5);
  ctx.textAlign = 'left';
}

/** Truncates text with an ellipsis to fit `max` px. */
export function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > max) end--;
  return `${text.slice(0, end)}…`;
}

// ---------------------------------------------------------------- hit test

/** The session under a point: a card first, then a bracket. -1 if none. */
/** Session whose card is at (x, py), or -1. Cards are the clickable targets. */
export function cardAtPoint(view: TimelineView, cards: PlacedCard[], x: number, py: number): number {
  const inX = x >= COLUMNS.cardsLeft && x <= view.width - COLUMNS.right;
  if (!inX) return -1;
  return cards.find((c) => py >= c.top && py <= c.top + THUMB_H)?.index ?? -1;
}

export function sessionAtPoint(scene: TimelineScene, view: TimelineView, cards: PlacedCard[], x: number, py: number): number {
  const card = cardAtPoint(view, cards, x, py);
  if (card >= 0) return card;
  const lane = Math.round((x - COLUMNS.lanesLeft - 1) / COLUMNS.laneStep);
  if (lane < 0 || Math.abs(x - (COLUMNS.lanesLeft + lane * COLUMNS.laneStep + 1)) > 3) return -1;
  const seq = scene.layout.seqAt(yToAxis(scene.layout, view, py), view.ppo);
  const hit = scene.sessions.find((s) => scene.lanes[s.index] === lane && s.startSeq <= seq + 1 && seq <= s.endSeq);
  return hit ? hit.index : -1;
}

const FLAG_H = 20;
const FLAG_PAD = 4;
const FLAG_TIP = 12;

/**
 * The playhead: a line across the strip with two tabs centred on it, the day
 * on the left and the time on the right, tips pointing at the line. They use
 * the day header's font and insets, and between days the head rests mid-band
 * (TimelineLayout.headAt), so there they sit exactly over the header.
 */
function drawHead(ctx: CanvasRenderingContext2D, y: number, width: number, ts: number | null, theme: Theme) {
  const cy = Math.round(y);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, cy - 1, width, 2);
  if (ts === null) return;

  const top = cy - FLAG_H / 2;
  const bottom = cy + FLAG_H / 2;
  ctx.font = `500 11px ${theme.fontMono}`;
  const day = formatDay(ts).toUpperCase();
  const time = formatTime(ts);
  ctx.fillStyle = theme.headTab;

  // Day tab: from the left edge to past the label, tip pointing right.
  // Corners on the strip's edge stay square; the others are rounded.
  const dayRight = COLUMNS.labelLeft + ctx.measureText(day).width + FLAG_PAD;
  tracePolygon(ctx, [[0, top, 0], [dayRight, top, TAB_RADIUS], [dayRight + FLAG_TIP, cy, TIP_RADIUS], [dayRight, bottom, TAB_RADIUS], [0, bottom, 0]]);
  ctx.fill();

  // Time tab: from before the label to the right edge, tip pointing left.
  const timeLeft = width - COLUMNS.right - ctx.measureText(time).width - FLAG_PAD;
  tracePolygon(ctx, [[width, top, 0], [timeLeft, top, TAB_RADIUS], [timeLeft - FLAG_TIP, cy, TIP_RADIUS], [timeLeft, bottom, TAB_RADIUS], [width, bottom, 0]]);
  ctx.fill();

  ctx.fillStyle = theme.headTabText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(day, COLUMNS.labelLeft, cy + 0.5);
  ctx.textAlign = 'right';
  ctx.fillText(time, width - COLUMNS.right, cy + 0.5);
}

/** Rayon-like softness for the head's tabs; tips are only slightly blunted. */
export const TAB_RADIUS = 4;
const TIP_RADIUS = 2;

/** A closed polygon with a corner radius per point: [x, y, radius]. */
export function tracePolygon(ctx: CanvasRenderingContext2D, points: [number, number, number][]) {
  const n = points.length;
  const [lx, ly] = points[n - 1];
  const [fx, fy] = points[0];
  ctx.beginPath();
  // Start mid-way along the closing edge, so every corner is drawn by arcTo.
  ctx.moveTo((lx + fx) / 2, (ly + fy) / 2);
  for (let i = 0; i < n; i++) {
    const [x, y, r] = points[i];
    const [nx, ny] = points[(i + 1) % n];
    ctx.arcTo(x, y, nx, ny, r);
  }
  ctx.closePath();
}
