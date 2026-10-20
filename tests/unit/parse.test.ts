import { describe, expect, it } from 'vitest';
import { checkMarkedVertices } from '../../src/core/exercises/check';
import { lerp } from '../../src/core/geometry/vec';
import { parseLine, parseProblemText, tokenizeLabels } from '../../src/core/problem/parse';
import { deserializeProblem, problemFromHash, problemToHash } from '../../src/core/problem/serialize';
import { describeSpec } from '../../src/core/section/points';
import { poly, solveText, vi } from './helpers';

const cube = poly('cube');
const pyr = poly('pyramid', { n: 4 });

describe('разбор школьной записи', () => {
  it('токенизация подписей с индексами', () => {
    expect(tokenizeLabels('A₁B₁', cube.labels)).toEqual([4, 5]);
    expect(tokenizeLabels('A1 B', cube.labels)).toEqual([4, 1]);
    const d = poly('dodecahedron');
    expect(tokenizeLabels('V1V12', d.labels)).toEqual([0, 11]);
    expect(tokenizeLabels('XY', cube.labels)).toBeNull();
  });

  it.each([
    ['M ∈ AB, AM : MB = 2 : 1', 0, 1, 2 / 3],
    ['M ∈ AB, AM:MB=1:3', 0, 1, 0.25],
    ['M ∈ BA, BM : MA = 1 : 2', 1, 0, 1 / 3],
    ['M ∈ AB, MB : AM = 1 : 2', 1, 0, 1 / 3],
    ['M ∈ AB, AM : AB = 0.25', 0, 1, 0.25],
    ['M ∈ AB, AM : AB = 1 : 4', 0, 1, 0.25],
    ['M ∈ AB, t = 0.4', 0, 1, 0.4],
    ['M ∈ AB t=0,4', 0, 1, 0.4],
    ['M — середина AB', 0, 1, 0.5],
    ['M - середина A1B1', 4, 5, 0.5],
    ['M на ребре AB, AM : MB = 1 : 1', 0, 1, 0.5],
    ['М на АВ, АМ : МВ = 1 : 3', 0, 1, 0.25],
  ])('%s', (text, from, to, t) => {
    const r = parseLine(text, cube);
    expect(r.ok).toBe(true);
    if (!r.ok || r.spec.kind !== 'edge') throw new Error('ожидалась точка на ребре');
    expect(r.label).toBe('M');
    expect(r.spec.from).toBe(from);
    expect(r.spec.to).toBe(to);
    expect(r.spec.t).toBeCloseTo(t, 12);
  });

  it('вершины и центр грани', () => {
    expect(parseLine('M = C1', cube)).toMatchObject({
      ok: true,
      label: 'C₁',
      spec: { kind: 'vertex', vertex: 6 },
    });
    expect(parseLine('K — центр грани ABB₁A₁', cube)).toMatchObject({
      ok: true,
      spec: { kind: 'face', weights: [0.25, 0.25, 0.25, 0.25] },
    });
    expect(parseLine('N ∈ SC, SN : NC = 1 : 2', pyr)).toMatchObject({ ok: true, spec: { from: 0, to: 3 } });
  });

  it.each([
    ['M ∈ AC, AM : MC = 1 : 1', /не ребро/],
    ['M ∈ AB', /не задано положение/],
    ['M ∈ AB, t = 1.5', /от 0 до 1/],
    ['B ∈ AB, t = 0.5', /занято вершиной/],
    ['M ∈ AB, AN : NB = 1 : 2', /отрезки с точкой M/],
    ['M ∈ AB, AM : MC = 1 : 2', /концы ребра/],
    ['какая-то ерунда', /не удалось разобрать|не понял|недопустимое/],
    ['M ∈ XY, t=0.5', /не обозначение ребра/],
  ])('ошибка: %s', (text, re) => {
    const r = parseLine(text, cube);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });

  it('несколько строк, дубли и лишние точки', () => {
    const r = parseProblemText('M — середина AB\nN — середина BC; K — середина CC₁', cube);
    expect(r.errors).toEqual([]);
    expect(r.points.map((p) => p.label)).toEqual(['M', 'N', 'K']);
    expect(parseProblemText('M — середина AB\nM — середина BC', cube).errors[0].error).toMatch(/дважды/);
    expect(
      parseProblemText('M — середина AB\nN — середина BC\nK — середина CD\nL — середина DA', cube).errors.at(
        -1,
      )!.error,
    ).toMatch(/ровно тремя/);
  });

  it('запись точки (describeSpec) разбирается обратно в ту же точку', () => {
    for (const t of [0.5, 1 / 3, 0.25, 0.3712, 2 / 7]) {
      const spec = { kind: 'edge' as const, from: vi(cube, 'B'), to: vi(cube, 'C'), t };
      const text = describeSpec(cube, 'N', spec);
      const r = parseLine(text, cube);
      expect(r.ok, text).toBe(true);
      if (r.ok && r.spec.kind === 'edge') expect(r.spec.t).toBeCloseTo(t, 4);
    }
  });
});

describe('сохранение', () => {
  it('URL-хеш туда и обратно (с юникодом в подписях)', () => {
    const pts = parseProblemText(
      'M — середина A₁B₁\nN ∈ CC₁, CN : NC₁ = 1 : 2\nK — середина AD',
      cube,
    ).points.map((p, i) => ({ id: `${i}`, ...p }));
    const hash = problemToHash({ kind: 'cube', params: cube.params, points: pts });
    const back = problemFromHash(hash);
    expect(back?.ok).toBe(true);
    if (back?.ok) expect(back.problem.points.map((p) => p.spec)).toEqual(pts.map((p) => p.spec));
  });
  it('повреждённые данные отклоняются', () => {
    expect(deserializeProblem('{oops').ok).toBe(false);
    expect(deserializeProblem(JSON.stringify({ v: 1, kind: 'sphere', params: {}, points: [] })).ok).toBe(
      false,
    );
    expect(
      deserializeProblem(
        JSON.stringify({ v: 1, kind: 'cube', params: {}, points: [{ label: 'M', spec: { kind: 'edge' } }] }),
      ).ok,
    ).toBe(false);
    expect(problemFromHash('#s=@@@')).toBeNull();
  });
});

describe('проверка упражнений', () => {
  it('все вершины отмечены верно', () => {
    const s = solveText(cube, 'M — середина AB\nN — середина CC₁\nK — середина A₁D₁');
    const r = checkMarkedVertices(
      cube,
      s.section!,
      s.construction!.sectionLabels,
      s.section!.vertices.map((v) => v.pos),
    );
    expect(r.ok).toBe(true);
  });
  it('ошибочная отметка объясняется', () => {
    const s = solveText(cube, 'A₁ = A₁\nB = B\nD = D');
    const wrongPt = lerp(cube.vertices[vi(cube, 'C')], cube.vertices[vi(cube, 'C₁')], 0.5);
    const r = checkMarkedVertices(cube, s.section!, s.construction!.sectionLabels, [
      wrongPt,
      cube.vertices[vi(cube, 'B')],
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(2);
    expect(r.wrong[0].explanation).toMatch(/по одну сторону/);
  });
});
