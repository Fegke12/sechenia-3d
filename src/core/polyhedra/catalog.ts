import { makeTolerance } from '../geometry/tolerance';
import { type Vec3, add, centroid, scale, sub } from '../geometry/vec';
import { buildPolyhedron, hullFaces, subscript } from './build';
import type { KindSpec, Polyhedron, PolyhedronKind, PolyhedronParams } from './types';

const LETTERS = 'ABCDEFGHIJKL'.split('');
const deg = (x: number) => (x * Math.PI) / 180;

const PARALLELEPIPED_REASON =
  'противолежащие грани параллелепипеда лежат в параллельных плоскостях (свойство параллелепипеда)';
const CENTRAL_SYMMETRY_REASON =
  'правильный многогранник центрально-симметричен относительно своего центра, поэтому противолежащие грани лежат в параллельных плоскостях';

/** Обоснования параллельности рёбер призмы (вершины 0..n−1 — нижнее основание, n..2n−1 — верхнее). */
function prismEdgeReason(n: number, baseKind: 'regular' | 'parallelogram' | 'square', what = 'призмы') {
  return (
    ea: readonly [number, number],
    eb: readonly [number, number],
    nm: (e: readonly [number, number]) => string,
  ) => {
    const lateral = (e: readonly [number, number]) => e[1] - e[0] === n;
    const level = (e: readonly [number, number]) =>
      e[0] < n && e[1] < n ? 0 : e[0] >= n && e[1] >= n ? 1 : -1;
    if (lateral(ea) && lateral(eb)) return `боковые рёбра ${what} параллельны`;
    const la = level(ea);
    const lb = level(eb);
    if (la >= 0 && lb >= 0 && la !== lb) {
      const [x, y] = la === 0 ? [ea, eb] : [eb, ea];
      if (x[0] + n === y[0] && x[1] + n === y[1])
        return `боковая грань ${nm(x)}${nm([y[1], y[0]])} — параллелограмм`;
      return null;
    }
    if (la >= 0 && la === lb) {
      if (baseKind === 'square') return 'противолежащие стороны квадрата параллельны';
      if (baseKind === 'parallelogram') return 'основание — параллелограмм';
      return `противолежащие стороны ${ngonGen(n)} в основании параллельны`;
    }
    return null;
  };
}

/** Рёбра, симметричные относительно центра (для центрально-симметричных тел). */
function antipodalEdgeReason(vertices: readonly Vec3[]) {
  const opp = (i: number) =>
    vertices.findIndex(
      (v) => Math.hypot(v[0] + vertices[i][0], v[1] + vertices[i][1], v[2] + vertices[i][2]) < 1e-9,
    );
  return (ea: readonly [number, number], eb: readonly [number, number]) => {
    const a0 = opp(ea[0]);
    const a1 = opp(ea[1]);
    return (a0 === eb[0] && a1 === eb[1]) || (a0 === eb[1] && a1 === eb[0])
      ? 'рёбра симметричны относительно центра многогранника, поэтому параллельны'
      : null;
  };
}

/** Вершины правильного n-угольника со стороной a, центр в начале координат, AB ∥ Ox снизу. */
function regularPolygon(n: number, a: number): Vec3[] {
  const R = a / (2 * Math.sin(Math.PI / n));
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const th = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n;
    out.push([R * Math.cos(th), R * Math.sin(th), 0]);
  }
  return out;
}

const NGON_NAMES: Record<number, string> = {
  3: 'треугольная',
  4: 'четырёхугольная',
  5: 'пятиугольная',
  6: 'шестиугольная',
  7: 'семиугольная',
  8: 'восьмиугольная',
};
const ngon = (n: number) => NGON_NAMES[n] ?? `${n}-угольная`;
const NGON_GEN: Record<number, string> = {
  3: 'правильного треугольника',
  4: 'квадрата',
  5: 'правильного пятиугольника',
  6: 'правильного шестиугольника',
  8: 'правильного восьмиугольника',
};
const ngonGen = (n: number) => NGON_GEN[n] ?? `правильного ${n}-угольника`;

/* ───────────────────────── Призма ───────────────────────── */

