import { useEffect, useMemo, useState } from 'react';
import { fmtVec } from '../core/geometry/vec';
import { KINDS, kindSpec } from '../core/polyhedra/catalog';
import type { PolyhedronKind } from '../core/polyhedra/types';
import { parseProblemText } from '../core/problem/parse';
import { nextUserLabel } from '../core/section/labels';
import { type PointSpec, describeSpec, placeOf, ratioOf } from '../core/section/points';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function LeftPanel() {
  return (
    <aside className="left panel" aria-label="Фигура и точки">
      <FigureBlock />
      <PointsBlock />
      <VerticesBlock />
    </aside>
  );
}

function FigureBlock() {
  const kind = useStore((s) => s.kind);
  const params = useStore((s) => s.params);
  const setKind = useStore((s) => s.setKind);
  const setParam = useStore((s) => s.setParam);
  const { poly } = useDerived();
  const spec = kindSpec(kind);
  const groups = [...new Set(KINDS.map((k) => k.group))];
  return (
    <section className="block">
      <h3>Многогранник</h3>
      <select
        aria-label="Тип многогранника"
        data-testid="kind-select"
        value={kind}
        onChange={(e) => setKind(e.target.value as PolyhedronKind)}
        style={{ width: '100%', marginBottom: 6 }}
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {KINDS.filter((k) => k.group === g).map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="hint" style={{ marginBottom: 10 }} data-testid="poly-title">
        {poly.title} · В {poly.vertices.length}, Р {poly.edges.length}, Г {poly.faces.length}
      </div>
      {spec.params
        .filter((p) => !p.visible || p.visible(params))
        .map((p) =>
          p.key === 'regular' ? (
            <label key={p.key} className="check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={params.regular >= 0.5}
                onChange={(e) => setParam('regular', e.target.checked ? 1 : 0)}
              />
              Правильный тетраэдр
            </label>
          ) : p.key === 'n' ? (
            <div className="field" key={p.key}>
              <label htmlFor="param-n">{p.label}</label>
              <select
                id="param-n"
                value={params.n}
                onChange={(e) => setParam('n', Number(e.target.value))}
                style={{ width: 74 }}
              >
                {Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field" key={p.key}>
              <label htmlFor={`param-${p.key}`}>{p.label}</label>
              <input
                type="number"
                id={`param-${p.key}`}
                min={p.min}
                max={p.max}
                step={p.step}
                value={Number(params[p.key].toFixed(4))}
                onChange={(e) => e.target.value !== '' && setParam(p.key, Number(e.target.value))}
              />
              <input
                type="range"
                aria-label={p.label}
                min={p.min}
                max={p.max}
                step={p.step}
                value={params[p.key]}
                onChange={(e) => setParam(p.key, Number(e.target.value))}
              />
            </div>
          ),
        )}
    </section>
  );
}

function PointsBlock() {
  const s = useStore();
  const { solution } = useDerived();
  const n = s.points.length;
  return (
    <section className="block">
      <div className="block-head">
        Точки секущей плоскости <span className="spacer" />
        <span
          className="mono"
          style={{ color: n === 3 ? 'var(--accent)' : 'var(--muted)' }}
          data-testid="points-count"
        >
          {n}/3
        </span>
      </div>
      <div className="need" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < n ? 'on' : ''} />
        ))}
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={s.inputTab === 'model'} onClick={() => s.setInputTab('model')}>
          На модели
        </button>
        <button
          role="tab"
          aria-selected={s.inputTab === 'conditions'}
          onClick={() => s.setInputTab('conditions')}
          data-testid="tab-conditions"
        >
          Условия задачи
        </button>
      </div>
      {s.inputTab === 'model' ? (
        <div>
          <div className="row">
            <button
              className="btn"
              aria-pressed={s.picking}
              onClick={() => s.setPicking(!s.picking)}
              data-testid="toggle-picking"
            >
              <Icon name="pointer" size={14} /> Выбор точек
            </button>
            <label className="check">
              <input type="checkbox" checked={s.snap} onChange={(e) => s.setSnap(e.target.checked)} />{' '}
              Привязка к долям
            </label>
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            {n < 3
              ? 'Щёлкните по вершине, ребру или грани. Привязка ставит точку в середину, треть, четверть ребра.'
              : 'Плоскость задана. Чтобы выбрать другую точку, удалите одну из текущих.'}
          </p>
        </div>
      ) : (
        <ConditionsEditor />
      )}
      <div style={{ marginTop: 10 }} data-testid="points-list">
        {solution.points.map((rp) => (
          <PointCard key={rp.point.id} id={rp.point.id} />
        ))}
        {n === 0 && <div className="hint">Точек пока нет.</div>}
      </div>
      <div className="row">
        <button className="btn sm" onClick={s.undoPoint} disabled={!n} title="Ctrl+Z">
          <Icon name="undo" size={14} /> Отменить
        </button>
        <button className="btn sm danger" onClick={s.clearPoints} disabled={!n}>
          <Icon name="trash" size={14} /> Сбросить
        </button>
      </div>
    </section>
  );
}

