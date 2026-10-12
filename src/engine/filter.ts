import type { SessionEdit } from './summary';
import type { Op } from './types';

/**
 * What the timeline is narrowed to. Values of one facet combine with OR
 * (Kitchen or WC); facets combine with AND (Kitchen or WC, by Sam).
 */
export interface Filter {
  author?: string[]; // author ids
  object?: string[]; // object names: "Rug" is every rug
  area?: string[]; // rooms or assemblies
  verb?: string[];
}

export type Facet = keyof Filter;

export const FACETS: Facet[] = ['author', 'object', 'area', 'verb'];

export const isEmpty = (f: Filter) => FACETS.every((facet) => !f[facet]?.length);

/** Adds `value` to its facet, or removes it if it is already there. */
export function toggle(f: Filter, facet: Facet, value: string): Filter {
  const values = f[facet] ?? [];
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return { ...f, [facet]: next.length ? next : undefined };
}

/** A predicate over ops, or null when nothing is filtered. `edits` is describeAll's output. */
export function matcher(filter: Filter, edits: SessionEdit[]): ((op: Op) => boolean) | null {
  if (isEmpty(filter)) return null;
  const sets = Object.fromEntries(FACETS.map((facet) => [facet, filter[facet]?.length ? new Set(filter[facet]) : null]));
  const pass = (facet: Facet, value: string | null) => !sets[facet] || (value !== null && sets[facet]!.has(value));
  return (op) => {
    const e = edits[op.seq - 1];
    return pass('author', op.authorId) && pass('object', e.name) && pass('area', e.area) && pass('verb', e.verb);
  };
}
