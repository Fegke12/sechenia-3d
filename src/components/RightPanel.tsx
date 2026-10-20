import { useMemo } from 'react';
import { polygonTypeName } from '../core/construction/buildConstruction';
import { checkMarkedVertices } from '../core/exercises/check';
import { type Vec3, cross, distance, fmt, fmtVec, sinAngle, sub } from '../core/geometry/vec';
import type { Polyhedron } from '../core/polyhedra/types';
import type { Section } from '../core/section/computeSection';
import { ratioOf } from '../core/section/points';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function RightPanel() {
  return (
    <aside className="right panel" aria-label="Результат">
      <PlaneBlock />
      <ResultBlock />
      <ChecksBlock />
      <SelfCheckBlock />
    </aside>
  );
}

function PlaneBlock() {
  const { solution } = useDerived();
  const labels = solution.points.slice(0, 3).map((p) => p.point.label);
  const pl = solution.plane;
  let eq = '';
  if (pl) {
    const n = pl.normal;
    const k = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]));
    const c = [n[0] / k, n[1] / k, n[2] / k, pl.d / k];
    const term = (v: number, s: string, first: boolean) => {
      if (Math.abs(v) < 1e-12) return '';
      const sign = v < 0 ? '− ' : first ? '' : '+ ';
      const a = Math.abs(v);
      return `${sign}${Math.abs(a - 1) < 1e-12 && s ? '' : fmt(a, 4)}${s} `;
    };
    let first = true;
    for (const [v, s] of [
      [c[0], 'x'],
      [c[1], 'y'],
      [c[2], 'z'],
      [c[3], ''],
    ] as const) {
      const t = term(v, s, first);
      if (t) {
        eq += t;
        first = false;
      }
    }
    eq += '= 0';
  }
  return (
    <section className="block">
      <h3>Секущая плоскость</h3>
      {labels.length === 3 ? (
        <div style={{ fontSize: 15, marginBottom: 6 }}>
          α ={' '}
          <span className="mono" style={{ color: 'var(--accent)' }}>
            ({labels.join('')})
          </span>
        </div>
      ) : (
        <div className="hint">Задана {labels.length} из 3 точек.</div>
      )}
      {pl && (
        <>
          <div className="eq" data-testid="plane-eq">
            {eq}
          </div>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>нормаль n̂</dt>
            <dd>{fmtVec(pl.normal, 3)}</dd>
          </dl>
        </>
      )}
      {solution.planeStatus !== 'ok' && solution.planeStatus !== 'need-points' && (
        <div className="err" style={{ marginTop: 8 }} data-testid="plane-error">
          {solution.message}
        </div>
      )}
      {solution.illConditioned && (
        <div className="warn" style={{ marginTop: 8 }}>
          {solution.message}
        </div>
      )}
    </section>
  );
}

