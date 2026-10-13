// Plan units are centimetres; letters are measured in letter heights. Objects are immutable: an
// edit replaces the whole object, so `before`/`after` on an Op can be stored by reference.

export interface Vec {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  type: 'wall';
  geometry: { a: Vec; b: Vec; thickness: number };
  style: { stroke: string };
}

export interface Room {
  id: string;
  type: 'room';
  geometry: { points: Vec[] };
  style: { name: string; fill: string };
}

export interface Furniture {
  id: string;
  type: 'furniture';
  // Centre, size, rotation in radians.
  geometry: { x: number; y: number; w: number; h: number; rotation: number };
  style: { name: string; material: string };
}

/** A 3D letter standing on the floor (units: letter heights, Y up). */
export interface Letter {
  id: string;
  type: 'letter';
  // `rotation` turns it about Y, in degrees; `bevel` rounds (or chamfers) its edges.
  geometry: { position: Vec3; rotation: number; depth: number; bevel: number };
  // `name` is the character itself; `detail` (0..1) is how strong the material's texture is.
  style: { name: string; material: LetterMaterial; color: string; detail: number };
}

export type LetterMaterial = 'clay' | 'stone' | 'glass' | 'chrome' | 'carved';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ModelObject = Wall | Room | Furniture | Letter;
export type ObjectType = ModelObject['type'];

export type OpKind = 'create' | 'update' | 'delete';

export interface Op {
  seq: number; // 1-based, contiguous: ops[i].seq === i + 1
  ts: number; // epoch ms
  authorId: string;
  kind: OpKind;
  objectId: string;
  before: ModelObject | null; // null for create
  after: ModelObject | null; // null for delete
}

/** Model state after a given seq. seq 0 is the empty model. */
export type State = Map<string, ModelObject>;

export interface Author {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface NamedVersion {
  seq: number;
  name: string;
}

export interface Dataset {
  authors: Author[];
  ops: Op[];
  namedVersions: NamedVersion[];
}
