import { createPolyhedron, normalizeParams } from '../core/polyhedra/catalog';
import { parseProblemText } from '../core/problem/parse';
import type { Problem } from '../core/problem/serialize';
import type { LessonModel } from './lessons';

/** Модель урока → задача (условие разбирается тем же парсером, что и ввод ученика). */
export function modelToProblem(m: LessonModel): Problem {
  const params = normalizeParams(m.kind, m.params ?? {});
  const poly = createPolyhedron(m.kind, params);
  const parsed = parseProblemText(m.text, poly);
  return {
    kind: m.kind,
    params,
    points: parsed.points.map((p, i) => ({ id: `l${i}`, label: p.label, spec: p.spec })),
  };
}