function buildPrism(p: PolyhedronParams): Polyhedron {
  const n = Math.round(p.n);
  const base = regularPolygon(n, p.a);
  const shift: Vec3 = [p.shiftX, p.shiftY, p.h];
  const top = base.map((v) => add(v, shift));
  const labels = [...LETTERS.slice(0, n), ...LETTERS.slice(0, n).map((l) => l + subscript(1))];
  const faces: number[][] = [];
  faces.push([...Array(n).keys()].reverse()); // 0 — нижнее основание
  faces.push([...Array(n).keys()].map((i) => i + n)); // 1 — верхнее основание
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, ((i + 1) % n) + n, i + n]);
  const oblique = Math.abs(p.shiftX) > 1e-12 || Math.abs(p.shiftY) > 1e-12;
  return buildPolyhedron({
    kind: 'prism',
    title: oblique ? `Наклонная ${ngon(n)} призма` : `Правильная ${ngon(n)} призма`,
    params: p,
    vertices: [...base, ...top],
    labels,
    faces,
    parallelReason: (fa, fb) => {
      if ((fa === 0 && fb === 1) || (fa === 1 && fb === 0))
        return 'основания призмы лежат в параллельных плоскостях (по определению призмы)';
      if (fa >= 2 && fb >= 2)
        return `противолежащие стороны ${ngonGen(n)} в основании параллельны, а боковые рёбра призмы параллельны друг другу; по признаку параллельности плоскостей противолежащие боковые грани параллельны`;
      return null;
    },
    structure: () => ({ type: 'prism', baseFace: 0, topFace: 1, lateral: shift }),
    edgeParallelReason: prismEdgeReason(n, 'regular'),
  });
}

/* ───────────────────────── Пирамида ───────────────────────── */

function buildPyramid(p: PolyhedronParams): Polyhedron {
  const n = Math.round(p.n);
  const base = regularPolygon(n, p.a);
  const apex: Vec3 = [p.apexX, p.apexY, p.h];
  const labels = ['S', ...LETTERS.slice(0, n)];
  const vertices = [apex, ...base];
  const faces: number[][] = [];
  faces.push([...Array(n).keys()].map((i) => i + 1).reverse()); // 0 — основание
  for (let i = 0; i < n; i++) faces.push([i + 1, ((i + 1) % n) + 1, 0]);
  const irregular = Math.abs(p.apexX) > 1e-12 || Math.abs(p.apexY) > 1e-12;
  return buildPolyhedron({
    kind: 'pyramid',
    title: irregular
      ? `${ngon(n)[0].toUpperCase()}${ngon(n).slice(1)} пирамида`
      : `Правильная ${ngon(n)} пирамида`,
    params: p,
    vertices,
    labels,
    faces,
    structure: () => ({ type: 'pyramid', baseFace: 0, apex: 0 }),
    edgeParallelReason: (ea, eb) =>
      ea[0] > 0 && eb[0] > 0 ? `противолежащие стороны ${ngonGen(n)} в основании параллельны` : null,
  });
}

/* ───────────────────── Куб и параллелепипед ───────────────────── */

function parallelepipedVertices(
  a: number,
  b: number,
  c: number,
  angle: number,
  sx: number,
  sy: number,
): Vec3[] {
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [a, 0, 0];
  const D: Vec3 = [b * Math.cos(deg(angle)), b * Math.sin(deg(angle)), 0];
  const C = add(B, D);
  const up: Vec3 = [sx, sy, c];
  const z = (x: number) => (Math.abs(x) < 1e-14 ? 0 : x);
  return [A, B, C, D, add(A, up), add(B, up), add(C, up), add(D, up)].map((v): Vec3 => [
    z(v[0]),
    z(v[1]),
    z(v[2]),
  ]);
}

const BOX_LABELS = ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'];
const BOX_FACES = [
  [3, 2, 1, 0], // ABCD
  [4, 5, 6, 7], // A₁B₁C₁D₁
  [0, 1, 5, 4], // ABB₁A₁
  [1, 2, 6, 5], // BCC₁B₁
  [2, 3, 7, 6], // CDD₁C₁
  [3, 0, 4, 7], // DAA₁D₁
];

function buildCube(p: PolyhedronParams): Polyhedron {
  const a = p.a;
  return buildPolyhedron({
    kind: 'cube',
    title: 'Куб',
    params: p,
    vertices: parallelepipedVertices(a, a, a, 90, 0, 0),
    labels: BOX_LABELS,
    faces: BOX_FACES,
    parallelReason: () => 'противолежащие грани куба лежат в параллельных плоскостях (куб — параллелепипед)',
    structure: () => ({ type: 'prism', baseFace: 0, topFace: 1, lateral: [0, 0, a] }),
    edgeParallelReason: prismEdgeReason(4, 'square', 'куба'),
  });
}

