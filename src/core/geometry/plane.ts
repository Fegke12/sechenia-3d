import type { Tolerance } from './tolerance';
import { type Vec3, add, cross, distance, dot, length, lerp, normalize, scale, sinAngle, sub } from './vec';

/** Плоскость n̂·X + d = 0 с единичной нормалью. */
export interface Plane {
  readonly normal: Vec3;
  readonly d: number;
}

export const signedDistance = (plane: Plane, p: Vec3): number => dot(plane.normal, p) + plane.d;

export function planeFromNormalPoint(n: Vec3, p: Vec3): Plane {
  const nn = normalize(n);
  return { normal: nn, d: -dot(nn, p) };
}

export type PlaneFromPointsResult =
  | { ok: true; plane: Plane; sin: number; illConditioned: boolean }
  | { ok: false; reason: 'coincident'; pair: [number, number] }
  | { ok: false; reason: 'collinear'; sin: number };

/**
 * Плоскость через три точки. Проверяет совпадение точек и коллинеарность
 * по синусу угла между P2−P1 и P3−P1 (безразмерная мера, не зависит от масштаба).
 */
export function planeFromPoints(p1: Vec3, p2: Vec3, p3: Vec3, tol: Tolerance): PlaneFromPointsResult {
  const pts = [p1, p2, p3];
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++)
      if (distance(pts[i], pts[j]) <= tol.merge) return { ok: false, reason: 'coincident', pair: [i, j] };
  const u = sub(p2, p1);
  const v = sub(p3, p1);
  // Берём наименьший из синусов по трём вершинам треугольника: устойчиво к выбору опорной точки.
  const s = Math.min(sinAngle(u, v), sinAngle(sub(p1, p2), sub(p3, p2)), sinAngle(sub(p1, p3), sub(p2, p3)));
  if (s < tol.collinearSin) return { ok: false, reason: 'collinear', sin: s };
  const n = cross(u, v);
  return { ok: true, plane: planeFromNormalPoint(n, p1), sin: s, illConditioned: s < tol.illConditionedSin };
}

export type SegmentPlaneHit =
  { kind: 'none' } | { kind: 'point'; t: number; point: Vec3 } | { kind: 'contained' };

/**
 * Пересечение отрезка AB с плоскостью (автономная функция, используется
 * в независимой проверке и тестах; основной алгоритм опирается на классы вершин).
 */
export function segmentPlane(a: Vec3, b: Vec3, plane: Plane, tol: Tolerance): SegmentPlaneHit {
  const da = signedDistance(plane, a);
  const db = signedDistance(plane, b);
  const za = Math.abs(da) <= tol.dist;
  const zb = Math.abs(db) <= tol.dist;
  if (za && zb) return { kind: 'contained' };
  if (za) return { kind: 'point', t: 0, point: a };
  if (zb) return { kind: 'point', t: 1, point: b };
  if (da * db > 0) return { kind: 'none' };
  const t = da / (da - db);
  return { kind: 'point', t, point: lerp(a, b, t) };
}

/** Проекция точки на плоскость. */
export const projectToPlane = (plane: Plane, p: Vec3): Vec3 =>
  sub(p, scale(plane.normal, signedDistance(plane, p)));

/** Пересечение прямой P + s·dir с плоскостью; null, если параллельна. */
export function linePlane(
  p: Vec3,
  dir: Vec3,
  plane: Plane,
  tol: Tolerance,
): { s: number; point: Vec3 } | null {
  const den = dot(plane.normal, dir);
  if (Math.abs(den) <= tol.parallelSin * length(dir)) return null;
  const s = -signedDistance(plane, p) / den;
  return { s, point: add(p, scale(dir, s)) };
}

/**
 * Пересечение двух прямых P + s·u и Q + r·v в пространстве.
 * Возвращает null, если прямые параллельны; иначе ближайшие точки и расстояние между ними
 * (для компланарных прямых расстояние ≈ 0).
 */
export function lineLine(
  p: Vec3,
  u: Vec3,
  q: Vec3,
  v: Vec3,
  tol: Tolerance,
): { s: number; r: number; pointA: Vec3; pointB: Vec3; gap: number } | null {
  if (sinAngle(u, v) < tol.parallelSin) return null;
  const w = sub(p, q);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const den = a * c - b * b;
  if (den <= 0) return null;
  const s = (b * e - c * d) / den;
  const r = (a * e - b * d) / den;
  const pointA = add(p, scale(u, s));
  const pointB = add(q, scale(v, r));
  return { s, r, pointA, pointB, gap: distance(pointA, pointB) };
}

/** Ортонормированный базис (u, v) плоскости — для перевода в 2D. */
export function planeBasis(plane: Plane): { u: Vec3; v: Vec3 } {
  const n = plane.normal;
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const helper: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { u, v };
}
