import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import { type SessionEdit, type SessionSummary, sessionEdits, summarize } from '../engine/summary';
import type { Room, State } from '../engine/types';
import { type Bounds, fitCamera } from './camera';
import { NO_HIGHLIGHT } from './highlight';
import { boundsOf, drawModel, expandBounds } from './modelRenderer';
import type { Theme } from './theme';

export const THUMB_W = 72;
export const THUMB_H = 48;
/** Thumbnails frame what the session touched, never tighter than ~one room. */
const FRAME_PAD_CM = 80;
const FRAME_MIN_W_CM = 450;
const FRAME_MIN_H_CM = 300;

export interface Preview {
  image: HTMLCanvasElement;
  edits: SessionEdit[];
  summary: SessionSummary;
}

/**
 * Draws the state at a session's end into a THUMB_W x THUMB_H canvas (device
 * pixels; `ctx` is unscaled). Each kind of project brings its own. Returning
 * false means "not yet" (e.g. 3D shapes still being built): it is retried later.
 */
export type DrawThumbnail = (ctx: CanvasRenderingContext2D, state: State, session: Session, dpr: number) => boolean | void;

/** What the timeline needs from previews (lets a filtered view re-index them). */
export type PreviewSource = Pick<SessionPreviews, 'get' | 'build'>;

/**
 * Display snapshots: the model at each session's end, rendered small and
 * summarised. Built lazily for sessions that come into view, within a time
 * budget per frame, and cached for good.
 */
export class SessionPreviews {
  private readonly cache = new Map<number, Preview>();
  private readonly wanted = new Set<number>();

  constructor(
    private readonly history: History,
    private readonly sessions: Session[],
    private readonly draw: DrawThumbnail,
    private readonly theme: Theme,
  ) {}

  /** The preview if built; otherwise asks for it and returns undefined. */
  get(index: number): Preview | undefined {
    const preview = this.cache.get(index);
    if (!preview) this.wanted.add(index);
    return preview;
  }

  /** Builds wanted previews, newest request first, until `budgetMs` is spent. */
  build(budgetMs: number): boolean {
    const deadline = performance.now() + budgetMs;
    let built = false;
    const later: number[] = [];
    while (this.wanted.size && performance.now() < deadline) {
      const index = [...this.wanted].pop()!;
      this.wanted.delete(index);
      const preview = this.render(this.sessions[index]);
      if (preview) {
        this.cache.set(index, preview);
        built = true;
      } else later.push(index);
    }
    // Not ready yet: ask again next time.
    for (const index of later) this.wanted.add(index);
    return built;
  }

  private render(session: Session): Preview | null {
    const state = this.history.snapshotAt(session.endSeq);
    const rooms = [...state.values()].filter((o): o is Room => o.type === 'room');
    const edits = sessionEdits(session, this.history.ops, rooms);

    const dpr = window.devicePixelRatio || 1;
    const image = document.createElement('canvas');
    image.width = THUMB_W * dpr;
    image.height = THUMB_H * dpr;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, image.width, image.height);
    if (this.draw(ctx, state, session, dpr) === false) return null;

    return { image, edits, summary: summarize(edits) };
  }
}

/** Floor plan thumbnails: 2D, framed on the area the session worked on. */
export function planThumbnails(history: History, bounds: Bounds, theme: Theme): DrawThumbnail {
  /**
   * The area this session worked on, so a thumbnail shows where the change
   * happened rather than the whole floor at an unreadable scale.
   */
  const frame = (session: Session): Bounds => {
    const touched = session.seqs.map((seq) => {
      const op = history.ops[seq - 1];
      return (op.after ?? op.before)!;
    });
    const framed = expandBounds(boundsOf(touched), FRAME_PAD_CM, FRAME_MIN_W_CM, FRAME_MIN_H_CM);
    // A session that touched the whole plan gets the whole plan.
    const tooBig =
      framed.maxX - framed.minX >= bounds.maxX - bounds.minX ||
      framed.maxY - framed.minY >= bounds.maxY - bounds.minY;
    return tooBig ? bounds : framed;
  };

  return (ctx, state, session, dpr) =>
    drawModel(ctx, state, fitCamera(frame(session), THUMB_W, THUMB_H, 0), dpr, theme, 'thumbnail', NO_HIGHLIGHT);
}
