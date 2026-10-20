import { findEdge } from '../polyhedra/build';
import type { Polyhedron } from '../polyhedra/types';
import { type Vec3, add, lerp, scale } from '../geometry/vec';

/** Способ задания точки. Хранится в терминах топологии, а не координат — переживает изменение размеров. */
export type PointSpec =
  | { readonly kind: 'vertex'; readonly vertex: number }
  /** M = from + t·(to − from); from/to — вершины ребра в порядке записи пользователя. */
  | { readonly kind: 'edge'; readonly from: number; readonly to: number; readonly t: number }
  /** M = Σ wᵢ·Vᵢ по вершинам грани (веса в порядке poly.faces[face]). */
  | { readonly kind: 'face'; readonly face: number; readonly weights: readonly number[] };

export interface DefinedPoint {
  readonly id: string;
  readonly label: string;
  readonly spec: PointSpec;
}

export type ResolvedPoint =
  { ok: true; pos: Vec3; edge?: number; face?: number } | { ok: false; error: string };

export function resolvePoint(poly: Polyhedron, spec: PointSpec): ResolvedPoint {
  const nV = poly.vertices.length;
  switch (spec.kind) {
    case 'vertex':
      if (!Number.isInteger(spec.vertex) || spec.vertex < 0 || spec.vertex >= nV)
        return { ok: false, error: 'такой вершины нет у многогранника' };
      return { ok: true, pos: poly.vertices[spec.vertex] };
    case 'edge': {
      if (spec.from < 0 || spec.from >= nV || spec.to < 0 || spec.to >= nV)
        return { ok: false, error: 'вершина ребра не существует' };
      const e = findEdge(poly, spec.from, spec.to);
      if (e < 0)
        return {
          ok: false,
          error: `${poly.labels[spec.from]}${poly.labels[spec.to]} — не ребро многогранника (это диагональ или несуществующий отрезок)`,
        };
      if (!(spec.t >= 0 && spec.t <= 1) || !Number.isFinite(spec.t))
        return { ok: false, error: 'точка должна лежать на ребре: параметр t должен быть в [0; 1]' };
      return { ok: true, pos: lerp(poly.vertices[spec.from], poly.vertices[spec.to], spec.t), edge: e };
    }
    case 'face': {
      const f = poly.faces[spec.face];
      if (!f) return { ok: false, error: 'такой грани нет' };
      if (spec.weights.length !== f.length)
        return { ok: false, error: 'веса не соответствуют вершинам грани' };
      const sum = spec.weights.reduce((s, w) => s + w, 0);
      if (spec.weights.some((w) => !(w >= -1e-12)) || Math.abs(sum - 1) > 1e-9)
        return { ok: false, error: 'точка должна лежать внутри грани или на её границе' };
      let p: Vec3 = [0, 0, 0];
      f.forEach((v, i) => (p = add(p, scale(poly.vertices[v], spec.weights[i]))));
      return { ok: true, pos: p, face: spec.face };
    }
  }
}

/** Упрощённая дробь для параметра t: t = p/(p+q) с малыми p, q. */
export function ratioOf(t: number, maxDen = 12): { p: number; q: number } | null {
  for (let den = 2; den <= maxDen; den++) {
    const p = Math.round(t * den);
    if (p > 0 && p < den && Math.abs(t - p / den) < 1e-9) {
      const g = gcd(p, den - p);
      return { p: p / g, q: (den - p) / g };
    }
  }
  return null;
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Школьная запись способа задания точки. */
export function describeSpec(poly: Polyhedron, label: string, spec: PointSpec): string {
  switch (spec.kind) {
    case 'vertex':
      return `${label} = ${poly.labels[spec.vertex]} (вершина)`;
    case 'edge': {
      const A = poly.labels[spec.from];
      const B = poly.labels[spec.to];
      if (spec.t === 0) return `${label} = ${A}`;
      if (spec.t === 1) return `${label} = ${B}`;
      const r = ratioOf(spec.t);
      if (r && r.p === r.q) return `${label} — середина ${A}${B}`;
      if (r) return `${label} ∈ ${A}${B}, ${A}${label} : ${label}${B} = ${r.p} : ${r.q}`;
      return `${label} ∈ ${A}${B}, ${A}${label} : ${A}${B} = ${Number(spec.t.toFixed(4))}`;
    }
    case 'face':
      return `${label} ∈ грань ${poly.faceNames[spec.face]}`;
  }
}

/** Где лежит точка: вершина / ребро / грань — в виде короткого текста. */
export function placeOf(poly: Polyhedron, spec: PointSpec): string {
  switch (spec.kind) {
    case 'vertex':
      return `вершина ${poly.labels[spec.vertex]}`;
    case 'edge':
      return `ребро ${poly.labels[spec.from]}${poly.labels[spec.to]}`;
    case 'face':
      return `грань ${poly.faceNames[spec.face]}`;
  }
}

/** Переводит спецификацию в «канонический» вид: точка на ребре в вершине → вершина и т.п. */
export function canonicalSpec(spec: PointSpec): PointSpec {
  if (spec.kind === 'edge') {
    if (spec.t <= 0) return { kind: 'vertex', vertex: spec.from };
    if (spec.t >= 1) return { kind: 'vertex', vertex: spec.to };
  }
  return spec;
}
