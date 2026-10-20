import { type Plane, planeFromNormalPoint, signedDistance } from '../geometry/plane';
import { makeTolerance, type Tolerance } from '../geometry/tolerance';
import {
  type Vec3,
  bounds,
  centroid,
  cross,
  distance,
  dot,
  length,
  neg,
  newellNormal,
  normalize,
  sub,
} from '../geometry/vec';
import type {
  ParallelFacePair,
  Polyhedron,
  PolyhedronKind,
  PolyhedronParams,
  PolyhedronStructure,
} from './types';

export const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
export const subscript = (n: number): string =>
  String(n)
    .split('')
    .map((d) => SUBSCRIPTS[Number(d)])
    .join('');

export interface BuildInput {
  kind: PolyhedronKind;
  title: string;
  params: PolyhedronParams;
  vertices: Vec3[];
  labels: string[];
  faces: number[][];
  /** Обоснование параллельности пары граней (или null, если школьного обоснования нет). */
  parallelReason?: (fa: number, fb: number, faces: number[][]) => string | null;
  structure?: (faces: number[][]) => PolyhedronStructure;
  /** Обоснование параллельности пары рёбер (базовый факт) или null. */
  edgeParallelReason?: (
    ea: readonly [number, number],
    eb: readonly [number, number],
    name: (e: readonly [number, number]) => string,
  ) => string | null;
}

/** Имя грани: начинаем с наименьшего индекса, направление — к меньшему из соседей. */
export function faceName(face: readonly number[], labels: readonly string[]): string {
  const n = face.length;
  let k = 0;
  for (let i = 1; i < n; i++) if (face[i] < face[k]) k = i;
  const next = face[(k + 1) % n];
  const prev = face[(k - 1 + n) % n];
  const dir = next < prev ? 1 : -1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(labels[face[(k + dir * i + n * 2) % n]]);
  return out.join('');
}

/**
 * Собирает многогранник: выводит рёбра, ориентирует грани наружу,
 * считает плоскости граней и пары параллельных граней.
 */
export function buildPolyhedron(input: BuildInput): Polyhedron {
  const { vertices, labels } = input;
  const bb = bounds(vertices);
  const scaleL = distance(bb.min, bb.max);
  const tol = makeTolerance(scaleL);
  const center = centroid(vertices);

  // Ориентация граней наружу (по центроиду выпуклого тела).
  const faces = input.faces.map((f) => {
    const pts = f.map((i) => vertices[i]);
    const n = newellNormal(pts);
    const c = centroid(pts);
    return dot(n, sub(c, center)) < 0 ? [...f].reverse() : [...f];
  });

  const facePlanes: Plane[] = faces.map((f) => {
    const pts = f.map((i) => vertices[i]);
    return planeFromNormalPoint(newellNormal(pts), centroid(pts));
  });

  const edgeMap = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = Math.min(f[i], f[(i + 1) % f.length]);
      const b = Math.max(f[i], f[(i + 1) % f.length]);
      const key = `${a}-${b}`;
      const e = edgeMap.get(key);
      if (e) e.faces.push(fi);
      else edgeMap.set(key, { a, b, faces: [fi] });
    }
  });
  const edgeList = [...edgeMap.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  const edges = edgeList.map((e) => [e.a, e.b] as const);
  const edgeFaces = edgeList.map((e) => [e.faces[0], e.faces[1] ?? -1] as const);
  const edgeNames = edges.map(([a, b]) => labels[a] + labels[b]);
  const faceNames = faces.map((f) => faceName(f, labels));
  const vertexFaces = vertices.map((_, vi) => faces.flatMap((f, fi) => (f.includes(vi) ? [fi] : [])));

  const parallelFaces: ParallelFacePair[] = [];
  if (input.parallelReason) {
    for (let i = 0; i < faces.length; i++)
      for (let j = i + 1; j < faces.length; j++) {
        const s = length(cross(facePlanes[i].normal, facePlanes[j].normal));
        if (s < 1e-9 && dot(facePlanes[i].normal, facePlanes[j].normal) < 0) {
          const reason = input.parallelReason(i, j, faces);
          if (reason) parallelFaces.push({ a: i, b: j, reason });
        }
      }
  }

  const parallelEdges: ParallelFacePair[] = [];
  if (input.edgeParallelReason) {
    const nm = (e: readonly [number, number]) => labels[e[0]] + labels[e[1]];
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const u = sub(vertices[edges[i][1]], vertices[edges[i][0]]);
        const w = sub(vertices[edges[j][1]], vertices[edges[j][0]]);
        if (length(cross(u, w)) > 1e-9 * length(u) * length(w)) continue;
        // Параллельные, но не на одной прямой.
        if (length(cross(u, sub(vertices[edges[j][0]], vertices[edges[i][0]]))) <= tol.dist * length(u))
          continue;
        const reason = input.edgeParallelReason(edges[i], edges[j], nm);
        if (reason) parallelEdges.push({ a: i, b: j, reason });
      }
  }

  return {
    kind: input.kind,
    title: input.title,
    params: input.params,
    vertices,
    labels,
    faces,
    edges,
    edgeFaces,
    facePlanes,
    faceNames,
    edgeNames,
    vertexFaces,
    parallelFaces,
    parallelEdges,
    structure: input.structure ? input.structure(faces) : { type: 'none' },
    center,
    tol,
  };
}

