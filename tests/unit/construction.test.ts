import { describe, expect, it } from 'vitest';
import { constructionSnapshot } from '../../src/core/construction/buildConstruction';
import { createPolyhedron } from '../../src/core/polyhedra/catalog';
import { EXAMPLES, exampleToProblem, mulberry32, randomProblem } from '../../src/core/problem/examples';
import { solve } from '../../src/core/solve';
import { poly, solveText } from './helpers';

describe('школьное решение', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('пример %s решается и проходит проверку', (_, ex) => {
    const pr = exampleToProblem(ex);
    const p = createPolyhedron(pr.kind, pr.params);
    const s = solve(p, pr.points);
    expect(s.planeStatus).toBe('ok');
    expect(s.trusted).toBe(true);
    expect(s.construction!.complete).toBe(true);
    // Каждый шаг содержит действие, обоснование и результат.
    for (const st of s.construction!.steps) {
      expect(st.title.length).toBeGreaterThan(5);
      expect(st.justification.length).toBeGreaterThan(0);
      expect(st.result.length).toBeGreaterThan(0);
    }
  });

  it('пирамида, метод следов: вспомогательные точки на прямых AB и BC, след в основании', () => {
    const s = solveText(
      poly('pyramid', { n: 4 }),
      'M ∈ SA, SM : MA = 1 : 1\nN ∈ SB, SN : NB = 3 : 7\nK ∈ SC, SK : KC = 3 : 2',
    );
    const steps = s.construction!.steps;
    const aux = steps.filter((x) => x.rule === 'intersect' && x.result.includes('вспомогательная'));
    expect(aux.length).toBe(2);
    expect(steps.some((x) => x.rule === 'connect' && x.result.includes('α ∩ (ABCD)'))).toBe(true);
    expect(s.construction!.usedCoordinateMethod).toBe(false);
    // Обоснование ссылается на аксиому о прямой в плоскости.
    expect(steps.find((x) => x.rule === 'connect')!.justification.join(' ')).toMatch(
      /вся прямая лежит в этой плоскости/,
    );
  });

  it('куб: параллельность граней используется с обоснованием', () => {
    const s = solveText(poly('cube'), 'M — середина AB\nN — середина CC₁\nK — середина A₁D₁');
    const par = s.construction!.steps.filter((x) => x.rule === 'parallel');
    expect(par.length).toBeGreaterThan(0);
    expect(par[0].justification.join(' ')).toMatch(/параллельн/);
  });

  it('пирамида с равными отношениями: MN ∥ AB доказывается подобием, след в SCD ∥ CD', () => {
    const s = solveText(
      poly('pyramid', { n: 4 }),
      'M ∈ SA, SM : MA = 1 : 2\nN ∈ SB, SN : NB = 1 : 2\nK ∈ SC, SK : KC = 1 : 2',
    );
    expect(s.trusted).toBe(true);
    expect(s.construction!.usedCoordinateMethod).toBe(false);
    const par = s.construction!.steps.find((x) => x.rule === 'parallel')!;
    expect(par.justification.join(' ')).toMatch(/подобны/);
    expect(s.section!.vertices).toHaveLength(4);
  });

  it('точки в трёх разных гранях: используется внутреннее проектирование', () => {
    const s = solveText(poly('cube'), 'M — середина AA₁\nN ∈ BC, BN : NC = 1 : 2\nK — середина C₁D₁');
    expect(s.construction!.steps.some((x) => x.rule === 'projection')).toBe(true);
    expect(s.trusted).toBe(true);
  });

  it('вырожденный случай (грань) — шаг с объяснением, без фиктивных построений', () => {
    const s = solveText(poly('cube'), 'M — середина AB\nN — середина BC\nK — середина CD');
    expect(s.construction!.steps.map((x) => x.rule)).toEqual(['plane', 'degenerate']);
  });

  it('снимок чертежа: на последнем шаге видны все вершины и стороны', () => {
    const s = solveText(poly('cube'), 'M — середина AB\nN — середина CC₁\nK — середина A₁D₁');
    const c = s.construction!;
    const snap = constructionSnapshot(c, c.steps.length - 1);
    expect(snap.points.filter((p) => p.sectionIndex !== null).length).toBeGreaterThanOrEqual(6);
    expect(snap.lines.filter((l) => l.line.kind === 'side')).toHaveLength(6);
    const first = constructionSnapshot(c, 0);
    expect(first.lines).toHaveLength(0);
  });

  it('генератор задач выдаёт корректные задачи, решаемые классически', () => {
    const r = mulberry32(2024);
    for (let i = 0; i < 25; i++) {
      const pr = randomProblem(r);
      const s = solve(createPolyhedron(pr.kind, pr.params), pr.points);
      expect(s.trusted).toBe(true);
      expect(s.section!.status).toBe('polygon');
      expect(s.construction!.usedCoordinateMethod).toBe(false);
    }
  });
});
