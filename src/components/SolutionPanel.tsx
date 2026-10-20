import { useEffect } from 'react';
import type { Step } from '../core/construction/types';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';

const RULE_NAMES: Record<Step['rule'], string> = {
  plane: 'аксиома',
  connect: 'след в грани',
  intersect: 'пересечение прямых',
  parallel: 'параллельность',
  projection: 'внутреннее проектирование',
  coordinate: 'координатный метод',
  side: 'сторона сечения',
  final: 'итог',
  degenerate: 'особый случай',
};

/** Текст со **жирным**. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

export function SolutionPanel() {
  const s = useStore();
  const { solution } = useDerived();
  const c = solution.construction;
  const steps = c?.steps ?? [];
  const n = steps.length;
  const idx = s.stepIndex;
  const exerciseHides = s.exercise.active && !s.exercise.result;
  const available = !!c && solution.trusted && !exerciseHides;

  // Автовоспроизведение.
  useEffect(() => {
    if (!s.playing || !available) return;
    const id = window.setInterval(() => {
      const st = useStore.getState();
      const cur = st.stepIndex ?? -1;
      if (cur >= n - 1) st.setPlaying(false);
      else {
        st.setStep(cur + 1);
        if (st.selfMode && st.revealed <= cur + 1) st.reveal();
      }
    }, 2200);
    return () => window.clearInterval(id);
  }, [s.playing, available, n]);

  // Клавиатура: ← → по шагам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const st = useStore.getState();
      if (!available || st.solutionHidden) return;
      if (e.key === 'ArrowRight') st.setStep(Math.min(n - 1, (st.stepIndex ?? -1) + 1));
      if (e.key === 'ArrowLeft') st.setStep(Math.max(0, (st.stepIndex ?? 1) - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, n]);

  const cur = idx !== null && n ? steps[Math.min(idx, n - 1)] : null;
  const locked = (i: number) => s.selfMode && i >= s.revealed;

  return (
    <section className="bottom" aria-label="Ход решения" data-testid="solution-panel">
      <div className="sol-head">
        <button
          className="btn sm ghost icon-btn"
          aria-label={s.bottomOpen ? 'Свернуть' : 'Развернуть'}
          onClick={() => s.setBottomOpen(!s.bottomOpen)}
        >
          <Icon name={s.bottomOpen ? 'chevronDown' : 'chevronUp'} size={15} />
        </button>
        <h2>Ход решения</h2>
        {available && !s.solutionHidden && n > 0 && (
          <>
            <button
              className="btn sm"
              aria-pressed={idx === null}
              onClick={() => s.setStep(null)}
              data-testid="overview"
            >
              Обзор
            </button>
            <button
              className="btn sm icon-btn"
              aria-label="Предыдущий шаг"
              disabled={idx === null || idx <= 0}
              onClick={() => s.setStep(Math.max(0, (idx ?? 1) - 1))}
            >
              <Icon name="prev" size={15} />
            </button>
            <span className="mono" style={{ minWidth: 54, textAlign: 'center' }} data-testid="step-counter">
              {idx === null ? `— / ${n}` : `${idx + 1} / ${n}`}
            </span>
            <button
              className="btn sm icon-btn"
              aria-label="Следующий шаг"
              data-testid="next-step"
              disabled={idx !== null && idx >= n - 1}
              onClick={() => s.setStep(idx === null ? 0 : Math.min(n - 1, idx + 1))}
            >
              <Icon name="next" size={15} />
            </button>
            <button
              className="btn sm"
              onClick={() =>
                s.playing
                  ? s.setPlaying(false)
                  : (s.setStep(idx === null || idx >= n - 1 ? 0 : idx), s.setPlaying(true))
              }
              data-testid="play"
            >
              <Icon name={s.playing ? 'pause' : 'play'} size={14} /> {s.playing ? 'Пауза' : 'Воспроизвести'}
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={s.onlyCurrentStep}
                onChange={(e) => s.setOnlyCurrent(e.target.checked)}
              />{' '}
              только текущий шаг
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={s.selfMode}
                onChange={(e) => s.setSelfMode(e.target.checked)}
                data-testid="self-mode"
              />{' '}
              сначала сам
            </label>
          </>
        )}
        <span className="spacer" />
        {c && (
          <label className="check">
            <input
              type="checkbox"
              checked={s.solutionHidden}
              onChange={(e) => s.setSolutionHidden(e.target.checked)}
              data-testid="hide-solution"
            />{' '}
            скрыть решение
          </label>
        )}
      </div>
      {s.bottomOpen && (
        <div className="sol-body">
          {!c ? (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              {solution.planeStatus === 'need-points'
                ? 'Задайте три точки — здесь появится пошаговое построение с обоснованием.'
                : solution.message || 'Нет решения.'}
            </div>
          ) : !available ? (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              {exerciseHides
                ? 'Решение скрыто, пока вы выполняете упражнение.'
                : 'Решение не прошло проверку и не показывается как достоверное.'}
            </div>
          ) : s.solutionHidden ? (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              Решение скрыто. Попробуйте построить сечение сами, затем снимите галочку «скрыть решение».
            </div>
          ) : (
            <>
              <nav className="sol-list" aria-label="Шаги">
                {steps.map((st, i) => (
                  <button
                    key={i}
                    className={`sol-item ${locked(i) ? 'locked' : ''}`}
                    aria-current={idx === i}
                    onClick={() => s.setStep(i)}
                    data-testid={`step-${i}`}
                  >
                    <span className="n">{i + 1}.</span>
                    <span>{locked(i) ? 'Шаг скрыт — выполните его сами' : st.title}</span>
                  </button>
                ))}
              </nav>
              <div className="sol-detail" data-testid="step-detail">
                {cur === null ? (
                  <Overview />
                ) : locked(cur.index) ? (
                  <div className="self-box">
                    <div className="rule">
                      шаг {cur.index + 1} · {RULE_NAMES[cur.rule]}
                    </div>
                    <h3>Попробуйте сами</h3>
                    <p className="action">{cur.prompt}</p>
                    <p className="hint">
                      Сделайте построение на бумаге или мысленно, затем откройте правильный шаг.
                    </p>
                    <button className="btn primary sm" onClick={s.reveal} data-testid="reveal">
                      Показать шаг {cur.index + 1}
                    </button>
                  </div>
                ) : (
                  <StepView step={cur} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function StepView({ step }: { step: Step }) {
  return (
    <div>
      <div className="rule">
        шаг {step.index + 1} · {RULE_NAMES[step.rule]}
      </div>
      <h3>{step.title}</h3>
      <p className="action">{step.action}</p>
      <div className="hint" style={{ marginBottom: 4 }}>
        Обоснование:
      </div>
      <ol>
        {step.justification.map((j, i) => (
          <li key={i}>{j}</li>
        ))}
      </ol>
      {step.uses.length > 0 && <div className="uses">Используем: {step.uses.join(' · ')}</div>}
      <div className="res">⇒ {step.result}</div>
    </div>
  );
}

function Overview() {
  const { solution } = useDerived();
  const c = solution.construction!;
  const rules = [...new Set(c.steps.map((s) => RULE_NAMES[s.rule]))].filter(
    (r) => r !== 'итог' && r !== 'аксиома',
  );
  return (
    <div>
      <div className="rule">обзор</div>
      <h3>
        {c.steps.length} шагов · сечение {c.polygonName}
      </h3>
      <p className="action">
        Используемые приёмы: {rules.join(', ') || '—'}. Нажмите «следующий шаг» или выберите шаг слева —
        модель покажет построение по шагам; стрелки ← → на клавиатуре тоже работают.
      </p>
      <p className="hint">Включите «сначала сам», чтобы каждый шаг открывался только после вашей попытки.</p>
    </div>
  );
}
