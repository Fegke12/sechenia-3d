import type { Vec3 } from '../geometry/vec';

export type CPointRole = 'given' | 'section' | 'aux' | 'projection';

export interface CPoint {
  readonly id: string;
  readonly label: string;
  readonly pos: Vec3;
  readonly role: CPointRole;
  /** Индекс вершины сечения, если точка ею является. */
  readonly sectionIndex: number | null;
  /** Принадлежит секущей плоскости (проекции M′ ей обычно не принадлежат). */
  readonly inAlpha: boolean;
  /** Обоснованная принадлежность плоскостям граней: грань → причина. */
  readonly planes: ReadonlyMap<number, string>;
  /** Ребро, на прямой которого лежит точка (если известно). */
  readonly edgeLine: number | null;
}

export type CLineKind = 'side' | 'trace' | 'edge-ext' | 'parallel' | 'projection' | 'aux';

export interface CLine {
  readonly id: string;
  readonly kind: CLineKind;
  readonly name: string;
  /** Две точки, задающие прямую. */
  readonly a: Vec3;
  readonly b: Vec3;
  /** Рисовать как отрезок между a и b (стороны, продолжения рёбер, проекции), а не как прямую. */
  readonly segmentOnly: boolean;
  readonly face: number | null;
  readonly inAlpha: boolean;
}

export type StepRule =
  | 'plane'
  | 'connect'
  | 'intersect'
  | 'parallel'
  | 'projection'
  | 'coordinate'
  | 'side'
  | 'final'
  | 'degenerate';

/** Машинно проверяемое утверждение шага. */
export type Claim =
  | { readonly kind: 'inAlpha'; readonly p: Vec3; readonly what: string }
  | { readonly kind: 'inFacePlane'; readonly p: Vec3; readonly face: number; readonly what: string }
  | { readonly kind: 'onLine'; readonly p: Vec3; readonly a: Vec3; readonly b: Vec3; readonly what: string }
  | { readonly kind: 'onEdgeSegment'; readonly p: Vec3; readonly edge: number; readonly what: string }
  | { readonly kind: 'parallelDirs'; readonly d1: Vec3; readonly d2: Vec3; readonly what: string }
  | { readonly kind: 'facesParallel'; readonly f: number; readonly g: number; readonly what: string }
  | { readonly kind: 'notParallel'; readonly d1: Vec3; readonly d2: Vec3; readonly what: string };

export interface Step {
  readonly index: number;
  readonly rule: StepRule;
  readonly title: string;
  /** Что делаем (действие построения). */
  readonly action: string;
  /** Математическое обоснование — по пунктам. */
  readonly justification: readonly string[];
  /** Используемые объекты (текстом). */
  readonly uses: readonly string[];
  /** Что получилось. */
  readonly result: string;
  /** Вопрос для режима «сначала сам». */
  readonly prompt: string;
  readonly newPoints: readonly CPoint[];
  readonly newLines: readonly CLine[];
  readonly highlight: {
    readonly faces: readonly number[];
    readonly edges: readonly number[];
    readonly points: readonly string[];
    readonly lines: readonly string[];
  };
  readonly claims: readonly Claim[];
}

export interface Construction {
  readonly steps: readonly Step[];
  readonly points: readonly CPoint[];
  readonly lines: readonly CLine[];
  /** Все вершины и стороны сечения получены построением. */
  readonly complete: boolean;
  /** Использован координатный метод (классические правила не дали шаг). */
  readonly usedCoordinateMethod: boolean;
  /** Подписи вершин сечения (по индексу Section.vertices). */
  readonly sectionLabels: readonly string[];
  readonly polygonName: string;
  readonly issues: readonly string[];
}
