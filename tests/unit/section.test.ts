import { describe, expect, it } from 'vitest';
import { planeFromNormalPoint, planeFromPoints, signedDistance } from '../../src/core/geometry/plane';
import { distance, lerp } from '../../src/core/geometry/vec';
import { createPolyhedron } from '../../src/core/polyhedra/catalog';
import { deserializeProblem, serializeProblem } from '../../src/core/problem/serialize';
import { computeSection } from '../../src/core/section/computeSection';
import type { DefinedPoint } from '../../src/core/section/points';
import { solve } from '../../src/core/solve';
import { measureSection, validateSection } from '../../src/core/validation/validateSection';
import { points, poly, rawPoly, solveText, vi } from './helpers';

const sq2 = Math.SQRT2;

function expectValid(s: ReturnType<typeof solve>) {
  expect(s.planeStatus).toBe('ok');
  expect(s.validation?.checks.filter((c) => !c.passed)).toEqual([]);
  expect(s.constructionIssues).toEqual([]);
  expect(s.trusted).toBe(true);
}

describe('сечения: аналитически проверяемые сценарии', () => {
  it('1. куб, плоскость параллельна основанию → квадрат a×a', () => {
    const c = poly('cube', { a: 4 });
    const s = solveText(c, 'M — середина AA₁\nN — середина BB₁\nK — середина CC₁');
    expectValid(s);
    expect(s.section!.status).toBe('polygon');
    expect(s.section!.vertices).toHaveLength(4);
    expect(s.measures!.area).toBeCloseTo(16, 10);
    for (const v of s.section!.vertices) expect(v.pos[2]).toBeCloseTo(2, 12);
  });

  it('2. куб, плоскость через три вершины A₁, B, D → правильный треугольник со стороной a√2', () => {
    const a = 3;
    const s = solveText(poly('cube', { a }), 'A₁ = A₁\nB = B\nD = D');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(3);
    for (const l of s.measures!.sideLengths) expect(l).toBeCloseTo(a * sq2, 10);
    expect(s.measures!.area).toBeCloseTo((Math.sqrt(3) / 4) * 2 * a * a, 10);
    expect(s.section!.vertices.every((v) => v.origin.type === 'vertex')).toBe(true);
  });

  it('3. куб, через диагонали AC и A₁C₁ → прямоугольник a × a√2', () => {
    const a = 2;
    const s = solveText(poly('cube', { a }), 'A = A\nC = C\nC₁ = C₁');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(4);
    expect(s.measures!.area).toBeCloseTo(a * a * sq2, 10);
    expect(s.section!.sides.filter((x) => x.polyEdge !== null)).toHaveLength(2); // AA₁ и CC₁
  });

  it('3b. куб, через середины трёх рёбер → правильный шестиугольник', () => {
    const a = 2;
    const s = solveText(poly('cube', { a }), 'M — середина AB\nN — середина CC₁\nK — середина A₁D₁');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(6);
    const side = a / sq2;
    for (const l of s.measures!.sideLengths) expect(l).toBeCloseTo(side, 10);
    expect(s.measures!.area).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * side * side, 10);
  });

  it('4. тетраэдр, середины DA, DB, DC → треугольник с площадью 1/4 основания', () => {
    const a = 4;
    const t = poly('tetrahedron', { a });
    const s = solveText(t, 'M — середина DA\nN — середина DB\nK — середина DC');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(3);
    expect(s.measures!.area).toBeCloseTo(((Math.sqrt(3) / 4) * a * a) / 4, 10);
  });

  it('4b. тетраэдр, четырёхугольное сечение (метод следов)', () => {
    const s = solveText(poly('tetrahedron'), 'M — середина AD\nN ∈ BD, BN : ND = 3 : 1\nK — середина BC');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(4);
    // Четвёртая вершина на AC. Менелай для △ABD: AQ = AB/2 (Q за точкой A); для △ABC: AP : PC = 1 : 3 ⇒ AP/AC = 1/4.
    const t = poly('tetrahedron');
    const extra = s.section!.vertices.find(
      (v) => v.origin.type === 'edge' && t.edgeNames[v.origin.edge] === 'AC',
    )!;
    expect(extra).toBeDefined();
    expect(
      distance(extra.pos, t.vertices[vi(t, 'A')]) / distance(t.vertices[vi(t, 'A')], t.vertices[vi(t, 'C')]),
    ).toBeCloseTo(1 / 4, 10);
  });

  it('5. треугольная призма, точки на боковых рёбрах на одной высоте → треугольник, равный основанию', () => {
    const p = poly('prism', { n: 3, a: 3, h: 6 });
    const s = solveText(p, 'M ∈ AA₁, AM : MA₁ = 1 : 2\nN ∈ BB₁, BN : NB₁ = 1 : 2\nK ∈ CC₁, CK : KC₁ = 1 : 2');
    expectValid(s);
    expect(s.measures!.area).toBeCloseTo((Math.sqrt(3) / 4) * 9, 10);
  });

  it('6. четырёхугольная пирамида, через S и середины AB и CD → треугольник a·h/2', () => {
    const a = 4;
    const h = 5;
    const s = solveText(poly('pyramid', { n: 4, a, h }), 'S = S\nM — середина AB\nN — середина CD');
    expectValid(s);
    expect(s.section!.vertices).toHaveLength(3);
    expect(s.measures!.area).toBeCloseTo((a * h) / 2, 10);
  });

  it('7. плоскость, не пересекающая многогранник', () => {
    const c = poly('cube', { a: 2 });
    const sec = computeSection(c, planeFromNormalPoint([0, 0, 1], [0, 0, 5]));
    expect(sec.status).toBe('empty');
    expect(sec.signs.every((x) => x === -1)).toBe(true);
    expect(validateSection(c, sec).ok).toBe(true);
  });

  it('8. плоскость через вершину: вершина не дублируется', () => {
    const c = poly('cube');
    const s = solveText(c, 'A = A\nM — середина BB₁\nN — середина DD₁');
    expectValid(s);
    const keys = s.section!.vertices.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(s.section!.vertices.filter((v) => v.origin.type === 'vertex')).toHaveLength(2); // A и C₁
    expect(s.section!.vertices).toHaveLength(4); // ромб AMC₁N
  });

  it('9. плоскость содержит ребро AB → сторона совпадает с ребром', () => {
    const c = poly('cube');
    const s = solveText(c, 'A = A\nB = B\nK — середина C₁D₁');
    expectValid(s);
    const side = s.section!.sides.find((x) => x.polyEdge === c.edgeNames.indexOf('AB'));
    expect(side).toBeDefined();
    expect(side!.faces).toHaveLength(2);
    expect(s.measures!.area).toBeCloseTo(4 * 4 * sq2, 9);
  });

  it('10. плоскость совпадает с гранью → вырожденный результат «грань»', () => {
    const c = poly('cube');
    const s = solveText(c, 'M — середина AB\nN — середина BC\nK — середина CD');
    expect(s.section!.status).toBe('face');
    expect(s.section!.touchFace).toBe(0);
    expect(s.section!.vertices).toHaveLength(4);
    expect(s.trusted).toBe(true);
    expect(s.construction!.steps.some((st) => st.rule === 'degenerate')).toBe(true);
  });

  it('11. вырожденное задание плоскости (коллинеарные точки) отклоняется', () => {
    const s = solveText(poly('cube'), 'M ∈ AB, AM : MB = 1 : 3\nN — середина AB\nK ∈ AB, AK : KB = 3 : 1');
    expect(s.planeStatus).toBe('collinear');
    expect(s.section).toBeNull();
    expect(s.message).toMatch(/одной прямой/);
  });

  it('12. плоскость проходит очень близко к вершине (вне допуска) — маленький, но корректный треугольник', () => {
    const c = poly('cube', { a: 1 });
    const d = 1e-6;
    const sec = computeSection(c, planeFromNormalPoint([1, 1, 1], [1 - d, 1, 1]));
    expect(sec.status).toBe('polygon');
    expect(sec.vertices).toHaveLength(3);
    expect(validateSection(c, sec).ok).toBe(true);
    // А на расстоянии ниже допуска — касание в вершине.
    const touch = computeSection(c, planeFromNormalPoint([1, 1, 1], [1 - 1e-13, 1, 1]));
    expect(touch.status).toBe('point');
  });

  it('13. порядок задания точек не влияет на сечение', () => {
    const c = poly('cube');
    const base = points(c, 'M — середина AB\nN ∈ CC₁, CN : NC₁ = 1 : 3\nK — середина A₁D₁');
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const ref = solve(c, base);
    expectValid(ref);
    for (const p of perms) {
      const s = solve(
        c,
        p.map((i) => base[i]),
      );
      expectValid(s);
      expect(s.section!.vertices).toHaveLength(ref.section!.vertices.length);
      expect(s.measures!.area).toBeCloseTo(ref.measures!.area, 10);
      for (const v of s.section!.vertices)
        expect(ref.section!.vertices.some((w) => distance(v.pos, w.pos) < 1e-9)).toBe(true);
    }
  });

  it('14. масштаб: площадь растёт как квадрат коэффициента подобия', () => {
    const text = 'M — середина AB\nN ∈ CC₁, CN : NC₁ = 1 : 3\nK — середина A₁D₁';
    const s1 = solveText(rawPoly('cube', { a: 1 }), text);
    for (const k of [1e-3, 0.37, 10, 1e3, 1e5]) {
      const s = solveText(rawPoly('cube', { a: k }), text);
      expectValid(s);
      expect(s.section!.vertices).toHaveLength(s1.section!.vertices.length);
      expect(s.measures!.area / (k * k)).toBeCloseTo(s1.measures!.area, 9);
    }
  });

  it('15. отношение AM : MB = 2 : 1 даёт точку на 2/3 ребра от A', () => {
    const c = poly('cube', { a: 3 });
    const [M] = points(c, 'M ∈ AB, AM : MB = 2 : 1');
    const s = solve(c, [M]);
    const pos = s.points[0].pos!;
    const A = c.vertices[vi(c, 'A')];
    const B = c.vertices[vi(c, 'B')];
    expect(distance(A, pos)).toBeCloseTo(2, 12);
    expect(distance(pos, B)).toBeCloseTo(1, 12);
    expect(distance(A, pos) / distance(pos, B)).toBeCloseTo(2, 12);
    // Обратная запись: BM : MA = 1 : 2 — та же точка.
    const [M2] = points(c, 'M ∈ BA, BM : MA = 1 : 2');
    expect(distance(solve(c, [M2]).points[0].pos!, pos)).toBeLessThan(1e-12);
  });

  it('16. сохранение и восстановление построения', () => {
    const c = poly('pyramid', { n: 4, a: 3.5, h: 6 });
    const pts = points(c, 'M ∈ SA, SM : MA = 1 : 1\nN ∈ SB, SN : NB = 3 : 7\nK ∈ SC, SK : KC = 3 : 2');
    const json = serializeProblem({ kind: 'pyramid', params: c.params, points: pts });
    const back = deserializeProblem(json);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const p2 = createPolyhedron(back.problem.kind, back.problem.params);
    const s1 = solve(c, pts);
    const s2 = solve(p2, back.problem.points);
    expectValid(s2);
    expect(s2.measures!.area).toBeCloseTo(s1.measures!.area, 12);
    expect(s2.construction!.polygonName).toBe(s1.construction!.polygonName);
  });
});

