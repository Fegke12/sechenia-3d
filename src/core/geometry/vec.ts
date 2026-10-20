/** Трёхмерный вектор/точка. Кортеж — неизменяемый, легко сериализуется. */
export type Vec3 = readonly [number, number, number];

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const ZERO: Vec3 = [0, 0, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lengthSq = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** Единичный вектор. Для нулевого вектора бросает исключение — это всегда ошибка вызывающего кода. */
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l === 0 || !Number.isFinite(l)) throw new Error('normalize: нулевой или некорректный вектор');
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** A + t(B − A) */
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function centroid(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) throw new Error('centroid: пустой набор точек');
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}

export const isFiniteVec = (a: Vec3): boolean =>
  Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

/** Синус угла между векторами (0 — коллинеарны). Для нулевых векторов возвращает 0. */
export function sinAngle(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la === 0 || lb === 0) return 0;
  return Math.min(1, length(cross(a, b)) / (la * lb));
}

/** Ограничивающий параллелепипед. */
export function bounds(points: readonly Vec3[]): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}

/** Произвольный единичный вектор, перпендикулярный данному. */
export function anyPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const helper: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(n, helper));
}

/** Ньюэлловская нормаль многоугольника (не нормированная, длина = 2·площадь для плоского). */
export function newellNormal(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const c = points[i];
    const d = points[(i + 1) % n];
    x += (c[1] - d[1]) * (c[2] + d[2]);
    y += (c[2] - d[2]) * (c[0] + d[0]);
    z += (c[0] - d[0]) * (c[1] + d[1]);
  }
  return [x, y, z];
}

export const fmt = (x: number, digits = 3): string => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
};
export const fmtVec = (p: Vec3, digits = 3): string =>
  `(${fmt(p[0], digits)}; ${fmt(p[1], digits)}; ${fmt(p[2], digits)})`;
