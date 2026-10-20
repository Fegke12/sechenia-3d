/**
 * Масштабно-зависимые допуски. Создаются из характерного размера фигуры L
 * (диагональ ограничивающего параллелепипеда), поэтому одинаково работают
 * для куба с ребром 0.001 и с ребром 1000.
 */
export interface Tolerance {
  /** Характерный размер L. */
  readonly scale: number;
  /** Допуск расстояния точки до плоскости. */
  readonly dist: number;
  /** Допуск слияния совпадающих точек. */
  readonly merge: number;
  /** Допуск безразмерного параметра на ребре (t). */
  readonly param: number;
  /** sin угла, ниже которого три точки считаются коллинеарными (ошибка). */
  readonly collinearSin: number;
  /** sin угла, ниже которого плоскость плохо обусловлена (предупреждение). */
  readonly illConditionedSin: number;
  /** Допуск параллельности направлений (sin угла). */
  readonly parallelSin: number;
}

export const REL_DIST = 1e-9;
export const REL_MERGE = 1e-8;

export function makeTolerance(scale: number): Tolerance {
  if (!(scale > 0) || !Number.isFinite(scale))
    throw new Error(`makeTolerance: некорректный масштаб ${scale}`);
  return {
    scale,
    dist: REL_DIST * scale,
    merge: REL_MERGE * scale,
    param: 1e-9,
    collinearSin: 1e-6,
    illConditionedSin: 1e-3,
    parallelSin: 1e-7,
  };
}
