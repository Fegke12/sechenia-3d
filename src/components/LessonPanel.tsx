import { checkMarkedVertices } from '../core/exercises/check';
import { LESSONS } from '../lessons/lessons';
import { modelToProblem } from '../lessons/toProblem';
import { useDerived } from '../state/derived';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { ExerciseControls } from './RightPanel';
import { Rich } from './SolutionPanel';

export function LessonPanel() {
  const s = useStore();
  const lesson = LESSONS.find((l) => l.id === s.lessonId) ?? null;
  const { poly, solution } = useDerived();

  const open = (id: string) => {
    const l = LESSONS.find((x) => x.id === id)!;
    s.openLesson(id);
    s.loadProblem(modelToProblem(l.demo), { keepLesson: true });
  };
  const demo = () => {
    if (!lesson) return;
    s.loadProblem(modelToProblem(lesson.demo), { keepLesson: true });
    s.setStep(0);
    s.setBottomOpen(true);
  };
  const startMark = () => {
    if (!lesson || lesson.exercise.type !== 'mark') return;
    s.loadProblem(modelToProblem(lesson.exercise.model), { keepLesson: true });
    s.startExercise();
  };
  const idx = lesson ? LESSONS.indexOf(lesson) : -1;

  return (
    <aside className="left panel" aria-label="Обучение">
      <section className="block">
        <h3>Уроки</h3>
        <ol className="lesson-list" data-testid="lesson-list">
          {LESSONS.map((l, i) => (
            <li key={l.id}>
              <button aria-current={l.id === s.lessonId} onClick={() => open(l.id)}>
                <span className="n">{i + 1}</span>
                <span>{l.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      {lesson ? (
        <>
          <section className="block theory" data-testid="lesson-theory">
            <div className="block-head">
              Урок {idx + 1} · теория <span className="spacer" />
            </div>
            <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>{lesson.title}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Цель: {lesson.goal}
            </p>
            {lesson.theory.map((t, i) => (
              <p key={i}>
                <Rich text={t} />
              </p>
            ))}
          </section>
          <section className="block">
            <h3>Демонстрация</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {lesson.demo.caption}
            </p>
            <button className="btn" onClick={demo} data-testid="lesson-demo">
              <Icon name="play" size={14} /> Показать построение по шагам
            </button>
          </section>
          <section className="block" data-testid="lesson-exercise">
            <h3>Упражнение</h3>
            {lesson.exercise.type === 'quiz' ? (
              <Quiz key={lesson.id} />
            ) : (
              <>
                <p style={{ marginTop: 0 }}>{lesson.exercise.prompt}</p>
                {!s.exercise.active ? (
                  <button className="btn primary" onClick={startMark} data-testid="lesson-start-mark">
                    <Icon name="target" size={14} /> Начать упражнение
                  </button>
                ) : (
                  <ExerciseControls
                    onCheck={() => {
                      if (solution.section && solution.construction)
                        s.setExerciseResult(
                          checkMarkedVertices(
                            poly,
                            solution.section,
                            solution.construction.sectionLabels,
                            s.exercise.marks,
                          ),
                        );
                    }}
                    onStop={s.stopExercise}
                  />
                )}
                <details style={{ marginTop: 8 }}>
                  <summary className="hint" style={{ cursor: 'pointer' }}>
                    Подсказка
                  </summary>
                  <p className="hint">{lesson.exercise.hint}</p>
                </details>
              </>
            )}
          </section>
          <section className="block row">
            <button className="btn sm" disabled={idx <= 0} onClick={() => open(LESSONS[idx - 1].id)}>
              <Icon name="prev" size={14} /> Предыдущий
            </button>
            <span className="spacer" />
            <button
              className="btn sm"
              disabled={idx >= LESSONS.length - 1}
              onClick={() => open(LESSONS[idx + 1].id)}
              data-testid="next-lesson"
            >
              Следующий <Icon name="next" size={14} />
            </button>
          </section>
        </>
      ) : (
        <section className="block">
          <p className="hint">
            Выберите урок. Курс идёт от простого к сложному: элементы многогранника → секущая плоскость →
            следы → призмы и пирамиды → особые случаи.
          </p>
        </section>
      )}
    </aside>
  );
}

function Quiz() {
  const s = useStore();
  const lesson = LESSONS.find((l) => l.id === s.lessonId)!;
  if (lesson.exercise.type !== 'quiz') return null;
  const ex = lesson.exercise;
  const ans = s.quizAnswer;
  return (
    <div>
      <p style={{ marginTop: 0 }}>{ex.question}</p>
      <div className="quiz" role="radiogroup">
        {ex.options.map((o, i) => (
          <button
            key={i}
            role="radio"
            aria-checked={ans === i}
            className={ans === null ? '' : o.correct ? 'right' : ans === i ? 'wrong' : ''}
            onClick={() => s.setQuizAnswer(i)}
            data-testid={`quiz-${i}`}
          >
            {o.text}
          </button>
        ))}
      </div>
      {ans !== null && (
        <div
          className={ex.options[ans].correct ? 'okmsg' : 'err'}
          style={{ marginTop: 8 }}
          data-testid="quiz-feedback"
        >
          {ex.options[ans].correct ? 'Верно. ' : 'Неверно. '}
          {ex.options[ans].explanation}
        </div>
      )}
      {ans !== null && !ex.options[ans].correct && (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => s.setQuizAnswer(null)}>
          Попробовать ещё раз
        </button>
      )}
      <details style={{ marginTop: 8 }}>
        <summary className="hint" style={{ cursor: 'pointer' }}>
          Подсказка
        </summary>
        <p className="hint">{ex.hint}</p>
      </details>
    </div>
  );
}