function buildParallelepiped(p: PolyhedronParams): Polyhedron {
  const rect = Math.abs(p.angle - 90) < 1e-9 && Math.abs(p.shiftX) < 1e-12 && Math.abs(p.shiftY) < 1e-12;
  return buildPolyhedron({
    kind: 'parallelepiped',
    title: rect ? 'Прямоугольный параллелепипед' : 'Параллелепипед',
    params: p,
    vertices: parallelepipedVertices(p.a, p.b, p.c, p.angle, p.shiftX, p.shiftY),
    labels: BOX_LABELS,
    faces: BOX_FACES,
    parallelReason: () => PARALLELEPIPED_REASON,
    structure: () => ({ type: 'prism', baseFace: 0, topFace: 1, lateral: [p.shiftX, p.shiftY, p.c] }),
    edgeParallelReason: prismEdgeReason(4, 'parallelogram', 'параллелепипеда'),
  });
}

/* ───────────────────────── Тетраэдр ───────────────────────── */

function buildTetrahedron(p: PolyhedronParams): Polyhedron {
  const regular = p.regular >= 0.5;
  let vertices: Vec3[];
  if (regular) {
    const a = p.a;
    vertices = [
      [0, 0, 0],
      [a, 0, 0],
      [a / 2, (a * Math.sqrt(3)) / 2, 0],
      [a / 2, (a * Math.sqrt(3)) / 6, a * Math.sqrt(2 / 3)],
    ];
  } else {
    vertices = [
      [0, 0, 0],
      [p.ab, 0, 0],
      [p.cx, p.cy, 0],
      [p.dx, p.dy, p.dz],
    ];
  }
  return buildPolyhedron({
    kind: 'tetrahedron',
    title: regular ? 'Правильный тетраэдр' : 'Тетраэдр',
    params: p,
    vertices,
    labels: ['A', 'B', 'C', 'D'],
    faces: [
      [0, 2, 1], // ABC
      [0, 1, 3], // ABD
      [1, 2, 3], // BCD
      [2, 0, 3], // ACD
    ],
    structure: () => ({ type: 'pyramid', baseFace: 0, apex: 3 }),
  });
}

/* ───────────────────── Платоновы тела (через оболочку) ───────────────────── */

const PHI = (1 + Math.sqrt(5)) / 2;

/** Сортировка вершин: сверху вниз, затем по углу — подписи идут «поясами». */
function sortForLabels(vs: Vec3[]): Vec3[] {
  return [...vs].sort((p, q) => {
    if (Math.abs(p[2] - q[2]) > 1e-9) return q[2] - p[2];
    return Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]);
  });
}

function buildFromHull(
  kind: PolyhedronKind,
  title: string,
  p: PolyhedronParams,
  raw: Vec3[],
  labels: string[],
) {
  const c = centroid(raw);
  const vertices = sortForLabels(raw.map((v) => sub(v, c)));
  const tol = makeTolerance(Math.max(...vertices.map((v) => Math.hypot(v[0], v[1], v[2]))) * 2);
  return buildPolyhedron({
    kind,
    title,
    params: p,
    vertices,
    labels,
    faces: hullFaces(vertices, tol),
    parallelReason: () => CENTRAL_SYMMETRY_REASON,
    edgeParallelReason: antipodalEdgeReason(vertices),
  });
}

function buildOctahedron(p: PolyhedronParams): Polyhedron {
  const r = p.a / Math.SQRT2;
  const eq: Vec3[] = [-135, -45, 45, 135].map((t) => [r * Math.cos(deg(t)), r * Math.sin(deg(t)), 0]);
  // Подписи: E — верх, A..D — экватор, F — низ.
  const vertices: Vec3[] = [[0, 0, r], ...eq, [0, 0, -r]];
  return buildPolyhedron({
    kind: 'octahedron',
    title: 'Правильный октаэдр',
    params: p,
    vertices,
    labels: ['E', 'A', 'B', 'C', 'D', 'F'],
    faces: hullFaces(vertices, makeTolerance(2 * r)),
    parallelReason: () => CENTRAL_SYMMETRY_REASON,
    edgeParallelReason: antipodalEdgeReason(vertices),
  });
}

