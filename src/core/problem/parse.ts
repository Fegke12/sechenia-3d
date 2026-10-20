import { findEdge } from '../polyhedra/build';
import type { Polyhedron } from '../polyhedra/types';
import { normalizeLabel } from '../section/labels';
import type { DefinedPoint, PointSpec } from '../section/points';

export type ParseLineResult =
  | { ok: true; label: string; spec: PointSpec; line: number }
  | { ok: false; error: string; line: number; source: string };

/** Разбивает строку из подписей вершин («A₁B₁», «SC», «V₁V₁₂») жадно по самому длинному совпадению. */
export function tokenizeLabels(s: string, labels: readonly string[]): number[] | null {
  const norm = labels.map(normalizeLabel);
  const src = normalizeLabel(s).replace(/\s+/g, '');
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    let best = -1;
    let bestLen = 0;
    norm.forEach((l, idx) => {
      if (l.length > bestLen && src.startsWith(l, i)) {
        best = idx;
        bestLen = l.length;
      }
    });
    if (best < 0) return null;
    out.push(best);
    i += bestLen;
  }
  return out;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const num = (s: string) => Number(s.replace(',', '.'));

/** Разбор одной строки условия. */
export function parseLine(
  source: string,
  poly: Polyhedron,
  line = 1,
  existing: readonly DefinedPoint[] = [],
): ParseLineResult {
  const fail = (error: string): ParseLineResult => ({ ok: false, error, line, source });
  const raw = source
    .replace(/\(.*?(вершина|выбрана на модели).*?\)/gi, '')
    .replace(/[–—−]/g, '-')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return fail('пустая строка');
  const m = /^([^\s∈=:,-]+)\s*(∈|=|-|in\s|на\s|принадлежит\s|лежит\s+на\s|совпадает\s+с\s)\s*(.*)$/i.exec(
    raw,
  );
  if (!m) return fail('не удалось разобрать запись. Пример: «M ∈ AB, AM : MB = 2 : 1» или «N — середина SC»');
  const label = normalizeLabel(m[1]);
  const rel = m[2].toLowerCase().trim();
  let rest = m[3].trim();
  const vertexLabels = poly.labels.map(normalizeLabel);

  // M = D, M совпадает с D → вершина
  if (rel === '=' || rel.startsWith('совпадает')) {
    const vs = tokenizeLabels(rest.replace(/^вершин[аеой]\s*/i, ''), poly.labels);
    if (vs && vs.length === 1)
      return { ok: true, label: poly.labels[vs[0]], spec: { kind: 'vertex', vertex: vs[0] }, line };
    if (!/середин|центр/i.test(rest)) return fail(`«${rest}» — не вершина многогранника`);
  }
  if (vertexLabels.includes(label))
    return fail(
      `обозначение ${label} занято вершиной многогранника — выберите другую букву (или запишите «${label} = ${label}»)`,
    );
  if (!/^[A-Z][₀-₉′']*$/.test(label))
    return fail(`«${m[1]}» — недопустимое обозначение точки (нужна латинская буква, можно с индексом)`);

  // Центр грани
  const centre = /^(?:-\s*)?центр\s+(?:грани\s+)?\(?([^\s),]+)\)?$/i.exec(rest);
  if (centre) {
    const vs = tokenizeLabels(centre[1], poly.labels);
    const face = vs
      ? poly.faces.findIndex((f) => f.length === vs.length && vs.every((v) => f.includes(v)))
      : -1;
    if (face < 0) return fail(`«${centre[1]}» — не грань многогранника`);
    const k = poly.faces[face].length;
    return { ok: true, label, spec: { kind: 'face', face, weights: Array(k).fill(1 / k) }, line };
  }
  // Точка на грани, выбранная на модели (повторное чтение собственной записи)
  const onFace = /^грань\s+\(?([^\s),]+)\)?$/i.exec(rest);
  if (onFace) {
    const vs = tokenizeLabels(onFace[1], poly.labels);
    const face = vs
      ? poly.faces.findIndex((f) => f.length === vs.length && vs.every((v) => f.includes(v)))
      : -1;
    if (face < 0) return fail(`«${onFace[1]}» — не грань многогранника`);
    const prev = existing.find((p) => p.label === label && p.spec.kind === 'face' && p.spec.face === face);
    if (prev) return { ok: true, label, spec: prev.spec, line };
    return fail('для точки на грани напишите «центр грани …» или выберите точку на модели');
  }

  // Середина: «M — середина AB», «M ∈ AB, середина»
  const mid =
    /^середин[аеуы]\s+(?:ребра\s+)?([^\s,]+)$/i.exec(rest) ?? /^([^\s,]+)\s*,?\s*середин[аеуы]$/i.exec(rest);
  if (mid) return edgeSpec(mid[1], 0.5, null);

  if (rel === '-' && !mid) return fail('после тире ожидается «середина XY» или «центр грани …»');

  // M ∈ AB, <уточнение>
  rest = rest.replace(/^ребр[уае]\s+/i, '');
  const parts = rest
    .split(/[,;]\s*|\s+(?=t\s*=|[A-ZА-Яa-zа-я][^\s]*\s*:|середин)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const edgeText = parts.shift() ?? '';
  const cond = parts.join(' ').trim();
  if (/^середин[аеуы]$/i.test(cond)) return edgeSpec(edgeText, 0.5, null);
  if (!cond)
    return fail(
      `не задано положение ${label} на ребре ${edgeText}: укажите отношение (${label}… : …), «t = 0.3» или «середина»`,
    );

  const tm = new RegExp(`^t\\s*=\\s*${NUM}$`, 'i').exec(cond);
  if (tm) return edgeSpec(edgeText, num(tm[1]), null);

  const rm = new RegExp(`^([^\\s:]+)\\s*:\\s*([^\\s=]+)\\s*=\\s*${NUM}\\s*(?::\\s*${NUM})?$`).exec(cond);
  if (rm)
    return edgeSpec(edgeText, null, {
      left: rm[1],
      right: rm[2],
      p: num(rm[3]),
      q: rm[4] !== undefined ? num(rm[4]) : null,
    });
  return fail(
    `не понял условие «${cond}». Примеры: «AM : MB = 2 : 1», «AM : AB = 0.25», «t = 0.4», «середина»`,
  );

  function edgeSpec(
    edgeStr: string,
    t: number | null,
    ratio: { left: string; right: string; p: number; q: number | null } | null,
  ): ParseLineResult {
    const vs = tokenizeLabels(edgeStr, poly.labels);
    if (!vs || vs.length !== 2)
      return fail(`«${edgeStr}» — не обозначение ребра (нужны две вершины, напр. AB, SC, A₁B₁)`);
    const [a, b] = vs;
    if (findEdge(poly, a, b) < 0) return fail(`${poly.labels[a]}${poly.labels[b]} — не ребро многогранника`);
    if (t !== null) {
      if (!(t >= 0 && t <= 1)) return fail('параметр t должен быть от 0 до 1');
      return { ok: true, label, spec: { kind: 'edge', from: a, to: b, t }, line };
    }
    if (!ratio) return fail('не задано положение точки');
    const left = tokenizeLabels(normalizeLabel(ratio.left).replace(label, '|'), [...poly.labels, '|']);
    const right = tokenizeLabels(normalizeLabel(ratio.right).replace(label, '|'), [...poly.labels, '|']);
    const BAR = poly.labels.length;
    if (!left || !right || left.length !== 2 || right.length !== 2)
      return fail(
        `в отношении должны участвовать отрезки с точкой ${label}, напр. ${poly.labels[a]}${label} : ${label}${poly.labels[b]}`,
      );
    const endOf = (seg: number[]) => (seg[0] === BAR ? seg[1] : seg[1] === BAR ? seg[0] : -1);
    // Вариант 1: AM : MB = p : q
    const l = endOf(left);
    const r = endOf(right);
    if (l >= 0 && r >= 0) {
      if (!((l === a && r === b) || (l === b && r === a)))
        return fail(`отношение должно связывать концы ребра ${poly.labels[a]}${poly.labels[b]}`);
      if (ratio.q === null) return fail('укажите отношение в виде p : q');
      if (!(ratio.p >= 0 && ratio.q >= 0) || ratio.p + ratio.q === 0)
        return fail('части отношения должны быть неотрицательны и не обе равны нулю');
      const tt = ratio.p / (ratio.p + ratio.q);
      return { ok: true, label, spec: { kind: 'edge', from: l, to: r, t: tt }, line };
    }
    // Вариант 2: AM : AB = k  (или = p : q)
    if (
      l >= 0 &&
      !right.includes(BAR) &&
      new Set(right).size === 2 &&
      right.includes(a) &&
      right.includes(b) &&
      right.includes(l)
    ) {
      const k = ratio.q === null ? ratio.p : ratio.p / ratio.q;
      if (!(k >= 0 && k <= 1))
        return fail(
          `отношение ${poly.labels[l]}${label} : ${poly.labels[a]}${poly.labels[b]} должно быть от 0 до 1`,
        );
      const other = l === a ? b : a;
      return { ok: true, label, spec: { kind: 'edge', from: l, to: other, t: k }, line };
    }
    return fail(
      `не понял отношение. Пишите ${poly.labels[a]}${label} : ${label}${poly.labels[b]} = p : q или ${poly.labels[a]}${label} : ${poly.labels[a]}${poly.labels[b]} = k`,
    );
  }
}

export interface ParsedProblem {
  readonly points: { label: string; spec: PointSpec; line: number }[];
  readonly errors: { line: number; source: string; error: string }[];
}

/** Разбор нескольких строк (разделители — перевод строки или «;»). */
export function parseProblemText(
  text: string,
  poly: Polyhedron,
  existing: readonly DefinedPoint[] = [],
): ParsedProblem {
  const lines = text.split(/\n|;(?![^(]*\))/);
  const points: ParsedProblem['points'] = [];
  const errors: ParsedProblem['errors'] = [];
  lines.forEach((src, i) => {
    if (!src.trim()) return;
    const r = parseLine(src, poly, i + 1, existing);
    if (r.ok) {
      if (points.some((p) => p.label === r.label))
        errors.push({ line: i + 1, source: src, error: `точка ${r.label} задана дважды` });
      else points.push({ label: r.label, spec: r.spec, line: r.line });
    } else errors.push({ line: r.line, source: r.source, error: r.error });
  });
  if (points.length > 3)
    errors.push({
      line: 0,
      source: '',
      error: 'секущая плоскость задаётся ровно тремя точками — лишние точки уберите',
    });
  return { points, errors };
}