/** Индекс ребра по паре вершин или -1. */
export function findEdge(poly: Polyhedron, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return poly.edges.findIndex(([x, y]) => x === lo && y === hi);
}

/** Грани многогранника, содержащие все указанные вершины. */
export const facesWithVertices = (poly: Polyhedron, vs: readonly number[]): number[] =>
  poly.faces.flatMap((f, fi) => (vs.every((v) => f.includes(v)) ? [fi] : []));

/**
 * Грани выпуклой оболочки набора точек (для платоновых тел).
 * Перебираем тройки вершин; плоскость — опорная, если все точки по одну сторону.
 */
export function hullFaces(vertices: readonly Vec3[], tol: Tolerance): number[][] {
  const n = vertices.length;
  const seen = new Set<string>();
  const faces: number[][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const nrm = cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i]));
        if (length(nrm) < tol.dist) continue;
        const plane = planeFromNormalPoint(nrm, vertices[i]);
        let pos = 0;
        let negc = 0;
        const on: number[] = [];
        for (let m = 0; m < n; m++) {
          const s = signedDistance(plane, vertices[m]);
          if (Math.abs(s) <= tol.dist * 10) on.push(m);
          else if (s > 0) pos++;
          else negc++;
        }
        if (pos > 0 && negc > 0) continue;
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // Упорядочиваем по углу вокруг центра грани, с внешней нормалью.
        const nn: Vec3 = pos > 0 ? neg(plane.normal) : plane.normal;
        const c = centroid(on.map((m) => vertices[m]));
        const u = normalize(sub(vertices[on[0]], c));
        const v = cross(nn, u);
        const sorted = [...on].sort((p, q) => {
          const dp = sub(vertices[p], c);
          const dq = sub(vertices[q], c);
          return Math.atan2(dot(dp, v), dot(dp, u)) - Math.atan2(dot(dq, v), dot(dq, u));
        });
        faces.push(sorted);
      }
  return faces;
}

/**
 * Обоснование параллельности рёбер e1 и e2: базовый факт или цепочка базовых фактов
 * (транзитивность параллельности). null — если школьного обоснования нет.
 */
export function parallelEdgeReason(poly: Polyhedron, e1: number, e2: number): string | null {
  if (e1 === e2) return null;
  const adj = new Map<number, { to: number; reason: string }[]>();
  for (const p of poly.parallelEdges) {
    adj.set(p.a, [...(adj.get(p.a) ?? []), { to: p.b, reason: p.reason }]);
    adj.set(p.b, [...(adj.get(p.b) ?? []), { to: p.a, reason: p.reason }]);
  }
  const prev = new Map<number, { from: number; reason: string }>();
  const queue = [e1];
  const seen = new Set([e1]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === e2) break;
    for (const n of adj.get(cur) ?? [])
      if (!seen.has(n.to)) {
        seen.add(n.to);
        prev.set(n.to, { from: cur, reason: n.reason });
        queue.push(n.to);
      }
  }
  if (!prev.has(e2)) return null;
  const chain: string[] = [];
  for (let c = e2; c !== e1; c = prev.get(c)!.from) {
    const st = prev.get(c)!;
    chain.unshift(`${poly.edgeNames[st.from]} ∥ ${poly.edgeNames[c]} (${st.reason})`);
  }
  return chain.join('; ');
}
