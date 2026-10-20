import { createPolyhedron, normalizeParams } from '../polyhedra/catalog';
import type { PolyhedronKind, PolyhedronParams } from '../polyhedra/types';
import type { DefinedPoint } from '../section/points';
import { solve } from '../solve';
import { parseProblemText } from './parse';
import type { Problem } from './serialize';

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: PolyhedronKind;
  readonly params?: PolyhedronParams;
  /** Условие в школьной записи — разбирается тем же парсером, что и ввод пользователя. */
  readonly text: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'cube-triangle',
    title: 'Куб: треугольник A₁BD',
    description: 'Плоскость через три вершины куба отсекает «уголок» — правильный треугольник.',
    kind: 'cube',
    text: 'A₁ = A₁\nB = B\nD = D',
  },
  {
    id: 'cube-rectangle',
    title: 'Куб: диагональное сечение',
    description: 'Плоскость через диагонали оснований AC и A₁C₁ — прямоугольник.',
    kind: 'cube',
    text: 'A = A\nC = C\nC₁ = C₁',
  },
  {
    id: 'cube-hexagon',
    title: 'Куб: правильный шестиугольник',
    description: 'Плоскость через середины трёх скрещивающихся рёбер — используются параллельность граней.',
    kind: 'cube',
    text: 'M — середина AB\nN — середина CC₁\nK — середина A₁D₁',
  },
  {
    id: 'cube-pentagon',
    title: 'Куб: пятиугольник',
    description: 'Метод следов: продолжаем стороны до пересечения с прямыми рёбер.',
    kind: 'cube',
    text: 'M — середина AB\nN — середина BC\nK ∈ DD₁, DK : KD₁ = 2 : 1',
  },
  {
    id: 'cube-projection',
    title: 'Куб: точки в трёх разных гранях',
    description: 'Никакие две точки не лежат в одной грани — помогает внутреннее проектирование.',
    kind: 'cube',
    text: 'M — середина AA₁\nN ∈ BC, BN : NC = 1 : 2\nK — середина C₁D₁',
  },
  {
    id: 'tetra-quad',
    title: 'Тетраэдр: четырёхугольник',
    description: 'Классика: продолжаем MN до пересечения с AB в плоскости грани ABD.',
    kind: 'tetrahedron',
    text: 'M — середина AD\nN ∈ BD, BN : ND = 3 : 1\nK — середина BC',
  },
  {
    id: 'pyramid-traces',
    title: 'Пирамида SABCD: метод следов',
    description: 'Строим след секущей плоскости на плоскости основания.',
    kind: 'pyramid',
    params: { n: 4 },
    text: 'M ∈ SA, SM : MA = 1 : 1\nN ∈ SB, SN : NB = 3 : 7\nK ∈ SC, SK : KC = 3 : 2',
  },
  {
    id: 'pyramid-base',
    title: 'Пирамида: две точки на основании',
    description: 'След на основании известен сразу, его продолжения дают точки на боковых гранях.',
    kind: 'pyramid',
    params: { n: 4 },
    text: 'M ∈ SA, SM : MA = 2 : 3\nN — середина BC\nK — середина CD',
  },
  {
    id: 'prism-lateral',
    title: 'Треугольная призма: точки на боковых рёбрах',
    description: 'Все три стороны сечения получаются соединением точек в боковых гранях.',
    kind: 'prism',
    params: { n: 3 },
    text: 'M ∈ AA₁, AM : MA₁ = 3 : 7\nN ∈ BB₁, BN : NB₁ = 3 : 2\nK ∈ CC₁, CK : KC₁ = 4 : 1',
  },
  {
    id: 'prism-pentagon',
    title: 'Треугольная призма: пятиугольник',
    description: 'Используются след на верхнем основании и параллельность оснований.',
    kind: 'prism',
    params: { n: 3 },
    text: 'M ∈ AA₁, AM : MA₁ = 7 : 3\nN — середина B₁C₁\nK — середина AC',
  },
  {
    id: 'hex-prism',
    title: 'Шестиугольная призма',
    description:
      'Сечение правильной шестиугольной призмы — используется параллельность противолежащих граней.',
    kind: 'prism',
    params: { n: 6, h: 4 },
    text: 'M — середина AB\nN — середина CC₁\nK ∈ D₁E₁, D₁K : KE₁ = 1 : 1',
  },
  {
    id: 'octa-hexagon',
    title: 'Октаэдр: шестиугольник',
    description: 'Плоскость через середины трёх рёбер, параллельная паре противолежащих граней.',
    kind: 'octahedron',
    text: 'M — середина EA\nN — середина AB\nK — середина BF',
  },
  {
    id: 'parallelepiped-oblique',
    title: 'Наклонный параллелепипед',
    description: 'Противолежащие грани параллельны — следы на них параллельны.',
    kind: 'parallelepiped',
    params: { angle: 65, shiftX: 1.2, shiftY: 0.6 },
    text: 'M ∈ AB, AM : MB = 1 : 2\nN — середина CC₁\nK ∈ A₁D₁, A₁K : KD₁ = 1 : 1',
  },
];

