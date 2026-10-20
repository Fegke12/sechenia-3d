import { createContext, useContext, useMemo } from 'react';
import { createPolyhedron } from '../core/polyhedra/catalog';
import type { Polyhedron } from '../core/polyhedra/types';
import { type Solution, solve } from '../core/solve';
import { useStore } from './store';

export interface Derived {
  poly: Polyhedron;
  solution: Solution;
}

/** Производные данные: пересчитываются только при изменении задачи (фигура, параметры, точки). */
export function useComputeDerived(): Derived {
  const kind = useStore((s) => s.kind);
  const params = useStore((s) => s.params);
  const points = useStore((s) => s.points);
  const poly = useMemo(() => createPolyhedron(kind, params), [kind, params]);
  const solution = useMemo(() => solve(poly, points), [poly, points]);
  return { poly, solution };
}

export const DerivedContext = createContext<Derived | null>(null);

export function useDerived(): Derived {
  const d = useContext(DerivedContext);
  if (!d) throw new Error('DerivedContext не задан');
  return d;
}