function PointCard({ id }: { id: string }) {
  const { poly, solution } = useDerived();
  const rp = solution.points.find((p) => p.point.id === id)!;
  const selected = useStore((s) => s.selectedPointId === id);
  const select = useStore((s) => s.selectPoint);
  const update = useStore((s) => s.updatePoint);
  const remove = useStore((s) => s.removePoint);
  const spec = rp.point.spec;
  return (
    <div
      className={`pt ${selected ? 'selected' : ''}`}
      onClick={() => select(id)}
      data-testid={`point-${rp.point.label}`}
    >
      <div className="pt-head">
        <span className="pt-label">{rp.point.label}</span>
        <span className="pt-text">{rp.text}</span>
        <button
          className="btn ghost icon-btn"
          aria-label={`Удалить точку ${rp.point.label}`}
          onClick={(e) => (e.stopPropagation(), remove(id))}
        >
          <Icon name="cross" size={14} />
        </button>
      </div>
      <div className="pt-meta">
        <span>{placeOf(poly, spec)}</span>
        {rp.pos && <span className="mono">{fmtVec(rp.pos, 3)}</span>}
      </div>
      {rp.error && (
        <div className="err" style={{ marginTop: 6 }}>
          {rp.error}
        </div>
      )}
      {spec.kind === 'edge' && (
        <div className="pt-slider">
          <span className="mono">t</span>
          <input
            type="range"
            min={0.01}
            max={0.99}
            step={0.01}
            value={spec.t}
            aria-label={`Положение точки ${rp.point.label} на ребре`}
            onChange={(e) => update(id, { spec: { ...spec, t: Number(e.target.value) } })}
          />
          <span className="mono" style={{ minWidth: 42, textAlign: 'right' }}>
            {(() => {
              const r = ratioOf(spec.t);
              return r ? `${r.p}:${r.q}` : spec.t.toFixed(2);
            })()}
          </span>
        </div>
      )}
    </div>
  );
}

function ConditionsEditor() {
  const { poly } = useDerived();
  const points = useStore((s) => s.points);
  const replacePoints = useStore((s) => s.replacePoints);
  const addPoint = useStore((s) => s.addPoint);
  const notify = useStore((s) => s.notify);
  const current = useMemo(
    () => points.map((p) => describeSpec(poly, p.label, p.spec)).join('\n'),
    [points, poly],
  );
  const [text, setText] = useState(current);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => setText(current), [current]);

  const apply = () => {
    const r = parseProblemText(text, poly, points);
    if (r.errors.length) {
      setErrors(r.errors.map((e) => (e.line ? `Строка ${e.line}: ${e.error}` : e.error)));
      return;
    }
    setErrors([]);
    replacePoints(r.points);
    notify('ok', `Условие принято: ${r.points.length} ${r.points.length === 1 ? 'точка' : 'точки'}.`);
  };

  return (
    <div>
      <textarea
        aria-label="Условие задачи"
        data-testid="conditions-text"
        value={text}
        spellCheck={false}
        placeholder={'M ∈ AB, AM : MB = 2 : 1\nN — середина BC\nK ∈ CC₁, t = 0.25'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
        }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn primary sm" onClick={apply} data-testid="apply-conditions">
          Применить условие
        </button>
        <span className="hint">Ctrl+Enter</span>
      </div>
      {errors.length > 0 && (
        <div className="errors" data-testid="conditions-errors">
          {errors.map((e, i) => (
            <div key={i} className="err">
              {e}
            </div>
          ))}
        </div>
      )}
      <details style={{ marginTop: 10 }}>
        <summary className="hint" style={{ cursor: 'pointer' }}>
          Подсказка по записи
        </summary>
        <div className="hint mono" style={{ marginTop: 6, lineHeight: 1.7 }}>
          M ∈ AB, AM : MB = 2 : 1<br />
          M ∈ AB, AM : AB = 0.25
          <br />
          M ∈ AB, t = 0.4 (от A)
          <br />
          N — середина SC
          <br />
          K = D (вершина)
          <br />K — центр грани ABB₁A₁
        </div>
      </details>
      <PointForm
        onAdd={(spec, label) => addPoint(spec, label)}
        disabled={points.length >= 3}
        taken={[...poly.labels, ...points.map((p) => p.label)]}
      />
    </div>
  );
}

