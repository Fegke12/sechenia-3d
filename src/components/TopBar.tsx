import { useEffect, useRef, useState } from 'react';
import { EXAMPLES, exampleToProblem, randomProblem } from '../core/problem/examples';
import { deserializeProblem, problemToHash, serializeProblem } from '../core/problem/serialize';
import { useStore } from '../state/store';
import { Icon, Logo } from './icons';

export function TopBar({ onPrint }: { onPrint: () => void }) {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const problem = () => ({ kind: s.kind, params: s.params, points: s.points });

  const share = async () => {
    const url = `${location.origin}${location.pathname}${problemToHash(problem())}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      s.notify('ok', 'Ссылка на построение скопирована в буфер обмена.');
    } catch {
      s.notify('info', 'Ссылка записана в адресную строку — скопируйте её оттуда.');
    }
  };
  const saveFile = () => {
    const blob = new Blob([JSON.stringify(JSON.parse(serializeProblem(problem())), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sechenie-${s.kind}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const openFile = async (f: File) => {
    const r = deserializeProblem(await f.text());
    if (!r.ok) return s.notify('error', `Не удалось открыть файл: ${r.error}.`);
    if (s.mode !== 'solve') s.setMode('solve');
    s.loadProblem(r.problem);
    s.notify('ok', 'Построение загружено из файла.');
  };
  const exportPng = () => {
    const url = window.__scene?.exportPNG();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `sechenie-${s.kind}.png`;
    a.click();
  };
  const random = () => {
    if (s.mode !== 'solve') s.setMode('solve');
    s.loadProblem(randomProblem(Math.random));
    s.notify('info', 'Новая задача: постройте сечение плоскостью через три заданные точки.');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>Сечения 3D</span>
        <small>стереометрия</small>
      </div>
      <div className="seg" role="group" aria-label="Режим">
        <button aria-pressed={s.mode === 'solve'} onClick={() => s.setMode('solve')} data-testid="mode-solve">
          Решить задачу
        </button>
        <button aria-pressed={s.mode === 'learn'} onClick={() => s.setMode('learn')} data-testid="mode-learn">
          <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <Icon name="book" size={14} /> Обучение
          </span>
        </button>
      </div>
      <span className="spacer" />
      <div className="tb-actions">
        <div className="menu-wrap" ref={menuRef}>
          <button
            className="btn ghost"
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
            data-testid="examples-btn"
          >
            <Icon name="list" size={15} /> <span className="txt">Примеры</span>
          </button>
          {menu && (
            <div className="menu" role="menu" data-testid="examples-menu">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  role="menuitem"
                  onClick={() => {
                    if (s.mode !== 'solve') s.setMode('solve');
                    s.loadProblem(exampleToProblem(ex));
                    setMenu(false);
                  }}
                >
                  {ex.title}
                  <small>{ex.description}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="btn ghost"
          onClick={random}
          title="Случайная корректная задача"
          data-testid="random-btn"
        >
          <Icon name="dice" size={15} /> <span className="txt">Случайная задача</span>
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={share}
          title="Поделиться ссылкой"
          aria-label="Поделиться ссылкой"
        >
          <Icon name="share" size={16} />
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={saveFile}
          title="Сохранить в файл"
          aria-label="Сохранить в файл"
        >
          <Icon name="save" size={16} />
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={() => fileRef.current?.click()}
          title="Открыть файл"
          aria-label="Открыть файл"
        >
          <Icon name="open" size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
        <button
          className="btn ghost icon-btn"
          onClick={exportPng}
          title="Сохранить изображение PNG"
          aria-label="Экспорт изображения"
        >
          <Icon name="image" size={16} />
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={onPrint}
          title="Печать решения"
          aria-label="Печать решения"
        >
          <Icon name="print" size={16} />
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={() => s.setHelp(true)}
          title="Справка"
          aria-label="Справка"
          data-testid="help-btn"
        >
          <Icon name="help" size={16} />
        </button>
      </div>
    </header>
  );
}