function ResultBlock() {
  const { poly, solution } = useDerived();
  const hidden = useStore((s) => s.solutionHidden || (s.exercise.active && !s.exercise.result));
  const sec = solution.section;
  const c = solution.construction;
  const kind = useMemo(() => (sec ? shapeKind(sec) : ''), [sec]);
  if (!sec || !c) return null;
  if (hidden)
    return (
      <section className="block">
        <h3>Результат</h3>
        <div className="hint">Готовое сечение скрыто — попробуйте построить его самостоятельно.</div>
      </section>
    );
  const m = solution.measures!;
  const n = sec.vertices.length;
  const title =
    sec.status === 'polygon'
      ? polygonTypeName(n)
      : sec.status === 'face'
        ? `грань ${poly.faceNames[sec.touchFace!]} (вырожденный случай)`
        : sec.status === 'segment'
          ? 'отрезок (касание по ребру)'
          : sec.status === 'point'
            ? 'точка (касание в вершине)'
            : sec.status === 'empty'
              ? 'пусто'
              : 'ошибка';
  const faces = [...new Set(sec.sides.flatMap((s) => s.faces))];
  return (
    <section className="block" data-testid="result">
      <h3>Сечение</h3>
      <div className="result-name">
        <span className="poly">{c.polygonName}</span> — <span data-testid="result-type">{title}</span>
      </div>
      {kind && <div className="hint">по вычислениям: {kind}</div>}
      <dl className="kv" style={{ margin: '8px 0' }}>
        <dt>площадь</dt>
        <dd data-testid="result-area">{fmt(m.area, 4)}</dd>
        <dt>периметр</dt>
        <dd>{fmt(m.perimeter, 4)}</dd>
      </dl>
      <table className="vt" aria-label="Вершины сечения">
        <thead>
          <tr>
            <th />
            <th>где</th>
            <th style={{ textAlign: 'right' }}>координаты</th>
          </tr>
        </thead>
        <tbody>
          {sec.vertices.map((v, i) => (
            <tr key={v.key}>
              <td className="lb">{c.sectionLabels[i]}</td>
              <td>{originText(poly, v.origin, c.sectionLabels[i])}</td>
              <td className="num">{fmtVec(v.pos, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sec.sides.length > 1 && (
        <table className="vt" style={{ marginTop: 8 }} aria-label="Стороны сечения">
          <thead>
            <tr>
              <th>сторона</th>
              <th>в грани</th>
              <th style={{ textAlign: 'right' }}>длина</th>
            </tr>
          </thead>
          <tbody>
            {sec.sides.map((s, i) => (
              <tr key={i}>
                <td className="lb">
                  {c.sectionLabels[s.a]}
                  {c.sectionLabels[s.b]}
                </td>
                <td>{s.faces.map((f) => poly.faceNames[f]).join(', ')}</td>
                <td className="num">{fmt(m.sideLengths[i], 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        Грани, участвующие в построении: {faces.map((f) => poly.faceNames[f]).join(', ') || '—'}
      </div>
    </section>
  );
}

function ChecksBlock() {
  const { solution } = useDerived();
  const hidden = useStore((s) => s.solutionHidden || (s.exercise.active && !s.exercise.result));
  const v = solution.validation;
  if (!v || hidden) return null;
  return (
    <section className="block">
      <div className="block-head">
        Проверка корректности <span className="spacer" />
        {solution.trusted ? (
          <span className="badge ok" data-testid="trusted">
            <Icon name="check" size={13} /> достоверно
          </span>
        ) : (
          <span className="badge bad" data-testid="untrusted">
            <Icon name="cross" size={13} /> не пройдено
          </span>
        )}
      </div>
      <ul className="checks">
        {v.checks.map((c) => (
          <li key={c.id}>
            <span style={{ color: c.passed ? 'var(--ok)' : 'var(--danger)' }}>
              <Icon name={c.passed ? 'check' : 'cross'} size={14} />
            </span>
            <span>{c.title}</span>
            <span className="det">{c.detail}</span>
          </li>
        ))}
        {solution.construction && (
          <li>
            <span style={{ color: solution.constructionIssues.length ? 'var(--danger)' : 'var(--ok)' }}>
              <Icon name={solution.constructionIssues.length ? 'cross' : 'check'} size={14} />
            </span>
            <span>Каждое утверждение школьного решения подтверждено вычислением</span>
            <span className="det">
              {solution.constructionIssues.length
                ? solution.constructionIssues.slice(0, 3).join('; ')
                : `${solution.construction.steps.reduce((s, st) => s + st.claims.length, 0)} утверждений`}
            </span>
          </li>
        )}
      </ul>
      {solution.construction?.usedCoordinateMethod && (
        <div className="warn" style={{ marginTop: 8 }}>
          Часть вершин найдена координатным методом: для этой конфигурации классическое построение не
          подобрано автоматически.
        </div>
      )}
      {!solution.trusted && (
        <div className="err" style={{ marginTop: 8 }}>
          Результат не прошёл проверку и не показан на модели как достоверный.
        </div>
      )}
    </section>
  );
}

function SelfCheckBlock() {
  const s = useStore();
  const { poly, solution } = useDerived();
  const sec = solution.section;
  if (s.mode !== 'solve' || !sec || sec.status !== 'polygon' || !solution.construction) return null;
  const ex = s.exercise;
  const check = () =>
    s.setExerciseResult(checkMarkedVertices(poly, sec, solution.construction!.sectionLabels, ex.marks));
  return (
    <section className="block">
      <h3>Проверить себя</h3>
      {!ex.active ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Сечение скроется — отметьте его вершины на рёбрах модели, затем сравните с правильным построением.
          </p>
          <button className="btn" onClick={s.startExercise} data-testid="start-selfcheck">
            <Icon name="target" size={14} /> Найти вершины самостоятельно
          </button>
        </>
      ) : (
        <ExerciseControls onCheck={check} onStop={s.stopExercise} />
      )}
    </section>
  );
}

export function ExerciseControls({ onCheck, onStop }: { onCheck: () => void; onStop: () => void }) {
  const ex = useStore((s) => s.exercise);
  const removeLast = useStore((s) => s.removeLastMark);
  const r = ex.result;
  return (
    <div>
      <div className="row">
        <span className="hint">Отмечено: {ex.marks.length}</span>
      </div>
      <div className="row">
        <button
          className="btn primary sm"
          onClick={onCheck}
          disabled={!ex.marks.length}
          data-testid="check-marks"
        >
          Проверить
        </button>
        <button className="btn sm" onClick={removeLast} disabled={!ex.marks.length}>
          <Icon name="undo" size={14} /> Убрать отметку
        </button>
        <button className="btn sm ghost" onClick={onStop}>
          Завершить
        </button>
      </div>
      {r && (
        <div style={{ marginTop: 8 }} data-testid="marks-result">
          <div className={r.ok ? 'okmsg' : 'err'}>{r.summary}</div>
          {r.wrong.length > 0 && (
            <ul className="wrong-list">
              {r.wrong.map((w, i) => (
                <li key={i}>{w.explanation}</li>
              ))}
            </ul>
          )}
          {r.missing.length > 0 && !r.ok && (
            <div className="hint" style={{ marginTop: 6 }}>
              Не найдено вершин: {r.missing.length}. Правильное сечение теперь показано на модели.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function originText(poly: Polyhedron, o: Section['vertices'][number]['origin'], label: string): string {
  if (o.type === 'vertex') return 'вершина';
  const [a, b] = poly.edges[o.edge];
  const r = ratioOf(o.t);
  const A = poly.labels[a];
  const B = poly.labels[b];
  if (r) return r.p === r.q ? `середина ${A}${B}` : `${A}${label} : ${label}${B} = ${r.p} : ${r.q}`;
  return `${A}${B}, t = ${fmt(o.t, 3)}`;
}

/** Вид многоугольника по вычислениям (для справки, не как доказанный факт). */
function shapeKind(sec: Section): string {
  if (sec.status !== 'polygon' && sec.status !== 'face') return '';
  const V = sec.vertices.map((v) => v.pos);
  const n = V.length;
  const len = (i: number) => distance(V[i], V[(i + 1) % n]);
  const dir = (i: number): Vec3 => sub(V[(i + 1) % n], V[i]);
  const par = (i: number, j: number) => sinAngle(dir(i), dir(j)) < 1e-9;
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9 * Math.max(x, y);
  const right = (i: number) => {
    const u = dir(i);
    const w = dir((i + 1) % n);
    return Math.abs(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) < 1e-9 * Math.hypot(...u) * Math.hypot(...w);
  };
  if (n === 3) {
    const [a, b, c] = [len(0), len(1), len(2)];
    if (eq(a, b) && eq(b, c)) return 'правильный треугольник';
    const rt = [0, 1, 2].some(right);
    if (eq(a, b) || eq(b, c) || eq(a, c))
      return rt ? 'равнобедренный прямоугольный треугольник' : 'равнобедренный треугольник';
    return rt ? 'прямоугольный треугольник' : '';
  }
  if (n === 4) {
    const p1 = par(0, 2);
    const p2 = par(1, 3);
    if (p1 && p2) {
      const rhomb = eq(len(0), len(1));
      const rect = right(0);
      return rect && rhomb ? 'квадрат' : rect ? 'прямоугольник' : rhomb ? 'ромб' : 'параллелограмм';
    }
    if (p1 || p2) {
      const iso = p1 ? eq(len(1), len(3)) : eq(len(0), len(2));
      return iso ? 'равнобедренная трапеция' : 'трапеция';
    }
    return '';
  }
  const allEq = Array.from({ length: n }, (_, i) => len(i)).every((l) => eq(l, len(0)));
  if (allEq && n === 6) {
    const angEq = Array.from({ length: n }, (_, i) => Math.hypot(...cross(dir(i), dir((i + 1) % n)))).every(
      (x, _i, arr) => Math.abs(x - arr[0]) < 1e-9 * arr[0],
    );
    if (angEq) return 'правильный шестиугольник';
  }
  return allEq ? 'равносторонний многоугольник' : '';
}
