import { buildConstruction, verifyConstruction } from './construction/buildConstruction';
import type { Construction } from './construction/types';
import { type Plane, planeFromPoints } from './geometry/plane';
import type { Vec3 } from './geometry/vec';
import type { Polyhedron } from './polyhedra/types';
import { computeSection, type Section } from './section/computeSection';
import { type DefinedPoint, describeSpec, resolvePoint } from './section/points';
import { measureSection, validateSection, type ValidationReport } from './validation/validateSection';

export type PlaneStatus = 'need-points' | 'invalid-point' | 'coincident' | 'collinear' | 'ok';

export interface ResolvedDefined {
  readonly point: DefinedPoint;
  readonly pos: Vec3 | null;
  readonly error: string | null;
  readonly text: string;
}

export interface Solution {
  readonly points: readonly ResolvedDefined[];
  readonly planeStatus: PlaneStatus;
  readonly message: string;
  readonly plane: Plane | null;
  readonly illConditioned: boolean;
  readonly section: Section | null;
  readonly validation: ValidationReport | null;
  readonly construction: Construction | null;
  readonly constructionIssues: readonly string[];
  readonly measures: ReturnType<typeof measureSection> | null;
  /** Результат достоверен: все проверки прошли. */
  readonly trusted: boolean;
}

/** Полный конвейер: точки → плоскость → сечение → проверки → школьное решение. */
export function solve(poly: Polyhedron, defined: readonly DefinedPoint[]): Solution {
  const points: ResolvedDefined[] = defined.map((d0) => {
    // Точка, совпадающая с вершиной, всегда называется именем вершины.
    const d =
      d0.spec.kind === 'vertex' && poly.labels[d0.spec.vertex]
        ? { ...d0, label: poly.labels[d0.spec.vertex] }
        : d0;
    const r = resolvePoint(poly, d.spec);
    return {
      point: d,
      pos: r.ok ? r.pos : null,
      error: r.ok ? null : r.error,
      text: describeSpec(poly, d.label, d.spec),
    };
  });
  const empty = {
    points,
    plane: null,
    illConditioned: false,
    section: null,
    validation: null,
    construction: null,
    constructionIssues: [],
    measures: null,
    trusted: false,
  };
  const bad = points.find((p) => p.error);
  if (bad)
    return { ...empty, planeStatus: 'invalid-point', message: `Точка ${bad.point.label}: ${bad.error}.` };
  if (points.length < 3) {
    const k = 3 - points.length;
    return {
      ...empty,
      planeStatus: 'need-points',
      message: `Плоскость задаётся тремя точками: нужно ещё ${k} ${k === 1 ? 'точка' : 'точки'}.`,
    };
  }
  const [p1, p2, p3] = points.slice(0, 3).map((p) => p.pos!);
  const pr = planeFromPoints(p1, p2, p3, poly.tol);
  if (!pr.ok) {
    if (pr.reason === 'coincident') {
      const a = points[pr.pair[0]].point.label;
      const b = points[pr.pair[1]].point.label;
      return {
        ...empty,
        planeStatus: 'coincident',
        message: `Точки ${a} и ${b} совпадают, поэтому плоскость не определяется однозначно. Выберите другую точку.`,
      };
    }
    return {
      ...empty,
      planeStatus: 'collinear',
      message: `Точки ${points
        .slice(0, 3)
        .map((p) => p.point.label)
        .join(
          ', ',
        )} лежат на одной прямой (или почти на одной: sin угла = ${pr.sin.toExponential(1)}). Через прямую проходит бесконечно много плоскостей — выберите точку не на этой прямой.`,
    };
  }
  const section = computeSection(poly, pr.plane);
  const validation = validateSection(poly, section, [p1, p2, p3]);
  let construction: Construction | null = null;
  let constructionIssues: string[] = [];
  if (section.status !== 'error') {
    construction = buildConstruction(
      poly,
      section,
      points.slice(0, 3).map((p) => ({ label: p.point.label, pos: p.pos!, text: p.text })),
    );
    constructionIssues = verifyConstruction(poly, section, construction);
  }
  return {
    points,
    planeStatus: 'ok',
    message: pr.illConditioned
      ? 'Точки почти лежат на одной прямой: плоскость определена, но неустойчиво к малым сдвигам точек.'
      : '',
    plane: pr.plane,
    illConditioned: pr.illConditioned,
    section,
    validation,
    construction,
    constructionIssues,
    measures: section.status === 'error' ? null : measureSection(section),
    trusted: validation.ok && constructionIssues.length === 0,
  };
}
