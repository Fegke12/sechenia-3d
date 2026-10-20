import { useEffect, useState } from 'react';
import { HelpModal, Notices, PrintView } from './components/Misc';
import { LeftPanel } from './components/LeftPanel';
import { LessonPanel } from './components/LessonPanel';
import { RightPanel } from './components/RightPanel';
import { SolutionPanel } from './components/SolutionPanel';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { EXAMPLES, exampleToProblem } from './core/problem/examples';
import { problemFromHash, problemToHash } from './core/problem/serialize';
import { DerivedContext, useComputeDerived } from './state/derived';
import { useStore } from './state/store';

export default function App() {
  const derived = useComputeDerived();
  const mode = useStore((s) => s.mode);
  const [mtab, setMtab] = useState<'left' | 'center' | 'right'>('center');
  const [printImage, setPrintImage] = useState<string | null>(null);

  // Восстановление построения из ссылки или стартовый пример.
  useEffect(() => {
    const st = useStore.getState();
    const r = problemFromHash(location.hash);
    if (r?.ok) st.loadProblem(r.problem);
    else {
      if (r && !r.ok) st.notify('error', `Не удалось восстановить построение из ссылки: ${r.error}.`);
      st.loadProblem(exampleToProblem(EXAMPLES.find((e) => e.id === 'cube-pentagon')!));
    }
  }, []);

  // Текущее построение всегда отражено в адресе страницы.
  const kind = useStore((s) => s.kind);
  const params = useStore((s) => s.params);
  const points = useStore((s) => s.points);
  useEffect(() => {
    const id = window.setTimeout(
      () => history.replaceState(null, '', problemToHash({ kind, params, points })),
      250,
    );
    return () => window.clearTimeout(id);
  }, [kind, params, points]);

  // Ctrl+Z — отменить последнюю точку.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useStore.getState().undoPoint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const print = () => {
    setPrintImage(window.__scene?.exportPNG() ?? null);
    setTimeout(() => window.print(), 80);
  };

  return (
    <DerivedContext.Provider value={derived}>
      <div className="app" data-mtab={mtab}>
        <TopBar onPrint={print} />
        <div className="mobile-tabs" role="tablist">
          {(
            [
              ['left', mode === 'learn' ? 'Урок' : 'Задача'],
              ['center', 'Модель'],
              ['right', 'Результат'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={mtab === k} onClick={() => setMtab(k)}>
              {t}
            </button>
          ))}
        </div>
        {mode === 'solve' ? <LeftPanel /> : <LessonPanel />}
        <Viewport />
        <RightPanel />
        <SolutionPanel />
      </div>
      <Notices />
      <HelpModal />
      <PrintView image={printImage} />
    </DerivedContext.Provider>
  );
}