/** Структурная форма: выбор вершины/ребра/грани без набора текста. */
function PointForm({
  onAdd,
  disabled,
  taken,
}: {
  onAdd: (spec: PointSpec, label?: string) => void;
  disabled: boolean;
  taken: string[];
}) {
  const { poly } = useDerived();
  const [type, setType] = useState<'edge' | 'vertex' | 'face'>('edge');
  const [vertex, setVertex] = useState(0);
  const [edge, setEdge] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [face, setFace] = useState(0);
  const [method, setMethod] = useState<'mid' | 'ratio' | 't'>('mid');
  const [p, setP] = useState(1);
  const [q, setQ] = useState(2);
  const [t, setT] = useState(0.5);
  const label = nextUserLabel(taken);
  const e = poly.edges[Math.min(edge, poly.edges.length - 1)];
  const [a, b] = reverse ? [e[1], e[0]] : [e[0], e[1]];
  const A = poly.labels[a];
  const B = poly.labels[b];

  const submit = () => {
    if (type === 'vertex') return onAdd({ kind: 'vertex', vertex });
    if (type === 'face') {
      const k = poly.faces[face].length;
      return onAdd({ kind: 'face', face, weights: Array(k).fill(1 / k) }, label);
    }
    const tt = method === 'mid' ? 0.5 : method === 'ratio' ? p / (p + q) : t;
    if (!(tt > 0 && tt < 1)) return;
    onAdd({ kind: 'edge', from: a, to: b, t: tt }, label);
  };

  return (
    <fieldset
      style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 10, padding: '8px 10px' }}
      disabled={disabled}
    >
      <legend className="hint" style={{ padding: '0 4px' }}>
        Добавить точку{' '}
        {type !== 'vertex' && (
          <b className="mono" style={{ color: 'var(--accent)' }}>
            {label}
          </b>
        )}
      </legend>
      <div className="row">
        <select
          value={type}
          onChange={(ev) => setType(ev.target.value as typeof type)}
          aria-label="Где лежит точка"
        >
          <option value="edge">на ребре</option>
          <option value="vertex">вершина</option>
          <option value="face">центр грани</option>
        </select>
        {type === 'vertex' && (
          <select value={vertex} onChange={(ev) => setVertex(Number(ev.target.value))} aria-label="Вершина">
            {poly.labels.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        )}
        {type === 'face' && (
          <select value={face} onChange={(ev) => setFace(Number(ev.target.value))} aria-label="Грань">
            {poly.faceNames.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        )}
        {type === 'edge' && (
          <>
            <select
              value={edge}
              onChange={(ev) => setEdge(Number(ev.target.value))}
              aria-label="Ребро"
              data-testid="form-edge"
            >
              {poly.edgeNames.map((l, i) => (
                <option key={i} value={i}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              type="button"
              onClick={() => setReverse(!reverse)}
              title="Поменять начало отсчёта"
            >
              от {A}
            </button>
          </>
        )}
      </div>
      {type === 'edge' && (
        <div className="row">
          <select
            value={method}
            onChange={(ev) => setMethod(ev.target.value as typeof method)}
            aria-label="Способ задания"
          >
            <option value="mid">середина</option>
            <option value="ratio">отношение</option>
            <option value="t">параметр t</option>
          </select>
          {method === 'ratio' && (
            <span className="mono" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {A}
              {label} : {label}
              {B} =
              <input
                type="number"
                min={0}
                step={1}
                value={p}
                onChange={(ev) => setP(Math.max(0, Number(ev.target.value)))}
                style={{ width: 48 }}
                aria-label="p"
              />
              :
              <input
                type="number"
                min={0}
                step={1}
                value={q}
                onChange={(ev) => setQ(Math.max(0, Number(ev.target.value)))}
                style={{ width: 48 }}
                aria-label="q"
              />
            </span>
          )}
          {method === 't' && (
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={t}
              onChange={(ev) => setT(Number(ev.target.value))}
              style={{ width: 70 }}
              aria-label="t"
            />
          )}
        </div>
      )}
      <div className="row">
        <button className="btn sm" type="button" onClick={submit} data-testid="form-add">
          <Icon name="plus" size={14} /> Добавить
        </button>
      </div>
    </fieldset>
  );
}

function VerticesBlock() {
  const { poly } = useDerived();
  return (
    <section className="block">
      <details>
        <summary className="block-head" style={{ cursor: 'pointer', margin: 0 }}>
          Вершины и координаты
        </summary>
        <table className="vt" style={{ marginTop: 8 }}>
          <tbody>
            {poly.vertices.map((v, i) => (
              <tr key={i}>
                <td className="lb" style={{ color: 'var(--text)' }}>
                  {poly.labels[i]}
                </td>
                <td className="num">{fmtVec(v, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