function buildIcosahedron(p: PolyhedronParams): Polyhedron {
  const raw: Vec3[] = [];
  for (const s1 of [-1, 1])
    for (const s2 of [-1, 1]) {
      raw.push([0, s1, s2 * PHI], [s1, s2 * PHI, 0], [s2 * PHI, 0, s1]);
    }
  // Ставим икосаэдр на вершину: поворачиваем так, чтобы (0, 1, φ) смотрела вверх.
  const rotated = raw.map((v) => rotateToZ(v, [0, 1, PHI]));
  return buildFromHull(
    'icosahedron',
    'Правильный икосаэдр',
    p,
    rotated.map((v) => scale(v, p.a / 2)),
    LETTERS.slice(0, 12),
  );
}

function buildDodecahedron(p: PolyhedronParams): Polyhedron {
  const raw: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) raw.push([x, y, z]);
  for (const s1 of [-1, 1])
    for (const s2 of [-1, 1]) {
      raw.push([0, s1 / PHI, s2 * PHI], [s1 / PHI, s2 * PHI, 0], [s2 * PHI, 0, s1 / PHI]);
    }
  // Ставим додекаэдр на грань: нормаль грани ~ (0, φ, 1) направляем вверх.
  const rotated = raw.map((v) => rotateToZ(v, [0, PHI, 1]));
  return buildFromHull(
    'dodecahedron',
    'Правильный додекаэдр',
    p,
    rotated.map((v) => scale(v, (p.a * PHI) / 2)),
    Array.from({ length: 20 }, (_, i) => 'V' + subscript(i + 1)),
  );
}

/** Поворот, переводящий направление axis в +z (формула Родрига). */
function rotateToZ(v: Vec3, axis: Vec3): Vec3 {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  const a: Vec3 = [axis[0] / l, axis[1] / l, axis[2] / l];
  const k: Vec3 = [a[1], -a[0], 0]; // a × z
  const s = Math.hypot(k[0], k[1]);
  const c = a[2];
  if (s < 1e-12) return c > 0 ? v : [v[0], -v[1], -v[2]];
  const kn: Vec3 = [k[0] / s, k[1] / s, 0];
  const kv: Vec3 = [kn[1] * v[2] - kn[2] * v[1], kn[2] * v[0] - kn[0] * v[2], kn[0] * v[1] - kn[1] * v[0]];
  const kd = kn[0] * v[0] + kn[1] * v[1] + kn[2] * v[2];
  return [
    v[0] * c + kv[0] * s + kn[0] * kd * (1 - c),
    v[1] * c + kv[1] * s + kn[1] * kd * (1 - c),
    v[2] * c + kv[2] * s + kn[2] * kd * (1 - c),
  ];
}

/* ───────────────────────── Каталог ───────────────────────── */

const isIrregularTetra = (p: PolyhedronParams) => p.regular < 0.5;

