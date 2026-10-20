import { useEffect, useMemo, useRef, useState } from 'react';
import { constructionSnapshot } from '../core/construction/buildConstruction';
import { fmtVec } from '../core/geometry/vec';
import type { PickCandidate } from '../scene/picking';
import { type ConstructionDraw, type Mark, SceneController } from '../scene/SceneController';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';

declare global {
  interface Window {
    /** Доступ к сцене для браузерных тестов и экспорта. */
    __scene?: SceneController;
    /** Доступ к состоянию приложения для браузерных тестов (только чтение). */
    __store?: typeof useStore;
  }
}

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<SceneController | null>(null);
  const { poly, solution } = useDerived();
  const s = useStore();
  const [hover, setHover] = useState<{ c: PickCandidate; x: number; y: number } | null>(null);
  const [legend, setLegend] = useState(true);
  const [glError, setGlError] = useState<string | null>(null);
  const polyRef = useRef(poly);
  polyRef.current = poly;

  const pickMode: 'off' | 'points' | 'marks' = s.exercise.active
    ? 'marks'
    : s.picking && s.mode === 'solve' && s.points.length < 3
      ? 'points'
      : 'off';

  // Обработчики — через ref, чтобы сцену не пересоздавать.
  const handlers = useRef({
    pick: (_c: PickCandidate) => {},
    hover: (_c: PickCandidate | null, _x: number, _y: number) => {},
  });
  handlers.current.pick = (c) => {
    const st = useStore.getState();
    if (st.exercise.active) {
      if (c.kind === 'face') return;
      st.addMark(c.pos);
      return;
    }
    if (st.addPoint(c.spec)) setHover(null);
  };
  handlers.current.hover = (c, x, y) => setHover(c ? { c, x, y } : null);

  useEffect(() => {
    window.__store = useStore;
    let c: SceneController;
    try {
      c = new SceneController(host.current!, {
        onPick: (p) => handlers.current.pick(p),
        onHover: (p, x, y) => handlers.current.hover(p, x, y),
      });
    } catch (e) {
      // Без WebGL сцена невозможна, но решение, проверки и уроки продолжают работать.
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    ctl.current = c;
    window.__scene = c;
    // Сцена создана после первого рендера — применяем текущее состояние.
    c.setPolyhedron(polyRef.current);
    return () => {
      c.dispose();
      ctl.current = null;
      delete window.__scene;
    };
  }, []);

  useEffect(() => ctl.current?.setPolyhedron(poly), [poly]);
  useEffect(() => ctl.current?.setStyle(s.style), [s.style]);
  useEffect(() => ctl.current?.setPicking(pickMode, s.snap), [pickMode, s.snap]);
  useEffect(() => {
    if (s.viewCmd) ctl.current?.setView(s.viewCmd.name === 'reset' ? 'iso' : s.viewCmd.name);
  }, [s.viewCmd]);

  const construction = solution.construction;
  const stepMode = s.stepIndex !== null && !!construction && !s.solutionHidden && !s.exercise.active;
  const hideAnswer = s.exercise.active && !s.exercise.result;
  const lastStep = construction ? construction.steps.length - 1 : 0;
  const visibleStep = stepMode
    ? s.selfMode
      ? Math.min(s.stepIndex!, s.revealed - 1)
      : s.stepIndex!
    : lastStep;
  const isFinal = !stepMode || visibleStep >= lastStep;

  useEffect(() => {
    const pts = solution.points
      .filter((p) => p.pos)
      .map((p) => ({
        id: p.point.id,
        label: p.point.label,
        pos: p.pos!,
        selected: p.point.id === s.selectedPointId,
      }));
    ctl.current?.setDefinedPoints(pts);
  }, [solution, s.selectedPointId]);

  useEffect(() => {
    const sec = solution.section;
    const ext = sec ? sec.vertices.map((v) => v.pos) : [];
    ctl.current?.setPlane(hideAnswer ? null : solution.plane, ext);
    const showSection = !hideAnswer && !s.solutionHidden;
    ctl.current?.setSection(
      showSection && sec && solution.trusted ? sec : null,
      construction?.sectionLabels ?? [],
      {
        fill: isFinal,
        showLabels: true,
      },
    );
  }, [solution, construction, isFinal, hideAnswer, s.solutionHidden]);

  const draw: ConstructionDraw | null = useMemo(() => {
    if (
      !construction ||
      !solution.trusted ||
      hideAnswer ||
      s.solutionHidden ||
      construction.steps.length === 0
    )
      return null;
    const snap = constructionSnapshot(construction, visibleStep);
    if (!stepMode) {
      if (!s.style.aux) return null;
      return {
        points: snap.points,
        lines: snap.lines.filter((l) => l.line.kind !== 'side'),
        highlight: { faces: [], edges: [], points: [], lines: [] },
        onlyCurrent: false,
      };
    }
    return {
      points: snap.points,
      lines: snap.lines,
      highlight: snap.current.highlight,
      onlyCurrent: s.onlyCurrentStep,
    };
  }, [
    construction,
    solution.trusted,
    hideAnswer,
    s.solutionHidden,
    visibleStep,
    stepMode,
    s.onlyCurrentStep,
    s.style.aux,
  ]);
  useEffect(() => ctl.current?.setConstruction(draw), [draw]);

  const marks: Mark[] = useMemo(() => {
    const r = s.exercise.result;
    return s.exercise.marks.map((pos) => ({
      pos,
      state: !r ? 'new' : r.wrong.some((w) => w.pos === pos) ? 'bad' : 'ok',
    }));
  }, [s.exercise]);
  useEffect(() => ctl.current?.setMarks(marks), [marks]);

  const status = statusLine(s, solution, pickMode);

  return (
    <div className="center">
      <div className="viewport" ref={host} data-testid="viewport" />
      {glError && (
        <div className="empty" role="alert" style={{ position: 'absolute', inset: '30% 10% auto' }}>
          Не удалось запустить 3D-графику (WebGL недоступен в этом браузере). Решение, проверки и уроки
          работают, но модель не отображается. Попробуйте другой браузер или включите аппаратное ускорение.
        </div>
      )}
      <div className="vp-toolbar">
        <div className="vp-group" role="group" aria-label="Стандартные виды">
          <button className="btn" onClick={() => s.view('iso')} title="Аксонометрия">
            3D
          </button>
          <button className="btn" onClick={() => s.view('front')} title="Вид спереди">
            Спереди
          </button>
          <button className="btn" onClick={() => s.view('top')} title="Вид сверху">
            Сверху
          </button>
          <button className="btn" onClick={() => s.view('side')} title="Вид сбоку">
            Сбоку
          </button>
          <button
            className="btn"
            onClick={() => s.view('reset')}
            title="Сбросить камеру"
            aria-label="Сбросить камеру"
          >
            <Icon name="reset" size={15} />
          </button>
        </div>
        <div className="vp-group" role="group" aria-label="Камера">
          <button className="btn" aria-label="Повернуть влево" onClick={() => ctl.current?.orbit(-20)}>
            <Icon name="rotate" size={15} style={{ transform: 'scaleX(-1)' }} />
          </button>
          <button className="btn" aria-label="Повернуть вправо" onClick={() => ctl.current?.orbit(20)}>
            <Icon name="rotate" size={15} />
          </button>
          <button className="btn" aria-label="Приблизить" onClick={() => ctl.current?.zoom(0.85)}>
            <Icon name="plus" size={15} />
          </button>
          <button className="btn" aria-label="Отдалить" onClick={() => ctl.current?.zoom(1.18)}>
            <Icon name="minus" size={15} />
          </button>
        </div>
        <div className="vp-group" role="group" aria-label="Видимость">
          {(
            [
              ['faces', 'Грани'],
              ['edges', 'Рёбра'],
              ['labels', 'Подписи'],
              ['points', 'Точки'],
              ['plane', 'Плоскость'],
              ['section', 'Сечение'],
              ['aux', 'Построения'],
            ] as const
          ).map(([k, t]) => (
            <button
              key={k}
              className="btn"
              aria-pressed={s.style[k]}
              onClick={() => s.setStyle({ [k]: !s.style[k] })}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="vp-group" role="group" aria-label="Прозрачность граней" title="Прозрачность граней">
          <button className="btn" aria-pressed={legend} onClick={() => setLegend(!legend)}>
            Легенда
          </button>
          <input
            type="range"
            min={0.04}
            max={0.9}
            step={0.02}
            value={s.style.faceOpacity}
            aria-label="Непрозрачность граней"
            onChange={(e) => s.setStyle({ faceOpacity: Number(e.target.value) })}
            style={{ width: 90, margin: '0 6px' }}
          />
        </div>
      </div>

      {legend && (
        <div className="legend" aria-label="Легенда">
          <div>
            <i style={{ borderColor: '#d7dde6' }} />
            видимое ребро
          </div>
          <div>
            <i className="dash" style={{ borderColor: '#7b8594' }} />
            невидимое ребро
          </div>
          <div>
            <i className="dot" style={{ background: '#38d6f5' }} />
            заданная точка
          </div>
          <div>
            <i style={{ borderColor: '#f2a93b', borderTopWidth: 3 }} />
            сечение
          </div>
          <div>
            <i className="dash" style={{ borderColor: '#b48cff' }} />
            след / вспомогательная
          </div>
          <div>
            <i className="dash" style={{ borderColor: '#4fd1a5' }} />
            параллельная прямая
          </div>
          <div>
            <i style={{ borderColor: '#6e8bff' }} />
            секущая плоскость
          </div>
        </div>
      )}

      {status && (
        <div className={`vp-status ${status.kind}`} data-testid="vp-status" role="status">
          {status.text}
        </div>
      )}
      {hover && pickMode !== 'off' && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.c.description} · {fmtVec(hover.c.pos, 2)}
        </div>
      )}
    </div>
  );
}

function statusLine(
  s: ReturnType<typeof useStore.getState>,
  sol: ReturnType<typeof useDerived>['solution'],
  pickMode: string,
): { kind: string; text: string } | null {
  if (s.exercise.active)
    return {
      kind: '',
      text: `Отмечайте вершины сечения на рёбрах модели · отмечено: ${s.exercise.marks.length}`,
    };
  if (sol.planeStatus === 'need-points') {
    const k = 3 - s.points.length;
    if (s.mode === 'learn') return null;
    return {
      kind: '',
      text:
        pickMode === 'points'
          ? `Выберите на модели ещё ${k} ${k === 1 ? 'точку' : 'точки'}: вершину, точку ребра или грани`
          : sol.message,
    };
  }
  if (sol.planeStatus !== 'ok') return { kind: 'error', text: sol.message };
  if (sol.section?.status === 'error')
    return { kind: 'error', text: 'Ошибка алгоритма: результат не показан как достоверный' };
  if (!sol.trusted) return { kind: 'error', text: 'Проверка результата не пройдена — см. правую панель' };
  if (sol.illConditioned) return { kind: 'error', text: sol.message };
  return null;
}
