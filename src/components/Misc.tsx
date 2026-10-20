import { useEffect } from 'react';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';

export function Notices() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.kind}`} data-testid={`notice-${n.kind}`}>
          <span>{n.text}</span>
          <button onClick={() => dismiss(n.id)} aria-label="Закрыть">
            <Icon name="cross" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function HelpModal() {
  const open = useStore((s) => s.helpOpen);
  const setHelp = useStore((s) => s.setHelp);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setHelp]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setHelp(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Справка"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Как пользоваться</h2>
        <h4>1. Фигура</h4>
        <p>
          Выберите многогранник слева и настройте размеры. Вращение — левая кнопка мыши, масштаб — колесо,
          перемещение — правая кнопка (на сенсорном экране — один и два пальца). Кнопки «3D / Спереди / Сверху
          / Сбоку» ставят стандартный вид.
        </p>
        <h4>2. Три точки</h4>
        <p>
          Вкладка «На модели»: включите «Выбор точек» и щёлкните по вершине, ребру или грани. Вкладка «Условия
          задачи»: запишите условие привычным образом, например «M ∈ AB, AM : MB = 2 : 1», «N — середина SC»,
          «K = D». Точку на ребре можно двигать ползунком — сечение пересчитывается сразу.
        </p>
        <h4>3. Сечение и проверка</h4>
        <p>
          Как только задана третья точка, приложение вычисляет плоскость и пересечение с каждым ребром и
          гранью. Правая панель показывает уравнение плоскости, вершины, стороны, площадь и результат
          независимых проверок. Непроверенный результат не показывается как достоверный.
        </p>
        <h4>4. Ход решения</h4>
        <p>
          Внизу — школьное построение по шагам: что делаем, почему (аксиома или теорема) и что получилось.
          Модель подсвечивает текущие точки, прямые и грани. Стрелки ← → переключают шаги; «Воспроизвести»
          показывает решение автоматически; «сначала сам» открывает шаг только после вашей попытки.
        </p>
        <h4>Обозначения</h4>
        <ul>
          <li>
            <b style={{ color: 'var(--accent)' }}>голубые</b> — заданные точки;{' '}
            <b style={{ color: 'var(--section)' }}>оранжевые</b> — вершины и стороны сечения;
          </li>
          <li>
            <b style={{ color: 'var(--aux)' }}>фиолетовые пунктирные</b> — следы и вспомогательные точки вне
            многогранника; <b style={{ color: 'var(--parallel)' }}>зелёные</b> — параллельные прямые;
          </li>
          <li>серый пунктир — невидимые рёбра и продолжения рёбер.</li>
        </ul>
        <h4>Горячие клавиши</h4>
        <p className="mono">← → — шаги решения · Ctrl+Z — отменить последнюю точку · Esc — закрыть окно</p>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => setHelp(false)}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

/** Версия для печати: изображение модели и все шаги решения. */
export function PrintView({ image }: { image: string | null }) {
  const { poly, solution } = useDerived();
  const c = solution.construction;
  return (
    <div className="print-only">
      <h1>Сечение: {poly.title}</h1>
      <p>Условие: {solution.points.map((p) => p.text).join('; ') || '—'}</p>
      {image && <img src={image} alt="Модель" />}
      {c && solution.trusted ? (
        c.steps.map((st) => (
          <div className="pstep" key={st.index}>
            <h3>
              Шаг {st.index + 1}. {st.title}
            </h3>
            <div>{st.action}</div>
            <ol>
              {st.justification.map((j, i) => (
                <li key={i}>{j}</li>
              ))}
            </ol>
            <div>⇒ {st.result}</div>
          </div>
        ))
      ) : (
        <p>Решение не построено.</p>
      )}
    </div>
  );
}
