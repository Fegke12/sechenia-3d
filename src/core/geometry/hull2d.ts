export type Vec2 = readonly [number, number];

const cross2 = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Выпуклая оболочка (монотонная цепочка Эндрю). Возвращает индексы исходных точек
 * в порядке обхода против часовой стрелки, без коллинеарных промежуточных точек.
 * eps — допуск ориентированной площади.
 */
export function convexHull2D(points: readonly Vec2[], eps: number): number[] {
  const idx = points
    .map((_, i) => i)
    .sort((i, j) => points[i][0] - points[j][0] || points[i][1] - points[j][1]);
  if (idx.length <= 1) return idx;
  const build = (order: number[]): number[] => {
    const h: number[] = [];
    for (const i of order) {
      while (h.length >= 2 && cross2(points[h[h.length - 2]], points[h[h.length - 1]], points[i]) <= eps)
        h.pop();
      h.push(i);
    }
    return h;
  };
  const lower = build(idx);
  const upper = build([...idx].reverse());
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull;
}

/** Ориентированная площадь многоугольника (формула шнурования). */
export function signedArea2D(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

/** Пересекаются ли отрезки ab и cd (включая касание), с допуском eps по площади. */
export function segmentsIntersect2D(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps: number): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
    return true;
  const onSeg = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p[0], q[0]) - 1e-12 <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + 1e-12 &&
    Math.min(p[1], q[1]) - 1e-12 <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + 1e-12;
  if (Math.abs(d1) <= eps && onSeg(c, d, a)) return true;
  if (Math.abs(d2) <= eps && onSeg(c, d, b)) return true;
  if (Math.abs(d3) <= eps && onSeg(a, b, c)) return true;
  if (Math.abs(d4) <= eps && onSeg(a, b, d)) return true;
  return false;
}
