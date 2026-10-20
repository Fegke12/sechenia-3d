import { signedDistance } from '../geometry/plane';
import { cross, dot, length, sub } from '../geometry/vec';
import type { Polyhedron } from './types';

/**
 * Проверка корректности модели многогранника. Возвращает список проблем (пустой — модель корректна).
 * Проверяются: ссылки, повторы вершин в гранях, плоскостность, ориентация (каждое направленное ребро
 * ровно один раз), замкнутость (каждое ребро — ровно две грани), выпуклость, невырожденность, Эйлер.
 */
export function validatePolyhedron(poly: Polyhedron): string[] {
  const issues: string[] = [];
  const nV = poly.vertices.length;
  const { tol } = poly;
  if (poly.labels.length !== nV) issues.push('число подписей не совпадает с числом вершин');
  if (new Set(poly.labels).size !== poly.labels.length) issues.push('подписи вершин повторяются');
  poly.vertices.forEach((v, i) => {
    if (!v.every(Number.isFinite)) issues.push(`вершина ${i} имеет некорректные координаты`);
  });
  for (let i = 0; i < nV; i++)
    for (let j = i + 1; j < nV; j++)
      if (length(sub(poly.vertices[i], poly.vertices[j])) <= tol.merge)
        issues.push(`вершины ${poly.labels[i]} и ${poly.labels[j]} совпадают`);

  const directed = new Set<string>();
  poly.faces.forEach((f, fi) => {
    if (f.length < 3) issues.push(`грань ${fi} имеет меньше трёх вершин`);
    if (new Set(f).size !== f.length) issues.push(`в грани ${fi} повторяются вершины`);
    for (const v of f)
      if (v < 0 || v >= nV) issues.push(`грань ${fi} ссылается на несуществующую вершину ${v}`);
    const plane = poly.facePlanes[fi];
    for (const v of f)
      if (Math.abs(signedDistance(plane, poly.vertices[v])) > tol.dist * 100)
        issues.push(`грань ${poly.faceNames[fi]} неплоская`);
    // Строгая выпуклость грани: все повороты в одну сторону относительно внешней нормали.
    for (let i = 0; i < f.length; i++) {
      const a = poly.vertices[f[i]];
      const b = poly.vertices[f[(i + 1) % f.length]];
      const c = poly.vertices[f[(i + 2) % f.length]];
      if (dot(cross(sub(b, a), sub(c, b)), plane.normal) <= tol.dist * tol.scale * 1e-3)
        issues.push(`грань ${poly.faceNames[fi]} невыпукла или ориентирована неверно`);
    }
    for (let i = 0; i < f.length; i++) {
      const key = `${f[i]}>${f[(i + 1) % f.length]}`;
      if (directed.has(key))
        issues.push(`направленное ребро ${key} встречается дважды — ориентация несогласована`);
      directed.add(key);
    }
    // Выпуклость тела: все вершины не снаружи плоскости грани.
    poly.vertices.forEach((v, vi) => {
      if (signedDistance(plane, v) > tol.dist * 100)
        issues.push(`вершина ${poly.labels[vi]} лежит снаружи грани ${poly.faceNames[fi]} — тело невыпукло`);
    });
  });

  poly.edges.forEach(([a, b], ei) => {
    if (a >= b) issues.push(`ребро ${ei} неупорядочено`);
    if (!directed.has(`${a}>${b}`) || !directed.has(`${b}>${a}`))
      issues.push(`ребро ${poly.edgeNames[ei]} не замкнуто`);
    const [f1, f2] = poly.edgeFaces[ei];
    if (f1 < 0 || f2 < 0) issues.push(`ребро ${poly.edgeNames[ei]} принадлежит не двум граням`);
  });
  const counts = new Map<string, number>();
  poly.faces.forEach((f) => {
    for (let i = 0; i < f.length; i++) {
      const a = Math.min(f[i], f[(i + 1) % f.length]);
      const b = Math.max(f[i], f[(i + 1) % f.length]);
      counts.set(`${a}-${b}`, (counts.get(`${a}-${b}`) ?? 0) + 1);
    }
  });
  for (const [k, c] of counts) if (c !== 2) issues.push(`ребро ${k} принадлежит ${c} граням`);

  const V = nV;
  const E = poly.edges.length;
  const F = poly.faces.length;
  if (V - E + F !== 2) issues.push(`нарушена формула Эйлера: V − E + F = ${V - E + F}`);

  // Невырожденность: объём > 0 (по формуле дивергенции).
  let vol = 0;
  for (const f of poly.faces) {
    const a = poly.vertices[f[0]];
    for (let i = 1; i + 1 < f.length; i++) {
      vol += dot(a, cross(poly.vertices[f[i]], poly.vertices[f[i + 1]])) / 6;
    }
  }
  if (!(vol > tol.scale ** 3 * 1e-9))
    issues.push('многогранник вырожден (нулевой объём) или грани ориентированы внутрь');
  return issues;
}

export function polyhedronVolume(poly: Polyhedron): number {
  let vol = 0;
  for (const f of poly.faces) {
    const a = poly.vertices[f[0]];
    for (let i = 1; i + 1 < f.length; i++)
      vol += dot(a, cross(poly.vertices[f[i]], poly.vertices[f[i + 1]])) / 6;
  }
  return vol;
}
