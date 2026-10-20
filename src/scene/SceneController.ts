import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { CLine, CPoint } from '../core/construction/types';
import { type Plane, planeBasis, projectToPlane } from '../core/geometry/plane';
import { type Vec3, add, bounds, distance, normalize, scale, sub } from '../core/geometry/vec';
import type { Polyhedron } from '../core/polyhedra/types';
import type { Section } from '../core/section/computeSection';
import { toThree } from './coords';
import { type PickCandidate, pick } from './picking';

export const COLORS = {
  face: 0x5aa9c9,
  faceHighlight: 0x3fd0f0,
  edge: 0xd7dde6,
  edgeHidden: 0x7b8594,
  edgeHighlight: 0x3fd0f0,
  vertex: 0xc9d1dc,
  defined: 0x38d6f5,
  section: 0xf2a93b,
  sectionFill: 0xf2a93b,
  aux: 0xb48cff,
  parallel: 0x4fd1a5,
  projection: 0x8f9bb3,
  plane: 0x6e8bff,
  markOk: 0x4fd18b,
  markBad: 0xff6b6b,
  markNew: 0xffffff,
  hover: 0xffffff,
} as const;

export type ViewName = 'iso' | 'front' | 'top' | 'side';

export interface SceneStyle {
  faces: boolean;
  edges: boolean;
  labels: boolean;
  points: boolean;
  plane: boolean;
  section: boolean;
  aux: boolean;
  faceOpacity: number;
}

export interface DrawnPoint {
  id: string;
  label: string;
  pos: Vec3;
  selected?: boolean;
}

export interface ConstructionDraw {
  points: readonly CPoint[];
  lines: readonly { line: CLine; from: Vec3; to: Vec3 }[];
  highlight: {
    faces: readonly number[];
    edges: readonly number[];
    points: readonly string[];
    lines: readonly string[];
  };
  /** Показывать только текущий шаг (остальное — приглушённо). */
  onlyCurrent: boolean;
}

export interface Mark {
  pos: Vec3;
  state: 'new' | 'ok' | 'bad';
}

export interface SceneCallbacks {
  onHover: (c: PickCandidate | null, x: number, y: number) => void;
  onPick: (c: PickCandidate) => void;
}

type Disposable = { dispose: () => void };

const VIEW_DIRS: Record<ViewName, Vec3> = {
  iso: [0.62, -1.5, 0.82],
  front: [0, -1, 0.0001],
  top: [0, -0.0001, 1],
  side: [1, 0, 0.0001],
};

/**
 * Императивная 3D-сцена. Каждый метод set* перестраивает только свою группу объектов
 * и освобождает ресурсы старой (геометрии, материалы, DOM-подписи).
 */
