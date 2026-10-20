import { lineLine, linePlane, signedDistance } from '../geometry/plane';
import {
  type Vec3,
  add,
  cross,
  distance,
  dot,
  fmt,
  fmtVec,
  length,
  lerp,
  normalize,
  scale,
  sinAngle,
  sub,
} from '../geometry/vec';
import { findEdge, parallelEdgeReason } from '../polyhedra/build';
import type { Polyhedron } from '../polyhedra/types';
import type { Section } from '../section/computeSection';
import { LabelPool } from '../section/labels';
import { ratioOf } from '../section/points';
import { distPointSegment } from '../validation/validateSection';
import type { CLine, CLineKind, CPoint, CPointRole, Claim, Construction, Step } from './types';

export interface GivenPoint {
  readonly label: string;
  readonly pos: Vec3;
  /** Школьная запись условия, напр. «M ∈ AB, AM : MB = 1 : 2». */
  readonly text: string;
}

const POLY_NAMES: Record<number, string> = {
  3: 'треугольник',
  4: 'четырёхугольник',
  5: 'пятиугольник',
  6: 'шестиугольник',
  7: 'семиугольник',
  8: 'восьмиугольник',
  9: 'девятиугольник',
  10: 'десятиугольник',
};
export const polygonTypeName = (n: number) => POLY_NAMES[n] ?? `${n}-угольник`;

const LINE_NAMES = ['a', 'b', 'c', 'd', 'm', 'n', 'l', 'p', 'q', 'r', 's'];

interface Candidate {
  priority: number;
  /** Для детерминированного выбора при равных приоритетах. */
  order: number;
  apply: () => void;
}

interface Trace {
  line: CLine;
  p: Vec3;
  dir: Vec3;
  /** Точки, через которые проведён след (для правила о параллельности). */
  A?: CPoint;
  B?: CPoint;
}

/**
 * Строит школьное решение: последовательность шагов, каждый из которых опирается
 * на аксиому/теорему и на уже найденные объекты. Подробности — docs/ARCHITECTURE.md §7.
 */
