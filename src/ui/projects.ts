import { DEVICE_MODEL_URL } from '../engine/device';
import { generateDataset } from '../engine/generator';
import { generateDeviceDataset } from '../engine/generator3d';
import { History } from '../engine/history';
import { type Session, groupSessions } from '../engine/sessions';
import type { Dataset } from '../engine/types';
import type { Bounds } from '../render/camera';
import { DeviceModel } from '../render/device/deviceModel';
import { deviceThumbnails } from '../render/device/deviceThumbnails';
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
  { id: 'n97', name: 'Nokia N97 mini', kind: '3D' },
];

interface Common {
  id: string;
  name: string;
  dataset: Dataset;
  history: History;
  sessions: Session[];
  areaLabel: string;
  thumbnails: (theme: Theme) => DrawThumbnail;
}

export interface PlanProject extends Common {
  kind: 'plan';
  /** Fixed framing so the camera doesn't jump while scrubbing. */
  bounds: Bounds;
}

export interface DeviceProject extends Common {
  kind: 'device';
  model: DeviceModel;
}

export type Project = PlanProject | DeviceProject;

function common(id: string, name: string, dataset: Dataset) {
  const history = new History(dataset.ops);
  const sessions = groupSessions(dataset.ops);
  return { id, name, dataset, history, sessions };
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

function deviceProject(id: string, name: string, dataset: Dataset, model: DeviceModel): DeviceProject {
  return {
    ...common(id, name, dataset),
    kind: 'device',
    model,
    areaLabel: 'Assemblies',
    thumbnails: () => deviceThumbnails(model),
  };
}

/**
 * A project like `base` with another history: a copy, or the same project
 * after a reset. Keeps the plan's framing and the loaded 3D model.
 */
export function deriveProject(base: Project, id: string, name: string, dataset: Dataset): Project {
  const project =
    base.kind === 'plan' ? planProject(id, name, dataset, base.bounds) : deviceProject(id, name, dataset, base.model);
  cache.set(id, Promise.resolve(project));
  return project;
}

const loaders: Record<string, () => Promise<Project>> = {
  apartment: async () => planProject('apartment', 'Apartment', generateDataset(1)),
  n97: async () => {
    // Diff colours for the 3D materials come from the canvas (light) theme.
    const model = await DeviceModel.load(DEVICE_MODEL_URL, readTheme(document.documentElement));
    return deviceProject('n97', 'Nokia N97 mini', generateDeviceDataset(1), model);
  },
};

const cache = new Map<string, Promise<Project>>();

/** Builds a built-in project once (history, sessions, and for 3D the model file). */
export function loadProject(id: string): Promise<Project> {
  let project = cache.get(id);
  if (!project) cache.set(id, (project = (loaders[id] ?? loaders.apartment)()));
  return project;
}
