import { describe, expect, it } from 'vitest';
import { createPolyhedron } from '../../src/core/polyhedra/catalog';
import { solve } from '../../src/core/solve';
import { LESSONS } from '../../src/lessons/lessons';
import { modelToProblem } from '../../src/lessons/toProblem';

describe('уроки', () => {
  it('ровно 10 уроков от простого к сложному, у каждого есть теория, демонстрация и упражнение', () => {
    expect(LESSONS).toHaveLength(10);
    for (const l of LESSONS) {
      expect(l.theory.length).toBeGreaterThanOrEqual(3);
      expect(l.demo.caption.length).toBeGreaterThan(10);
      expect(l.exercise).toBeDefined();
    }
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: демонстрация строится и проходит проверку', (_, l) => {
    const pr = modelToProblem(l.demo);
    expect(pr.points).toHaveLength(3);
    const s = solve(createPolyhedron(pr.kind, pr.params), pr.points);
    expect(s.trusted).toBe(true);
    expect(s.construction!.steps.length).toBeGreaterThanOrEqual(2);
  });

  it.each(LESSONS.filter((l) => l.exercise.type === 'mark').map((l) => [l.id, l] as const))(
    '%s: упражнение «отметьте вершины» имеет невырожденное сечение',
    (_, l) => {
      if (l.exercise.type !== 'mark') return;
      const pr = modelToProblem(l.exercise.model);
      expect(pr.points).toHaveLength(3);
      const s = solve(createPolyhedron(pr.kind, pr.params), pr.points);
      expect(s.trusted).toBe(true);
      expect(s.section!.status).toBe('polygon');
    },
  );

  it('в каждом тесте-вопросе ровно один верный ответ, у каждого варианта есть объяснение', () => {
    for (const l of LESSONS)
      if (l.exercise.type === 'quiz') {
        expect(l.exercise.options.filter((o) => o.correct)).toHaveLength(1);
        for (const o of l.exercise.options) expect(o.explanation.length).toBeGreaterThan(10);
      }
  });

  it('факты в вопросах подтверждаются вычислением', () => {
    // Урок 1: у шестиугольной призмы 18 рёбер.
    expect(createPolyhedron('prism', { n: 6 }).edges).toHaveLength(18);
    // Уроки 2 и 10: точки в одной грани → сечение совпадает с гранью.
    const t = createPolyhedron('tetrahedron');
    const st = solve(
      t,
      modelToProblem({ kind: 'tetrahedron', text: 'M — середина AB\nN — середина BC\nK — середина AC' })
        .points,
    );
    expect(st.section!.status).toBe('face');
    const c = createPolyhedron('cube');
    const sc = solve(
      c,
      modelToProblem({ kind: 'cube', text: 'M — середина AB\nN — середина BC\nK — середина CD' }).points,
    );
    expect(sc.section!.status).toBe('face');
  });
});
