import { generateDataset } from '../engine/generator';
import { generateLettersDataset } from '../engine/letters';
import { History } from '../engine/history';
import { type Session, groupSessions } from '../engine/sessions';
import { type SessionEdit, describeAll } from '../engine/summary';
import type { Dataset, Room } from '../engine/types';
import type { Bounds } from '../render/camera';
import { LetterKit } from '../render/letters/letterKit';
import { letterThumbnails } from '../render/letters/letterThumbnails';
import { boundsOf } from '../render/modelRenderer';
import { type DrawThumbnail, planThumbnails } from '../render/previews';
import { type Theme, readTheme } from '../render/theme';

export interface ProjectEntry {
  id: string;
  name: string;
  kind: '2D' | '3D';
}

/** The built-in projects; copies are added at runtime. */
export const PROJECTS: ProjectEntry[] = [
  { id: 'apartment', name: 'Apartment', kind: '2D' },
  { id: 'letters', name: 'Letters', kind: '3D' },
];

interface Common {
  id: string;
  name: string;
  dataset: Dataset;
  history: History;
  sessions: Session[];
  areaLabel: string;
  thumbnails: (theme: Theme) => DrawThumbnail;
  /** Every edit described (name, area, verb), indexed by seq - 1; built on first use. */
  describe: () => SessionEdit[];
}

export interface PlanProject extends Common {
  kind: 'plan';
  /** Fixed framing so the camera doesn't jump while scrubbing. */
  bounds: Bounds;
}

export interface LettersProject extends Common {
  kind: 'letters';
  kit: LetterKit;
}

export type Project = PlanProject | LettersProject;

function common(id: string, name: string, dataset: Dataset) {
  const history = new History(dataset.ops);
  const sessions = groupSessions(dataset.ops);
  let edits: SessionEdit[] | null = null;
  const describe = () =>
    (edits ??= describeAll(sessions, dataset.ops, (s) =>
      [...history.snapshotAt(s).values()].filter((o): o is Room => o.type === 'room')));
  return { id, name, dataset, history, sessions, describe };
}

function planProject(id: string, name: string, dataset: Dataset, bounds?: Bounds): PlanProject {
  const base = common(id, name, dataset);
  const framing = bounds ?? boundsOf(base.history.snapshotAt(base.history.length).values());
  return {
    ...base,
    kind: 'plan',
    bounds: framing,
    areaLabel: 'Rooms',
    thumbnails: (theme) => planThumbnails(base.history, framing, theme),
  };
}

function lettersProject(id: string, name: string, dataset: Dataset, kit: LetterKit): LettersProject {
  return {
    ...common(id, name, dataset),
    kind: 'letters',
    kit,
    areaLabel: 'Materials',
    thumbnails: () => letterThumbnails(kit),
  };
}

/**
 * A project like `base` with another history: a copy, or the same project
 * after a reset. Keeps the plan's framing and the letters' geometry cache.
 */
export function deriveProject(base: Project, id: string, name: string, dataset: Dataset): Project {
  const project =
    base.kind === 'plan' ? planProject(id, name, dataset, base.bounds) : lettersProject(id, name, dataset, base.kit);
  cache.set(id, Promise.resolve(project));
  return project;
}

const loaders: Record<string, () => Promise<Project>> = {
  apartment: async () => planProject('apartment', 'Apartment', generateDataset(1)),
  // Diff colours for the 3D materials come from the canvas (light) theme.
  letters: async () =>
    lettersProject('letters', 'Letters', generateLettersDataset(1), new LetterKit(readTheme(document.documentElement))),
};

const cache = new Map<string, Promise<Project>>();

/** Builds a built-in project once (history, sessions, and for 3D the letter kit). */
export function loadProject(id: string): Promise<Project> {
  let project = cache.get(id);
  if (!project) cache.set(id, (project = (loaders[id] ?? loaders.apartment)()));
  return project;
}
