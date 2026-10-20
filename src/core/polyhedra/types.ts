import type { Plane } from '../geometry/plane';
import type { Tolerance } from '../geometry/tolerance';
import type { Vec3 } from '../geometry/vec';

export type PolyhedronKind =
  | 'prism'
  | 'pyramid'
  | 'cube'
  | 'parallelepiped'
  | 'tetrahedron'
  | 'octahedron'
  | 'dodecahedron'
  | 'icosahedron';

export type PolyhedronParams = Record<string, number>;

/** Пара параллельных граней с обоснованием, пригодным для школьного решения. */
export interface ParallelFacePair {
  readonly a: number;
  readonly b: number;
  readonly reason: string;
}

/** Структура фигуры, нужная методу внутреннего проектирования. */
export type PolyhedronStructure =
  | { readonly type: 'prism'; readonly baseFace: number; readonly topFace: number; readonly lateral: Vec3 }
  | { readonly type: 'pyramid'; readonly baseFace: number; readonly apex: number }
  | { readonly type: 'none' };

export interface Polyhedron {
  readonly kind: PolyhedronKind;
  readonly title: string;
  readonly params: PolyhedronParams;
  readonly vertices: readonly Vec3[];
  readonly labels: readonly string[];
  /** Циклы индексов вершин; обход против часовой стрелки, если смотреть снаружи. */
  readonly faces: readonly (readonly number[])[];
  /** Рёбра (a < b), выводятся из граней. */
  readonly edges: readonly (readonly [number, number])[];
  /** Две грани, сходящиеся в каждом ребре (в порядке индексов граней). */
  readonly edgeFaces: readonly (readonly [number, number])[];
  /** Плоскости граней с внешней нормалью. */
  readonly facePlanes: readonly Plane[];
  readonly faceNames: readonly string[];
  readonly edgeNames: readonly string[];
  readonly vertexFaces: readonly (readonly number[])[];
  readonly parallelFaces: readonly ParallelFacePair[];
  /** Пары параллельных рёбер с обоснованием (базовые факты; цепочки — через parallelEdgeReason). */
  readonly parallelEdges: readonly ParallelFacePair[];
  readonly structure: PolyhedronStructure;
  readonly center: Vec3;
  readonly tol: Tolerance;
}

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Показывать параметр только при выполнении условия. */
  readonly visible?: (p: PolyhedronParams) => boolean;
  /** Изменение параметра меняет топологию (точки придётся сбросить). */
  readonly topological?: boolean;
}

export interface KindSpec {
  readonly kind: PolyhedronKind;
  readonly title: string;
  readonly group: 'Призмы и параллелепипеды' | 'Пирамиды' | 'Правильные многогранники';
  readonly params: readonly ParamSpec[];
  readonly build: (p: PolyhedronParams) => Polyhedron;
}
