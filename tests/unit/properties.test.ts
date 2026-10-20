import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planeFromNormalPoint, signedDistance } from '../../src/core/geometry/plane';
import { type Vec3, distance } from '../../src/core/geometry/vec';
import { buildPolyhedron } from '../../src/core/polyhedra/build';
import { KINDS, createPolyhedron } from '../../src/core/polyhedra/catalog';
import type { Polyhedron } from '../../src/core/polyhedra/types';
import { computeSection } from '../../src/core/section/computeSection';
import type { DefinedPoint } from '../../src/core/section/points';
import { solve } from '../../src/core/solve';
import { measureSection, validateSection } from '../../src/core/validation/validateSection';

const kinds = KINDS.map((k) => k.kind);
const arbUnit = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => x * x + y * y + z * z > 1e-3);

describe('инварианты для случайных плоскостей (property-based)', () => {
  it('любая плоскость: результат проходит независимую проверку', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        arbUnit,
        fc.double({ min: -0.7, max: 0.7, noNaN: true }),
        (kind, n, off) => {
          const p = createPolyhedron(kind);
          const c = p.center;
          const pt: Vec3 = [
            c[0] + n[0] * off * p.tol.scale,
            c[1] + n[1] * off * p.tol.scale,
            c[2] + n[2] * off * p.tol.scale,
          ];
          const sec = computeSection(p, planeFromNormalPoint(n as unknown as Vec3, pt));
          expect(sec.status).not.toBe('error');
          const rep = validateSection(p, sec);
          expect(rep.checks.filter((x) => !x.passed)).toEqual([]);
          // Вершины многогранника, попавшие в допуск (с учётом привязки), лежат в плоскости с точностью ε_слияния.
          for (const v of sec.vertices)
            expect(Math.abs(signedDistance(sec.plane, v.pos))).toBeLessThanOrEqual(p.tol.merge * (1 + 1e-9));
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('перенумерация вершин и граней не меняет сечение', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        arbUnit,
        fc.double({ min: -0.4, max: 0.4, noNaN: true }),
        fc.integer({ min: 1, max: 1e9 }),
        (kind, n, off, seed) => {
          const p = createPolyhedron(kind);
          const q = shuffled(p, seed);
          const c = p.center;
          const pt: Vec3 = [
            c[0] + n[0] * off * p.tol.scale,
            c[1] + n[1] * off * p.tol.scale,
            c[2] + n[2] * off * p.tol.scale,
          ];
          const plane = planeFromNormalPoint(n as unknown as Vec3, pt);
          const s1 = computeSection(p, plane);
          const s2 = computeSection(q, plane);
          expect(s2.status).toBe(s1.status);
          expect(s2.vertices.length).toBe(s1.vertices.length);
          expect(measureSection(s2).area).toBeCloseTo(measureSection(s1).area, 9);
          for (const v of s2.vertices)
            expect(s1.vertices.some((w) => distance(v.pos, w.pos) < 1e-9 * p.tol.scale)).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('перестановка трёх определяющих точек не меняет сечение', () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.integer({ min: 1, max: 1e9 }), (kind, seed) => {
        const p = createPolyhedron(kind);
        const pts = randomEdgePoints(p, seed);
        const a = solve(p, pts);
        const b = solve(p, [pts[2], pts[0], pts[1]]);
        expect(b.planeStatus).toBe(a.planeStatus);
        if (a.section && b.section) {
          expect(b.section.vertices.length).toBe(a.section.vertices.length);
          expect(measureSection(b.section).area).toBeCloseTo(measureSection(a.section).area, 9);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('школьное решение на случайных задачах', () => {
  it('для каждой задачи с невырожденным сечением построение завершено и все утверждения шагов подтверждаются', () => {
    const stats: Record<string, { total: number; coord: number }> = {};
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.integer({ min: 1, max: 1e9 }), (kind, seed) => {
        const p = createPolyhedron(kind, kind === 'prism' || kind === 'pyramid' ? { n: 3 + (seed % 4) } : {});
        const s = solve(p, randomEdgePoints(p, seed));
        if (s.planeStatus !== 'ok') return;
        expect(s.validation!.ok).toBe(true);
        expect(s.construction!.complete).toBe(true);
        expect(s.constructionIssues).toEqual([]);
        const st = (stats[kind] ??= { total: 0, coord: 0 });
        if (s.section!.status === 'polygon') {
          st.total++;
          if (s.construction!.usedCoordinateMethod) st.coord++;
        }
      }),
      { numRuns: 3000 },
    );
    // Для школьных фигур классическое построение должно находиться почти всегда.
    for (const k of ['cube', 'prism', 'pyramid', 'tetrahedron', 'parallelepiped']) {
      const st = stats[k];
      if (st && st.total > 20)
        expect(st.coord / st.total, `${k}: ${st.coord}/${st.total}`).toBeLessThan(0.02);
    }
    console.info(
      'доля координатного метода:',
      Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${v.coord}/${v.total}`])),
    );
  });
});

/* ── вспомогательные ── */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEdgePoints(p: Polyhedron, seed: number): DefinedPoint[] {
  const r = rng(seed);
  const used = new Set<number>();
  const out: DefinedPoint[] = [];
  while (out.length < 3) {
    const e = Math.floor(r() * p.edges.length);
    if (used.has(e) && r() < 0.8) continue;
    used.add(e);
    const [a, b] = p.edges[e];
    const t = Math.round((0.05 + 0.9 * r()) * 1000) / 1000;
    out.push({
      id: `r${out.length}`,
      label: ['M', 'N', 'K'][out.length],
      spec: { kind: 'edge', from: a, to: b, t },
    });
  }
  return out;
}

/** Тот же многогранник с переставленными вершинами и гранями и сдвинутым началом обхода граней. */
function shuffled(p: Polyhedron, seed: number): Polyhedron {
  const r = rng(seed);
  const perm = p.vertices.map((_, i) => i).sort(() => r() - 0.5);
  const inv = new Array<number>(perm.length);
  perm.forEach((old, nw) => (inv[old] = nw));
  const faces = p.faces
    .map((f) => {
      const k = Math.floor(r() * f.length);
      return [...f.slice(k), ...f.slice(0, k)].map((v) => inv[v]);
    })
    .sort(() => r() - 0.5);
  return buildPolyhedron({
    kind: p.kind,
    title: p.title,
    params: p.params,
    vertices: perm.map((old) => p.vertices[old]),
    labels: perm.map((old) => p.labels[old]),
    faces,
  });
}
