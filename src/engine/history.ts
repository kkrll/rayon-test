import type { ModelObject, Op, State } from './types';

export interface HistoryOptions {
  /** A hidden full-state copy is kept every N ops. */
  checkpointEvery: number;
  /** Max distance (in ops) handled by stepping from the current state. */
  incrementalThreshold: number;
}

export interface StateTiming {
  path: 'incremental' | 'checkpoint';
  opsApplied: number;
  ms: number;
}

export interface Diff {
  added: ModelObject[];
  deleted: ModelObject[]; // as they were at `fromSeq`, for ghost rendering
  modified: ModelObject[]; // as they are at `toSeq`
}

const DEFAULTS: HistoryOptions = { checkpointEvery: 200, incrementalThreshold: 300 };

export function applyForward(state: State, op: Op) {
  if (op.after) state.set(op.objectId, op.after);
  else state.delete(op.objectId);
}

export function applyInverse(state: State, op: Op) {
  if (op.before) state.set(op.objectId, op.before);
  else state.delete(op.objectId);
}

/**
 * Answers "what did the model look like after op `seq`?".
 * Keeps one live state that moves with the cursor, plus hidden checkpoints
 * for long jumps. seq 0 is the empty model, seq ops.length the latest.
 */
export class History {
  readonly ops: Op[];
  readonly options: HistoryOptions;
  lastTiming: StateTiming | null = null;

  private readonly checkpoints: State[] = [];
  private live: State = new Map();
  private liveSeq = 0;

  constructor(ops: Op[], options: Partial<HistoryOptions> = {}) {
    this.ops = ops;
    this.options = { ...DEFAULTS, ...options };
    this.buildCheckpoints();
  }

  get length() {
    return this.ops.length;
  }

  /**
   * Returns the live state at `seq`. The map is reused across calls:
   * read it, don't keep it. Use `snapshotAt` for a state you can hold.
   */
  getStateAt(seq: number): ReadonlyMap<string, ModelObject> {
    const target = this.clampSeq(seq);
    const start = performance.now();
    const distance = Math.abs(target - this.liveSeq);

    let path: StateTiming['path'];
    let opsApplied: number;
    if (distance <= this.options.incrementalThreshold) {
      path = 'incremental';
      opsApplied = this.stepTo(target);
    } else {
      path = 'checkpoint';
      opsApplied = this.loadCheckpoint(target);
    }

    this.lastTiming = { path, opsApplied, ms: performance.now() - start };
    return this.live;
  }

  /** An independent copy of the state at `seq` (for thumbnails, tests). */
  snapshotAt(seq: number): State {
    const target = this.clampSeq(seq);
    const base = this.nearestCheckpointSeq(target);
    const state = new Map(this.checkpoints[base / this.options.checkpointEvery]);
    for (let s = base; s < target; s++) applyForward(state, this.ops[s]);
    return state;
  }

  /**
   * What changed between two seqs, derived from the ops in between rather
   * than by comparing two full states: cost is O(ops in range).
   */
  diff(fromSeq: number, toSeq: number): Diff {
    const from = this.clampSeq(fromSeq);
    const to = this.clampSeq(toSeq);
    // First `before` seen per object = its state at `from`; last `after` = at `to`.
    const atFrom = new Map<string, ModelObject | null>();
    const atTo = new Map<string, ModelObject | null>();
    for (let s = from; s < to; s++) {
      const op = this.ops[s];
      if (!atFrom.has(op.objectId)) atFrom.set(op.objectId, op.before);
      atTo.set(op.objectId, op.after);
    }

    const diff: Diff = { added: [], deleted: [], modified: [] };
    for (const [id, before] of atFrom) {
      const after = atTo.get(id) ?? null;
      if (!before && after) diff.added.push(after);
      else if (before && !after) diff.deleted.push(before);
      else if (before && after && before !== after) diff.modified.push(after);
    }
    return diff;
  }

  private buildCheckpoints() {
    const { checkpointEvery } = this.options;
    const state: State = new Map();
    this.checkpoints.push(new Map(state));
    for (let s = 0; s < this.ops.length; s++) {
      applyForward(state, this.ops[s]);
      if ((s + 1) % checkpointEvery === 0) this.checkpoints.push(new Map(state));
    }
  }

  private stepTo(target: number): number {
    const applied = Math.abs(target - this.liveSeq);
    while (this.liveSeq < target) applyForward(this.live, this.ops[this.liveSeq++]);
    while (this.liveSeq > target) applyInverse(this.live, this.ops[--this.liveSeq]);
    return applied;
  }

  private loadCheckpoint(target: number): number {
    const base = this.nearestCheckpointSeq(target);
    this.live = new Map(this.checkpoints[base / this.options.checkpointEvery]);
    this.liveSeq = base;
    return this.stepTo(target);
  }

  private nearestCheckpointSeq(seq: number) {
    const every = this.options.checkpointEvery;
    return Math.floor(seq / every) * every;
  }

  private clampSeq(seq: number) {
    return Math.max(0, Math.min(this.ops.length, Math.round(seq)));
  }
}
