import { type Plane, signedDistance } from '../geometry/plane';
import { type Vec3, cross, distance, dot, lerp, newellNormal, sub } from '../geometry/vec';
import type { Polyhedron } from '../polyhedra/types';

export type Sign = -1 | 0 | 1;

export type SectionOrigin =
  | { readonly type: 'vertex'; readonly vertex: number }
  /** Строгое пересечение ребра; t отсчитывается от вершины edges[edge][0]. */
  | { readonly type: 'edge'; readonly edge: number; readonly t: number };

export interface SectionVertex {
  /** Ключ происхождения: `v:3` или `e:5` — однозначно определяет точку. */
  readonly key: string;
  readonly pos: Vec3;
  readonly origin: SectionOrigin;
}

export interface SectionSide {
  /** Индексы в Section.vertices. */
  readonly a: number;
  readonly b: number;
  /** Грани многогранника, в которых лежит сторона (2 — если сторона совпадает с ребром). */
  readonly faces: readonly number[];
  /** Ребро многогранника, если сторона с ним совпадает. */
  readonly polyEdge: number | null;
}

export type SectionStatus = 'empty' | 'point' | 'segment' | 'face' | 'polygon' | 'error';

export interface Section {
  readonly status: SectionStatus;
  /** Для polygon/face — вершины по циклу (против часовой стрелки относительно n̂). */
  readonly vertices: readonly SectionVertex[];
  readonly sides: readonly SectionSide[];
  readonly plane: Plane;
  readonly signs: readonly Sign[];
  readonly distances: readonly number[];
  /** Для вырожденного касания: грань/ребро/вершина касания. */
  readonly touchFace: number | null;
  readonly touchEdge: number | null;
  readonly touchVertex: number | null;
  readonly error: string | null;
  readonly diagnostics: readonly string[];
}

const vKey = (i: number) => `v:${i}`;
const eKey = (i: number) => `e:${i}`;

/**
 * Сечение выпуклого многогранника плоскостью.
 * Алгоритм: классификация вершин → (касание | обход граней) → граф сторон → цикл.
 * Подробности и обоснование — docs/MATHEMATICS.md, §5–6.
 */