export function buildConstruction(
  poly: Polyhedron,
  section: Section,
  given: readonly GivenPoint[],
): Construction {
  const { tol } = poly;
  const L = tol.scale;
  const V = poly.vertices;
  const F = (f: number) => poly.faceNames[f];
  const PL = (f: number) => `(${poly.faceNames[f]})`;
  const E = (e: number) => poly.edgeNames[e];

  const steps: Step[] = [];
  const points: CPoint[] = [];
  const lines: CLine[] = [];
  const traces = new Map<number, Trace>();
  const issues: string[] = [];
  let idc = 0;
  let lineNameIdx = 0;
  let usedCoordinateMethod = false;

  const pool = new LabelPool([...poly.labels, ...given.map((g) => g.label)]);
  const relTol = (p: Vec3) => 1 + distance(p, poly.center) / L;
  // Совпадение точек при построении: 1e-7·L (с поправкой для далёких вспомогательных точек).
  const close = (p: Vec3, q: Vec3) => distance(p, q) <= tol.merge * 10 * relTol(p);
  const findKnown = (p: Vec3) => points.find((k) => k.inAlpha && close(k.pos, p));

  /* ── подписи вершин сечения ── */
  const sectionLabels: string[] = section.vertices.map((sv) => {
    if (sv.origin.type === 'vertex') return poly.labels[sv.origin.vertex];
    const g = given.find((gp) => close(gp.pos, sv.pos));
    return g ? g.label : '';
  });
  sectionLabels.forEach((l) => l && pool.reserve(l));
  for (let i = 0; i < sectionLabels.length; i++) if (!sectionLabels[i]) sectionLabels[i] = pool.take();
  const sectionIndexAt = (p: Vec3) => {
    const i = section.vertices.findIndex((sv) => close(sv.pos, p));
    return i >= 0 ? i : null;
  };

  const newPoint = (
    label: string,
    pos: Vec3,
    role: CPointRole,
    planes: Map<number, string>,
    edgeLine: number | null,
    inAlpha = true,
  ): CPoint => {
    const p: CPoint = {
      id: `p${idc++}`,
      label,
      pos,
      role,
      sectionIndex: inAlpha ? sectionIndexAt(pos) : null,
      inAlpha,
      planes,
      edgeLine,
    };
    points.push(p);
    return p;
  };
  const newLine = (
    kind: CLineKind,
    name: string,
    a: Vec3,
    b: Vec3,
    face: number | null,
    inAlpha: boolean,
    segmentOnly = false,
  ): CLine => {
    const l: CLine = { id: `l${lines.length}`, kind, name, a, b, face, inAlpha, segmentOnly };
    lines.push(l);
    return l;
  };
  const pushStep = (s: Omit<Step, 'index'>) => steps.push({ ...s, index: steps.length });

  /** Плоскости граней, которым принадлежит точка, с обоснованием (по положению на вершине/ребре). */
  const membership = (label: string, pos: Vec3, extraFace?: { face: number; reason: string }) => {
    const m = new Map<number, string>();
    let edgeLine: number | null = null;
    const vi = V.findIndex((v) => close(v, pos));
    if (vi >= 0) {
      const same = poly.labels[vi] === label;
      for (const f of poly.vertexFaces[vi])
        m.set(
          f,
          same
            ? `${label} — вершина грани ${F(f)}`
            : `${label} совпадает с вершиной ${poly.labels[vi]} грани ${F(f)}`,
        );
    } else {
      poly.edges.forEach(([a, b], e) => {
        if (distPointSegment(pos, V[a], V[b]) <= tol.dist * 100) {
          edgeLine = e;
          for (const f of poly.edgeFaces[e])
            if (!m.has(f)) m.set(f, `${label} ∈ ${E(e)}, а ${E(e)} — ребро грани ${F(f)}`);
        }
      });
    }
    if (extraFace && !m.has(extraFace.face)) m.set(extraFace.face, extraFace.reason);
    return { planes: m, edgeLine };
  };

  /** Лежит ли точка в самой грани (а не только в её плоскости). */
  const onFace = (f: number, p: Vec3) => {
    const face = poly.faces[f];
    const n = poly.facePlanes[f].normal;
    if (Math.abs(signedDistance(poly.facePlanes[f], p)) > tol.dist * 100) return false;
    for (let i = 0; i < face.length; i++) {
      const a = V[face[i]];
      const b = V[face[(i + 1) % face.length]];
      if (dot(cross(sub(b, a), sub(p, a)), n) < -tol.dist * L * 100) return false;
    }
    return true;
  };

  const edgeRatioText = (e: number, t: number, X: string) => {
    const [p, q] = poly.edges[e];
    const P = poly.labels[p];
    const Q = poly.labels[q];
    const r = ratioOf(t);
    if (r && r.p === r.q) return `${X} — середина ${P}${Q}`;
    if (r) return `${P}${X} : ${X}${Q} = ${r.p} : ${r.q}`;
    return `${P}${X} : ${P}${Q} ≈ ${fmt(t, 3)}`;
  };

  /* ═════════════ Шаг 1: секущая плоскость ═════════════ */
  const givenPts = given.map((g) => {
    const { planes, edgeLine } = membership(g.label, g.pos);
    // Точка внутри грани: принадлежность — по условию.
    poly.faces.forEach((_, f) => {
      if (!planes.has(f) && onFace(f, g.pos)) planes.set(f, `${g.label} лежит в грани ${F(f)} (по условию)`);
    });
    return newPoint(g.label, g.pos, 'given', planes, edgeLine);
  });
  const alphaName = given.length === 3 ? `(${given.map((g) => g.label).join('')})` : 'α';
  pushStep({
    rule: 'plane',
    title: `Секущая плоскость α = ${alphaName}`,
    action: `Отмечаем заданные точки: ${given.map((g) => g.text).join('; ')}.`,
    justification: [
      `Точки ${given.map((g) => g.label).join(', ')} не лежат на одной прямой (проверено: векторы ${given[0]?.label}${given[1]?.label} и ${given[0]?.label}${given[2]?.label} не коллинеарны).`,
      'Через три точки, не лежащие на одной прямой, проходит плоскость, и притом только одна (аксиома стереометрии). Это и есть секущая плоскость α.',
    ],
    uses: given.map((g) => g.text),
    result: `α = ${alphaName}`,
    prompt: 'Почему три данные точки однозначно задают секущую плоскость?',
    newPoints: givenPts,
    newLines: [],
    highlight: { faces: [], edges: [], points: givenPts.map((p) => p.id), lines: [] },
    claims: givenPts.map((p) => ({ kind: 'inAlpha', p: p.pos, what: `${p.label} ∈ α` }) as Claim),
  });

  /* ═════════════ Вырожденные случаи ═════════════ */
  if (section.status !== 'polygon') {
    const n = section.vertices.length;
    let title = 'Плоскость не пересекает многогранник';
    let just = ['Все вершины многогранника лежат строго по одну сторону от α, поэтому общих точек нет.'];
    const claims: Claim[] = [];
    if (section.status === 'face' && section.touchFace !== null) {
      const f = section.touchFace;
      title = `α совпадает с плоскостью грани ${F(f)}`;
      just = [
        `Все заданные точки лежат в плоскости грани ${F(f)}: ${givenPts
          .map((p) => p.planes.get(f) ?? `${p.label} ∈ ${PL(f)}`)
          .join('; ')}.`,
        'Через три точки, не лежащие на одной прямой, проходит единственная плоскость, поэтому α = ' +
          PL(f) +
          '.',
        `Остальные вершины многогранника лежат по одну сторону от α (многогранник выпуклый), поэтому сечение вырождается и совпадает с самой гранью ${F(f)}.`,
      ];
      givenPts.forEach((p) =>
        claims.push({ kind: 'inFacePlane', p: p.pos, face: f, what: `${p.label} ∈ ${PL(f)}` }),
      );
    } else if (section.status === 'segment' && section.touchEdge !== null) {
      title = `α касается многогранника по ребру ${E(section.touchEdge)}`;
      just = [
        'Плоскость содержит ребро, а все остальные вершины лежат по одну сторону от неё; пересечение — отрезок (ребро).',
      ];
    } else if (section.status === 'point' && section.touchVertex !== null) {
      title = `α касается многогранника в вершине ${poly.labels[section.touchVertex]}`;
      just = [
        'Плоскость проходит через одну вершину, остальные вершины — по одну сторону от неё; пересечение — точка.',
      ];
    }
    pushStep({
      rule: 'degenerate',
      title,
      action: n > 0 ? `Пересечение: ${sectionLabels.join('')}.` : 'Пересечение пусто.',
      justification: just,
      uses: [],
      result:
        section.status === 'face'
          ? 'сечение совпадает с гранью (вырожденный случай)'
          : `вырожденное пересечение (${n} точ.)`,
      prompt: 'Что представляет собой пересечение плоскости с многогранником в этом случае?',
      newPoints: [],
      newLines: [],
      highlight: {
        faces: section.touchFace !== null ? [section.touchFace] : [],
        edges: section.touchEdge !== null ? [section.touchEdge] : [],
        points: [],
        lines: [],
      },
      claims,
    });
    return finish();
  }

  /* ═════════════ Основной цикл построения ═════════════ */
  const sides = section.sides;
  const sideEmitted = new Set<number>();
  const knownSection = (i: number) => points.find((p) => p.inAlpha && p.sectionIndex === i);
  const sideOnFace = (f: number) => sides.findIndex((s) => s.faces.includes(f));
  const faceEdges = (f: number) => {
    const c = poly.faces[f];
    return c.map((v, i) => {
      const w = c[(i + 1) % c.length];
      return poly.edges.findIndex(([a, b]) => a === Math.min(v, w) && b === Math.max(v, w));
    });
  };
  const pointsInPlane = (f: number) => points.filter((p) => p.inAlpha && p.planes.has(f));

  const setTrace = (f: number, line: CLine, p: Vec3, q: Vec3, A?: CPoint, B?: CPoint) =>
    traces.set(f, { line, p, dir: sub(q, p), A, B });

  /** Если след лежит на прямой ребра многогранника (ребро целиком в α), это ребро и есть прямая α. */
  const traceOnEdge = (tr: Trace) => {
    const q = add(tr.p, tr.dir);
    const onLine = (x: Vec3, a: Vec3, b: Vec3) =>
      length(cross(sub(x, a), sub(b, a))) / distance(a, b) <= tol.dist * 100;
    const e = poly.edges.findIndex(([a, b]) => onLine(tr.p, V[a], V[b]) && onLine(q, V[a], V[b]));
    if (e < 0) return null;
    return {
      edge: e,
      text:
        tr.A && tr.B
          ? `Точки ${tr.A.label} и ${tr.B.label} принадлежат α и лежат на прямой ${E(e)}, поэтому вся прямая ${E(e)} лежит в α (аксиома о двух точках прямой).`
          : `Прямая ${tr.line.name} лежит в α и совпадает с прямой ребра ${E(e)}.`,
    };
  };

  /**
   * Если след проходит через точки A ∈ OP и B ∈ OQ рёбер грани с общей вершиной O
   * и OA : OP = OB : OQ, то AB ∥ PQ (подобие треугольников). Возвращает ребро PQ и обоснование.
   */
  const proportionalParallel = (A?: CPoint, B?: CPoint) => {
    if (!A || !B || A.role === 'aux' || B.role === 'aux' || A.edgeLine === null || B.edgeLine === null)
      return null;
    const e1 = poly.edges[A.edgeLine];
    const e2 = poly.edges[B.edgeLine];
    const O = e1.find((v) => e2.includes(v));
    if (O === undefined || A.edgeLine === B.edgeLine) return null;
    const P = e1[0] === O ? e1[1] : e1[0];
    const Q = e2[0] === O ? e2[1] : e2[0];
    const e3 = findEdge(poly, P, Q);
    if (e3 < 0) return null;
    const rA = distance(V[O], A.pos) / distance(V[O], V[P]);
    const rB = distance(V[O], B.pos) / distance(V[O], V[Q]);
    if (Math.abs(rA - rB) > 1e-9 || rA <= 1e-9 || rA >= 1 - 1e-9) return null;
    const o = poly.labels[O];
    const r = ratioOf(rA);
    const val = r ? `${r.p} : ${r.p + r.q}` : fmt(rA, 4);
    return {
      edge: e3,
      text: `${o}${A.label} : ${o}${poly.labels[P]} = ${o}${B.label} : ${o}${poly.labels[Q]} = ${val}. Треугольники ${o}${A.label}${B.label} и ${o}${poly.labels[P]}${poly.labels[Q]} подобны (угол ${o} общий, прилежащие стороны пропорциональны), поэтому ∠${o}${A.label}${B.label} = ∠${o}${poly.labels[P]}${poly.labels[Q]} и ${A.label}${B.label} ∥ ${E(e3)}.`,
    };
  };

  const isDone = () =>
    section.vertices.every((_, i) => knownSection(i)) && sides.every((_, i) => sideEmitted.has(i));

  for (let iter = 0; iter < 400 && !isDone(); iter++) {
    const cands: Candidate[] = [];
    let order = 0;

    /* ── Стороны: обе вершины известны, след в грани известен ── */
    sides.forEach((s, si) => {
      if (sideEmitted.has(si)) return;
      const A = knownSection(s.a);
      const B = knownSection(s.b);
      const f = s.faces.find((ff) => traces.has(ff));
      if (!A || !B || f === undefined) return;
      cands.push({ priority: 95, order: order++, apply: () => emitSide(si, f, A, B) });
    });

    /* ── A. Соединение двух точек в плоскости грани ── */
    poly.faces.forEach((_, f) => {
      if (traces.has(f)) return;
      const inF = pointsInPlane(f);
      if (inF.length < 2) return;
      const si = sideOnFace(f);
      let pair: [CPoint, CPoint] | null = null;
      if (si >= 0) {
        const A = knownSection(sides[si].a);
        const B = knownSection(sides[si].b);
        if (A && B && A.planes.has(f) && B.planes.has(f) && !sideEmitted.has(si)) pair = [A, B];
      }
      let priority = 100;
      if (!pair) {
        const rank = (p: CPoint) =>
          (p.sectionIndex !== null ? 0 : onFace(f, p.pos) ? 1 : 2) * 1e6 + Number(p.id.slice(1));
        const sorted = [...inF].sort((x, y) => rank(x) - rank(y));
        outer: for (let i = 0; i < sorted.length; i++)
          for (let j = i + 1; j < sorted.length; j++)
            if (distance(sorted[i].pos, sorted[j].pos) > tol.merge * 1000) {
              pair = [sorted[i], sorted[j]];
              break outer;
            }
        priority = si >= 0 ? 80 : 40;
      }
      if (!pair) return;
      const [A, B] = pair;
      cands.push({ priority, order: order++, apply: () => connect(f, A, B, priority === 100 ? si : -1) });
    });

    /* ── B. След ∩ прямая ребра в той же плоскости ── */
    for (const [f, tr] of traces) {
      for (const e of faceEdges(f)) {
        const [p, q] = poly.edges[e];
        const hit = lineLine(tr.p, tr.dir, V[p], sub(V[q], V[p]), tol);
        if (!hit || hit.gap > tol.dist * 1e4 * relTol(hit.pointB)) continue;
        const X = hit.pointB;
        const t = hit.r;
        if (findKnown(X)) continue;
        if (t >= -1e-9 && t <= 1 + 1e-9) {
          if (sectionIndexAt(X) === null) {
            issues.push(`точка пересечения следа с ребром ${E(e)} не совпала с вершиной сечения`);
            continue;
          }
          cands.push({ priority: 90, order: order++, apply: () => intersect(f, e, X, t) });
        } else {
          if (distance(X, poly.center) > 25 * L) continue;
          const g = poly.edgeFaces[e][0] === f ? poly.edgeFaces[e][1] : poly.edgeFaces[e][0];
          // Вспомогательная точка полезна, только если плоскость второй грани ребра ещё без следа.
          if (traces.has(g)) continue;
          const partners = pointsInPlane(g).length;
          const overshoot = t < 0 ? -t : t - 1;
          cands.push({
            priority: (partners >= 1 ? 50 : 30) - Math.min(4, overshoot),
            order: order++,
            apply: () => intersect(f, e, X, t),
          });
        }
      }
    }

    /* ── C. Параллельные грани ── */
    for (const pair of poly.parallelFaces) {
      for (const [f, g] of [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ] as const) {
        const tr = traces.get(f);
        if (!tr || traces.has(g)) continue;
        const cand = pointsInPlane(g).sort(
          (x, y) => (x.sectionIndex !== null ? 0 : 1) - (y.sectionIndex !== null ? 0 : 1),
        )[0];
        if (!cand) continue;
        cands.push({
          priority: sideOnFace(g) >= 0 ? 85 : 35,
          order: order++,
          apply: () => parallel(f, g, cand, pair.reason),
        });
      }
    }

    /* ── F. Прямая, параллельная α: e ∥ ℓ ⊂ α ⇒ α ∩ (G) ∥ e для грани G ⊃ e ── */
    for (const [, tr] of traces) {
      const pp = proportionalParallel(tr.A, tr.B) ?? traceOnEdge(tr);
      if (!pp) continue;
      poly.edges.forEach(([a, b], e2) => {
        if (section.signs[a] === 0 && section.signs[b] === 0) return; // ребро в α
        const chain = e2 === pp.edge ? '' : parallelEdgeReason(poly, pp.edge, e2);
        if (e2 !== pp.edge && !chain) return;
        for (const g of poly.edgeFaces[e2]) {
          if (traces.has(g)) continue;
          const P = pointsInPlane(g).sort(
            (x, y) => (x.sectionIndex !== null ? 0 : 1) - (y.sectionIndex !== null ? 0 : 1),
          )[0];
          if (!P) continue;
          cands.push({
            priority: sideOnFace(g) >= 0 ? 84 : 34,
            order: order++,
            apply: () => parallelToEdge(g, e2, P, tr, pp, chain ?? ''),
          });
        }
      });
    }

    /* ── D. Внутреннее проектирование на плоскость основания ── */
    const st = poly.structure;
    if (st.type !== 'none' && !traces.has(st.baseFace)) {
      const base = st.baseFace;
      const bp = poly.facePlanes[base];
      const proj = (P: Vec3): Vec3 | null => {
        if (Math.abs(signedDistance(bp, P)) <= tol.dist * 100) return null;
        if (st.type === 'prism') return linePlane(P, st.lateral, bp, tol)?.point ?? null;
        const S = V[st.apex];
        if (close(P, S)) return null;
        return linePlane(S, sub(P, S), bp, tol)?.point ?? null;
      };
      const alphaPts = points.filter((p) => p.inAlpha && !p.planes.has(base));
      let best: { M: CPoint; N: CPoint; M1: Vec3; N1: Vec3; X: Vec3; d: number } | null = null;
      for (let i = 0; i < alphaPts.length; i++)
        for (let j = i + 1; j < alphaPts.length; j++) {
          const M = alphaPts[i];
          const N = alphaPts[j];
          if ([...M.planes.keys()].some((f) => N.planes.has(f))) continue; // хватит правила A
          const M1 = proj(M.pos);
          const N1 = proj(N.pos);
          if (!M1 || !N1 || close(M1, N1)) continue;
          const hit = lineLine(M.pos, sub(N.pos, M.pos), M1, sub(N1, M1), tol);
          if (!hit || hit.gap > tol.dist * 1e4 * relTol(hit.pointA)) continue;
          if (findKnown(hit.pointA)) continue;
          const d = distance(hit.pointA, poly.center);
          if (d > 25 * L) continue;
          if (!best || d < best.d) best = { M, N, M1, N1, X: hit.pointA, d };
        }
      if (best) {
        const b = best;
        cands.push({
          priority: 20,
          order: order++,
          apply: () => projection(base, b.M, b.N, b.M1, b.N1, b.X),
        });
      }
    }

    if (cands.length === 0) {
      // E. Координатный метод — честный запасной вариант.
      const missing = section.vertices.map((_, i) => i).filter((i) => !knownSection(i));
      if (missing.length === 0) {
        issues.push('построение остановилось: все вершины найдены, но стороны не удалось обосновать');
        break;
      }
      const sharing = missing.find((i) => {
        const sv = section.vertices[i];
        const faces =
          sv.origin.type === 'edge' ? poly.edgeFaces[sv.origin.edge] : poly.vertexFaces[sv.origin.vertex];
        return faces.some((f) => pointsInPlane(f).length >= 1);
      });
      coordinate(sharing ?? missing[0]);
      continue;
    }
    cands.sort((x, y) => y.priority - x.priority || x.order - y.order);
    cands[0].apply();
  }

  if (!isDone()) issues.push('построение не завершено за отведённое число шагов');

  /* ═════════════ Итоговый шаг ═════════════ */
  if (isDone()) {
    const n = section.vertices.length;
    const name = polygonName();
    const sideLines = lines.filter((l) => l.kind === 'side');
    pushStep({
      rule: 'final',
      title: `Сечение ${name} — ${polygonTypeName(n)}`,
      action: `Искомое сечение — ${polygonTypeName(n)} ${name}.`,
      justification: [
        `Стороны: ${sides
          .map((s) => `${sectionLabels[s.a]}${sectionLabels[s.b]} ⊂ ${s.faces.map((f) => F(f)).join(' и ')}`)
          .join('; ')}.`,
        'Каждая вершина принадлежит ровно двум сторонам, поэтому ломаная замкнута.',
        'Многоугольник выпуклый: он является пересечением выпуклого многогранника с плоскостью.',
      ],
      uses: [],
      result: `${polygonTypeName(n)} ${name}`,
      prompt: 'Сколько сторон у сечения и в каких гранях они лежат?',
      newPoints: [],
      newLines: [],
      highlight: {
        faces: [...new Set(sides.flatMap((s) => s.faces))],
        edges: [],
        points: points.filter((p) => p.sectionIndex !== null).map((p) => p.id),
        lines: sideLines.map((l) => l.id),
      },
      claims: [],
    });
  }

  return finish();

  /* ═════════════ Правила ═════════════ */

  function connect(f: number, A: CPoint, B: CPoint, sideIdx: number) {
    const isSide = sideIdx >= 0 && onFace(f, A.pos) && onFace(f, B.pos);
    const line = newLine(isSide ? 'side' : 'trace', `${A.label}${B.label}`, A.pos, B.pos, f, true, isSide);
    setTrace(f, line, A.pos, B.pos, A, B);
    if (isSide) {
      sideEmitted.add(sideIdx);
      // Сторона на ребре многогранника лежит сразу в двух гранях — след известен в обеих.
      for (const ff of sides[sideIdx].faces) if (!traces.has(ff)) setTrace(ff, line, A.pos, B.pos, A, B);
    }
    const polyEdge = isSide ? sides[sideIdx].polyEdge : null;
    const just = [
      `${A.label} ∈ α и ${A.label} ∈ ${PL(f)}: ${A.planes.get(f)}.`,
      `${B.label} ∈ α и ${B.label} ∈ ${PL(f)}: ${B.planes.get(f)}.`,
      `Если две точки прямой лежат в плоскости, то и вся прямая лежит в этой плоскости. Значит, прямая ${A.label}${B.label} лежит и в α, и в ${PL(f)}: ${A.label}${B.label} = α ∩ ${PL(f)} — след секущей плоскости.`,
    ];
    if (isSide)
      just.push(
        polyEdge !== null
          ? `Отрезок ${A.label}${B.label} — ребро ${E(polyEdge)} многогранника; он целиком лежит в α и является стороной сечения.`
          : `Точки ${A.label} и ${B.label} принадлежат грани ${F(f)}, а грань — выпуклый многоугольник, поэтому отрезок ${A.label}${B.label} лежит в грани. Это сторона сечения.`,
      );
    pushStep({
      rule: 'connect',
      title: isSide
        ? `Соединяем ${A.label} и ${B.label} в грани ${F(f)}`
        : `Проводим прямую ${A.label}${B.label} в плоскости ${PL(f)}`,
      action: isSide
        ? `Соединяем точки ${A.label} и ${B.label} отрезком.`
        : `Проводим прямую ${A.label}${B.label}; она лежит в плоскости грани ${F(f)}, но может выходить за пределы самой грани.`,
      justification: just,
      uses: [A.label, B.label, `грань ${F(f)}`],
      result: isSide ? `${A.label}${B.label} — сторона сечения` : `${A.label}${B.label} = α ∩ ${PL(f)}`,
      prompt: `Какие две известные точки секущей плоскости лежат в плоскости грани ${F(f)}? Что можно через них провести?`,
      newPoints: [],
      newLines: [line],
      highlight: {
        faces: [f],
        edges: polyEdge !== null ? [polyEdge] : [],
        points: [A.id, B.id],
        lines: [line.id],
      },
      claims: [
        { kind: 'inAlpha', p: A.pos, what: `${A.label} ∈ α` },
        { kind: 'inAlpha', p: B.pos, what: `${B.label} ∈ α` },
        { kind: 'inFacePlane', p: A.pos, face: f, what: `${A.label} ∈ ${PL(f)}` },
        { kind: 'inFacePlane', p: B.pos, face: f, what: `${B.label} ∈ ${PL(f)}` },
      ],
    });
  }

  function intersect(f: number, e: number, X: Vec3, t: number) {
    const tr = traces.get(f)!;
    const [p, q] = poly.edges[e];
    const inside = t >= -1e-9 && t <= 1 + 1e-9;
    const g = poly.edgeFaces[e][0] === f ? poly.edgeFaces[e][1] : poly.edgeFaces[e][0];
    const si = sectionIndexAt(X);
    const label = inside && si !== null ? sectionLabels[si] : pool.take();
    const planes = new Map<number, string>();
    let pt: CPoint;
    if (inside) {
      const m = membership(label, X);
      pt = newPoint(label, X, 'section', m.planes, m.edgeLine);
    } else {
      for (const ff of poly.edgeFaces[e])
        planes.set(ff, `${label} лежит на прямой ${E(e)}, а эта прямая лежит в плоскости ${PL(ff)}`);
      pt = newPoint(label, X, 'aux', planes, e);
    }
    const newLines: CLine[] = [];
    const endpoint = t < 0 ? p : q;
    if (!inside) newLines.push(newLine('edge-ext', `${E(e)}…${label}`, V[endpoint], X, null, false, true));
    // Если след нарисован отрезком (сторона сечения), продолжение до новой точки — отдельной пунктирной прямой.
    if (tr.line.segmentOnly) {
      const a = tr.p;
      const b = add(tr.p, tr.dir);
      const s = dot(sub(X, a), tr.dir) / dot(tr.dir, tr.dir);
      if (s < -1e-9 || s > 1 + 1e-9)
        newLines.push(newLine('aux', `${tr.line.name}…${label}`, s < 0 ? a : b, X, f, true, true));
    }
    const trName = tr.line.name;
    const just = [
      `Прямая ${trName} лежит в плоскости ${PL(f)} (по построению — это след α), прямая ${E(e)} лежит в той же плоскости, так как ${E(e)} — ребро грани ${F(f)}.`,
      `Прямые ${trName} и ${E(e)} не параллельны, а две лежащие в одной плоскости непараллельные прямые пересекаются, причём в одной точке. Обозначим её ${label}.`,
      `${label} ∈ ${trName}, а ${trName} ⊂ α, значит, ${label} ∈ α.`,
    ];
    if (inside) {
      just.push(
        t <= 1e-9 || t >= 1 - 1e-9
          ? `Точка пересечения совпала с вершиной ${label} многогранника — это вершина сечения.`
          : `${label} лежит на ребре ${E(e)} (${edgeRatioText(e, t, label)}), значит, ${label} — вершина сечения.`,
      );
    } else {
      just.push(
        `${label} лежит на продолжении ребра ${E(e)} за точку ${poly.labels[endpoint]}, вне многогранника, — это вспомогательная точка.`,
        `Поскольку прямая ${E(e)} лежит и в плоскости грани ${F(g)}, точка ${label} ∈ ${PL(g)}. Это даст ещё одну точку α в плоскости ${PL(g)}.`,
      );
    }
    pushStep({
      rule: 'intersect',
      title: inside
        ? `Находим ${label} = ${trName} ∩ ${E(e)}`
        : `Вспомогательная точка ${label} = ${trName} ∩ ${E(e)}`,
      action: inside
        ? `Отмечаем точку пересечения прямой ${trName} с ребром ${E(e)}.`
        : `Продлеваем прямую ${trName} и ребро ${E(e)} до пересечения в точке ${label}.`,
      justification: just,
      uses: [trName, E(e), `плоскость ${PL(f)}`],
      result: inside ? `${label} — вершина сечения` : `${label} ∈ α ∩ ${PL(g)} (вспомогательная)`,
      prompt: `Прямая ${trName} и ребро ${E(e)} лежат в одной плоскости ${PL(f)}. Найдите их общую точку. Лежит ли она на самом ребре?`,
      newPoints: [pt],
      newLines,
      highlight: {
        faces: inside ? [f] : [f, g],
        edges: [e],
        points: [pt.id],
        lines: [tr.line.id, ...newLines.map((l) => l.id)],
      },
      claims: [
        { kind: 'onLine', p: X, a: tr.p, b: add(tr.p, tr.dir), what: `${label} ∈ ${trName}` },
        { kind: 'onLine', p: X, a: V[p], b: V[q], what: `${label} ∈ прямой ${E(e)}` },
        { kind: 'inFacePlane', p: tr.p, face: f, what: `${trName} ⊂ ${PL(f)}` },
        { kind: 'inFacePlane', p: add(tr.p, tr.dir), face: f, what: `${trName} ⊂ ${PL(f)}` },
        { kind: 'notParallel', d1: tr.dir, d2: sub(V[q], V[p]), what: `${trName} ∦ ${E(e)}` },
        { kind: 'inAlpha', p: X, what: `${label} ∈ α` },
        ...(inside ? [{ kind: 'onEdgeSegment', p: X, edge: e, what: `${label} ∈ ${E(e)}` } as Claim] : []),
        ...(!inside ? [{ kind: 'inFacePlane', p: X, face: g, what: `${label} ∈ ${PL(g)}` } as Claim] : []),
      ],
    });
  }

  function parallel(f: number, g: number, P: CPoint, reason: string) {
    const tr = traces.get(f)!;
    const name = LINE_NAMES[lineNameIdx++ % LINE_NAMES.length] + (lineNameIdx > LINE_NAMES.length ? '′' : '');
    const dirN = scale(normalize(tr.dir), L * 0.5);
    const line = newLine('parallel', name, P.pos, add(P.pos, dirN), g, true);
    setTrace(g, line, P.pos, add(P.pos, dirN));
    pushStep({
      rule: 'parallel',
      title: `Через ${P.label} проводим прямую ${name} ∥ ${tr.line.name} в плоскости ${PL(g)}`,
      action: `В плоскости грани ${F(g)} через точку ${P.label} проводим прямую ${name}, параллельную ${tr.line.name}.`,
      justification: [
        `Плоскости ${PL(f)} и ${PL(g)} параллельны: ${reason}.`,
        `Если две параллельные плоскости пересечены третьей плоскостью, то линии их пересечения параллельны. Плоскость α пересекает ${PL(f)} по прямой ${tr.line.name}, значит, α ∩ ${PL(g)} ∥ ${tr.line.name}.`,
        `${P.label} ∈ α и ${P.label} ∈ ${PL(g)}: ${P.planes.get(g)}. Через точку вне прямой проходит единственная прямая, параллельная данной, — это прямая ${name} = α ∩ ${PL(g)}.`,
      ],
      uses: [tr.line.name, P.label, `${PL(f)} ∥ ${PL(g)}`],
      result: `${name} = α ∩ ${PL(g)}, ${name} ∥ ${tr.line.name}`,
      prompt: `Грани ${F(f)} и ${F(g)} лежат в параллельных плоскостях. Как связаны следы секущей плоскости на них?`,
      newPoints: [],
      newLines: [line],
      highlight: { faces: [f, g], edges: [], points: [P.id], lines: [tr.line.id, line.id] },
      claims: [
        { kind: 'facesParallel', f, g, what: `${PL(f)} ∥ ${PL(g)}` },
        { kind: 'inFacePlane', p: P.pos, face: g, what: `${P.label} ∈ ${PL(g)}` },
        { kind: 'inAlpha', p: P.pos, what: `${P.label} ∈ α` },
        { kind: 'parallelDirs', d1: tr.dir, d2: dirN, what: `${name} ∥ ${tr.line.name}` },
      ],
    });
  }

  function parallelToEdge(
    g: number,
    e: number,
    P: CPoint,
    tr: Trace,
    pp: { edge: number; text: string },
    chain: string,
  ) {
    const name = LINE_NAMES[lineNameIdx++ % LINE_NAMES.length] + (lineNameIdx > LINE_NAMES.length ? '′' : '');
    const [a, b] = poly.edges[e];
    const dirE = sub(V[b], V[a]);
    const dirN = scale(normalize(dirE), L * 0.5);
    const line = newLine('parallel', name, P.pos, add(P.pos, dirN), g, true);
    setTrace(g, line, P.pos, add(P.pos, dirN));
    const AB = tr.line.name;
    const [pa, pb] = poly.edges[pp.edge];
    const just = [pp.text];
    if (e !== pp.edge) just.push(`${E(e)} ∥ ${E(pp.edge)}: ${chain}.`);
    just.push(
      `Прямая ${E(e)} параллельна прямой ${AB}, лежащей в α, поэтому ${E(e)} ∥ α (признак параллельности прямой и плоскости).`,
      `Плоскость ${PL(g)} проходит через прямую ${E(e)}, параллельную α, и пересекает α (общая точка ${P.label}: ${P.planes.get(g)}). Если плоскость проходит через прямую, параллельную другой плоскости, и пересекает её, то линия пересечения параллельна этой прямой: α ∩ ${PL(g)} ∥ ${E(e)}.`,
      `Через ${P.label} проводим прямую ${name} ∥ ${E(e)} — это след α на ${PL(g)}.`,
    );
    pushStep({
      rule: 'parallel',
      title: `Через ${P.label} проводим прямую ${name} ∥ ${E(e)} в плоскости ${PL(g)}`,
      action: `В плоскости грани ${F(g)} через точку ${P.label} проводим прямую ${name}, параллельную ребру ${E(e)}.`,
      justification: just,
      uses: [AB, E(pp.edge), E(e), P.label],
      result: `${name} = α ∩ ${PL(g)}, ${name} ∥ ${E(e)}`,
      prompt: `Прямая ${AB} параллельна ребру ${E(pp.edge)}. Что из этого следует для следа α в плоскости ${PL(g)}?`,
      newPoints: [],
      newLines: [line],
      highlight: { faces: [g], edges: [e, pp.edge], points: [P.id], lines: [tr.line.id, line.id] },
      claims: [
        { kind: 'parallelDirs', d1: tr.dir, d2: sub(V[pb], V[pa]), what: `${AB} ∥ ${E(pp.edge)}` },
        { kind: 'parallelDirs', d1: sub(V[pb], V[pa]), d2: dirE, what: `${E(pp.edge)} ∥ ${E(e)}` },
        { kind: 'inFacePlane', p: P.pos, face: g, what: `${P.label} ∈ ${PL(g)}` },
        { kind: 'inAlpha', p: P.pos, what: `${P.label} ∈ α` },
        { kind: 'parallelDirs', d1: dirN, d2: dirE, what: `${name} ∥ ${E(e)}` },
      ],
    });
  }

  function projection(base: number, M: CPoint, N: CPoint, M1: Vec3, N1: Vec3, X: Vec3) {
    const st = poly.structure;
    const projLabel = (P: CPoint, pos: Vec3) => {
      const vi = V.findIndex((v) => close(v, pos));
      return vi >= 0 ? poly.labels[vi] : P.label + '′';
    };
    const m1 = projLabel(M, M1);
    const n1 = projLabel(N, N1);
    const label = pool.take();
    const pm = newPoint(
      m1,
      M1,
      'projection',
      new Map([[base, `${m1} лежит в плоскости основания по построению`]]),
      null,
      false,
    );
    const pn = newPoint(
      n1,
      N1,
      'projection',
      new Map([[base, `${n1} лежит в плоскости основания по построению`]]),
      null,
      false,
    );
    const xPlanes = new Map<number, string>([
      [base, `${label} лежит на прямой ${m1}${n1}, а она лежит в плоскости основания ${PL(base)}`],
    ]);
    const ptX = newPoint(label, X, 'aux', xPlanes, null);
    const l1 = newLine('projection', `${M.label}${m1}`, M.pos, M1, null, false, true);
    const l2 = newLine('projection', `${N.label}${n1}`, N.pos, N1, null, false, true);
    const l3 = newLine('aux', `${m1}${n1}`, M1, N1, base, false);
    const l4 = newLine('aux', `${M.label}${N.label}`, M.pos, N.pos, null, true);
    let just: string[];
    let action: string;
    if (st.type === 'prism') {
      action = `Проецируем ${M.label} и ${N.label} на плоскость основания ${PL(base)} параллельно боковому ребру: получаем ${m1} и ${n1}. Проводим прямые ${M.label}${N.label} и ${m1}${n1} до пересечения в точке ${label}.`;
      just = [
        `${M.label}${m1} ∥ ${N.label}${n1}, так как обе прямые параллельны боковым рёбрам призмы. Две параллельные прямые задают плоскость, и прямые ${M.label}${N.label} и ${m1}${n1} лежат в этой плоскости.`,
        `Прямые ${M.label}${N.label} и ${m1}${n1} не параллельны, поэтому пересекаются в точке ${label}.`,
        `${label} ∈ ${M.label}${N.label} ⊂ α и ${label} ∈ ${m1}${n1} ⊂ ${PL(base)}. Значит, ${label} — общая точка α и плоскости основания.`,
      ];
    } else {
      const S = st.type === 'pyramid' ? poly.labels[st.apex] : 'S';
      action = `Центрально проецируем ${M.label} и ${N.label} из вершины ${S} на плоскость основания ${PL(base)}: ${m1} = ${S}${M.label} ∩ ${PL(base)}, ${n1} = ${S}${N.label} ∩ ${PL(base)}. Проводим ${M.label}${N.label} и ${m1}${n1} до пересечения в точке ${label}.`;
      just = [
        `Прямые ${S}${M.label} и ${S}${N.label} пересекаются в точке ${S}, поэтому задают плоскость (${S}${M.label}${N.label}). Ей принадлежат прямые ${M.label}${N.label} и ${m1}${n1}.`,
        `Прямые ${M.label}${N.label} и ${m1}${n1} лежат в одной плоскости и не параллельны, значит, пересекаются в точке ${label}.`,
        `${label} ∈ ${M.label}${N.label} ⊂ α и ${label} ∈ ${m1}${n1} ⊂ ${PL(base)}: ${label} — общая точка α и плоскости основания.`,
      ];
    }
    pushStep({
      rule: 'projection',
      title: `Внутреннее проектирование: точка ${label} в плоскости основания`,
      action,
      justification: just,
      uses: [M.label, N.label, `плоскость основания ${PL(base)}`],
      result: `${label} ∈ α ∩ ${PL(base)} (вспомогательная)`,
      prompt: `Точки ${M.label} и ${N.label} не лежат в одной грани. Как найти точку прямой ${M.label}${N.label} в плоскости основания?`,
      newPoints: [pm, pn, ptX],
      newLines: [l1, l2, l3, l4],
      highlight: {
        faces: [base],
        edges: [],
        points: [M.id, N.id, pm.id, pn.id, ptX.id],
        lines: [l1.id, l2.id, l3.id, l4.id],
      },
      claims: [
        { kind: 'inFacePlane', p: M1, face: base, what: `${m1} ∈ ${PL(base)}` },
        { kind: 'inFacePlane', p: N1, face: base, what: `${n1} ∈ ${PL(base)}` },
        { kind: 'onLine', p: X, a: M.pos, b: N.pos, what: `${label} ∈ ${M.label}${N.label}` },
        { kind: 'onLine', p: X, a: M1, b: N1, what: `${label} ∈ ${m1}${n1}` },
        { kind: 'inAlpha', p: X, what: `${label} ∈ α` },
        { kind: 'inFacePlane', p: X, face: base, what: `${label} ∈ ${PL(base)}` },
        ...(st.type === 'prism'
          ? [
              {
                kind: 'parallelDirs',
                d1: sub(M1, M.pos),
                d2: sub(N1, N.pos),
                what: `${M.label}${m1} ∥ ${N.label}${n1}`,
              } as Claim,
            ]
          : []),
      ],
    });
  }

  function coordinate(si: number) {
    usedCoordinateMethod = true;
    const sv = section.vertices[si];
    const label = sectionLabels[si];
    const n = section.plane.normal;
    const k = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]));
    const [a, b, c] = [n[0] / k, n[1] / k, n[2] / k];
    const d = section.plane.d / k;
    const eq = `${fmt(a)}·x ${sgn(b)} ${fmt(Math.abs(b))}·y ${sgn(c)} ${fmt(Math.abs(c))}·z ${sgn(d)} ${fmt(Math.abs(d))} = 0`;
    const fval = (P: Vec3) => a * P[0] + b * P[1] + c * P[2] + d;
    const m = membership(label, sv.pos);
    const pt = newPoint(label, sv.pos, 'section', m.planes, m.edgeLine);
    const just = [
      'Для этой конфигурации не нашлось шага классического построения (нет двух известных точек α в плоскости одной грани). Применяем координатный метод — он тоже строгий.',
      `Уравнение α по координатам ${given.map((gp) => `${gp.label}${fmtVec(gp.pos)}`).join(', ')}: ${eq}.`,
    ];
    let edges: number[] = [];
    if (sv.origin.type === 'edge') {
      const e = sv.origin.edge;
      edges = [e];
      const [p, q] = poly.edges[e];
      const fp = fval(V[p]);
      const fq = fval(V[q]);
      just.push(
        `f(${poly.labels[p]}) = ${fmt(fp)}, f(${poly.labels[q]}) = ${fmt(fq)} — разных знаков, поэтому ребро ${E(e)} пересекает α.`,
        `t = f(${poly.labels[p]}) / (f(${poly.labels[p]}) − f(${poly.labels[q]})) = ${fmt(sv.origin.t, 4)}; ${label} = ${poly.labels[p]} + t·${poly.labels[p]}${poly.labels[q]} = ${fmtVec(sv.pos)}; ${edgeRatioText(e, sv.origin.t, label)}.`,
      );
    } else {
      just.push(`f(${label}) = 0 — вершина ${label} лежит в α и является вершиной сечения.`);
    }
    pushStep({
      rule: 'coordinate',
      title: `Координатный метод: вершина ${label}`,
      action: `Вычисляем точку пересечения α с ${sv.origin.type === 'edge' ? `ребром ${E(sv.origin.edge)}` : `вершиной ${label}`}.`,
      justification: just,
      uses: ['уравнение плоскости α'],
      result: `${label} — вершина сечения`,
      prompt: `Составьте уравнение плоскости α и подставьте координаты концов ребра.`,
      newPoints: [pt],
      newLines: [],
      highlight: { faces: [], edges, points: [pt.id], lines: [] },
      claims: [
        { kind: 'inAlpha', p: sv.pos, what: `${label} ∈ α` },
        ...(sv.origin.type === 'edge'
          ? [
              {
                kind: 'onEdgeSegment',
                p: sv.pos,
                edge: sv.origin.edge,
                what: `${label} ∈ ${E(sv.origin.edge)}`,
              } as Claim,
            ]
          : []),
      ],
    });
  }

  function emitSide(si: number, f: number, A: CPoint, B: CPoint) {
    sideEmitted.add(si);
    const s = sides[si];
    const tr = traces.get(f)!;
    const line = newLine('side', `${A.label}${B.label}`, A.pos, B.pos, f, true, true);
    for (const ff of s.faces) if (!traces.has(ff)) setTrace(ff, line, A.pos, B.pos, A, B);
    pushStep({
      rule: 'side',
      title: `Соединяем ${A.label} и ${B.label}: сторона в грани ${F(f)}`,
      action: `Проводим отрезок ${A.label}${B.label}.`,
      justification: [
        `${A.label} и ${B.label} лежат на прямой ${tr.line.name} = α ∩ ${PL(f)} и на границе грани ${F(f)}.`,
        s.polyEdge !== null
          ? `Отрезок ${A.label}${B.label} совпадает с ребром ${E(s.polyEdge)} и целиком лежит в α.`
          : `Грань ${F(f)} — выпуклый многоугольник, поэтому отрезок ${A.label}${B.label} лежит в грани, а так как он лежит и в α, это сторона сечения.`,
      ],
      uses: [A.label, B.label, tr.line.name],
      result: `${A.label}${B.label} — сторона сечения`,
      prompt: `Какие две вершины сечения лежат в грани ${F(f)}?`,
      newPoints: [],
      newLines: [line],
      highlight: {
        faces: [f],
        edges: s.polyEdge !== null ? [s.polyEdge] : [],
        points: [A.id, B.id],
        lines: [line.id],
      },
      claims: [
        { kind: 'inFacePlane', p: A.pos, face: f, what: `${A.label} ∈ ${PL(f)}` },
        { kind: 'inFacePlane', p: B.pos, face: f, what: `${B.label} ∈ ${PL(f)}` },
        { kind: 'onLine', p: A.pos, a: tr.p, b: add(tr.p, tr.dir), what: `${A.label} ∈ ${tr.line.name}` },
        { kind: 'onLine', p: B.pos, a: tr.p, b: add(tr.p, tr.dir), what: `${B.label} ∈ ${tr.line.name}` },
      ],
    });
  }

  function polygonName(): string {
    const n = sectionLabels.length;
    if (n === 0) return '';
    // Начинаем с первой заданной точки, если она — вершина сечения.
    let start = 0;
    const gi = sectionLabels.findIndex((l) => given.some((g) => g.label === l));
    if (gi >= 0) start = gi;
    return Array.from({ length: n }, (_, i) => sectionLabels[(start + i) % n]).join('');
  }

  function finish(): Construction {
    return {
      steps,
      points,
      lines,
      complete: section.status !== 'polygon' ? true : isDone(),
      usedCoordinateMethod,
      sectionLabels,
      polygonName:
        section.status === 'polygon' || section.status === 'face' ? polygonName() : sectionLabels.join(''),
      issues,
    };
  }
}

