import { createPolyhedron, kindSpec, normalizeParams } from '../../src/core/polyhedra/catalog';
import type { Polyhedron, PolyhedronKind, PolyhedronParams } from '../../src/core/polyhedra/types';
import { parseProblemText } from '../../src/core/problem/parse';
import type { DefinedPoint } from '../../src/core/section/points';
import { solve } from '../../src/core/solve';

export function poly(kind: PolyhedronKind, params: PolyhedronParams = {}): Polyhedron {
  return createPolyhedron(kind, params);
}

/** Многогранник без ограничения диапазона параметров (для тестов масштаба). */
export function rawPoly(kind: PolyhedronKind, params: PolyhedronParams): Polyhedron {
  const base = normalizeParams(kind, {});
  return kindSpec(kind).build({ ...base, ...params });
}

export function points(p: Polyhedron, text: string): DefinedPoint[] {
  const parsed = parseProblemText(text, p);
  if (parsed.errors.length) throw new Error(parsed.errors.map((e) => `${e.source}: ${e.error}`).join('\n'));
  return parsed.points.map((pt, i) => ({ id: `t${i}`, label: pt.label, spec: pt.spec }));
}

export function solveText(p: Polyhedron, text: string) {
  return solve(p, points(p, text));
}

export const vi = (p: Polyhedron, label: string): number => {
  const i = p.labels.indexOf(label);
  if (i < 0) throw new Error(`нет вершины ${label}`);
  return i;
};
