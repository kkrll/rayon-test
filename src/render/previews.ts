import type { History } from '../engine/history';
import type { Session } from '../engine/sessions';
import { type SessionEdit, sessionEdits, summarize } from '../engine/summary';
import type { Room } from '../engine/types';
import { type Bounds, fitCamera } from './camera';
import { NO_HIGHLIGHT, boundsOf, drawModel, expandBounds } from './modelRenderer';
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
  summary: string;
}

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
    private readonly bounds: Bounds,
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
    while (this.wanted.size && performance.now() < deadline) {
      const index = [...this.wanted].pop()!;
      this.wanted.delete(index);
      this.cache.set(index, this.render(this.sessions[index]));
      built = true;
    }
    return built;
  }

  private render(session: Session): Preview {
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
    drawModel(ctx, state, fitCamera(this.frame(session), THUMB_W, THUMB_H, 0), dpr, this.theme, 'thumbnail', NO_HIGHLIGHT);

    return { image, edits, summary: summarize(edits) };
  }

  /**
   * The area this session worked on, so a thumbnail shows where the change
   * happened rather than the whole floor at an unreadable scale.
   */
  private frame(session: Session): Bounds {
    const touched = session.seqs.map((seq) => {
      const op = this.history.ops[seq - 1];
      return (op.after ?? op.before)!;
    });
    const framed = expandBounds(boundsOf(touched), FRAME_PAD_CM, FRAME_MIN_W_CM, FRAME_MIN_H_CM);
    // A session that touched the whole plan gets the whole plan.
    const tooBig =
      framed.maxX - framed.minX >= this.bounds.maxX - this.bounds.minX ||
      framed.maxY - framed.minY >= this.bounds.maxY - this.bounds.minY;
    return tooBig ? this.bounds : framed;
  }
}
