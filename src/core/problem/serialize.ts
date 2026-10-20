import { KINDS, normalizeParams } from '../polyhedra/catalog';
import type { PolyhedronKind, PolyhedronParams } from '../polyhedra/types';
import type { DefinedPoint, PointSpec } from '../section/points';

export interface Problem {
  readonly kind: PolyhedronKind;
  readonly params: PolyhedronParams;
  readonly points: readonly DefinedPoint[];
}

interface Serialized {
  v: 1;
  kind: string;
  params: Record<string, number>;
  points: { label: string; spec: PointSpec }[];
}

export function serializeProblem(p: Problem): string {
  const data: Serialized = {
    v: 1,
    kind: p.kind,
    params: { ...p.params },
    points: p.points.map((d) => ({ label: d.label, spec: d.spec })),
  };
  return JSON.stringify(data);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function validSpec(s: unknown): s is PointSpec {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (o.kind === 'vertex') return Number.isInteger(o.vertex);
  if (o.kind === 'edge') return Number.isInteger(o.from) && Number.isInteger(o.to) && isNum(o.t);
  if (o.kind === 'face')
    return Number.isInteger(o.face) && Array.isArray(o.weights) && o.weights.every(isNum);
  return false;
}

/** Разбор сохранённого построения. Некорректные данные отклоняются с понятной ошибкой. */
export function deserializeProblem(
  json: string,
): { ok: true; problem: Problem } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'файл повреждён: это не JSON' };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'неверный формат данных' };
  const d = data as Partial<Serialized>;
  if (d.v !== 1) return { ok: false, error: 'неподдерживаемая версия формата' };
  if (!KINDS.some((k) => k.kind === d.kind))
    return { ok: false, error: `неизвестный тип многогранника «${String(d.kind)}»` };
  const kind = d.kind as PolyhedronKind;
  const params = normalizeParams(kind, d.params && typeof d.params === 'object' ? d.params : {});
  const pts = Array.isArray(d.points) ? d.points : [];
  if (pts.length > 3) return { ok: false, error: 'слишком много точек (нужно не больше трёх)' };
  const points: DefinedPoint[] = [];
  for (const [i, p] of pts.entries()) {
    if (!p || typeof p.label !== 'string' || !validSpec(p.spec))
      return { ok: false, error: `точка №${i + 1} задана некорректно` };
    points.push({ id: `pt${i}-${p.label}`, label: p.label.slice(0, 8), spec: p.spec });
  }
  return { ok: true, problem: { kind, params, points } };
}

/* Base64url для UTF-8 строк (работает в браузере и в Node). */
export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const problemToHash = (p: Problem) => `#s=${toBase64Url(serializeProblem(p))}`;

export function problemFromHash(hash: string): ReturnType<typeof deserializeProblem> | null {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    return deserializeProblem(fromBase64Url(m[1]));
  } catch {
    return { ok: false, error: 'ссылка повреждена' };
  }
}
