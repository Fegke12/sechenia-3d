import * as THREE from 'three';
import { lineLine } from '../core/geometry/plane';
import { type Vec3, sub } from '../core/geometry/vec';
import type { Polyhedron } from '../core/polyhedra/types';
import { ratioOf, type PointSpec } from '../core/section/points';
import { fromThree, toThree } from './coords';

export interface PickCandidate {
  readonly spec: PointSpec;
  readonly pos: Vec3;
  /** Кратко, для подсказки: «ребро AB, AM : MB = 1 : 2». */
  readonly description: string;
  readonly kind: 'vertex' | 'edge' | 'face';
}

/** Доли, к которым привязывается точка на ребре («школьные» отношения). */
export const SNAP_FRACTIONS = [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 5, 2 / 5, 3 / 5, 4 / 5, 1 / 6, 5 / 6];

const VERTEX_PX = 14;
const EDGE_PX = 9;
const SNAP_PX = 7;

export interface PickContext {
  poly: Polyhedron;
  camera: THREE.Camera;
  /** Преобразование из координат модели three (после toThree) в мировые. */
  modelMatrix: THREE.Matrix4;
  /** Меш граней с атрибутом faceIndex на каждую вершину треугольника. */
  faceMesh: THREE.Mesh | null;
  width: number;
  height: number;
  snap: boolean;
  /** Ограничить выбор вершинами и рёбрами (упражнения «отметьте вершины сечения»). */
  edgesOnly?: boolean;
}

function toScreen(ctx: PickContext, v: Vec3): { x: number; y: number; z: number } {
  const p = toThree(v).applyMatrix4(ctx.modelMatrix).project(ctx.camera);
  return { x: ((p.x + 1) / 2) * ctx.width, y: ((1 - p.y) / 2) * ctx.height, z: p.z };
}

