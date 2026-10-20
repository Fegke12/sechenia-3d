import { create } from 'zustand';
import type { MarkResult } from '../core/exercises/check';
import type { Vec3 } from '../core/geometry/vec';
import {
  createPolyhedron,
  defaultParams,
  kindSpec,
  normalizeParams,
  topologyKey,
} from '../core/polyhedra/catalog';
import type { PolyhedronKind, PolyhedronParams } from '../core/polyhedra/types';
import type { Problem } from '../core/problem/serialize';
import { nextUserLabel } from '../core/section/labels';
import { type DefinedPoint, type PointSpec, canonicalSpec } from '../core/section/points';
import type { SceneStyle, ViewName } from '../scene/SceneController';

export type Mode = 'solve' | 'learn';
export type InputTab = 'model' | 'conditions';

export interface Notice {
  id: number;
  kind: 'info' | 'error' | 'ok';
  text: string;
}

export interface ExerciseState {
  /** Ученик отмечает вершины сечения на модели. */
  active: boolean;
  marks: Vec3[];
  result: MarkResult | null;
}

export interface AppState {
  mode: Mode;
  kind: PolyhedronKind;
  params: PolyhedronParams;
  points: DefinedPoint[];
  inputTab: InputTab;
  picking: boolean;
  snap: boolean;
  style: SceneStyle;
  /** null — обзор (всё сечение), число — пошаговый режим. */
  stepIndex: number | null;
  onlyCurrentStep: boolean;
  /** «Сначала сам»: сколько шагов раскрыто. */
  selfMode: boolean;
  revealed: number;
  solutionHidden: boolean;
  playing: boolean;
  selectedPointId: string | null;
  lessonId: string | null;
  exercise: ExerciseState;
  quizAnswer: number | null;
  notices: Notice[];
  viewCmd: { name: ViewName | 'reset'; nonce: number } | null;
  helpOpen: boolean;
  bottomOpen: boolean;

  setMode: (m: Mode) => void;
  setKind: (k: PolyhedronKind) => void;
  setParam: (key: string, value: number) => void;
  addPoint: (spec: PointSpec, label?: string) => boolean;
  updatePoint: (id: string, patch: Partial<Pick<DefinedPoint, 'label' | 'spec'>>) => void;
  removePoint: (id: string) => void;
  undoPoint: () => void;
  clearPoints: () => void;
  replacePoints: (pts: { label: string; spec: PointSpec }[]) => void;
  loadProblem: (p: Problem, opts?: { keepLesson?: boolean }) => void;
  setInputTab: (t: InputTab) => void;
  setPicking: (b: boolean) => void;
  setSnap: (b: boolean) => void;
  setStyle: (patch: Partial<SceneStyle>) => void;
  setStep: (i: number | null) => void;
  setOnlyCurrent: (b: boolean) => void;
  setSelfMode: (b: boolean) => void;
  reveal: () => void;
  setSolutionHidden: (b: boolean) => void;
  setPlaying: (b: boolean) => void;
  selectPoint: (id: string | null) => void;
  openLesson: (id: string | null) => void;
  startExercise: () => void;
  stopExercise: () => void;
  addMark: (p: Vec3) => void;
  removeLastMark: () => void;
  setExerciseResult: (r: MarkResult | null) => void;
  setQuizAnswer: (i: number | null) => void;
  notify: (kind: Notice['kind'], text: string) => void;
  dismiss: (id: number) => void;
  view: (name: ViewName | 'reset') => void;
  setHelp: (b: boolean) => void;
  setBottomOpen: (b: boolean) => void;
}

let nid = 1;
let pid = 1;
const newId = () => `pt${pid++}`;

const DEFAULT_STYLE: SceneStyle = {
  faces: true,
  edges: true,
  labels: true,
  points: true,
  plane: true,
  section: true,
  aux: false,
  faceOpacity: 0.16,
};

const resetSolutionView = {
  stepIndex: null,
  revealed: 1,
  playing: false,
  exercise: { active: false, marks: [], result: null },
};