export const KINDS: readonly KindSpec[] = [
  {
    kind: 'cube',
    title: 'Куб',
    group: 'Призмы и параллелепипеды',
    params: [{ key: 'a', label: 'Ребро a', min: 0.2, max: 20, step: 0.1, default: 4 }],
    build: buildCube,
  },
  {
    kind: 'parallelepiped',
    title: 'Параллелепипед',
    group: 'Призмы и параллелепипеды',
    params: [
      { key: 'a', label: 'AB', min: 0.2, max: 20, step: 0.1, default: 5 },
      { key: 'b', label: 'AD', min: 0.2, max: 20, step: 0.1, default: 3 },
      { key: 'c', label: 'Высота', min: 0.2, max: 20, step: 0.1, default: 3.5 },
      { key: 'angle', label: 'Угол BAD, °', min: 30, max: 150, step: 1, default: 90 },
      { key: 'shiftX', label: 'Наклон по x', min: -5, max: 5, step: 0.1, default: 0 },
      { key: 'shiftY', label: 'Наклон по y', min: -5, max: 5, step: 0.1, default: 0 },
    ],
    build: buildParallelepiped,
  },
  {
    kind: 'prism',
    title: 'Призма',
    group: 'Призмы и параллелепипеды',
    params: [
      { key: 'n', label: 'Сторон основания', min: 3, max: 12, step: 1, default: 3, topological: true },
      { key: 'a', label: 'Сторона основания', min: 0.2, max: 20, step: 0.1, default: 4 },
      { key: 'h', label: 'Высота', min: 0.2, max: 20, step: 0.1, default: 5 },
      { key: 'shiftX', label: 'Наклон по x', min: -5, max: 5, step: 0.1, default: 0 },
      { key: 'shiftY', label: 'Наклон по y', min: -5, max: 5, step: 0.1, default: 0 },
    ],
    build: buildPrism,
  },
  {
    kind: 'pyramid',
    title: 'Пирамида',
    group: 'Пирамиды',
    params: [
      { key: 'n', label: 'Сторон основания', min: 3, max: 12, step: 1, default: 4, topological: true },
      { key: 'a', label: 'Сторона основания', min: 0.2, max: 20, step: 0.1, default: 4 },
      { key: 'h', label: 'Высота', min: 0.2, max: 20, step: 0.1, default: 5 },
      { key: 'apexX', label: 'Смещение вершины x', min: -6, max: 6, step: 0.1, default: 0 },
      { key: 'apexY', label: 'Смещение вершины y', min: -6, max: 6, step: 0.1, default: 0 },
    ],
    build: buildPyramid,
  },
  {
    kind: 'tetrahedron',
    title: 'Тетраэдр',
    group: 'Пирамиды',
    params: [
      { key: 'regular', label: 'Правильный (1/0)', min: 0, max: 1, step: 1, default: 1 },
      {
        key: 'a',
        label: 'Ребро a',
        min: 0.2,
        max: 20,
        step: 0.1,
        default: 4.5,
        visible: (p) => p.regular >= 0.5,
      },
      { key: 'ab', label: 'AB', min: 0.2, max: 20, step: 0.1, default: 5, visible: isIrregularTetra },
      { key: 'cx', label: 'C: x', min: -10, max: 10, step: 0.1, default: 1.5, visible: isIrregularTetra },
      { key: 'cy', label: 'C: y', min: 0.2, max: 10, step: 0.1, default: 4, visible: isIrregularTetra },
      { key: 'dx', label: 'D: x', min: -10, max: 10, step: 0.1, default: 2.5, visible: isIrregularTetra },
      { key: 'dy', label: 'D: y', min: -10, max: 10, step: 0.1, default: 1.5, visible: isIrregularTetra },
      { key: 'dz', label: 'D: высота', min: 0.2, max: 10, step: 0.1, default: 4, visible: isIrregularTetra },
    ],
    build: buildTetrahedron,
  },
  {
    kind: 'octahedron',
    title: 'Октаэдр',
    group: 'Правильные многогранники',
    params: [{ key: 'a', label: 'Ребро a', min: 0.2, max: 20, step: 0.1, default: 4 }],
    build: buildOctahedron,
  },
  {
    kind: 'dodecahedron',
    title: 'Додекаэдр',
    group: 'Правильные многогранники',
    params: [{ key: 'a', label: 'Ребро a', min: 0.2, max: 20, step: 0.1, default: 2.5 }],
    build: buildDodecahedron,
  },
  {
    kind: 'icosahedron',
    title: 'Икосаэдр',
    group: 'Правильные многогранники',
    params: [{ key: 'a', label: 'Ребро a', min: 0.2, max: 20, step: 0.1, default: 3.5 }],
    build: buildIcosahedron,
  },
];

export const kindSpec = (kind: PolyhedronKind): KindSpec => {
  const s = KINDS.find((k) => k.kind === kind);
  if (!s) throw new Error(`Неизвестный тип многогранника: ${kind}`);
  return s;
};

export const defaultParams = (kind: PolyhedronKind): PolyhedronParams =>
  Object.fromEntries(kindSpec(kind).params.map((p) => [p.key, p.default]));

/** Параметры с подставленными значениями по умолчанию и ограничением диапазонов. */
export function normalizeParams(kind: PolyhedronKind, params: PolyhedronParams): PolyhedronParams {
  const out: PolyhedronParams = {};
  for (const ps of kindSpec(kind).params) {
    let v = params[ps.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) v = ps.default;
    v = Math.min(ps.max, Math.max(ps.min, v));
    if (ps.step === 1 && Number.isInteger(ps.min)) v = Math.round(v);
    out[ps.key] = v;
  }
  return out;
}

export const createPolyhedron = (kind: PolyhedronKind, params?: PolyhedronParams): Polyhedron =>
  kindSpec(kind).build(normalizeParams(kind, params ?? {}));

/** Ключ топологии: при его совпадении индексы вершин/рёбер/граней сохраняют смысл. */
export const topologyKey = (poly: Polyhedron): string =>
  `${poly.kind}|${poly.vertices.length}|${poly.faces.map((f) => f.join('.')).join('/')}`;
