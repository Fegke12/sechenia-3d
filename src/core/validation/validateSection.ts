import { convexHull2D, segmentsIntersect2D, signedArea2D, type Vec2 } from '../geometry/hull2d';
import { planeBasis, segmentPlane, signedDistance } from '../geometry/plane';
import { type Vec3, cross, distance, dot, lerp, sub } from '../geometry/vec';
import type { Polyhedron } from '../polyhedra/types';
import type { Section } from '../section/computeSection';

export interface Check {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

/** Перевод точек плоскости в 2D-базис. */
export function to2D(section: Section, pts: readonly Vec3[]): Vec2[] {
  const { u, v } = planeBasis(section.plane);
  return pts.map((p) => [dot(p, u), dot(p, v)] as const);
}

/** Независимый расчёт: все пересечения рёбер напрямую + выпуклая оболочка в плоскости. */
export function bruteForceSectionPoints(poly: Polyhedron, section: Section): Vec3[] {
  const raw: Vec3[] = [];
  for (const [a, b] of poly.edges) {
    const hit = segmentPlane(poly.vertices[a], poly.vertices[b], section.plane, poly.tol);
    if (hit.kind === 'point') raw.push(hit.point);
    if (hit.kind === 'contained') raw.push(poly.vertices[a], poly.vertices[b]);
  }
  const uniq: Vec3[] = [];
  for (const p of raw) if (!uniq.some((q) => distance(p, q) <= poly.tol.merge)) uniq.push(p);
  return uniq;
}

export function validateSection(
  poly: Polyhedron,
  section: Section,
  definingPoints: readonly Vec3[] = [],
): ValidationReport {
  const { tol } = poly;
  const checks: Check[] = [];
  const add = (id: string, title: string, passed: boolean, detail: string) =>
    checks.push({ id, title, passed, detail });

  if (section.status === 'error') {
    add('algorithm', 'Алгоритм построения', false, section.error ?? 'ошибка');
    return { ok: false, checks };
  }
  const V = section.vertices.map((v) => v.pos);

  // 1. Принадлежность плоскости.
  const maxPlane = Math.max(0, ...V.map((p) => Math.abs(signedDistance(section.plane, p))));
  add(
    'on-plane',
    'Вершины лежат в секущей плоскости',
    maxPlane <= tol.merge * (1 + 1e-9),
    `макс. отклонение ${maxPlane.toExponential(2)}`,
  );

  // 2. Внутри многогранника.
  let maxOut = 0;
  for (const p of V) for (const fp of poly.facePlanes) maxOut = Math.max(maxOut, signedDistance(fp, p));
  add(
    'inside',
    'Вершины внутри или на границе многогранника',
    maxOut <= tol.dist * 10,
    `макс. выход наружу ${maxOut.toExponential(2)}`,
  );

  // 3. Стороны лежат в гранях.
  let sidesOk = true;
  for (const s of section.sides) {
    const a = V[s.a];
    const b = V[s.b];
    const mid = lerp(a, b, 0.5);
    if (Math.abs(signedDistance(section.plane, mid)) > tol.dist * 10) sidesOk = false;
    if (s.faces.length === 0) sidesOk = false;
    for (const f of s.faces)
      for (const p of [a, b, mid])
        if (Math.abs(signedDistance(poly.facePlanes[f], p)) > tol.dist * 10) sidesOk = false;
  }
  add(
    'sides-on-faces',
    'Каждая сторона лежит в грани многогранника',
    sidesOk,
    `${section.sides.length} сторон проверено`,
  );

  // 4. Замкнутость и отсутствие повторов.
  let dup = false;
  for (let i = 0; i < V.length; i++)
    for (let j = i + 1; j < V.length; j++) if (distance(V[i], V[j]) <= tol.merge) dup = true;
  const n = V.length;
  let closed = true;
  if (section.status === 'polygon' || section.status === 'face') {
    if (section.sides.length !== n) closed = false;
    section.sides.forEach((s, i) => {
      if (s.a !== i || s.b !== (i + 1) % n) closed = false;
    });
  }
  add(
    'closed',
    'Граница замкнута, повторяющихся вершин нет',
    closed && !dup,
    dup ? 'есть совпадающие вершины' : `${n} вершин`,
  );

  // 5. Выпуклость и простота.
  if (section.status === 'polygon' || section.status === 'face') {
    const P = to2D(section, V);
    const area = signedArea2D(P);
    let convex = n >= 3 && area > 0;
    for (let i = 0; i < n && convex; i++) {
      const a = V[i];
      const b = V[(i + 1) % n];
      const c = V[(i + 2) % n];
      if (dot(cross(sub(b, a), sub(c, b)), section.plane.normal) <= 0) convex = false;
    }
    let simple = true;
    // Допуск ориентированной площади: относительная машинная точность для координат порядка L.
    const epsA = 1e-13 * tol.scale * tol.scale;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segmentsIntersect2D(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n], epsA)) simple = false;
      }
    add(
      'convex',
      'Многоугольник выпуклый, без самопересечений, ориентирован по нормали',
      convex && simple,
      convex && simple ? 'ок' : 'нарушено',
    );

    // 6. Независимый расчёт.
    const brute = bruteForceSectionPoints(poly, section);
    const B2 = to2D(section, brute);
    const hull = convexHull2D(B2, epsA);
    // Сравнение с допуском слияния: каждая вершина сечения — точка независимого расчёта,
    // а каждая вершина оболочки лежит на границе сечения (лишние почти коллинеарные точки допустимы).
    const hullPts = hull.map((i) => brute[i]);
    const verticesFound = V.every((q) => brute.some((p) => distance(p, q) <= tol.merge * 10));
    const hullOnBoundary = hullPts.every((p) =>
      section.sides.some((sd) => distPointSegment(p, V[sd.a], V[sd.b]) <= tol.merge * 10),
    );
    const sameCount = verticesFound;
    const allMatch = hullOnBoundary;
    const hullArea = signedArea2D(hull.map((i) => B2[i]));
    // Сдвиг вершин в пределах допуска слияния меняет площадь не более чем на ε·периметр.
    let perim = 0;
    for (let i = 0; i < n; i++) perim += distance(V[i], V[(i + 1) % n]);
    const areaOk = Math.abs(hullArea - area) <= 10 * tol.merge * perim;
    add(
      'independent',
      'Совпадает с независимым расчётом (пересечение рёбер + выпуклая оболочка)',
      sameCount && allMatch && areaOk,
      `вершин: ${n} / ${hullPts.length}, площадь: ${area.toFixed(6)} / ${hullArea.toFixed(6)}`,
    );
  } else {
    // Вырожденные случаи: проверяем, что многогранник действительно по одну сторону.
    const pos = section.signs.includes(1);
    const neg = section.signs.includes(-1);
    const zeros = section.signs.filter((s) => s === 0).length;
    const expected = zeros === 0 ? 'empty' : zeros === 1 ? 'point' : zeros === 2 ? 'segment' : 'face';
    add(
      'dimension',
      'Размерность пересечения определена верно',
      !(pos && neg) && expected === section.status,
      `вершин на плоскости: ${zeros}; результат: ${section.status}`,
    );
  }

  // 7. Заданные точки — на границе сечения.
  if (definingPoints.length > 0 && section.vertices.length > 0) {
    const onBoundary = (p: Vec3) => {
      if (V.length === 1) return distance(p, V[0]) <= tol.merge * 10;
      return section.sides.some((s) => distPointSegment(p, V[s.a], V[s.b]) <= tol.dist * 100);
    };
    const bad = definingPoints.filter((p) => !onBoundary(p)).length;
    add(
      'defining',
      'Заданные точки лежат на границе сечения',
      bad === 0,
      bad === 0 ? 'все точки на границе' : `${bad} точ. вне границы`,
    );
  }

  return { ok: checks.every((c) => c.passed), checks };
}

export function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return distance(p, lerp(a, b, t));
}

/** Площадь, периметр и длины сторон многоугольника сечения. */
export function measureSection(section: Section): { area: number; perimeter: number; sideLengths: number[] } {
  const V = section.vertices.map((v) => v.pos);
  if (section.status === 'segment') {
    const l = distance(V[0], V[1]);
    return { area: 0, perimeter: l, sideLengths: [l] };
  }
  if (section.status !== 'polygon' && section.status !== 'face')
    return { area: 0, perimeter: 0, sideLengths: [] };
  const sideLengths = section.sides.map((s) => distance(V[s.a], V[s.b]));
  const P = to2D(section, V);
  return { area: Math.abs(signedArea2D(P)), perimeter: sideLengths.reduce((a, b) => a + b, 0), sideLengths };
}
