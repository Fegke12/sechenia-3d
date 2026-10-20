import { signedDistance } from '../geometry/plane';
import { type Vec3, distance, fmt } from '../geometry/vec';
import type { Polyhedron } from '../polyhedra/types';
import type { Section } from '../section/computeSection';
import { ratioOf } from '../section/points';
import { distPointSegment } from '../validation/validateSection';

export interface MarkResult {
  readonly ok: boolean;
  /** Индексы вершин сечения, отмеченных верно. */
  readonly found: readonly number[];
  /** Индексы вершин сечения, которые не отмечены. */
  readonly missing: readonly number[];
  /** Отметки, не совпавшие ни с одной вершиной сечения, с объяснением. */
  readonly wrong: readonly { pos: Vec3; explanation: string }[];
  readonly summary: string;
}

/** Допуск попадания: 3% характерного размера фигуры. */
export const MARK_TOLERANCE = 0.03;

/**
 * Проверка упражнения «отметьте все вершины сечения»: сравниваем отметки ученика с вершинами,
 * найденными алгоритмом, и объясняем каждую ошибку геометрически.
 */
export function checkMarkedVertices(
  poly: Polyhedron,
  section: Section,
  labels: readonly string[],
  marks: readonly Vec3[],
): MarkResult {
  const tolD = MARK_TOLERANCE * poly.tol.scale;
  const found = new Set<number>();
  const wrong: { pos: Vec3; explanation: string }[] = [];
  for (const m of marks) {
    let best = -1;
    let bestD = Infinity;
    section.vertices.forEach((v, i) => {
      const d = distance(v.pos, m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= tolD) {
      if (found.has(best)) wrong.push({ pos: m, explanation: `Вершина ${labels[best]} отмечена дважды.` });
      found.add(best);
    } else wrong.push({ pos: m, explanation: explainWrong(poly, section, labels, m) });
  }
  const missing = section.vertices.map((_, i) => i).filter((i) => !found.has(i));
  const ok = missing.length === 0 && wrong.length === 0;
  const summary = ok
    ? `Верно! Все ${section.vertices.length} вершин сечения найдены.`
    : `Найдено ${found.size} из ${section.vertices.length} вершин${wrong.length ? `, ошибочных отметок: ${wrong.length}` : ''}.`;
  return { ok, found: [...found], missing, wrong, summary };
}

function explainWrong(poly: Polyhedron, section: Section, labels: readonly string[], m: Vec3): string {
  // Ищем ребро, на котором стоит отметка.
  let edge = -1;
  let bestD = Infinity;
  poly.edges.forEach(([a, b], e) => {
    const d = distPointSegment(m, poly.vertices[a], poly.vertices[b]);
    if (d < bestD) {
      bestD = d;
      edge = e;
    }
  });
  if (edge < 0 || bestD > 0.02 * poly.tol.scale)
    return 'Отметка не на ребре: вершины сечения всегда лежат на рёбрах (или совпадают с вершинами) многогранника.';
  const [a, b] = poly.edges[edge];
  const name = poly.edgeNames[edge];
  const fa = signedDistance(section.plane, poly.vertices[a]);
  const fb = signedDistance(section.plane, poly.vertices[b]);
  const sa = section.signs[a];
  const sb = section.signs[b];
  if (sa !== 0 && sb !== 0 && sa === sb)
    return `Ребро ${name}: вершины ${poly.labels[a]} и ${poly.labels[b]} лежат по одну сторону от секущей плоскости, поэтому плоскость это ребро не пересекает.`;
  const idx = section.vertices.findIndex(
    (v) =>
      (v.origin.type === 'edge' && v.origin.edge === edge) ||
      (v.origin.type === 'vertex' && (v.origin.vertex === a || v.origin.vertex === b)),
  );
  if (idx >= 0) {
    const v = section.vertices[idx];
    if (v.origin.type === 'edge') {
      const r = ratioOf(v.origin.t);
      const where = r
        ? `${poly.labels[a]}${labels[idx]} : ${labels[idx]}${poly.labels[b]} = ${r.p} : ${r.q}`
        : `на расстоянии ${fmt(v.origin.t * 100, 1)}% длины от ${poly.labels[a]}`;
      return `Ребро ${name} действительно пересекается плоскостью, но в другой точке: ${where}. Проверьте построение следа в соседней грани.`;
    }
    return `На ребре ${name} вершина сечения совпадает с вершиной ${labels[idx]} многогранника.`;
  }
  return `Ребро ${name} не пересекается секущей плоскостью (f(${poly.labels[a]}) = ${fmt(fa)}, f(${poly.labels[b]}) = ${fmt(fb)}).`;
}