const sgn = (x: number) => (x < 0 ? '−' : '+');

/* ═════════════ Проверка утверждений шагов ═════════════ */

export function verifyConstruction(poly: Polyhedron, section: Section, c: Construction): string[] {
  const { tol } = poly;
  const L = tol.scale;
  const bad: string[] = [...c.issues];
  const rel = (p: Vec3) => 1 + distance(p, poly.center) / L;
  for (const s of c.steps)
    for (const cl of s.claims) {
      let ok = true;
      switch (cl.kind) {
        case 'inAlpha':
          ok = Math.abs(signedDistance(section.plane, cl.p)) <= 1e-7 * L * rel(cl.p);
          break;
        case 'inFacePlane':
          ok = Math.abs(signedDistance(poly.facePlanes[cl.face], cl.p)) <= 1e-7 * L * rel(cl.p);
          break;
        case 'onLine': {
          const d = sub(cl.b, cl.a);
          ok = length(cross(sub(cl.p, cl.a), d)) / length(d) <= 1e-7 * L * rel(cl.p);
          break;
        }
        case 'onEdgeSegment': {
          const [a, b] = poly.edges[cl.edge];
          ok = distPointSegment(cl.p, poly.vertices[a], poly.vertices[b]) <= 1e-7 * L;
          break;
        }
        case 'parallelDirs':
          ok = sinAngle(cl.d1, cl.d2) <= 1e-7;
          break;
        case 'notParallel':
          ok = sinAngle(cl.d1, cl.d2) > 1e-9;
          break;
        case 'facesParallel':
          ok =
            sinAngle(poly.facePlanes[cl.f].normal, poly.facePlanes[cl.g].normal) <= 1e-9 &&
            poly.parallelFaces.some((p) => (p.a === cl.f && p.b === cl.g) || (p.a === cl.g && p.b === cl.f));
          break;
      }
      if (!ok) bad.push(`шаг ${s.index + 1}: не подтвердилось «${cl.what}»`);
    }
  if (section.status === 'polygon') {
    section.vertices.forEach((sv, i) => {
      if (
        !c.points.some((p) => p.inAlpha && p.sectionIndex === i && distance(p.pos, sv.pos) <= tol.merge * 100)
      )
        bad.push(`вершина сечения ${c.sectionLabels[i]} не получена построением`);
    });
    const sideCount = c.lines.filter((l) => l.kind === 'side').length;
    if (sideCount !== section.sides.length)
      bad.push(`построено ${sideCount} сторон из ${section.sides.length}`);
  }
  return bad;
}

