import { describe, expect, it } from 'vitest';
import { distance } from '../../src/core/geometry/vec';
import { parallelEdgeReason } from '../../src/core/polyhedra/build';
import { KINDS, createPolyhedron, topologyKey } from '../../src/core/polyhedra/catalog';
import { polyhedronVolume, validatePolyhedron } from '../../src/core/polyhedra/validate';
import { poly, vi } from './helpers';

const COUNTS: [string, Record<string, number>, number, number, number][] = [
  ['cube', {}, 8, 12, 6],
  ['parallelepiped', {}, 8, 12, 6],
  ['parallelepiped', { angle: 60, shiftX: 1, shiftY: -0.5 }, 8, 12, 6],
  ['prism', { n: 3 }, 6, 9, 5],
  ['prism', { n: 4 }, 8, 12, 6],
  ['prism', { n: 5 }, 10, 15, 7],
  ['prism', { n: 6 }, 12, 18, 8],
  ['prism', { n: 6, shiftX: 1.5, shiftY: 0.7 }, 12, 18, 8],
  ['prism', { n: 12 }, 24, 36, 14],
  ['pyramid', { n: 3 }, 4, 6, 4],
  ['pyramid', { n: 4 }, 5, 8, 5],
  ['pyramid', { n: 5 }, 6, 10, 6],
  ['pyramid', { n: 6 }, 7, 12, 7],
  ['pyramid', { n: 4, apexX: 2.5, apexY: -1 }, 5, 8, 5],
  ['tetrahedron', {}, 4, 6, 4],
  ['tetrahedron', { regular: 0 }, 4, 6, 4],
  ['octahedron', {}, 6, 12, 8],
  ['dodecahedron', {}, 20, 30, 12],
  ['icosahedron', {}, 12, 30, 20],
];

describe('модели многогранников', () => {
  it.each(COUNTS)('%s %j: V, E, F, корректность, Эйлер', (kind, params, V, E, F) => {
    const p = createPolyhedron(kind as never, params);
    expect(p.vertices).toHaveLength(V);
    expect(p.edges).toHaveLength(E);
    expect(p.faces).toHaveLength(F);
    expect(V - E + F).toBe(2);
    expect(validatePolyhedron(p)).toEqual([]);
  });

  it('все виды каталога строятся и валидны по умолчанию', () => {
    for (const k of KINDS) expect(validatePolyhedron(createPolyhedron(k.kind)), k.kind).toEqual([]);
  });

  it('ссылки граней и рёбер указывают на существующие элементы', () => {
    for (const k of KINDS) {
      const p = createPolyhedron(k.kind);
      for (const f of p.faces) for (const v of f) expect(v).toBeLessThan(p.vertices.length);
      p.edgeFaces.forEach(([f1, f2]) => {
        expect(f1).toBeGreaterThanOrEqual(0);
        expect(f2).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('правильные многогранники: все рёбра равны заданному a', () => {
    for (const kind of ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'] as const) {
      const a = 3;
      const p = createPolyhedron(kind, { a });
      for (const [x, y] of p.edges) expect(distance(p.vertices[x], p.vertices[y])).toBeCloseTo(a, 9);
    }
  });

  it('объёмы совпадают с формулами', () => {
    const a = 2;
    expect(polyhedronVolume(poly('cube', { a }))).toBeCloseTo(8, 9);
    expect(polyhedronVolume(poly('tetrahedron', { a }))).toBeCloseTo(a ** 3 / (6 * Math.SQRT2), 9);
    expect(polyhedronVolume(poly('octahedron', { a }))).toBeCloseTo((Math.SQRT2 / 3) * a ** 3, 9);
    expect(polyhedronVolume(poly('dodecahedron', { a }))).toBeCloseTo(
      ((15 + 7 * Math.sqrt(5)) / 4) * a ** 3,
      9,
    );
    expect(polyhedronVolume(poly('icosahedron', { a }))).toBeCloseTo(
      ((5 * (3 + Math.sqrt(5))) / 12) * a ** 3,
      9,
    );
    expect(polyhedronVolume(poly('pyramid', { n: 4, a: 3, h: 4 }))).toBeCloseTo(12, 9);
    expect(polyhedronVolume(poly('prism', { n: 3, a: 2, h: 5 }))).toBeCloseTo(Math.sqrt(3) * 5, 9);
  });

  it('школьные обозначения: куб ABCDA₁B₁C₁D₁, пирамида SABCD', () => {
    expect(poly('cube').labels).toEqual(['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁']);
    expect(poly('cube').faceNames).toContain('ABB₁A₁');
    expect(poly('pyramid', { n: 4 }).labels).toEqual(['S', 'A', 'B', 'C', 'D']);
    expect(poly('pyramid', { n: 4 }).faceNames).toEqual(['ABCD', 'SAB', 'SBC', 'SCD', 'SAD']);
  });

  it('параллельные грани имеют обоснование только там, где оно верно', () => {
    expect(poly('cube').parallelFaces).toHaveLength(3);
    expect(poly('prism', { n: 3 }).parallelFaces).toHaveLength(1);
    expect(poly('prism', { n: 6 }).parallelFaces).toHaveLength(4);
    expect(poly('pyramid', { n: 4 }).parallelFaces).toHaveLength(0);
    expect(poly('tetrahedron').parallelFaces).toHaveLength(0);
    expect(poly('octahedron').parallelFaces).toHaveLength(4);
    expect(poly('icosahedron').parallelFaces).toHaveLength(10);
    expect(poly('dodecahedron').parallelFaces).toHaveLength(6);
  });

  it('цепочки параллельных рёбер', () => {
    const c = poly('cube');
    const e = (a: string, b: string) => c.edgeNames.indexOf(a + b);
    expect(parallelEdgeReason(c, e('A', 'B'), e('C', 'D'))).toMatch(/квадрата/);
    expect(parallelEdgeReason(c, e('A', 'B'), e('C₁', 'D₁'))).toBeTruthy();
    expect(parallelEdgeReason(c, e('A', 'B'), e('B', 'C'))).toBeNull();
    const t = poly('tetrahedron');
    expect(t.parallelEdges).toHaveLength(0);
  });

  it('ключ топологии меняется при смене числа сторон, но не размеров', () => {
    expect(topologyKey(poly('prism', { n: 3, a: 2 }))).toBe(topologyKey(poly('prism', { n: 3, a: 5, h: 9 })));
    expect(topologyKey(poly('prism', { n: 3 }))).not.toBe(topologyKey(poly('prism', { n: 4 })));
  });

  it('вершина пирамиды S над основанием, координаты куба школьные', () => {
    const c = poly('cube', { a: 4 });
    expect(c.vertices[vi(c, 'C₁')]).toEqual([4, 4, 4]);
    const p = poly('pyramid', { n: 4, h: 5 });
    expect(p.vertices[vi(p, 'S')][2]).toBe(5);
  });
});