export function computeSection(poly: Polyhedron, plane: Plane): Section {
  const { tol } = poly;
  const distances = poly.vertices.map((v) => signedDistance(plane, v));
  const signs: Sign[] = distances.map((d) => (Math.abs(d) <= tol.dist ? 0 : d > 0 ? 1 : -1));
  // Согласование допусков: если точка пересечения ребра оказалась бы ближе допуска слияния к вершине,
  // считаем, что плоскость проходит через эту вершину. Иначе возникли бы ложные «микро-стороны».
  for (let changed = true, guard = 0; changed && guard < poly.vertices.length + 1; guard++) {
    changed = false;
    for (const [a, b] of poly.edges) {
      if (signs[a] * signs[b] >= 0) continue;
      const t = distances[a] / (distances[a] - distances[b]);
      const len = distance(poly.vertices[a], poly.vertices[b]);
      if (t * len <= tol.merge) {
        signs[a] = 0;
        changed = true;
      } else if ((1 - t) * len <= tol.merge) {
        signs[b] = 0;
        changed = true;
      }
    }
  }
  const base = {
    plane,
    signs,
    distances,
    touchFace: null,
    touchEdge: null,
    touchVertex: null,
    error: null,
    diagnostics: [] as string[],
  };
  const hasPos = signs.includes(1);
  const hasNeg = signs.includes(-1);
  const zeros = signs.flatMap((s, i) => (s === 0 ? [i] : []));

  /* ── Касание: многогранник целиком в одном замкнутом полупространстве ── */
  if (!(hasPos && hasNeg)) {
    const mk = (i: number): SectionVertex => ({
      key: vKey(i),
      pos: poly.vertices[i],
      origin: { type: 'vertex', vertex: i },
    });
    if (zeros.length === 0) return { ...base, status: 'empty', vertices: [], sides: [] };
    if (zeros.length === 1)
      return { ...base, status: 'point', vertices: [mk(zeros[0])], sides: [], touchVertex: zeros[0] };
    // Грань, все вершины которой нулевые.
    const face = poly.faces.findIndex((f) => f.every((v) => signs[v] === 0));
    if (face >= 0) {
      const f = poly.faces[face];
      if (zeros.length !== f.length) {
        return error(base, 'плоскость совпадает с гранью, но содержит и другие вершины — модель некорректна');
      }
      const verts = f.map(mk);
      const n = newellNormal(verts.map((v) => v.pos));
      const ordered = dot(n, plane.normal) >= 0 ? verts : [...verts].reverse();
      const sides: SectionSide[] = ordered.map((v, i) => {
        const w = ordered[(i + 1) % ordered.length];
        const a = (v.origin as { vertex: number }).vertex;
        const b = (w.origin as { vertex: number }).vertex;
        const e = poly.edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
        return { a: i, b: (i + 1) % ordered.length, faces: [...poly.edgeFaces[e]], polyEdge: e };
      });
      return { ...base, status: 'face', vertices: ordered, sides, touchFace: face };
    }
    if (zeros.length === 2) {
      const [a, b] = zeros;
      const e = poly.edges.findIndex(([x, y]) => x === a && y === b);
      if (e < 0) return error(base, 'две вершины на плоскости не соединены ребром — модель некорректна');
      return {
        ...base,
        status: 'segment',
        vertices: [mk(a), mk(b)],
        sides: [{ a: 0, b: 1, faces: [...poly.edgeFaces[e]], polyEdge: e }],
        touchEdge: e,
      };
    }
    return error(base, `касание по ${zeros.length} вершинам, не образующим грань — модель некорректна`);
  }

  /* ── Собственное сечение ── */
  const points = new Map<string, SectionVertex>();
  const edgeIndex = new Map<string, number>();
  poly.edges.forEach(([a, b], i) => edgeIndex.set(`${a}-${b}`, i));
  const edgeOf = (a: number, b: number) => edgeIndex.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? -1;

  const pointOnEdge = (a: number, b: number): SectionVertex => {
    const e = edgeOf(a, b);
    const key = eKey(e);
    const existing = points.get(key);
    if (existing) return existing;
    const [p, q] = poly.edges[e];
    const t = distances[p] / (distances[p] - distances[q]);
    const v: SectionVertex = {
      key,
      pos: lerp(poly.vertices[p], poly.vertices[q], t),
      origin: { type: 'edge', edge: e, t },
    };
    points.set(key, v);
    return v;
  };
  const pointAtVertex = (i: number): SectionVertex => {
    const key = vKey(i);
    const existing = points.get(key);
    if (existing) return existing;
    const v: SectionVertex = { key, pos: poly.vertices[i], origin: { type: 'vertex', vertex: i } };
    points.set(key, v);
    return v;
  };

  const sideMap = new Map<string, { a: string; b: string; faces: number[] }>();
  const diagnostics: string[] = [];

  poly.faces.forEach((f, fi) => {
    const pts: SectionVertex[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      if (signs[a] === 0) pts.push(pointAtVertex(a));
      if (signs[a] * signs[b] < 0) pts.push(pointOnEdge(a, b));
    }
    const unique = [...new Map(pts.map((p) => [p.key, p])).values()];
    if (unique.length < 2) return;
    let chain = unique;
    if (unique.length > 2) {
      // Возможно только при почти совпадающих плоскостях; упорядочиваем вдоль прямой пересечения.
      diagnostics.push(
        `грань ${poly.faceNames[fi]}: ${unique.length} точки пересечения, упорядочены вдоль прямой`,
      );
      const dir = cross(plane.normal, poly.facePlanes[fi].normal);
      chain = [...unique].sort((p, q) => dot(sub(p.pos, q.pos), dir));
    }
    for (let i = 0; i + 1 < chain.length; i++) {
      const [ka, kb] = [chain[i].key, chain[i + 1].key].sort();
      const key = `${ka}|${kb}`;
      const s = sideMap.get(key);
      if (s) s.faces.push(fi);
      else sideMap.set(key, { a: ka, b: kb, faces: [fi] });
    }
  });

  // Граф: степень каждой вершины должна быть 2.
  const adj = new Map<string, string[]>();
  for (const s of sideMap.values()) {
    adj.set(s.a, [...(adj.get(s.a) ?? []), s.b]);
    adj.set(s.b, [...(adj.get(s.b) ?? []), s.a]);
  }
  for (const [k, nb] of adj)
    if (nb.length !== 2)
      return error(
        { ...base, diagnostics },
        `вершина сечения ${k} имеет степень ${nb.length} вместо 2 — граница сечения не является простым циклом`,
      );
  if (points.size !== adj.size)
    return error({ ...base, diagnostics }, 'найдены точки пересечения, не попавшие на стороны сечения');

  // Обход цикла.
  const start = [...adj.keys()].sort()[0];
  const order: string[] = [start];
  let prev = start;
  let cur = adj.get(start)![0];
  while (cur !== start) {
    order.push(cur);
    const nb = adj.get(cur)!;
    const next = nb[0] === prev ? nb[1] : nb[0];
    prev = cur;
    cur = next;
    if (order.length > adj.size) return error({ ...base, diagnostics }, 'обход границы сечения не замкнулся');
  }
  if (order.length !== adj.size)
    return error(
      { ...base, diagnostics },
      'граница сечения состоит из нескольких компонент — для выпуклого тела это ошибка',
    );

  let verts = order.map((k) => points.get(k)!);
  const n = newellNormal(verts.map((v) => v.pos));
  if (dot(n, plane.normal) < 0) verts = [verts[0], ...verts.slice(1).reverse()];
  const pos = new Map(verts.map((v, i) => [v.key, i]));
  const sides: SectionSide[] = verts.map((v, i) => {
    const w = verts[(i + 1) % verts.length];
    const [ka, kb] = [v.key, w.key].sort();
    const s = sideMap.get(`${ka}|${kb}`)!;
    let polyEdge: number | null = null;
    if (v.origin.type === 'vertex' && w.origin.type === 'vertex') {
      const e = edgeOf(v.origin.vertex, w.origin.vertex);
      if (e >= 0) polyEdge = e;
    }
    return { a: pos.get(v.key)!, b: pos.get(w.key)!, faces: [...s.faces].sort((x, y) => x - y), polyEdge };
  });

  return { ...base, diagnostics, status: 'polygon', vertices: verts, sides };
}

function error(base: Omit<Section, 'status' | 'vertices' | 'sides'>, message: string): Section {
  return { ...base, status: 'error', vertices: [], sides: [], error: message };
}