/** Превращает пример в задачу, разбирая его условие. Бросает исключение, если пример некорректен. */
export function exampleToProblem(ex: Example): Problem {
  const params = normalizeParams(ex.kind, ex.params ?? {});
  const poly = createPolyhedron(ex.kind, params);
  const parsed = parseProblemText(ex.text, poly);
  if (parsed.errors.length)
    throw new Error(`Пример ${ex.id}: ${parsed.errors.map((e) => e.error).join('; ')}`);
  return {
    kind: ex.kind,
    params,
    points: parsed.points.map((p, i) => ({ id: `${ex.id}-${i}`, label: p.label, spec: p.spec })),
  };
}

/* ───────────── Генератор случайных задач ───────────── */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NICE_T = [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 2 / 5, 3 / 5];
const GEN_KINDS: { kind: PolyhedronKind; params?: PolyhedronParams }[] = [
  { kind: 'cube' },
  { kind: 'tetrahedron' },
  { kind: 'pyramid', params: { n: 4 } },
  { kind: 'pyramid', params: { n: 3 } },
  { kind: 'prism', params: { n: 3 } },
  { kind: 'prism', params: { n: 4 } },
  { kind: 'parallelepiped' },
];

/**
 * Случайная, но корректная задача: три точки на разных рёбрах с «школьными» отношениями,
 * сечение — невырожденный многоугольник, решение строится без координатного метода и проходит проверки.
 */
export function randomProblem(rand: () => number, kind?: PolyhedronKind): Problem {
  const pool = kind ? GEN_KINDS.filter((k) => k.kind === kind) : GEN_KINDS;
  for (let attempt = 0; attempt < 500; attempt++) {
    const g = pool[Math.floor(rand() * pool.length)] ?? { kind: kind! };
    const params = normalizeParams(g.kind, g.params ?? {});
    const poly = createPolyhedron(g.kind, params);
    const edges = [...poly.edges.keys()].sort(() => rand() - 0.5).slice(0, 3);
    const labels = ['M', 'N', 'K'];
    const points: DefinedPoint[] = edges.map((e, i) => {
      const [a, b] = poly.edges[e];
      const flip = rand() < 0.5;
      return {
        id: `rnd-${attempt}-${i}`,
        label: labels[i],
        spec: {
          kind: 'edge',
          from: flip ? b : a,
          to: flip ? a : b,
          t: NICE_T[Math.floor(rand() * NICE_T.length)],
        },
      };
    });
    const s = solve(poly, points);
    if (s.planeStatus !== 'ok' || !s.section || s.section.status !== 'polygon' || !s.trusted) continue;
    if (!s.construction || s.construction.usedCoordinateMethod || s.section.vertices.length < 3) continue;
    // Хотим задачи, где нужно хотя бы что-то построить.
    if (s.construction.steps.length < 5 && attempt < 400) continue;
    return { kind: g.kind, params, points };
  }
  throw new Error('не удалось сгенерировать задачу');
}