export const useStore = create<AppState>((set, get) => ({
  mode: 'solve',
  kind: 'cube',
  params: defaultParams('cube'),
  points: [],
  inputTab: 'model',
  picking: true,
  snap: true,
  style: DEFAULT_STYLE,
  stepIndex: null,
  onlyCurrentStep: false,
  selfMode: false,
  revealed: 1,
  solutionHidden: false,
  playing: false,
  selectedPointId: null,
  lessonId: null,
  exercise: { active: false, marks: [], result: null },
  quizAnswer: null,
  notices: [],
  viewCmd: null,
  helpOpen: false,
  bottomOpen: true,

  setMode: (mode) => set({ mode, lessonId: mode === 'learn' ? get().lessonId : null, ...resetSolutionView }),

  setKind: (kind) => {
    const { points, kind: old } = get();
    if (kind === old) return;
    set({ kind, params: defaultParams(kind), points: [], selectedPointId: null, ...resetSolutionView });
    if (points.length)
      get().notify(
        'info',
        `Тип фигуры изменён — заданные точки (${points.length}) сброшены, так как у новой фигуры другие вершины и рёбра.`,
      );
  },

  setParam: (key, value) => {
    const { kind, params, points } = get();
    const next = normalizeParams(kind, { ...params, [key]: value });
    const spec = kindSpec(kind).params.find((p) => p.key === key);
    const topoChanged =
      spec?.topological &&
      topologyKey(createPolyhedron(kind, params)) !== topologyKey(createPolyhedron(kind, next));
    if (topoChanged && points.length) {
      set({ params: next, points: [], selectedPointId: null, ...resetSolutionView });
      get().notify('info', 'Изменилось число вершин — заданные точки сброшены.');
    } else set({ params: next, stepIndex: get().stepIndex === null ? null : 0 });
  },

  addPoint: (spec0, label) => {
    const { points, kind, params } = get();
    if (points.length >= 3) {
      get().notify(
        'error',
        'Плоскость уже задана тремя точками. Удалите одну из точек, чтобы выбрать другую.',
      );
      return false;
    }
    const spec = canonicalSpec(spec0);
    const poly = createPolyhedron(kind, params);
    const taken = [...poly.labels, ...points.map((p) => p.label)];
    const lab = spec.kind === 'vertex' ? poly.labels[spec.vertex] : (label ?? nextUserLabel(taken));
    if (points.some((p) => p.label === lab)) {
      get().notify('error', `Точка ${lab} уже задана.`);
      return false;
    }
    set({ points: [...points, { id: newId(), label: lab, spec }], ...resetSolutionView });
    return true;
  },
  updatePoint: (id, patch) =>
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...patch, spec: patch.spec ?? p.spec } : p)),
      stepIndex: s.stepIndex === null ? null : 0,
    })),
  removePoint: (id) =>
    set((s) => ({
      points: s.points.filter((p) => p.id !== id),
      selectedPointId: null,
      ...resetSolutionView,
    })),
  undoPoint: () => set((s) => ({ points: s.points.slice(0, -1), ...resetSolutionView })),
  clearPoints: () => set({ points: [], selectedPointId: null, ...resetSolutionView }),
  replacePoints: (pts) =>
    set({
      points: pts.map((p) => ({ id: newId(), label: p.label, spec: canonicalSpec(p.spec) })),
      ...resetSolutionView,
    }),
  loadProblem: (p, opts) =>
    set((s) => ({
      kind: p.kind,
      params: normalizeParams(p.kind, p.params),
      points: p.points.map((d) => ({ ...d, id: newId() })),
      selectedPointId: null,
      lessonId: opts?.keepLesson ? s.lessonId : s.mode === 'learn' ? s.lessonId : null,
      ...resetSolutionView,
      viewCmd: { name: 'iso', nonce: Date.now() },
    })),
  setInputTab: (inputTab) => set({ inputTab }),
  setPicking: (picking) => set({ picking }),
  setSnap: (snap) => set({ snap }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  setStep: (stepIndex) => set({ stepIndex, playing: stepIndex === null ? false : get().playing }),
  setOnlyCurrent: (onlyCurrentStep) => set({ onlyCurrentStep }),
  setSelfMode: (selfMode) => set({ selfMode, revealed: 1, stepIndex: selfMode ? 0 : get().stepIndex }),
  reveal: () => set((s) => ({ revealed: s.revealed + 1 })),
  setSolutionHidden: (solutionHidden) =>
    set({ solutionHidden, stepIndex: solutionHidden ? null : get().stepIndex, playing: false }),
  setPlaying: (playing) => set({ playing }),
  selectPoint: (selectedPointId) => set({ selectedPointId }),
  openLesson: (lessonId) => set({ lessonId, quizAnswer: null, ...resetSolutionView }),
  startExercise: () =>
    set({ exercise: { active: true, marks: [], result: null }, stepIndex: null, picking: false }),
  stopExercise: () => set({ exercise: { active: false, marks: [], result: null } }),
  addMark: (p) =>
    set((s) => ({ exercise: { ...s.exercise, marks: [...s.exercise.marks, p], result: null } })),
  removeLastMark: () =>
    set((s) => ({ exercise: { ...s.exercise, marks: s.exercise.marks.slice(0, -1), result: null } })),
  setExerciseResult: (result) => set((s) => ({ exercise: { ...s.exercise, result } })),
  setQuizAnswer: (quizAnswer) => set({ quizAnswer }),
  notify: (kind, text) => {
    const id = nid++;
    set((s) => ({ notices: [...s.notices.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 4500);
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  view: (name) => set({ viewCmd: { name, nonce: Date.now() } }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
}));
