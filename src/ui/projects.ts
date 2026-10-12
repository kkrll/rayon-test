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

export const PROJECTS = [
  { id: 'apartment', name: 'Apartment', kind: '2D' },
  { id: 'n97', name: 'Nokia N97 mini', kind: '3D' },
] as const;

export type ProjectId = (typeof PROJECTS)[number]['id'];

interface Common {
  id: ProjectId;
  dataset: Dataset;
  history: History;
  sessions: Session[];
  /** Session ends are the display snapshots: Shift+arrow steps between them. */
  sessionEnds: number[];
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

function common(id: ProjectId, dataset: Dataset) {
  const history = new History(dataset.ops);
  const sessions = groupSessions(dataset.ops);
  const sessionEnds = [...new Set(sessions.map((s) => s.endSeq))].sort((a, b) => a - b);
  return { id, dataset, history, sessions, sessionEnds };
}

const loaders: Record<ProjectId, () => Promise<Project>> = {
  apartment: async () => {
    const base = common('apartment', generateDataset(1));
    const bounds = boundsOf(base.history.snapshotAt(base.history.length).values());
    return {
      ...base,
      kind: 'plan',
      bounds,
      areaLabel: 'Rooms',
      thumbnails: (theme) => planThumbnails(base.history, bounds, theme),
    };
  },
  n97: async () => {
    // Diff colours for the 3D materials come from the canvas (light) theme.
    const model = await DeviceModel.load(DEVICE_MODEL_URL, readTheme(document.documentElement));
    return {
      ...common('n97', generateDeviceDataset(1)),
      kind: 'device',
      model,
      areaLabel: 'Assemblies',
      thumbnails: () => deviceThumbnails(model),
    };
  },
};

const cache = new Map<ProjectId, Promise<Project>>();

/** Builds a project once (history, sessions, and for 3D the model file). */
export function loadProject(id: ProjectId): Promise<Project> {
  let project = cache.get(id);
  if (!project) cache.set(id, (project = loaders[id]()));
  return project;
}