describe('граничные и вырожденные случаи (раздел 7)', () => {
  const c = poly('cube', { a: 4 });
  const mk = (specs: DefinedPoint['spec'][]): DefinedPoint[] =>
    specs.map((spec, i) => ({ id: `d${i}`, label: ['M', 'N', 'K'][i], spec }));
  const A = vi(c, 'A');
  const B = vi(c, 'B');
  const C = vi(c, 'C');

  it('1. все три точки совпадают', () => {
    const s = solve(
      c,
      mk([
        { kind: 'edge', from: A, to: B, t: 0.5 },
        { kind: 'edge', from: B, to: A, t: 0.5 },
        { kind: 'edge', from: A, to: B, t: 0.5 },
      ]),
    );
    expect(s.planeStatus).toBe('coincident');
  });
  it('2. две точки совпадают', () => {
    const s = solve(
      c,
      mk([
        { kind: 'vertex', vertex: A },
        { kind: 'edge', from: A, to: B, t: 0 },
        { kind: 'vertex', vertex: C },
      ]),
    );
    expect(s.planeStatus).toBe('coincident');
    expect(s.message).toMatch(/совпадают/);
  });
  it('3. три точки коллинеарны (на диагонали грани)', () => {
    const s = solve(
      c,
      mk([
        { kind: 'vertex', vertex: A },
        { kind: 'face', face: 0, weights: [0.25, 0.25, 0.25, 0.25] },
        { kind: 'vertex', vertex: C },
      ]),
    );
    expect(s.planeStatus).toBe('collinear');
  });
  it('4. точки почти коллинеарны: ниже допуска — ошибка, чуть выше — предупреждение', () => {
    const near = solve(
      c,
      mk([
        { kind: 'vertex', vertex: A },
        { kind: 'edge', from: A, to: B, t: 0.5 },
        { kind: 'edge', from: B, to: vi(c, 'B₁'), t: 1e-8 },
      ]),
    );
    expect(near.planeStatus).toBe('collinear');
    const ill = solve(
      c,
      mk([
        { kind: 'vertex', vertex: A },
        { kind: 'edge', from: A, to: B, t: 0.5 },
        { kind: 'edge', from: B, to: vi(c, 'B₁'), t: 2e-4 },
      ]),
    );
    expect(ill.planeStatus).toBe('ok');
    expect(ill.illConditioned).toBe(true);
    expect(ill.message).toMatch(/неустойчиво/);
  });
  it('5. одна точка — вершина: она становится вершиной сечения', () => {
    const s = solveText(c, 'A = A\nN — середина CC₁\nK ∈ B₁C₁, B₁K : KC₁ = 1 : 1');
    expectValid(s);
    expect(s.section!.vertices.some((v) => v.origin.type === 'vertex' && v.origin.vertex === A)).toBe(true);
  });
  it('6. две точки на одном ребре → плоскость содержит ребро', () => {
    const s = solveText(c, 'M ∈ AB, AM : MB = 1 : 3\nN ∈ AB, AN : NB = 3 : 1\nK — середина C₁D₁');
    expectValid(s);
    expect(s.section!.sides.some((x) => x.polyEdge === c.edgeNames.indexOf('AB'))).toBe(true);
  });
  it('7–8. плоскость через вершины и два ребра (диагональное сечение)', () => {
    const s = solveText(c, 'B = B\nD = D\nD₁ = D₁');
    expectValid(s);
    expect(s.section!.sides.filter((x) => x.polyEdge !== null)).toHaveLength(2);
  });
  it('9, 12. касание по ребру → отрезок', () => {
    const sec = computeSection(c, planeFromNormalPoint([1, -1, 0], c.vertices[B]));
    // нормаль (1, −1, 0) через B(4,0,0): ребро BB₁ лежит в плоскости, остальное — по одну сторону.
    expect(sec.status).toBe('segment');
    expect(c.edgeNames[sec.touchEdge!]).toBe('BB₁');
    expect(validateSection(c, sec).ok).toBe(true);
  });
  it('10. совпадение с гранью через явную плоскость', () => {
    const sec = computeSection(c, planeFromNormalPoint([0, 0, 1], [0, 0, 4]));
    expect(sec.status).toBe('face');
    expect(c.faceNames[sec.touchFace!]).toBe('A₁B₁C₁D₁');
  });
  it('11. касание в одной вершине → точка', () => {
    const sec = computeSection(c, planeFromNormalPoint([1, 1, 1], [4, 4, 4]));
    expect(sec.status).toBe('point');
    expect(c.labels[sec.touchVertex!]).toBe('C₁');
  });
  it('13. плоскость через вершину и точку внутри грани', () => {
    const s = solve(
      c,
      mk([
        { kind: 'vertex', vertex: A },
        { kind: 'face', face: 3, weights: [0.25, 0.25, 0.25, 0.25] },
        { kind: 'edge', from: vi(c, 'D'), to: vi(c, 'D₁'), t: 0.5 },
      ]),
    );
    expectValid(s);
    expect(s.validation!.checks.find((x) => x.id === 'defining')!.passed).toBe(true);
  });
  it('14–15. все вершины по одну сторону → пусто', () => {
    const sec = computeSection(c, planeFromNormalPoint([1, 2, 3], [-1, -1, -1]));
    expect(sec.status).toBe('empty');
    expect(new Set(sec.signs).size).toBe(1);
  });
  it('16. плоскость через несколько вершин сечения-вершин многогранника одновременно', () => {
    const s = solveText(c, 'A = A\nC₁ = C₁\nM — середина BB₁');
    expectValid(s);
    expect(s.section!.vertices.filter((v) => v.origin.type === 'vertex')).toHaveLength(2);
  });
  it('17. очень маленький и очень большой масштаб', () => {
    for (const a of [1e-6, 1e6]) {
      const s = solveText(
        rawPoly('pyramid', { n: 5, a, h: 2 * a }),
        'M ∈ SA, SM : MA = 1 : 2\nN — середина BC\nK ∈ SD, SK : KD = 3 : 1',
      );
      expectValid(s);
    }
  });
  it('18–19. изменение размеров и перемещение точки сохраняют корректность', () => {
    for (const h of [1, 3, 9])
      for (const t of [0.05, 0.3, 0.5, 0.95]) {
        const p = poly('prism', { n: 5, a: 2, h });
        const s = solve(
          p,
          mk([
            { kind: 'edge', from: vi(p, 'A'), to: vi(p, 'A₁'), t },
            { kind: 'edge', from: vi(p, 'C'), to: vi(p, 'D'), t: 0.5 },
            { kind: 'edge', from: vi(p, 'D₁'), to: vi(p, 'E₁'), t: 0.25 },
          ]),
        );
        expectValid(s);
      }
  });
  it('20. удаление точки → требуется ещё точка; повторный выбор восстанавливает', () => {
    const pts = points(c, 'M — середина AB\nN — середина BC\nK — середина CC₁');
    const two = solve(c, pts.slice(0, 2));
    expect(two.planeStatus).toBe('need-points');
    expect(two.message).toMatch(/ещё 1/);
    expectValid(solve(c, pts));
  });
  it('21. почти касательное положение плоскости', () => {
    const pl = planeFromPoints(c.vertices[vi(c, 'C₁')], [4, 4 - 1e-7, 4], [4 - 1e-7, 4, 4], c.tol);
    expect(pl.ok).toBe(true);
    if (!pl.ok) return;
    // Плоскость z = 4 немного повёрнута — проходит через C₁; результат корректен в любом случае.
    const sec = computeSection(c, pl.plane);
    expect(validateSection(c, sec).ok).toBe(true);
  });
  it('22. отношения, близкие к 0 и 1', () => {
    for (const t of [1e-6, 1 - 1e-6]) {
      const s = solve(
        c,
        mk([
          { kind: 'edge', from: A, to: B, t },
          { kind: 'edge', from: C, to: vi(c, 'C₁'), t: 0.5 },
          { kind: 'edge', from: vi(c, 'A₁'), to: vi(c, 'D₁'), t: 0.5 },
        ]),
      );
      expectValid(s);
    }
    // t ниже допуска слияния — точка совпадает с вершиной A, дубликатов нет.
    const s = solve(
      c,
      mk([
        { kind: 'edge', from: A, to: B, t: 1e-12 },
        { kind: 'edge', from: C, to: vi(c, 'C₁'), t: 0.5 },
        { kind: 'edge', from: vi(c, 'A₁'), to: vi(c, 'D₁'), t: 0.5 },
      ]),
    );
    expectValid(s);
    expect(new Set(s.section!.vertices.map((v) => v.key)).size).toBe(s.section!.vertices.length);
  });
  it('23. спецификации от другой фигуры отклоняются, а не дают фиктивный ответ', () => {
    const pts = points(poly('cube'), 'M — середина A₁B₁\nN — середина CC₁\nK — середина D₁A₁');
    const s = solve(poly('tetrahedron'), pts);
    expect(s.planeStatus).toBe('invalid-point');
  });
  it('пересечение не зависит от выбора опорной точки плоскости', () => {
    const pts = [
      c.vertices[A],
      lerp(c.vertices[B], c.vertices[vi(c, 'B₁')], 0.3),
      lerp(c.vertices[vi(c, 'D')], c.vertices[vi(c, 'D₁')], 0.6),
    ];
    const pr = planeFromPoints(pts[0], pts[1], pts[2], c.tol);
    if (!pr.ok) throw new Error();
    for (const p of pts) expect(Math.abs(signedDistance(pr.plane, p))).toBeLessThan(1e-12);
    expect(measureSection(computeSection(c, pr.plane)).area).toBeGreaterThan(0);
  });
});