function distToSegment2D(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/**
 * Определяет, какую точку выбирает пользователь: вершину, точку на ребре или точку грани.
 * Положение на ребре вычисляется в 3D как ближайшая точка между лучом камеры и прямой ребра.
 */
export function pick(
  ctx: PickContext,
  mx: number,
  my: number,
  raycaster: THREE.Raycaster,
): PickCandidate | null {
  const { poly } = ctx;
  // 1. Вершины (экранная привязка).
  let bestV = -1;
  let bestVd = VERTEX_PX;
  let bestVz = Infinity;
  poly.vertices.forEach((v, i) => {
    const s = toScreen(ctx, v);
    const d = Math.hypot(s.x - mx, s.y - my);
    if (d < bestVd - 1 || (d <= bestVd + 1 && s.z < bestVz)) {
      bestV = i;
      bestVd = d;
      bestVz = s.z;
    }
  });
  if (bestV >= 0)
    return {
      spec: { kind: 'vertex', vertex: bestV },
      pos: poly.vertices[bestV],
      description: `вершина ${poly.labels[bestV]}`,
      kind: 'vertex',
    };

  // Луч в координатах ядра.
  const inv = new THREE.Matrix4().copy(ctx.modelMatrix).invert();
  const o = fromThree(raycaster.ray.origin.clone().applyMatrix4(inv));
  const dEnd = fromThree(raycaster.ray.origin.clone().add(raycaster.ray.direction).applyMatrix4(inv));
  const rayDir = sub(dEnd, o);

  // 2. Рёбра.
  let bestE = -1;
  let bestEd = EDGE_PX;
  let bestEz = Infinity;
  let bestScreenLen = 0;
  poly.edges.forEach(([a, b], e) => {
    const sa = toScreen(ctx, poly.vertices[a]);
    const sb = toScreen(ctx, poly.vertices[b]);
    const { d, t } = distToSegment2D(mx, my, sa.x, sa.y, sb.x, sb.y);
    const z = sa.z + (sb.z - sa.z) * t;
    if (d < bestEd - 1 || (d <= bestEd + 1 && z < bestEz)) {
      bestE = e;
      bestEd = d;
      bestEz = z;
      bestScreenLen = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    }
  });
  if (bestE >= 0) {
    const [a, b] = poly.edges[bestE];
    const A = poly.vertices[a];
    const B = poly.vertices[b];
    const hit = lineLine(o, rayDir, A, sub(B, A), poly.tol);
    let t = hit ? Math.max(0, Math.min(1, hit.r)) : 0.5;
    if (ctx.snap) {
      for (const f of SNAP_FRACTIONS)
        if (Math.abs(t - f) * bestScreenLen <= SNAP_PX) {
          t = f;
          break;
        }
    }
    const edgeName = poly.edgeNames[bestE];
    const r = ratioOf(t);
    const desc = r
      ? r.p === r.q
        ? `середина ребра ${edgeName}`
        : `ребро ${edgeName}, деление ${r.p} : ${r.q} от ${poly.labels[a]}`
      : `ребро ${edgeName}, t = ${t.toFixed(3)}`;
    const pos: Vec3 = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    return { spec: { kind: 'edge', from: a, to: b, t }, pos, description: desc, kind: 'edge' };
  }
  if (ctx.edgesOnly || !ctx.faceMesh) return null;

  // 3. Грань (первое пересечение луча с гранями).
  const hits = raycaster.intersectObject(ctx.faceMesh, false);
  if (!hits.length || !hits[0].face) return null;
  const faceAttr = ctx.faceMesh.geometry.getAttribute('faceIndex');
  const fi = faceAttr.getX(hits[0].face.a);
  const local = hits[0].point.clone().applyMatrix4(inv);
  const P = fromThree(local);
  const face = poly.faces[fi];
  const weights = faceWeights(poly, fi, P);
  if (!weights) return null;
  // Привязка к центру грани.
  const k = face.length;
  const centre: Vec3 = face.reduce<Vec3>(
    (s, v) => [
      s[0] + poly.vertices[v][0] / k,
      s[1] + poly.vertices[v][1] / k,
      s[2] + poly.vertices[v][2] / k,
    ],
    [0, 0, 0],
  );
  const sc = toScreen(ctx, centre);
  if (ctx.snap && Math.hypot(sc.x - mx, sc.y - my) <= 10) {
    return {
      spec: { kind: 'face', face: fi, weights: Array(k).fill(1 / k) },
      pos: centre,
      description: `центр грани ${poly.faceNames[fi]}`,
      kind: 'face',
    };
  }
  return {
    spec: { kind: 'face', face: fi, weights },
    pos: P,
    description: `грань ${poly.faceNames[fi]}`,
    kind: 'face',
  };
}

/**
 * Веса точки P относительно вершин грани (веер треугольников из первой вершины):
 * P = Σ wᵢ·Vᵢ, wᵢ ≥ 0. Точка проецируется на плоскость грани.
 */
export function faceWeights(poly: Polyhedron, fi: number, P: Vec3): number[] | null {
  const face = poly.faces[fi];
  const V = (i: number) => poly.vertices[face[i]];
  const n = poly.facePlanes[fi].normal;
  for (let i = 1; i + 1 < face.length; i++) {
    const a = V(0);
    const b = V(i);
    const c = V(i + 1);
    const w = bary(P, a, b, c, n);
    if (w && w.every((x) => x >= -1e-6)) {
      const ws = Array(face.length).fill(0);
      const cl = w.map((x) => Math.max(0, x));
      const s = cl[0] + cl[1] + cl[2];
      ws[0] = cl[0] / s;
      ws[i] = cl[1] / s;
      ws[i + 1] = cl[2] / s;
      return ws;
    }
  }
  return null;
}

function bary(p: Vec3, a: Vec3, b: Vec3, c: Vec3, n: Vec3): [number, number, number] | null {
  const cr = (u: Vec3, v: Vec3): Vec3 => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const dt = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const area = dt(cr(sub(b, a), sub(c, a)), n);
  if (Math.abs(area) < 1e-15) return null;
  const wa = dt(cr(sub(b, p), sub(c, p)), n) / area;
  const wb = dt(cr(sub(c, p), sub(a, p)), n) / area;
  return [wa, wb, 1 - wa - wb];
}
