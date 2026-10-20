import { describe, expect, it } from 'vitest';
import { convexHull2D, segmentsIntersect2D, signedArea2D } from '../../src/core/geometry/hull2d';
import {
  lineLine,
  linePlane,
  planeFromPoints,
  segmentPlane,
  signedDistance,
} from '../../src/core/geometry/plane';
import { makeTolerance } from '../../src/core/geometry/tolerance';
import {
  add,
  cross,
  dot,
  length,
  lerp,
  newellNormal,
  normalize,
  scale,
  sinAngle,
  sub,
} from '../../src/core/geometry/vec';

const tol = makeTolerance(10);

describe('векторы', () => {
  it('сложение, вычитание, масштаб', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([1, 2, 3], [4, 5, 6])).toEqual([-3, -3, -3]);
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });
  it('скалярное произведение', () => {
    expect(dot([1, 2, 3], [4, -5, 6])).toBe(12);
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
  });
  it('векторное произведение: правая тройка, антикоммутативность, ортогональность', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    const a = [2, -1, 3] as const;
    const b = [0.5, 4, -2] as const;
    const c = cross(a, b);
    expect(cross(b, a)).toEqual([-c[0], -c[1], -c[2]]);
    expect(dot(c, a)).toBeCloseTo(0, 12);
    expect(dot(c, b)).toBeCloseTo(0, 12);
  });
  it('нормализация', () => {
    const n = normalize([3, 0, 4]);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[2]).toBeCloseTo(0.8);
    expect(length(n)).toBeCloseTo(1, 14);
    expect(() => normalize([0, 0, 0])).toThrow();
  });
  it('линейная интерполяция и синус угла', () => {
    expect(lerp([0, 0, 0], [2, 4, 6], 0.25)).toEqual([0.5, 1, 1.5]);
    expect(sinAngle([1, 0, 0], [2, 0, 0])).toBe(0);
    expect(sinAngle([1, 0, 0], [0, 3, 0])).toBeCloseTo(1);
  });
  it('нормаль Ньюэлла: длина = удвоенная площадь', () => {
    const sq = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 0],
    ] as const;
    expect(newellNormal(sq)).toEqual([0, 0, 8]);
  });
});

describe('плоскость', () => {
  it('по трём точкам: уравнение выполняется во всех трёх точках', () => {
    const P = [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ] as const;
    const r = planeFromPoints(P[0], P[1], P[2], tol);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const p of P) expect(signedDistance(r.plane, p)).toBeCloseTo(0, 12);
    expect(length(r.plane.normal)).toBeCloseTo(1, 14);
    // x/1 + y/2 + z/3 = 1 → расстояние от начала координат = 1/√(1 + 1/4 + 1/9)
    expect(Math.abs(signedDistance(r.plane, [0, 0, 0]))).toBeCloseTo(1 / Math.sqrt(1 + 0.25 + 1 / 9), 12);
  });
  it('знаковое расстояние меняет знак по разные стороны', () => {
    const r = planeFromPoints([0, 0, 0], [1, 0, 0], [0, 1, 0], tol);
    if (!r.ok) throw new Error();
    expect(signedDistance(r.plane, [5, 5, 2])).toBeCloseTo(2);
    expect(signedDistance(r.plane, [5, 5, -3])).toBeCloseTo(-3);
  });
  it('совпадающие и коллинеарные точки отклоняются', () => {
    expect(planeFromPoints([0, 0, 0], [0, 0, 0], [1, 1, 1], tol)).toMatchObject({
      ok: false,
      reason: 'coincident',
    });
    expect(planeFromPoints([0, 0, 0], [1, 1, 1], [2, 2, 2], tol)).toMatchObject({
      ok: false,
      reason: 'collinear',
    });
    expect(planeFromPoints([0, 0, 0], [1, 0, 0], [2, 1e-9, 0], tol)).toMatchObject({
      ok: false,
      reason: 'collinear',
    });
    const ill = planeFromPoints([0, 0, 0], [1, 0, 0], [2, 1e-4, 0], tol);
    expect(ill.ok && ill.illConditioned).toBe(true);
  });
  it('пересечение отрезка с плоскостью', () => {
    const r = planeFromPoints([0, 0, 1], [1, 0, 1], [0, 1, 1], tol);
    if (!r.ok) throw new Error();
    const hit = segmentPlane([0, 0, 0], [0, 0, 4], r.plane, tol);
    expect(hit.kind).toBe('point');
    if (hit.kind === 'point') {
      expect(hit.t).toBeCloseTo(0.25);
      expect(hit.point[2]).toBeCloseTo(1);
    }
    expect(segmentPlane([0, 0, 2], [0, 0, 4], r.plane, tol).kind).toBe('none');
    expect(segmentPlane([0, 0, 1], [3, 0, 1], r.plane, tol).kind).toBe('contained');
    expect(segmentPlane([0, 0, 1], [3, 0, 5], r.plane, tol)).toMatchObject({ kind: 'point', t: 0 });
  });
  it('прямая–плоскость и прямая–прямая', () => {
    const r = planeFromPoints([0, 0, 0], [1, 0, 0], [0, 1, 0], tol);
    if (!r.ok) throw new Error();
    expect(linePlane([1, 1, 5], [0, 0, -1], r.plane, tol)?.point).toEqual([1, 1, 0]);
    expect(linePlane([1, 1, 5], [1, 0, 0], r.plane, tol)).toBeNull();
    const ll = lineLine([0, 0, 0], [1, 0, 0], [2, -1, 0], [0, 1, 0], tol)!;
    expect(ll.pointA[0]).toBeCloseTo(2);
    expect(ll.gap).toBeCloseTo(0);
    expect(lineLine([0, 0, 0], [1, 0, 0], [0, 1, 0], [2, 0, 0], tol)).toBeNull();
  });
});

describe('2D: оболочка и самопересечения', () => {
  it('выпуклая оболочка отбрасывает внутренние и коллинеарные точки', () => {
    const pts = [
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ] as const;
    const h = convexHull2D(pts, 1e-12);
    expect(h).toHaveLength(4);
    expect(signedArea2D(h.map((i) => pts[i]))).toBeCloseTo(4);
  });
  it('пересечение отрезков', () => {
    expect(segmentsIntersect2D([0, 0], [2, 2], [0, 2], [2, 0], 1e-12)).toBe(true);
    expect(segmentsIntersect2D([0, 0], [1, 0], [0, 1], [1, 1], 1e-12)).toBe(false);
  });
});
