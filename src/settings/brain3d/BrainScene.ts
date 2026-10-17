/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrainGraph, BrainNode, BrainNodeKind } from '../../lib/ipc';
import { KIND_COLORS, LOBES, colorOf, lobeIndex, sick } from './kinds';
import { LabelPool } from './labels';
import { bulk, field, placeNeuron, sampleCortex } from './shape';
import {
  backFrag, backVert, cortexFrag, cortexVert, dustFrag, dustVert, edgeFrag, edgeVert,
  neuronFrag, neuronVert, pulseFrag, pulseVert, shellFrag, shellVert,
} from './shaders';

export type SceneProps = {
  graph: BrainGraph;
  selected: string | null;
  visible: Set<BrainNodeKind>;
  search: string;
  dreaming: boolean;
};

const CORTEX_POINTS = 42000;
const PULSE_CAP = 360;
const TRAIL = 4;
const EDGE_SEGMENTS = 10;
const RIPPLES = 12;
/** Turns recorded without a prompt, and automatic rounds: they stay neurons but are never named on screen. */
const JUNK_TITLE = /^\s*$|^\(empty prompt\)|^\[automatic finishing/i;
const BRAIN_RADIUS = 1.15;
const HOME_TARGET = new THREE.Vector3(0, -0.05, 0);
const HOME_DIR = new THREE.Vector3(-0.62, 0.3, 0.72).normalize();
const FOV = 36;
/** Kinds drawn as hubs: the few big neurons a person reads the brain by. */
const HUBS = new Set<BrainNodeKind>(['user', 'memory', 'skill', 'recipe', 'provider']);

type Runtime = { dim: number; flash: number; emph: number; born: number; crowd: number };

const radius3 = (node: BrainNode) => {
  const w = Math.sqrt(Math.max(0, node.weight));
  let r = 4.5 + Math.min(5, w * 1.5);
  if (node.kind === 'episode') r = 3 + Math.min(1.2, node.weight);
  else if (node.kind === 'tool') r = 3 + Math.min(3, w * 1.1);
  else if (node.kind === 'topic') r = 3.6 + Math.min(4, w * 1.4);
  else if (node.kind === 'provider') r = 4.5 + Math.min(4, w * 1.6);
  return r * 0.0031;
};

const linear = (hex: string) => new THREE.Color(hex);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/**
 * The 3D brain: a procedurally sampled cortex cloud, a fresnel shell, neurons in their lobes, axons through the
 * white matter, signals along them, bloom, orbit camera and HTML labels. One instance per canvas.
 */
export class BrainScene {
  private renderer: any;
  private composer: any;
  private bloom: any;
  private scene: any = new THREE.Scene();
  private camera: any;
  private controls: any;
  private clock0 = performance.now();
  private time = 0;
  private raf = 0;
  private visibleOnScreen = true;
  private disposed = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private pxScale = 1;
  private reduced = false;
  private labels: LabelPool;
  private observers: (() => void)[] = [];

  // Layers.
  private cortex: any;
  private shell: any;
  private neurons: any = null;
  private edges: any = null;
  private pulseMesh: any;
  private dust: any;
  private stateTex: any = null;
  private stateData = new Float32Array(4);
  private stateW = 1;
  private shared: Record<string, { value: any }> = {
    uTime: { value: 0 },
    uFog: { value: new THREE.Vector2(2, 4) },
    uState: { value: null },
    uStateW: { value: 1 },
    uPx: { value: 1000 },
    uDream: { value: 0 },
    uWave: { value: 0 },
  };
  private lobeGlowU = new Float32Array(LOBES.length);
  private lobeColU = LOBES.map((l) => linear(KIND_COLORS[l.kinds[0]]));
  private ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, -1000));
  private rippleAt = 0;

  // Graph state.
  private props: SceneProps;
  private signature = '';
  private nodes: BrainNode[] = [];
  private index = new Map<string, number>();
  private pos = new Float32Array(0);
  private nodeCol = new Float32Array(0);
  private nodeSize = new Float32Array(0);
  private rt: Runtime[] = [];
  private rtById = new Map<string, Runtime>();
  private posCache = new Map<string, [number, number, number]>();
  private eA = new Int32Array(0);
  private eB = new Int32Array(0);
  private eC = new Float32Array(0);
  private adjStart = new Int32Array(1);
  private adjEdge = new Int32Array(0);
  private shown = new Uint8Array(0);
  private matched = new Uint8Array(0);
  private focus = new Uint8Array(0);
  private litMask = new Uint8Array(0);
  private recent: number[] = [];
  private firing: number[] = [];
  private activity = new Float32Array(LOBES.length);
  private ranked = new Map<BrainNodeKind, number[]>();
  private first = true;

  // Interaction.
  private hover = -1;
  private pointer = { x: 0, y: 0, inside: false, moved: false, down: false };
  private downAt = { x: 0, y: 0, t: 0 };
  private lastInteraction = -1e9;
  private fly: null | { t0: number; dur: number; fromT: any; toT: any; fromD: number; toD: number; fromDir: any; toDir: any } = null;
  private lastSelected: string | null = null;
  private labelSet: number[] = [];
  private labelDirty = true;
  private zoomBucket = 0;
  private crowd = new Int32Array(0);
  /** Pixels the view is slid left while something is picked, so it clears the inspector panel. */
  private shift = 0;

  // Per-frame scratch (no allocation in the loop).
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sw = new Float32Array(0);
  private vp = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private bx = 0; private by = 0; private bz = 0;

  // Signals.
  private pE = new Int32Array(PULSE_CAP);
  private pRev = new Uint8Array(PULSE_CAP);
  private pT = new Float32Array(PULSE_CAP);
  private pSpeed = new Float32Array(PULSE_CAP);
  private pHop = new Int8Array(PULSE_CAP);
  private pNode = new Int32Array(PULSE_CAP);
  private pn = 0;
  private arrivals = new Int32Array(PULSE_CAP * 2);
  private spawnAcc = 0;
  private lastFocusFire = 0;
  private pulsePos: any;
  private pulseSize: any;
  private pulseCol: any;

  // Quality / stats.
  private level = 0;
  private fixedQuality = false;
  private frameEma = 16;
  private cpuEma = 4;
  private slowFrames = 0;
  private lastFrame = 0;
  private statFrames = 0;

  constructor(private canvas: HTMLCanvasElement, labelHost: HTMLElement, private onSelect: (id: string | null) => void, initial: SceneProps) {
    const built0 = performance.now();
    this.props = initial;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.fixedQuality = new URLSearchParams(location.search).get('brainq') === 'fixed';
    this.labels = new LabelPool(labelHost);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor(0x030308, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.65;
    c.zoomSpeed = 0.85;
    c.panSpeed = 0.7;
    c.screenSpacePanning = true;
    c.minDistance = 0.55;
    c.maxDistance = 7;
    c.autoRotate = !this.reduced;
    c.autoRotateSpeed = 0.55;
    c.target.copy(HOME_TARGET);

    this.buildBackground();
    this.shell = this.buildShell();
    this.cortex = this.buildCortex();
    this.buildPulses();
    this.dust = this.buildDust();
    this.scene.add(this.cortex, this.shell, this.dust);

    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.dpr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    this.homeCamera(true);
    this.rebuild(initial.graph);
    const fx = new URLSearchParams(location.search).get('brainfx') ?? '';
    if (fx) (window as unknown as Record<string, unknown>).__brain = this;
    if (fx.includes('nobloom')) this.bloom.enabled = false;
    if (fx.includes('nocortex')) this.cortex.visible = false;
    if (fx.includes('noshell')) this.shell.visible = false;
    if (fx.includes('noedges') && this.edges) this.edges.visible = false;
    if (fx.includes('noneurons') && this.neurons) this.neurons.visible = false;
    this.wire();
    this.lastFrame = performance.now();
    canvas.dataset.buildMs = String(Math.round(performance.now() - built0));
    this.start();
  }

  // ───────────────────────── props ─────────────────────────

  setProps(next: SceneProps) {
    const prev = this.props;
    this.props = next;
    if (next.graph !== prev.graph) this.rebuild(next.graph);
    this.updateMasks();
    if (next.selected !== this.lastSelected) this.selectionChanged(next.selected);
    this.labelDirty = true;
  }

  private selectionChanged(id: string | null) {
    this.lastSelected = id;
    const i = id ? this.index.get(id) : undefined;
    const c = this.controls;
    const now = this.time;
    const fromT = c.target.clone();
    const curD = this.camera.position.distanceTo(c.target);
    if (i !== undefined) {
      const toT = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.fly = { t0: now, dur: 1.15, fromT, toT, fromD: curD, toD: Math.max(0.85, Math.min(curD, 1.6)), fromDir: null, toDir: null };
      this.addRipple(toT.x, toT.y, toT.z);
      c.autoRotate = false;
    } else if (fromT.distanceTo(HOME_TARGET) > 0.01) {
      this.fly = { t0: now, dur: 1.0, fromT, toT: HOME_TARGET.clone(), fromD: curD, toD: curD, fromDir: null, toDir: null };
    }
  }

  /** Dev aid (only reachable with ?brainfx=...): put the camera somewhere and stop it moving. */
  debugView(x: number, y: number, z: number, tx = 0, ty = -0.05, tz = 0) {
    this.controls.autoRotate = false;
    this.lastInteraction = this.time + 1e6;
    this.fly = null;
    this.controls.target.set(tx, ty, tz);
    this.camera.position.set(x, y, z);
    this.controls.update();
  }

  private homeDistance() {
    const aspect = this.width / Math.max(1, this.height);
    const vfov = (FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    return (BRAIN_RADIUS * 0.92) / Math.sin(Math.min(vfov, hfov) / 2);
  }

  private homeCamera(instant: boolean) {
    const d = this.homeDistance();
    const c = this.controls;
    if (instant) {
      c.target.copy(HOME_TARGET);
      this.camera.position.copy(HOME_TARGET).addScaledVector(HOME_DIR, d);
      c.update();
      return;
    }
    const dir = this.camera.position.clone().sub(c.target).normalize();
    this.fly = { t0: this.time, dur: 1.3, fromT: c.target.clone(), toT: HOME_TARGET.clone(), fromD: this.camera.position.distanceTo(c.target), toD: d, fromDir: dir, toDir: HOME_DIR.clone() };
  }

  // ───────────────────────── static layers ─────────────────────────

  private buildBackground() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: backVert, fragmentShader: backFrag, depthTest: false, depthWrite: false,
      uniforms: { uAspect: { value: new THREE.Vector2(1, 1) }, uTime: this.shared.uTime },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    this.scene.add(mesh);
    this.back = mesh;
  }
  private back: any;

  private lobeUniforms() {
    return {
      uLobeCol: { value: this.lobeColU },
      uLobeGlow: { value: this.lobeGlowU },
      uLobeC: { value: LOBES.map((l) => new THREE.Vector3(...l.center)) },
      uLobeR: { value: LOBES.map((l) => new THREE.Vector3(l.radii[0] * 1.3, l.radii[1] * 1.3, l.radii[2] * 1.3)) },
      uLobeS: { value: LOBES.map((l) => (l.sym ? 1 : 0)) },
    };
  }

  private buildCortex() {
    const s = sampleCortex(CORTEX_POINTS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    geo.setAttribute('aNormal', new THREE.BufferAttribute(s.normals, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(s.seeds, 1));
    geo.setAttribute('aLobe', new THREE.BufferAttribute(s.lobes, 1));
    geo.setAttribute('aMix', new THREE.BufferAttribute(s.mixes, 1));
    geo.setAttribute('aGroove', new THREE.BufferAttribute(s.grooves, 1));
    geo.setDrawRange(0, s.count);
    this.cortexCount = s.count;
    const mat = new THREE.ShaderMaterial({
      vertexShader: cortexVert, fragmentShader: cortexFrag, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.shared.uTime, uFog: this.shared.uFog, uPx: this.shared.uPx, uDream: this.shared.uDream, uWave: this.shared.uWave,
        uSize: { value: 0.0062 }, uIntensity: { value: 0.75 },
        uLobeCol: { value: this.lobeColU }, uLobeGlow: { value: this.lobeGlowU }, uRip: { value: this.ripples },
      },
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    return points;
  }
  private cortexCount = 0;

  private buildShell() {
    const ico = new THREE.IcosahedronGeometry(1, 44);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const geo = mergeVertices(ico, 1e-4);
    ico.dispose();
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const dx = p.getX(i); const dy = p.getY(i); const dz = p.getZ(i);
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len; const uy = dy / len; const uz = dz / len;
      let t = 1.9;
      for (let it = 0; it < 70; it += 1) {
        const sdf = field(ux * t, uy * t, uz * t, 0.4);
        if (sdf < 0.0015) break;
        t -= Math.max(0.004, sdf * 0.85);
        if (t < 0.05) break;
      }
      p.setXYZ(i, ux * t, uy * t, uz * t);
    }
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: {
        uTime: this.shared.uTime, uFog: this.shared.uFog, uDream: this.shared.uDream, uWave: this.shared.uWave,
        uRim: { value: new THREE.Color(0.2, 0.25, 0.9) },
        ...this.lobeUniforms(),
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return mesh;
  }

  private buildDust() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 2.2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r; pos[i * 3 + 1] = u * r * 0.8; pos[i * 3 + 2] = Math.sin(a) * s * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.shared.uTime, uPx: this.shared.uPx, uMotion: { value: this.reduced ? 0 : 1 } },
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 0;
    return pts;
  }

  private buildPulses() {
    const quad = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const n = PULSE_CAP * TRAIL;
    this.pulsePos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pulseSize = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.pulseCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.pulsePos);
    geo.setAttribute('aSize', this.pulseSize);
    geo.setAttribute('aColor', this.pulseCol);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: pulseVert, fragmentShader: pulseFrag, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uFog: this.shared.uFog },
    });
    this.pulseMesh = new THREE.Mesh(geo, mat);
    this.pulseMesh.frustumCulled = false;
    this.pulseMesh.renderOrder = 5;
    this.scene.add(this.pulseMesh);
  }

  // ───────────────────────── graph → layers ─────────────────────────

  private rebuild(graph: BrainGraph) {
    const nodes = graph.nodes;
    let wsum = 0;
    let latest = '';
    for (const n of nodes) { wsum += n.weight; if (n.updated > latest) latest = n.updated; }
    const signature = `${nodes.length}:${graph.edges.length}:${latest}:${wsum.toFixed(3)}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const first = this.first;
    const now = this.time;
    const N = nodes.length;
    this.nodes = nodes;
    this.index = new Map(nodes.map((n, i) => [n.id, i]));
    this.pos = new Float32Array(N * 3);
    this.nodeCol = new Float32Array(N * 3);
    this.nodeSize = new Float32Array(N);
    const meta = new Float32Array(N * 2);
    const born = new Float32Array(N);
    const idx = new Float32Array(N);
    const nextRt: Runtime[] = [];
    const fresh: number[] = [];
    const newIdx: number[] = [];
    const kindColors = new Map<string, any>();
    for (let i = 0; i < N; i += 1) {
      const node = nodes[i];
      let p = this.posCache.get(node.id);
      if (!p) { p = placeNeuron(LOBES[lobeIndex(node.kind)], node.id); this.posCache.set(node.id, p); newIdx.push(i); }
      this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
      const hex = colorOf(node);
      let col = kindColors.get(hex);
      if (!col) { col = linear(hex); kindColors.set(hex, col); }
      this.nodeCol[i * 3] = col.r; this.nodeCol[i * 3 + 1] = col.g; this.nodeCol[i * 3 + 2] = col.b;
      this.nodeSize[i] = radius3(node);
      meta[i * 2] = (HUBS.has(node.kind) ? 1 : 0) + (sick(node) ? 2 : 0) + (node.kind === 'episode' ? 4 : 0);
      let state = this.rtById.get(node.id);
      if (!state) {
        state = { dim: first ? 1 : 0.5, flash: 0, emph: 0, born: first ? -1000 : now, crowd: 1 };
        this.rtById.set(node.id, state);
        if (!first) fresh.push(i);
      }
      born[i] = state.born;
      idx[i] = i;
      nextRt.push(state);
    }
    this.relax(newIdx);
    this.rt = nextRt;
    for (const id of [...this.rtById.keys()]) if (!this.index.has(id)) this.rtById.delete(id);

    // Edges, adjacency, curves.
    const eAL: number[] = [];
    const eBL: number[] = [];
    for (const e of graph.edges) {
      const a = this.index.get(e.a);
      const b = this.index.get(e.b);
      if (a === undefined || b === undefined || a === b) continue;
      eAL.push(a); eBL.push(b);
    }
    const E = eAL.length;
    this.eA = Int32Array.from(eAL);
    this.eB = Int32Array.from(eBL);
    this.eC = new Float32Array(E * 3);
    const deg = new Int32Array(N + 1);
    for (let j = 0; j < E; j += 1) { deg[this.eA[j] + 1] += 1; deg[this.eB[j] + 1] += 1; }
    for (let i = 0; i < N; i += 1) deg[i + 1] += deg[i];
    this.adjStart = deg;
    this.adjEdge = new Int32Array(E * 2);
    const fill = deg.slice(0, N);
    for (let j = 0; j < E; j += 1) { this.adjEdge[fill[this.eA[j]]++] = j; this.adjEdge[fill[this.eB[j]]++] = j; }
    this.buildEdges(E);

    // Neurons.
    if (this.neurons) { this.scene.remove(this.neurons); this.neurons.geometry.dispose(); this.neurons.material.dispose(); }
    const quad = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.nodeSize, 1));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.nodeCol, 3));
    geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 2));
    geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 1));
    geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
    geo.instanceCount = N;
    const mat = new THREE.ShaderMaterial({
      vertexShader: neuronVert, fragmentShader: neuronFrag, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.shared.uTime, uFog: this.shared.uFog, uState: this.shared.uState, uStateW: this.shared.uStateW },
    });
    this.neurons = new THREE.Mesh(geo, mat);
    this.neurons.frustumCulled = false;
    this.neurons.renderOrder = 4;
    this.scene.add(this.neurons);

    // State texture: one RGBA texel per node (dim, flash, emphasis).
    if (this.stateTex) this.stateTex.dispose();
    this.stateW = Math.max(1, Math.min(1024, N));
    const h = Math.max(1, Math.ceil(N / this.stateW));
    this.stateData = new Float32Array(this.stateW * h * 4);
    this.stateTex = new THREE.DataTexture(this.stateData, this.stateW, h, THREE.RGBAFormat, THREE.FloatType);
    this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.needsUpdate = true;
    this.shared.uState.value = this.stateTex;
    this.shared.uStateW.value = this.stateW;

    this.shown = new Uint8Array(N); this.matched = new Uint8Array(N); this.focus = new Uint8Array(N); this.litMask = new Uint8Array(N);
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sw = new Float32Array(N);

    // Ranking for labels, recent/firing sets for signals, lobe activity.
    this.ranked = new Map();
    for (const i of [...nodes.keys()].sort((a, b) => nodes[b].weight - nodes[a].weight)) {
      const k = nodes[i].kind;
      const list = this.ranked.get(k);
      if (list) list.push(i); else this.ranked.set(k, [i]);
    }
    const linked = [...nodes.keys()].filter((i) => this.adjStart[i + 1] > this.adjStart[i]);
    this.firing = linked;
    this.recent = [...linked].sort((a, b) => Date.parse(nodes[b].updated) - Date.parse(nodes[a].updated)).slice(0, 60);
    const heat = new Float32Array(LOBES.length);
    const wall = Date.now();
    for (const node of nodes) {
      const hours = Math.max(0, (wall - Date.parse(node.updated)) / 3_600_000);
      if (Number.isFinite(hours)) heat[lobeIndex(node.kind)] += Math.exp(-hours / 12);
    }
    for (let l = 0; l < LOBES.length; l += 1) this.activity[l] = 1 - Math.exp(-heat[l] / 2);

    this.updateMasks();
    this.labelDirty = true;
    this.first = false;
    // A cascade from whatever was just learned.
    for (const i of fresh) {
      this.rt[i].flash = 1;
      this.addRipple(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      const s = this.adjStart[i];
      const count = Math.min(12, this.adjStart[i + 1] - s);
      for (let k = 0; k < count; k += 1) this.addPulse(this.adjEdge[s + k], this.eA[this.adjEdge[s + k]] !== i, -Math.random() * 0.45, 1.1, 2, i);
    }
    if (this.props.selected && this.lastSelected === null) this.selectionChanged(this.props.selected);
  }

  /** New neurons nudge apart (and off older ones) so a crowded lobe reads as individual cells, not one blob. */
  private relax(fresh: number[]) {
    if (!fresh.length) return;
    const N = this.nodes.length;
    const pos = this.pos;
    const byLobe = new Map<number, number[]>();
    for (let i = 0; i < N; i += 1) {
      const l = lobeIndex(this.nodes[i].kind);
      const list = byLobe.get(l);
      if (list) list.push(i); else byLobe.set(l, [i]);
    }
    const isNew = new Uint8Array(N);
    for (const i of fresh) isNew[i] = 1;
    for (let pass = 0; pass < 10; pass += 1) {
      for (const list of byLobe.values()) {
        for (const i of list) {
          if (!isNew[i]) continue;
          let fx = 0; let fy = 0; let fz = 0;
          const want = 0.046 + this.nodeSize[i] * 2;
          for (const j of list) {
            if (j === i) continue;
            const dx = pos[i * 3] - pos[j * 3]; const dy = pos[i * 3 + 1] - pos[j * 3 + 1]; const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= want * want) continue;
            const d = Math.sqrt(d2) || 0.001;
            const push = (want - d) / d * 0.5;
            fx += dx * push; fy += dy * push; fz += dz * push;
          }
          if (!fx && !fy && !fz) continue;
          const nx = pos[i * 3] + fx; const ny = pos[i * 3 + 1] + fy; const nz = pos[i * 3 + 2] + fz;
          const s = bulk(nx, ny, nz);
          if (s < -0.03 && s > -0.32) { pos[i * 3] = nx; pos[i * 3 + 1] = ny; pos[i * 3 + 2] = nz; }
        }
      }
    }
    for (const i of fresh) this.posCache.set(this.nodes[i].id, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
  }

  private buildEdges(E: number) {
    if (this.edges) { this.scene.remove(this.edges); this.edges.geometry.dispose(); this.edges.material.dispose(); this.edges = null; }
    if (!E) return;
    const S = EDGE_SEGMENTS;
    const verts = E * S * 2;
    const position = new Float32Array(verts * 3);
    const color = new Float32Array(verts * 3);
    const ends = new Float32Array(verts * 2);
    const tt = new Float32Array(verts);
    const ww = new Float32Array(verts);
    const pos = this.pos;
    const lav = [0.45, 0.42, 0.9];
    const degree = (i: number) => this.adjStart[i + 1] - this.adjStart[i];
    let v = 0;
    for (let j = 0; j < E; j += 1) {
      const a = this.eA[j]; const b = this.eB[j];
      const ax = pos[a * 3]; const ay = pos[a * 3 + 1]; const az = pos[a * 3 + 2];
      const bx = pos[b * 3]; const by = pos[b * 3 + 1]; const bz = pos[b * 3 + 2];
      const wa = Math.max(0.05, Math.min(1, 2.6 / Math.sqrt(Math.max(degree(a), 1))));
      const wb = Math.max(0.05, Math.min(1, 2.6 / Math.sqrt(Math.max(degree(b), 1))));
      const mx = (ax + bx) / 2; const my = (ay + by) / 2; const mz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      // The bow heads for the white matter, with a little deterministic scatter so bundles fan out.
      let dx = -mx; let dy = -0.02 - my; let dz = -mz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const h1 = Math.sin(j * 12.9898 + 4.1) * 43758.5453; const h2 = Math.sin(j * 78.233 + 1.7) * 24634.6345; const h3 = Math.sin(j * 37.719 + 9.3) * 12345.6789;
      const rx = (h1 - Math.floor(h1)) * 2 - 1; const ry = (h2 - Math.floor(h2)) * 2 - 1; const rz = (h3 - Math.floor(h3)) * 2 - 1;
      const bow = len * 0.3;
      const cx = mx + (dx * 0.5 + rx * 0.5) * bow;
      const cy = my + (dy * 0.5 + ry * 0.5) * bow;
      const cz = mz + (dz * 0.5 + rz * 0.5) * bow;
      this.eC[j * 3] = cx; this.eC[j * 3 + 1] = cy; this.eC[j * 3 + 2] = cz;
      for (let s = 0; s < S; s += 1) {
        for (let k = 0; k < 2; k += 1) {
          const t = (s + k) / S;
          const u = 1 - t;
          const w0 = u * u; const w1 = 2 * u * t; const w2 = t * t;
          position[v * 3] = w0 * ax + w1 * cx + w2 * bx;
          position[v * 3 + 1] = w0 * ay + w1 * cy + w2 * by;
          position[v * 3 + 2] = w0 * az + w1 * cz + w2 * bz;
          for (let c = 0; c < 3; c += 1) {
            const mixed = this.nodeCol[a * 3 + c] * (1 - t) + this.nodeCol[b * 3 + c] * t;
            color[v * 3 + c] = mixed * 0.6 + lav[c] * 0.4;
          }
          ends[v * 2] = a; ends[v * 2 + 1] = b;
          tt[v] = t;
          ww[v] = wa * (1 - t) + wb * t;
          v += 1;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aEnds', new THREE.BufferAttribute(ends, 2));
    geo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    geo.setAttribute('aW', new THREE.BufferAttribute(ww, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: edgeVert, fragmentShader: edgeFrag, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.shared.uTime, uFog: this.shared.uFog, uState: this.shared.uState, uStateW: this.shared.uStateW,
        uActive: { value: -1 }, uFocus: { value: 0 }, uBase: { value: 0.03 },
      },
    });
    this.edges = new THREE.LineSegments(geo, mat);
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 3;
    this.scene.add(this.edges);
  }

  // ───────────────────────── masks / labels set ─────────────────────────

  private activeIndex() {
    const sel = this.props.selected ? this.index.get(this.props.selected) : undefined;
    if (sel !== undefined) return sel;
    return this.hover;
  }

  private updateMasks() {
    const N = this.nodes.length;
    const { visible, search } = this.props;
    const needle = search.trim().toLowerCase();
    const active = this.activeIndex();
    this.focus.fill(0);
    if (active >= 0) {
      this.focus[active] = 1;
      for (let k = this.adjStart[active]; k < this.adjStart[active + 1]; k += 1) {
        const j = this.adjEdge[k];
        this.focus[this.eA[j] === active ? this.eB[j] : this.eA[j]] = 1;
      }
    }
    for (let i = 0; i < N; i += 1) {
      const node = this.nodes[i];
      const sh = visible.has(node.kind) ? 1 : 0;
      this.shown[i] = sh;
      this.matched[i] = !needle || node.title.toLowerCase().includes(needle) ? 1 : 0;
      this.litMask[i] = sh && this.matched[i] && (active < 0 || this.focus[i]) ? 1 : 0;
    }
    this.labelDirty = true;
  }

  private rebuildLabelSet() {
    this.labelDirty = false;
    const set: number[] = [];
    const seen = new Set<number>();
    const add = (i: number | undefined) => {
      if (i === undefined || i < 0 || seen.has(i) || !this.litMask[i]) return;
      if (JUNK_TITLE.test(this.nodes[i].title)) return;
      seen.add(i); set.push(i);
    };
    const sel = this.props.selected ? this.index.get(this.props.selected) : undefined;
    add(sel);
    add(this.hover >= 0 ? this.hover : undefined);
    const needle = this.props.search.trim();
    if (needle) { let n = 0; for (let i = 0; i < this.nodes.length && n < 40; i += 1) if (this.litMask[i] && !seen.has(i)) { add(i); n += 1; } }
    const active = this.activeIndex();
    if (active >= 0) {
      const ordered: number[] = [];
      for (let k = this.adjStart[active]; k < this.adjStart[active + 1]; k += 1) {
        const j = this.adjEdge[k];
        ordered.push(this.eA[j] === active ? this.eB[j] : this.eA[j]);
      }
      const named = (i: number) => (this.nodes[i].kind === 'episode' ? 0 : 1);
      ordered.sort((a, b) => named(b) - named(a) || this.nodes[b].weight - this.nodes[a].weight);
      for (const i of ordered.slice(0, 12)) add(i);
    }
    const b = this.zoomBucket;
    const quota = (kind: BrainNodeKind) => {
      if (kind === 'episode') return 0;
      if (kind === 'tool') return b === 0 ? 0 : b === 1 ? 6 : 14;
      if (kind === 'topic') return b === 0 ? 2 : b === 1 ? 8 : 24;
      return b === 0 ? 2 : b === 1 ? 8 : 30;
    };
    for (const kind of ['user', 'skill', 'memory', 'provider', 'recipe', 'topic', 'tool'] as BrainNodeKind[]) {
      for (const i of (this.ranked.get(kind) ?? []).slice(0, quota(kind))) add(i);
    }
    this.labelSet = set;
  }

  // ───────────────────────── signals ─────────────────────────

  private addRipple(x: number, y: number, z: number) {
    const r = this.ripples[this.rippleAt];
    r.set(x, y, z, this.time);
    this.rippleAt = (this.rippleAt + 1) % RIPPLES;
  }

  private addPulse(edge: number, reverse: boolean, delay: number, speed: number, hop: number, node: number) {
    if (this.pn >= PULSE_CAP) return;
    const i = this.pn++;
    this.pE[i] = edge; this.pRev[i] = reverse ? 1 : 0; this.pT[i] = delay; this.pSpeed[i] = speed; this.pHop[i] = hop; this.pNode[i] = node;
  }

  private fire(from: number, hop: number, speed = 0.9) {
    const s = this.adjStart[from];
    const e = this.adjStart[from + 1];
    if (e === s || !this.shown[from]) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const j = this.adjEdge[s + Math.floor(Math.random() * (e - s))];
      const other = this.eA[j] === from ? this.eB[j] : this.eA[j];
      if (!this.shown[other]) continue;
      this.addPulse(j, this.eA[j] !== from, 0, speed * (0.8 + Math.random() * 0.5), hop, from);
      return;
    }
  }

  private bez(edge: number, u: number) {
    const a = this.eA[edge] * 3; const b = this.eB[edge] * 3; const c = edge * 3;
    const w = 1 - u;
    const w0 = w * w; const w1 = 2 * w * u; const w2 = u * u;
    const p = this.pos;
    this.bx = w0 * p[a] + w1 * this.eC[c] + w2 * p[b];
    this.by = w0 * p[a + 1] + w1 * this.eC[c + 1] + w2 * p[b + 1];
    this.bz = w0 * p[a + 2] + w1 * this.eC[c + 2] + w2 * p[b + 2];
  }

  private stepSignals(dt: number) {
    const { dreaming } = this.props;
    const active = this.activeIndex();
    const calm = this.reduced ? 0.35 : 1;
    this.spawnAcc += dt * (dreaming ? 14 : 2.6) * calm;
    while (this.spawnAcc >= 1 && this.firing.length) {
      this.spawnAcc -= 1;
      const pool = this.recent.length && Math.random() < 0.65 ? this.recent : this.firing;
      this.fire(pool[Math.floor(Math.random() * pool.length)], Math.random() < 0.3 ? 1 : 0);
    }
    this.spawnAcc = Math.min(this.spawnAcc, 4);
    if (active >= 0 && this.time - this.lastFocusFire > (this.reduced ? 0.7 : 0.28)) { this.lastFocusFire = this.time; this.fire(active, 0, 1.2); }

    // Advance, collecting arrivals; then compact the pool.
    let w = 0;
    let arrived = 0;
    for (let i = 0; i < this.pn; i += 1) {
      const t = this.pT[i] + this.pSpeed[i] * dt;
      if (t >= 1) {
        const j = this.pE[i];
        const target = this.pRev[i] ? this.eA[j] : this.eB[j];
        this.arrivals[arrived * 2] = target; this.arrivals[arrived * 2 + 1] = this.pHop[i];
        arrived += 1;
        continue;
      }
      if (w !== i) {
        this.pE[w] = this.pE[i]; this.pRev[w] = this.pRev[i]; this.pSpeed[w] = this.pSpeed[i]; this.pHop[w] = this.pHop[i]; this.pNode[w] = this.pNode[i];
      }
      this.pT[w] = t;
      w += 1;
    }
    this.pn = w;
    for (let k = 0; k < arrived; k += 1) {
      const node = this.arrivals[k * 2];
      const hop = this.arrivals[k * 2 + 1];
      const state = this.rt[node];
      if (state) state.flash = 1;
      for (let h = 0; h < hop && h < 2; h += 1) this.fire(node, hop - 1);
    }
    if (this.pn > PULSE_CAP - 40) this.pn = PULSE_CAP - 40;

    // Write the instanced glow points: a bright head with a fading trail.
    const pp = this.pulsePos.array as Float32Array;
    const ps = this.pulseSize.array as Float32Array;
    const pc = this.pulseCol.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.pn; i += 1) {
      const t = this.pT[i];
      if (t <= 0) continue;
      const j = this.pE[i];
      const src = this.pNode[i] * 3;
      for (let k = 0; k < TRAIL; k += 1) {
        const tk = t - k * 0.04;
        if (tk <= 0) break;
        this.bez(j, this.pRev[i] ? 1 - tk : tk);
        pp[n * 3] = this.bx; pp[n * 3 + 1] = this.by; pp[n * 3 + 2] = this.bz;
        ps[n] = k === 0 ? 0.03 : 0.022 - k * 0.004;
        const fade = k === 0 ? 1 : 0.55 - k * 0.14;
        pc[n * 4] = this.nodeCol[src] * 1.6; pc[n * 4 + 1] = this.nodeCol[src + 1] * 1.6; pc[n * 4 + 2] = this.nodeCol[src + 2] * 1.6; pc[n * 4 + 3] = fade;
        n += 1;
      }
    }
    this.pulseMesh.geometry.instanceCount = n;
    this.pulsePos.needsUpdate = true; this.pulseSize.needsUpdate = true; this.pulseCol.needsUpdate = true;
  }

  // ───────────────────────── frame ─────────────────────────

  private project() {
    const cam = this.camera;
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const m = this.vp.elements;
    const w = this.width; const h = this.height;
    const p = this.pos;
    for (let i = 0; i < this.nodes.length; i += 1) {
      const x = p[i * 3]; const y = p[i * 3 + 1]; const z = p[i * 3 + 2];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      this.sw[i] = cw;
      this.sx[i] = (cx / cw * 0.5 + 0.5) * w;
      this.sy[i] = (1 - (cy / cw * 0.5 + 0.5)) * h;
    }
  }

  private pickAt(px: number, py: number) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.nodes.length; i += 1) {
      if (!this.shown[i] || this.sw[i] <= 0.05) continue;
      const rpx = (this.nodeSize[i] * this.pxScale) / this.sw[i];
      const tol = Math.max(8, rpx * 1.4 + 4);
      const dx = this.sx[i] - px; const dy = this.sy[i] - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > tol) continue;
      const hub = this.nodes[i].kind === 'episode' ? 0 : 5;
      const score = d - hub + this.sw[i] * 2.5;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(0.05, Math.max(0.0001, rawDt));
    this.time = (now - this.clock0) / 1000;
    this.shared.uTime.value = this.time;
    this.frameEma += (rawDt * 1000 - this.frameEma) * 0.05;

    const c = this.controls;
    const cam = this.camera;
    // Camera: fly-to, auto-rotate resumes after a pause.
    if (this.fly) {
      const f = this.fly;
      const k = Math.min(1, (this.time - f.t0) / f.dur);
      const e = ease(k);
      if (f.fromDir) this.tmp.lerpVectors(f.fromDir, f.toDir, e).normalize();
      else this.tmp.copy(cam.position).sub(c.target).normalize();
      c.target.lerpVectors(f.fromT, f.toT, e);
      const d = f.fromD + (f.toD - f.fromD) * e;
      cam.position.copy(c.target).addScaledVector(this.tmp, d);
      if (k >= 1) this.fly = null;
    }
    if (!this.reduced && !this.pointer.down && !this.fly && !this.props.selected && this.time - this.lastInteraction > 7) c.autoRotate = true;
    const wantShift = this.props.selected && this.width > 760 ? Math.min(150, this.width * 0.17) : 0;
    if (Math.abs(wantShift - this.shift) > 0.3) {
      this.shift += (wantShift - this.shift) * Math.min(1, dt * 5);
      cam.setViewOffset(this.width, this.height, this.shift, 0, this.width, this.height);
    } else if (this.shift !== wantShift) {
      this.shift = wantShift;
      if (wantShift === 0) cam.clearViewOffset(); else cam.setViewOffset(this.width, this.height, wantShift, 0, this.width, this.height);
    }
    c.update();
    cam.updateMatrixWorld();

    const camDist = cam.position.distanceTo(HOME_TARGET);
    this.shared.uFog.value.set(camDist - BRAIN_RADIUS * 0.9, camDist + BRAIN_RADIUS * 1.15);
    const zoom = this.homeDistance() / Math.max(0.1, cam.position.distanceTo(c.target));
    const bucket = zoom < 1.25 ? 0 : zoom < 2.1 ? 1 : 2;
    if (bucket !== this.zoomBucket) { this.zoomBucket = bucket; this.labelDirty = true; }

    // Dream waves, lobe glow.
    const dreamTarget = this.props.dreaming ? 1 : 0;
    const du = this.shared.uDream;
    du.value += (dreamTarget - du.value) * Math.min(1, dt * 1.6);
    this.shared.uWave.value = 1.3 - ((this.time / 4.6) % 1) * 3.0;
    for (let l = 0; l < LOBES.length; l += 1) {
      const on = LOBES[l].kinds.some((kind) => this.props.visible.has(kind));
      const target = (0.2 + 0.85 * this.activity[l]) * (on ? 1 : 0.2);
      this.lobeGlowU[l] += (target * (0.9 + 0.1 * Math.sin(this.time * 0.9 + l)) - this.lobeGlowU[l]) * Math.min(1, dt * 3);
    }

    // Hover pick.
    this.project();
    if (this.pointer.moved && !this.pointer.down) {
      this.pointer.moved = false;
      const id = this.pointer.inside ? this.pickAt(this.pointer.x, this.pointer.y) : -1;
      if (id !== this.hover) {
        this.hover = id;
        this.canvas.style.cursor = id >= 0 ? 'pointer' : 'grab';
        this.updateMasks();
      }
    }

    // Per-node state texture.
    const sel = this.props.selected ? this.index.get(this.props.selected) ?? -1 : -1;
    const active = this.activeIndex();
    const data = this.stateData;
    const ease8 = Math.min(1, dt * 9);
    const decay = dt / 0.45;
    // Crowding: nodes sharing a patch of screen dim each other so a dense cluster stays additive-safe.
    const cell = 26;
    const cols = Math.ceil(this.width / cell) + 2;
    const rows = Math.ceil(this.height / cell) + 2;
    if (this.crowd.length < cols * rows) this.crowd = new Int32Array(cols * rows);
    this.crowd.fill(0, 0, cols * rows);
    for (let i = 0; i < this.rt.length; i += 1) {
      if (!this.shown[i] || this.sw[i] <= 0) continue;
      const cx = Math.max(0, Math.min(cols - 1, Math.floor(this.sx[i] / cell) + 1));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor(this.sy[i] / cell) + 1));
      this.crowd[cy * cols + cx] += 1;
    }
    for (let i = 0; i < this.rt.length; i += 1) {
      const s = this.rt[i];
      const cx = Math.max(0, Math.min(cols - 1, Math.floor(this.sx[i] / cell) + 1));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor(this.sy[i] / cell) + 1));
      const n = this.crowd[cy * cols + cx];
      let f = 1 / (1 + 0.14 * Math.max(0, n - 2));
      if (HUBS.has(this.nodes[i].kind)) f = Math.max(f, 0.7);
      s.crowd += (f - s.crowd) * Math.min(1, dt * 4);
    }
    for (let i = 0; i < this.rt.length; i += 1) {
      const s = this.rt[i];
      const target = !this.shown[i] ? 0 : this.litMask[i] ? 1 : 0.22;
      s.dim += (target - s.dim) * ease8;
      s.flash = s.flash > decay ? s.flash - decay : 0;
      const eTarget = i === sel ? 1 : i === this.hover ? 0.85 : active >= 0 && this.focus[i] ? 0.4 : 0;
      s.emph += (eTarget - s.emph) * ease8;
      data[i * 4] = s.dim; data[i * 4 + 1] = s.flash; data[i * 4 + 2] = s.emph; data[i * 4 + 3] = s.crowd;
    }
    if (this.stateTex) this.stateTex.needsUpdate = true;
    if (this.edges) {
      const u = this.edges.material.uniforms;
      u.uActive.value = active;
      u.uBase.value = 0.03 * (0.5 + 0.5 * Math.min(1, Math.max(0, zoom - 1)));
      u.uFocus.value += ((active >= 0 || this.props.search.trim() ? 1 : 0) - u.uFocus.value) * Math.min(1, dt * 6);
    }

    this.stepSignals(dt);
    if (this.labelDirty) this.rebuildLabelSet();
    this.composer.render(dt);
    this.placeLabels(camDist);

    const cpu = performance.now() - t0;
    this.cpuEma += (cpu - this.cpuEma) * 0.05;
    this.statFrames += 1;
    if (this.statFrames % 20 === 0) {
      this.canvas.dataset.frameMs = this.frameEma.toFixed(1);
      this.canvas.dataset.cpuMs = this.cpuEma.toFixed(2);
      this.canvas.dataset.pulses = String(this.pn);
    }
    this.adapt();
  };

  private adapt() {
    if (this.fixedQuality || this.statFrames < 120) return;
    if (this.frameEma > 34) this.slowFrames += 1; else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames < 90 || this.level >= 3) return;
    this.slowFrames = 0;
    this.level += 1;
    if (this.level === 1) this.setPixelRatio(1);
    else if (this.level === 2) this.cortex.geometry.setDrawRange(0, Math.floor(this.cortexCount * 0.55));
    else { this.bloom.enabled = false; }
  }

  private setPixelRatio(dpr: number) {
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);
    this.resize();
  }

  private placeLabels(camDist: number) {
    const pool = this.labels;
    const W = this.width; const H = this.height;
    pool.begin();
    const cam = this.camera;
    const sel = this.props.selected ? this.index.get(this.props.selected) ?? -1 : -1;
    const active = this.activeIndex();
    const PAD = 3;
    // Node names, strictly in priority order: a label is skipped rather than ever overlapping another.
    for (let k = 0; k < this.labelSet.length; k += 1) {
      const i = this.labelSet[k];
      const node = this.nodes[i];
      if (!node || this.sw[i] <= 0.05) continue;
      const isActive = i === active || i === sel;
      const depth = Math.max(0.15, Math.min(1, 1.25 - (this.sw[i] - (camDist - BRAIN_RADIUS)) / (BRAIN_RADIUS * 1.9)));
      if (!isActive && depth < 0.3) continue;
      const label = node.title.length > 32 ? `${node.title.slice(0, 31)}…` : node.title;
      const slot = pool.slot(`n:${node.id}`, 'brain-label', label.replace(/[&<]/g, (m) => (m === '&' ? '&amp;' : '&lt;')));
      pool.setClass(slot, isActive ? 'brain-label active' : node.kind === 'episode' || node.kind === 'tool' ? 'brain-label soft' : 'brain-label');
      const rpx = (this.nodeSize[i] * this.pxScale) / this.sw[i];
      const gap = rpx + 7;
      const sx = this.sx[i]; const sy = this.sy[i];
      const bw = slot.w; const bh = slot.h;
      // Right, left, above, below; clamped into the stage so a picked label near an edge still fits.
      let px = 0; let py = 0; let ok = false;
      for (let o = 0; o < 4 && !ok; o += 1) {
        px = o === 0 ? sx + gap : o === 1 ? sx - gap - bw : sx - bw / 2;
        py = o < 2 ? sy - bh / 2 : o === 2 ? sy - gap - bh : sy + gap;
        px = Math.max(3, Math.min(W - bw - 3, px));
        py = Math.max(3, Math.min(H - bh - 3, py));
        ok = pool.free(px - PAD, py - PAD, bw + PAD * 2, bh + PAD * 2, W, H);
      }
      if (!ok) continue;
      pool.claim(px - PAD, py - PAD, bw + PAD * 2, bh + PAD * 2);
      pool.show(slot, px, py, isActive ? 1 : depth * 0.92);
    }
    // Lobe names float beside their lobe, on the side facing the camera; last in priority.
    for (let l = 0; l < LOBES.length; l += 1) {
      const lobe = LOBES[l];
      const on = lobe.kinds.some((kind) => this.props.visible.has(kind));
      const slot = pool.slot(`lobe:${l}`, 'brain-lobe', `<b>${lobe.name}</b><span>${lobe.role}</span>`);
      const side = lobe.sym ? (cam.position.x >= 0 ? 1 : -1) : 1;
      let ox = lobe.center[0] * side; const oy = lobe.center[1]; const oz = lobe.center[2];
      let nx = ox; let ny = oy + 0.05; let nz = oz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (!lobe.sym) { ox = 0; nx = nx * 0.3; }
      const reach = l === 6 ? 0.28 : l === 0 ? 0.55 : l === 5 ? 0.62 : 0.78;
      this.tmp.set(ox + nx * reach, oy + ny * reach, oz + nz * reach);
      this.tmp.project(cam);
      if (this.tmp.z > 1 || this.tmp.z < -1) continue;
      const x = (this.tmp.x * 0.5 + 0.5) * W;
      const y = (1 - (this.tmp.y * 0.5 + 0.5)) * H;
      this.tmp2.set(ox + nx * reach, oy + ny * reach, oz + nz * reach).applyMatrix4(cam.matrixWorldInverse);
      const d = -this.tmp2.z;
      const depth = Math.max(0.1, Math.min(1, 1.2 - (d - (camDist - BRAIN_RADIUS)) / (BRAIN_RADIUS * 2.1)));
      const lx = x + 6; const ly = y - slot.h / 2;
      if (!pool.free(lx - PAD, ly - PAD, slot.w + 4 + PAD * 2, slot.h + PAD * 2, W, H)) continue;
      pool.claim(lx - PAD, ly - PAD, slot.w + 4 + PAD * 2, slot.h + PAD * 2);
      pool.show(slot, lx, ly, (on ? 0.62 : 0.18) * depth);
    }
    pool.end();
  }

  // ───────────────────────── wiring ─────────────────────────

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pxScale = h / (2 * Math.tan((FOV * Math.PI) / 360));
    this.shared.uPx.value = this.pxScale * this.dpr;
    this.back.material.uniforms.uAspect.value.set(w / h, 1);
  };

  private wire() {
    const canvas = this.canvas;
    const ro = new ResizeObserver(() => {
      const before = this.width / Math.max(1, this.height);
      this.resize();
      // Keep the whole brain in frame when the stage changes shape and nobody has moved the camera.
      if (Math.abs(this.width / this.height - before) > 0.01 && this.time - this.lastInteraction > 1e8 && !this.props.selected) this.homeCamera(true);
    });
    ro.observe(canvas);
    this.observers.push(() => ro.disconnect());

    const io = new IntersectionObserver((entries) => {
      const on = entries.some((e) => e.isIntersecting);
      if (on !== this.visibleOnScreen) { this.visibleOnScreen = on; this.syncRun(); }
    });
    io.observe(canvas);
    this.observers.push(() => io.disconnect());
    const vis = () => this.syncRun();
    document.addEventListener('visibilitychange', vis);
    this.observers.push(() => document.removeEventListener('visibilitychange', vis));

    const touch = () => { this.lastInteraction = this.time; this.controls.autoRotate = false; this.fly = null; };
    this.controls.addEventListener('start', touch);
    this.controls.addEventListener('end', () => { this.lastInteraction = this.time; });

    const local = (e: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      this.pointer.down = true;
      this.downAt = { ...local(e), t: performance.now() };
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.inside = true; this.pointer.moved = true;
    };
    const up = (e: PointerEvent) => {
      this.pointer.down = false;
      const p = local(e);
      if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < 5 && performance.now() - this.downAt.t < 600) {
        this.project();
        const i = this.pickAt(p.x, p.y);
        this.onSelect(i >= 0 ? this.nodes[i].id : null);
      }
      this.pointer.moved = true;
    };
    const leave = () => { this.pointer.inside = false; this.pointer.moved = true; };
    const dbl = () => { this.homeCamera(false); this.lastInteraction = this.time; };
    const lost = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.style.cursor = 'grab';
    this.observers.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('webglcontextlost', lost);
    });
  }

  private running = false;
  private start() { this.syncRun(); }
  private syncRun() {
    const should = this.visibleOnScreen && document.visibilityState !== 'hidden' && !this.disposed;
    if (should && !this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const off of this.observers) off();
    this.controls.dispose();
    this.labels.dispose();
    this.scene.traverse((o: any) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) { for (const mat of Array.isArray(m) ? m : [m]) mat.dispose?.(); }
    });
    this.stateTex?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