export class SceneController {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private model = new THREE.Group();
  private groups: Record<string, THREE.Group> = {};
  private lineMaterials = new Set<LineMaterial>();
  private raf = 0;
  private resizeObs: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private poly: Polyhedron | null = null;
  private faceMesh: THREE.Mesh | null = null;
  private style: SceneStyle = {
    faces: true,
    edges: true,
    labels: true,
    points: true,
    plane: true,
    section: true,
    aux: true,
    faceOpacity: 0.18,
  };
  private picking: 'off' | 'points' | 'marks' = 'off';
  private snap = true;
  private pointerDown: { x: number; y: number } | null = null;
  private pulse: THREE.Object3D[] = [];
  private tween: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
  private lastFitKey = '';
  private width = 1;
  private height = 1;
  private cb: SceneCallbacks;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    cb: SceneCallbacks,
  ) {
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('data-testid', 'scene-canvas');
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('start', () => (this.tween = null));

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1);
    dl.position.set(3, 6, 5);
    this.camera.add(dl);
    this.scene.add(this.camera);
    this.scene.add(this.model);
    for (const g of [
      'depth',
      'faces',
      'edges',
      'vertices',
      'labels',
      'plane',
      'section',
      'construction',
      'highlight',
      'points',
      'marks',
      'hover',
    ])
      this.model.add((this.groups[g] = new THREE.Group()));

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  /* ───────────────────────── публичный API ───────────────────────── */

  setPolyhedron(poly: Polyhedron) {
    this.poly = poly;
    // Центрируем по габаритам (не по центроиду вершин — иначе высокая пирамида уходит за кадр).
    const bb = bounds(poly.vertices);
    const c = toThree([
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    ]);
    this.model.position.copy(c).multiplyScalar(-1);
    this.model.updateMatrixWorld(true);
    this.rebuildPolyhedron();
    const key = `${poly.kind}|${poly.vertices.length}|${poly.tol.scale.toFixed(3)}`;
    if (key !== this.lastFitKey) {
      const first = this.lastFitKey === '';
      this.lastFitKey = key;
      this.setView('iso', !first);
    }
  }

  setStyle(style: SceneStyle) {
    const rebuild =
      style.faceOpacity !== this.style.faceOpacity ||
      style.faces !== this.style.faces ||
      style.edges !== this.style.edges;
    this.style = style;
    if (rebuild) this.rebuildPolyhedron();
    this.groups.labels.visible = style.labels;
    this.groups.plane.visible = style.plane;
    this.groups.points.visible = style.points;
    this.groups.section.visible = style.section;
  }

  setPicking(mode: 'off' | 'points' | 'marks', snap: boolean) {
    this.picking = mode;
    this.snap = snap;
    this.renderer.domElement.style.cursor = mode === 'off' ? 'grab' : 'crosshair';
    if (mode === 'off') this.clear('hover');
  }

  setDefinedPoints(points: readonly DrawnPoint[]) {
    const g = this.clear('points');
    if (!this.poly) return;
    const r = this.poly.tol.scale * 0.013;
    for (const p of points) {
      const m = this.sphere(p.pos, r * (p.selected ? 1.45 : 1.1), COLORS.defined, 20);
      g.add(m);
      g.add(this.ring(p.pos, r * 2.1, COLORS.defined));
      g.add(this.label(p.pos, p.label, 'lbl lbl-defined', 0.05));
    }
  }

  setPlane(plane: Plane | null, extentPoints: readonly Vec3[] = []) {
    const g = this.clear('plane');
    if (!plane || !this.poly) return;
    const { u, v } = planeBasis(plane);
    const c = projectToPlane(plane, this.poly.center);
    const L = this.poly.tol.scale;
    let half = 0.62 * L;
    for (const p of extentPoints) half = Math.max(half, distance(p, c) * 1.15);
    const corners = [
      add(c, add(scale(u, -half), scale(v, -half))),
      add(c, add(scale(u, half), scale(v, -half))),
      add(c, add(scale(u, half), scale(v, half))),
      add(c, add(scale(u, -half), scale(v, half))),
    ].map(toThree);
    const geo = new THREE.BufferGeometry().setFromPoints([
      corners[0],
      corners[1],
      corners[2],
      corners[0],
      corners[2],
      corners[3],
    ]);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.plane,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    g.add(mesh);
    const outline: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) outline.push(corners[i], corners[(i + 1) % 4]);
    g.add(this.segments(outline, COLORS.plane, 1.2, { opacity: 0.55, depthTest: false, renderOrder: 3 }));
  }

  /**
   * Сечение: заливка, контур и вершины. sidesOnly — показать только перечисленные стороны (пошаговый режим).
   */
  setSection(
    section: Section | null,
    labels: readonly string[],
    opts: { fill: boolean; showLabels: boolean; hiddenVertexIdx?: Set<number> },
  ) {
    const g = this.clear('section');
    if (!section || !this.poly || section.status === 'empty' || section.status === 'error') return;
    const V = section.vertices.map((v) => v.pos);
    const r = this.poly.tol.scale * 0.011;
    if ((section.status === 'polygon' || section.status === 'face') && opts.fill) {
      const pts: THREE.Vector3[] = [];
      for (let i = 1; i + 1 < V.length; i++) pts.push(toThree(V[0]), toThree(V[i]), toThree(V[i + 1]));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: COLORS.sectionFill,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 5;
      mesh.userData.role = 'section-fill';
      g.add(mesh);
      const outline: THREE.Vector3[] = [];
      section.sides.forEach((s) => outline.push(toThree(V[s.a]), toThree(V[s.b])));
      g.add(this.segments(outline, COLORS.section, 3.2, { depthTest: false, renderOrder: 6 }));
    } else if (section.status === 'segment') {
      g.add(
        this.segments([toThree(V[0]), toThree(V[1])], COLORS.section, 4, {
          depthTest: false,
          renderOrder: 6,
        }),
      );
    }
    if (opts.fill || section.status === 'point' || section.status === 'segment')
      V.forEach((p, i) => {
        if (opts.hiddenVertexIdx?.has(i)) return;
        g.add(this.sphere(p, r, COLORS.section, 6));
        if (opts.showLabels && section.vertices[i].origin.type === 'edge' && labels[i])
          g.add(this.label(p, labels[i], 'lbl lbl-section', 0.05));
      });
  }

  /** Вспомогательные построения школьного решения. */
  setConstruction(draw: ConstructionDraw | null) {
    const g = this.clear('construction');
    const hl = this.clear('highlight');
    this.pulse = [];
    if (!draw || !this.poly) return;
    const r = this.poly.tol.scale * 0.011;
    const hlLines = new Set(draw.highlight.lines);
    const hlPts = new Set(draw.highlight.points);
    for (const { line, from, to } of draw.lines) {
      const current = hlLines.has(line.id);
      if (draw.onlyCurrent && !current) continue;
      const style = lineStyle(line.kind);
      const seg = this.segments(
        [toThree(from), toThree(to)],
        style.color,
        current ? style.width + 1.6 : style.width,
        {
          dashed: style.dashed,
          depthTest: false,
          renderOrder: 7,
          opacity: current ? 1 : 0.8,
        },
      );
      seg.userData = { role: 'construction-line', kind: line.kind, current };
      g.add(seg);
    }
    for (const p of draw.points) {
      const current = hlPts.has(p.id);
      if (draw.onlyCurrent && !current && p.role !== 'given') continue;
      const color =
        p.role === 'aux'
          ? COLORS.aux
          : p.role === 'projection'
            ? COLORS.projection
            : p.role === 'given'
              ? COLORS.defined
              : COLORS.section;
      if (p.role !== 'given') {
        g.add(this.sphere(p.pos, r * (current ? 1.3 : 1), color, 8));
        if (!this.poly.labels.includes(p.label) || p.role === 'projection')
          g.add(
            this.label(
              p.pos,
              p.label,
              `lbl ${p.role === 'aux' ? 'lbl-aux' : p.role === 'projection' ? 'lbl-proj' : 'lbl-section'}`,
              0.05,
            ),
          );
      }
      if (current) {
        const ring = this.ring(p.pos, r * 2.6, 0xffffff);
        this.pulse.push(ring);
        hl.add(ring);
      }
    }
    // Подсветка граней и рёбер текущего шага.
    for (const f of draw.highlight.faces) hl.add(this.faceOverlay(f));
    const edgePts: THREE.Vector3[] = [];
    for (const e of draw.highlight.edges) {
      const [a, b] = this.poly.edges[e];
      edgePts.push(toThree(this.poly.vertices[a]), toThree(this.poly.vertices[b]));
    }
    if (edgePts.length)
      hl.add(this.segments(edgePts, COLORS.edgeHighlight, 3.2, { depthTest: false, renderOrder: 8 }));
    hl.userData = { faces: draw.highlight.faces.length, edges: draw.highlight.edges.length };
  }

  setMarks(marks: readonly Mark[]) {
    const g = this.clear('marks');
    if (!this.poly) return;
    const r = this.poly.tol.scale * 0.014;
    for (const m of marks) {
      const color = m.state === 'ok' ? COLORS.markOk : m.state === 'bad' ? COLORS.markBad : COLORS.markNew;
      g.add(this.sphere(m.pos, r, color, 9));
      g.add(this.ring(m.pos, r * 1.9, color));
    }
  }

  setView(name: ViewName, animate = true) {
    if (!this.poly) return;
    const dir = toThree(normalize(VIEW_DIRS[name]));
    const R = this.poly.tol.scale / 2;
    const dist = (R / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    const to = dir.multiplyScalar(dist);
    this.controls.target.set(0, 0, 0);
    if (animate) this.tween = { from: this.camera.position.clone(), to, t0: performance.now() };
    else {
      this.camera.position.copy(to);
      this.camera.lookAt(0, 0, 0);
    }
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Вращение модели на заданный угол (используется кнопками и тестами). */
  orbit(dAzimuthDeg: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(dAzimuthDeg));
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  zoom(factor: number) {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  /** Экранные координаты точки модели (для тестов и подсказок). */
  project(v: Vec3): { x: number; y: number } {
    const p = toThree(v).applyMatrix4(this.model.matrixWorld).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  cameraState() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  /** Снимок сцены с подписями в PNG. */
  exportPNG(): string {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111317';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0);
    const k = src.width / this.width;
    ctx.font = `${Math.round(14 * k)}px "IBM Plex Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    this.model.traverse((o) => {
      if (!(o instanceof CSS2DObject) || !o.element.isConnected || !isVisible(o)) return;
      const w = new THREE.Vector3();
      o.getWorldPosition(w);
      const p = w.project(this.camera);
      if (p.z > 1) return;
      ctx.fillStyle = getComputedStyle(o.element).color || '#fff';
      ctx.fillText(
        o.element.textContent ?? '',
        ((p.x + 1) / 2) * canvas.width,
        ((1 - p.y) / 2) * canvas.height,
      );
    });
    return canvas.toDataURL('image/png');
  }

  /** Сводка для автотестов: что сейчас нарисовано. */
  debugSummary() {
    const count = (g: string, role?: string) => {
      let n = 0;
      this.groups[g].traverse((o) => {
        if (o !== this.groups[g] && (!role || o.userData.role === role) && (o as THREE.Mesh).isMesh) n++;
      });
      return n;
    };
    return {
      sectionFill: count('section', 'section-fill'),
      constructionLines: this.groups.construction.children.filter(
        (c) => c.userData.role === 'construction-line',
      ).length,
      currentLines: this.groups.construction.children.filter((c) => c.userData.current).length,
      highlightFaces: this.groups.highlight.userData.faces ?? 0,
      highlightEdges: this.groups.highlight.userData.edges ?? 0,
      definedPoints: this.groups.points.children.filter((c) => c instanceof CSS2DObject).length,
      camera: this.cameraState(),
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    for (const k of Object.keys(this.groups)) this.clear(k);
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }

  /* ───────────────────────── построение объектов ───────────────────────── */

  private rebuildPolyhedron() {
    const poly = this.poly;
    const gDepth = this.clear('depth');
    const gFaces = this.clear('faces');
    const gEdges = this.clear('edges');
    const gVerts = this.clear('vertices');
    const gLabels = this.clear('labels');
    this.faceMesh = null;
    if (!poly) return;

    // Грани: веер треугольников, атрибут faceIndex для пикинга.
    const pos: number[] = [];
    const fidx: number[] = [];
    poly.faces.forEach((f, fi) => {
      for (let i = 1; i + 1 < f.length; i++)
        for (const v of [f[0], f[i], f[i + 1]]) {
          const p = toThree(poly.vertices[v]);
          pos.push(p.x, p.y, p.z);
          fidx.push(fi);
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('faceIndex', new THREE.Float32BufferAttribute(fidx, 1));
    geo.computeVertexNormals();

    // Проход только по глубине: нужен, чтобы отличать видимые рёбра от невидимых.
    const depth = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    depth.renderOrder = 0;
    gDepth.add(depth);
    this.faceMesh = depth;

    const faceMat = new THREE.MeshPhongMaterial({
      color: COLORS.face,
      transparent: true,
      opacity: this.style.faces ? this.style.faceOpacity : 0,
      depthWrite: false,
      flatShading: true,
      shininess: 18,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const faces = new THREE.Mesh(geo, faceMat);
    faces.renderOrder = 1;
    gFaces.add(faces);

    if (this.style.edges) {
      const ep: THREE.Vector3[] = [];
      for (const [a, b] of poly.edges) ep.push(toThree(poly.vertices[a]), toThree(poly.vertices[b]));
      gEdges.add(this.segments(ep, COLORS.edge, 2, { depthFunc: THREE.LessEqualDepth, renderOrder: 2 }));
      gEdges.add(
        this.segments(ep, COLORS.edgeHidden, 1.4, {
          depthFunc: THREE.GreaterDepth,
          dashed: true,
          renderOrder: 2,
          opacity: 0.85,
        }),
      );
    }
    const r = poly.tol.scale * 0.007;
    poly.vertices.forEach((v, i) => {
      gVerts.add(this.sphere(v, r, COLORS.vertex, 4));
      gLabels.add(this.label(v, poly.labels[i], 'lbl lbl-vertex', 0.045));
    });
  }

  private faceOverlay(f: number): THREE.Mesh {
    const poly = this.poly!;
    const face = poly.faces[f];
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i + 1 < face.length; i++)
      pts.push(
        toThree(poly.vertices[face[0]]),
        toThree(poly.vertices[face[i]]),
        toThree(poly.vertices[face[i + 1]]),
      );
    const m = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.MeshBasicMaterial({
        color: COLORS.faceHighlight,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    m.renderOrder = 4;
    return m;
  }

  private segments(
    pts: THREE.Vector3[],
    color: number,
    width: number,
    o: {
      dashed?: boolean;
      depthTest?: boolean;
      depthFunc?: THREE.DepthModes;
      renderOrder?: number;
      opacity?: number;
    } = {},
  ): LineSegments2 {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const L = this.poly?.tol.scale ?? 1;
    const mat = new LineMaterial({
      color,
      linewidth: width,
      dashed: !!o.dashed,
      dashSize: L * 0.018,
      gapSize: L * 0.012,
      transparent: true,
      opacity: o.opacity ?? 1,
      depthTest: o.depthTest ?? true,
      depthWrite: false,
    });
    if (o.depthFunc !== undefined) mat.depthFunc = o.depthFunc;
    mat.resolution.set(this.width, this.height);
    this.lineMaterials.add(mat);
    const line = new LineSegments2(geo, mat);
    if (o.dashed) line.computeLineDistances();
    line.renderOrder = o.renderOrder ?? 2;
    return line;
  }

  private sphere(p: Vec3, r: number, color: number, renderOrder: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    m.position.copy(toThree(p));
    m.renderOrder = renderOrder;
    return m;
  }

  private ring(p: Vec3, r: number, color: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.78, r, 32),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    m.position.copy(toThree(p));
    m.renderOrder = 9;
    m.userData.billboard = true;
    return m;
  }

  private label(p: Vec3, text: string, cls: string, offset: number): CSS2DObject {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    const poly = this.poly!;
    const dir = sub(p, poly.center);
    const d = Math.hypot(dir[0], dir[1], dir[2]);
    const off =
      d > 1e-9 ? scale(dir, (offset * poly.tol.scale) / d) : ([0, 0, offset * poly.tol.scale] as Vec3);
    obj.position.copy(toThree(add(p, off)));
    return obj;
  }

  private clear(name: string): THREE.Group {
    const g = this.groups[name];
    const disposables = new Set<Disposable>();
    g.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
      const m = o as THREE.Mesh;
      if (m.geometry) disposables.add(m.geometry);
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => disposables.add(x));
      else if (mat) disposables.add(mat);
      if (mat instanceof LineMaterial) this.lineMaterials.delete(mat);
    });
    // Геометрия граней разделяется между проходом глубины и гранями — dispose идемпотентен.
    disposables.forEach((d) => d.dispose());
    g.clear();
    return g;
  }

  /* ───────────────────────── цикл и события ───────────────────────── */

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineMaterials.forEach((m) => m.resolution.set(w, h));
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / 420);
      const e = 1 - Math.pow(1 - k, 3);
      // Интерполируем по сфере, чтобы не «пролетать» через центр.
      const len = THREE.MathUtils.lerp(this.tween.from.length(), this.tween.to.length(), e);
      const dir = this.tween.from.clone().normalize().lerp(this.tween.to.clone().normalize(), e).normalize();
      this.camera.position.copy(dir.multiplyScalar(len));
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    const t = performance.now() / 1000;
    for (const o of this.pulse) o.scale.setScalar(1 + 0.18 * Math.sin(t * 5));
    this.model.traverse((o) => {
      if (o.userData.billboard) o.quaternion.copy(this.camera.quaternion);
    });
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  private candidateAt(e: PointerEvent): PickCandidate | null {
    if (!this.poly || this.picking === 'off') return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const ndc = new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.model.updateMatrixWorld(true);
    return pick(
      {
        poly: this.poly,
        camera: this.camera,
        modelMatrix: this.model.matrixWorld,
        faceMesh: this.faceMesh,
        width: rect.width,
        height: rect.height,
        snap: this.snap,
        edgesOnly: this.picking === 'marks',
      },
      mx,
      my,
      this.raycaster,
    );
  }

  private onMove = (e: PointerEvent) => {
    if (this.picking === 'off') return;
    if (this.pointerDown) return;
    const c = this.candidateAt(e);
    const g = this.clear('hover');
    if (c && this.poly) g.add(this.sphere(c.pos, this.poly.tol.scale * 0.012, COLORS.hover, 10));
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.cb.onHover(c, e.clientX - rect.left, e.clientY - rect.top);
  };
  private onDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };
  private onUp = (e: PointerEvent) => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || this.picking === 'off' || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // это было вращение
    const c = this.candidateAt(e);
    if (c) this.cb.onPick(c);
  };
  private onLeave = () => {
    this.clear('hover');
    this.cb.onHover(null, 0, 0);
  };
}

function lineStyle(kind: CLine['kind']): { color: number; width: number; dashed: boolean } {
  switch (kind) {
    case 'side':
      return { color: COLORS.section, width: 3.2, dashed: false };
    case 'trace':
      return { color: COLORS.aux, width: 1.8, dashed: true };
    case 'aux':
      return { color: COLORS.aux, width: 1.6, dashed: true };
    case 'parallel':
      return { color: COLORS.parallel, width: 1.8, dashed: true };
    case 'edge-ext':
      return { color: COLORS.edgeHidden, width: 1.6, dashed: true };
    case 'projection':
      return { color: COLORS.projection, width: 1.4, dashed: true };
  }
}

function isVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