/** Состояние чертежа на шаге k: какие точки и прямые видны и с какими границами рисовать прямые. */
export function constructionSnapshot(c: Construction, stepIndex: number) {
  const k = Math.min(stepIndex, c.steps.length - 1);
  const pts: CPoint[] = [];
  const lns: CLine[] = [];
  for (let i = 0; i <= k; i++) {
    pts.push(...c.steps[i].newPoints);
    lns.push(...c.steps[i].newLines);
  }
  const drawn = lns.map((l) => {
    if (l.segmentOnly) return { line: l, from: l.a, to: l.b };
    // Прямая рисуется между крайними известными точками на ней (с небольшим запасом).
    const dir = sub(l.b, l.a);
    const len2 = dot(dir, dir);
    let lo = 0;
    let hi = 1;
    const lineLen = Math.sqrt(len2);
    for (const p of pts) {
      const w = sub(p.pos, l.a);
      const perp = length(cross(w, dir)) / lineLen;
      if (perp <= 1e-6 * (lineLen + length(w))) {
        const s = dot(w, dir) / len2;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    const margin = 0.08 * (hi - lo);
    return { line: l, from: lerp(l.a, l.b, lo - margin), to: lerp(l.a, l.b, hi + margin) };
  });
  return { points: pts, lines: drawn, current: c.steps[k] };
}
