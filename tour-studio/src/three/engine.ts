import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { plasterMaps, worldUVs } from './plaster';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { astar, classifyOpening, dilate, downsample, mergeRects, regionAt, type PlanModel } from '../lib/plan';
import { buildOpening, glazing, openingMats, type OpeningSpec } from './openings';
import { loadInteriorEnv, loadView, realFit, type WindowView } from './real';
import { curtainBreeze, dustMotes, timeUniform } from './anim';
import { roomName, styleById, type StyleDef } from '../lib/styles';
import type { DesignBrief, FurnitureKind, PlanRoom, RoomType } from '../lib/types';
import { bathSet, buildFurniture, disposeGroup, FOOTPRINT, kitchenRun, makeMats, showerGlass, type Mats } from './furniture';
import { floorTexture, skyTexture, smallTileTexture } from './textures';

export const WALL_H = 2.7;
const EYE = 1.55;

type Side = 0 | 1 | 2 | 3;
interface WRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface EngineRoom {
  id: string;
  type: RoomType;
  name: string;
  label: number;
  areaM2: number;
  inner: WRect;
  solid: [number, number, number, number];
  anchor: Side;
  view: THREE.Vector3;
  focus: THREE.Vector3;
}

export type Mode = 'tour' | 'walk' | 'doll';

/** One continuous speed-ramp path: outside a living-room window → living → bedroom → kitchen. */
export interface ReelPath {
  pts: { x: number; z: number; yaw: number; pitch: number }[];
  /** arc-length (in points, 5 cm apart) at: outside, inside the window, end of living glide,
   *  bedroom start, bedroom end, kitchen start, kitchen end */
  keys: number[];
  rooms: string[];
}

export interface FrameInfo {
  t: number;
  duration: number;
  room: string;
  area: number;
  fade: number;
  labels?: { name: string; area: number; x: number; y: number }[];
}

interface Sample {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  room: number;
}

const OVERVIEW = 4.5;

/** Photographic finish: lens vignette, a whisper of edge fringing and fine sensor grain. */
const LENS = {
  uniforms: { tDiffuse: { value: null }, seed: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float seed; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 43.7) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, 0.78, smoothstep(0.08, 0.55, r2 * 1.6));
      // print-like grade: a gentle S-curve, cool shadows, warm highlights
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(-0.010, -0.002, 0.012) * (1.0 - l) + vec3(0.014, 0.005, -0.012) * l;
      float g = hash(vUv * 1024.0) - 0.5;
      c += g * 0.022 * (1.0 - dot(c, vec3(0.3333)) * 0.6);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class TourEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 0.05, 400);
  container: HTMLElement;
  private structure = new THREE.Group();
  private ceiling = new THREE.Group();
  private fixtures = new THREE.Group();
  private furniture = new THREE.Group();
  private roomLights = new THREE.Group();
  private hemi = new THREE.HemisphereLight('#eef2f5', '#b9a993', 1.1);
  private sun = new THREE.DirectionalLight('#fff3e2', 2.4);
  private controls: OrbitControls;
  private model: PlanModel | null = null;
  rooms: EngineRoom[] = [];
  private style: StyleDef = styleById('scandi');
  private mats: Mats = makeMats(this.style);
  private brief: DesignBrief | null = null;
  private extent = 10;
  private grid: { block: Uint8Array; gw: number; gh: number; cell: number } | null = null;
  private samples: Sample[] = [];
  private fps = 30;
  duration = 0;
  mode: Mode = 'tour';
  t = 0;
  playing = false;
  exporting = false;
  onFrame: ((f: FrameInfo) => void) | null = null;
  private raf = 0;
  private last = 0;
  private walk = { yaw: 0, pitch: -0.05, pos: new THREE.Vector3(), target: null as THREE.Vector3 | null, keys: new Set<string>() };
  private floorMeshes: THREE.Object3D[] = [];
  private resizeObs: ResizeObserver;
  private dragging: { x: number; y: number; moved: boolean } | null = null;
  private city: THREE.Group;
  private sky: THREE.Mesh;
  private photoSky = false;
  private view: WindowView | null = null;
  private dust = new THREE.Group();
  private disposed = false;
  private openingsGroup = new THREE.Group();
  private windowLights = new THREE.Group();
  private openingSpecs: OpeningSpec[] = [];
  private downlightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1dc', emissiveIntensity: 0.6 });
  private composer: EffectComposer | null = null;
  private lens: ShaderPass | null = null;
  private dof: BokehPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private focusDist = 4;
  private focusRay = new THREE.Raycaster();
  private gtao: GTAOPass | null = null;
  /** ambient occlusion and multisampled post-processing; off for slow devices */
  hq = true;
  /** an engine kept only for video export renders nothing until it is used */
  idle = false;
  private contextLost = false;
  /** frame-time watchdog: heavy effects step down on slow GPUs */
  private slowFrames = 0;
  private lightFx = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = createRenderer();
    // if the GPU resets (driver hiccup, too much load) drop to the light pipeline instead of going black
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.hq = false;
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    RectAreaLightUniformsLib.init();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    // a photographed interior gives real reflections and soft bounce light
    loadInteriorEnv()
      .then((t) => {
        if (this.disposed) return;
        this.scene.environment = pm.fromEquirectangular(t).texture;
      })
      .catch(() => {});
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#e6e3dc');

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
    );
    this.scene.add(sky);
    this.sky = sky;
    this.city = cityContext();
    this.scene.add(this.city);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.add(this.dust);
    this.scene.add(this.structure, this.ceiling, this.fixtures, this.furniture, this.roomLights, this.openingsGroup, this.windowLights);

    try {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 12 });
      this.gtao.blendIntensity = 0.9;
      this.composer.addPass(this.gtao);
      // a real lens focuses on what it looks at: the far wall or the sofa stays crisp, the chair in front softens
      this.dof = new BokehPass(this.scene, this.camera, { focus: 4, aperture: 0.0011, maxblur: 0.0032 });
      this.composer.addPass(this.dof);
      // daylight blooming softly around windows, as a camera sensor sees it
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.07, 0.4, 1.6);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.lens = new ShaderPass(LENS);
      this.composer.addPass(this.lens);
    } catch {
      this.composer = null;
    }
    this.hq = !/Android|iPhone|iPad/i.test(navigator.userAgent);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.25;
    this.controls.enabled = false;

    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ build

  private toWorld(px: number, py: number) {
    const m = this.model!;
    return new THREE.Vector2((px - (m.hull.x0 + m.hull.x1) / 2) / m.pxPerM, (py - (m.hull.y0 + m.hull.y1) / 2) / m.pxPerM);
  }

  build(model: PlanModel, planRooms: PlanRoom[], brief: DesignBrief) {
    this.model = model;
    this.clear(this.structure);
    this.clear(this.ceiling);
    this.floorMeshes = [];
    const ppm = model.pxPerM;
    const hw = (model.hull.x1 - model.hull.x0) / ppm;
    const hh = (model.hull.y1 - model.hull.y0) / ppm;
    this.extent = Math.max(hw, hh);

    // rooms
    this.rooms = [];
    const typeByLabel = new Map<number, RoomType>();
    const seenLabels = new Set<number>();
    for (const r of planRooms) {
      const reg = regionAt(model, r.sx, r.sy);
      if (!reg || seenLabels.has(reg.label)) continue;
      seenLabels.add(reg.label);
      typeByLabel.set(reg.label, r.type);
      const a = this.toWorld(reg.inner.x0, reg.inner.y0);
      const b = this.toWorld(reg.inner.x1, reg.inner.y1);
      const inner = { x0: a.x, z0: a.y, x1: b.x, z1: b.y };
      const room: EngineRoom = {
        id: r.id,
        type: r.type,
        name: r.name || roomName(r.type),
        label: reg.label,
        areaM2: reg.areaM2,
        inner,
        solid: reg.solid,
        anchor: 0,
        view: new THREE.Vector3(),
        focus: new THREE.Vector3(),
      };
      room.anchor = this.pickAnchor(room, r.type === 'bedroom' || r.type === 'master' ? 2.0 : 1.6);
      this.rooms.push(room);
    }

    // walls
    const cell = Math.max(1, Math.round(ppm * 0.05));
    const wg = downsample(model.wall, model.w, model.h, cell, 0.45);
    const wallGeos: THREE.BufferGeometry[] = [];
    for (const r of mergeRects(wg.grid, wg.gw, wg.gh)) {
      const p = this.toWorld((r.x + r.w / 2) * cell, (r.y + r.h / 2) * cell);
      const g = new THREE.BoxGeometry((r.w * cell) / ppm, WALL_H, (r.h * cell) / ppm);
      g.translate(p.x, WALL_H / 2, p.y);
      wallGeos.push(g);
    }
    const plaster = plasterMaps();
    const wallMat = new THREE.MeshStandardMaterial({
      color: this.style.wall,
      roughness: 1,
      roughnessMap: plaster.rough,
      bumpMap: plaster.bump,
      bumpScale: 0.35,
    });
    wallMat.name = 'wall';
    if (wallGeos.length) {
      const walls = new THREE.Mesh(worldUVs(mergeGeometries(wallGeos), 1.6), wallMat);
      walls.castShadow = walls.receiveShadow = true;
      walls.name = 'walls';
      this.structure.add(walls);
      // skirting boards: a slightly wider sleeve at the foot of every wall
      const skirt = wallGeos.map((g) => {
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const k = new THREE.BoxGeometry(b.max.x - b.min.x + 0.024, 0.08, b.max.z - b.min.z + 0.024);
        k.translate((b.min.x + b.max.x) / 2, 0.04, (b.min.z + b.max.z) / 2);
        return k;
      });
      const sk = new THREE.Mesh(mergeGeometries(skirt), new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.5 }));
      sk.name = 'skirting';
      sk.receiveShadow = true;
      this.structure.add(sk);
    }

    // doors, windows and sliders found in the plan
    this.openingSpecs = [];
    const isBalcony = (l: number) => typeByLabel.get(l) === 'balcony';
    const curtainRooms: RoomType[] = ['living', 'master', 'bedroom', 'kids', 'office', 'dining', 'mamad'];
    for (const o of model.openings) {
      const kind = classifyOpening(o, isBalcony);
      const a = this.toWorld(o.x0, o.y0),
        b = this.toWorld(o.x1, o.y1);
      const along = o.axis === 'x' ? 'x' : 'z';
      const width = along === 'x' ? b.x - a.x : b.y - a.y;
      const depth = Math.max(0.08, along === 'x' ? b.y - a.y : b.x - a.x);
      let inward: 1 | -1 = 1;
      if (kind === 'slider' && (isBalcony(o.la) || isBalcony(o.lb))) inward = isBalcony(o.la) ? 1 : -1;
      else if (o.outA || o.outB) inward = o.outA ? 1 : -1;
      else inward = (typeByLabel.get(o.lb) || 'hall') === 'hall' ? -1 : 1;
      const roomLabel = inward === 1 ? o.lb : o.la;
      this.openingSpecs.push({
        kind,
        cx: (a.x + b.x) / 2,
        cz: (a.y + b.y) / 2,
        along,
        width,
        depth,
        inward,
        curtains: curtainRooms.includes(typeByLabel.get(roomLabel) as RoomType),
      });
    }

    // floors per finish
    const fc = Math.max(1, Math.round(ppm * 0.1));
    const fgw = Math.ceil(model.w / fc),
      fgh = Math.ceil(model.h / fc);
    const finish = { main: new Uint8Array(fgw * fgh), wet: new Uint8Array(fgw * fgh), deck: new Uint8Array(fgw * fgh) };
    const ceil = new Uint8Array(fgw * fgh);
    for (let gy = 0; gy < fgh; gy++)
      for (let gx = 0; gx < fgw; gx++) {
        const x = Math.min(model.w - 1, gx * fc + (fc >> 1)),
          y = Math.min(model.h - 1, gy * fc + (fc >> 1));
        const i = y * model.w + x;
        if (!model.interior[i]) continue;
        const t = typeByLabel.get(model.labels[i]);
        const k = gy * fgw + gx;
        if (t === 'bathroom') finish.wet[k] = 1;
        else if (t === 'balcony') finish.deck[k] = 1;
        else finish.main[k] = 1;
        if (t !== 'balcony') ceil[k] = 1;
      }
    const rectsGeo = (grid: Uint8Array, y: number, metres: number, down = false) => {
      const geos: THREE.BufferGeometry[] = [];
      for (const r of mergeRects(grid, fgw, fgh)) {
        const a = this.toWorld(r.x * fc, r.y * fc);
        const b = this.toWorld((r.x + r.w) * fc, (r.y + r.h) * fc);
        const g = new THREE.PlaneGeometry(b.x - a.x, b.y - a.y);
        g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
        g.translate((a.x + b.x) / 2, y, (a.y + b.y) / 2);
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / metres, -pos.getZ(i) / metres);
        geos.push(g);
      }
      return geos.length ? mergeGeometries(geos) : null;
    };
    const ft = floorTexture(this.style.floor, this.style.floorTone);
    const floors: [Uint8Array, THREE.Material, number, string][] = [
      [finish.main, floorMaterial(ft), ft.metres, 'floor-main'],
      [finish.wet, new THREE.MeshStandardMaterial({ map: smallTileTexture('#d8d6d1'), roughness: 0.35 }), 1.2, 'floor-wet'],
      [finish.deck, new THREE.MeshStandardMaterial({ map: smallTileTexture('#c9bfae', 'rgba(0,0,0,0.25)', 4), roughness: 0.8 }), 2.4, 'floor-deck'],
    ];
    for (const [grid, mat, metres, name] of floors) {
      const g = rectsGeo(grid, 0, metres);
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.name = name;
      this.structure.add(m);
      this.floorMeshes.push(m);
    }
    const cg = rectsGeo(ceil, WALL_H, 1, true);
    if (cg) {
      const pm = plasterMaps();
      const cm = new THREE.Mesh(
        worldUVs(cg, 2.2),
        new THREE.MeshStandardMaterial({ color: this.style.ceiling, roughness: 1, roughnessMap: pm.rough, bumpMap: pm.bump, bumpScale: 0.25 }),
      );
      cm.name = 'ceiling';
      this.ceiling.add(cm);
    }
    // concrete slab under the flat, so the cut-away model has real thickness
    const slabGeo = rectsGeo(ceil.map((v, i) => v | finish.deck[i]), 0, 1);
    if (slabGeo) {
      slabGeo.computeBoundingBox();
      const geos: THREE.BufferGeometry[] = [];
      for (const r of mergeRects(ceil.map((v, i) => v | finish.deck[i]), fgw, fgh)) {
        const a = this.toWorld(r.x * fc, r.y * fc),
          b = this.toWorld((r.x + r.w) * fc, (r.y + r.h) * fc);
        const g = new THREE.BoxGeometry(b.x - a.x, 0.3, b.y - a.y);
        g.translate((a.x + b.x) / 2, -0.151, (a.y + b.y) / 2);
        geos.push(g);
      }
      const slab = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: '#cfcac1', roughness: 0.95 }));
      slab.receiveShadow = true;
      this.structure.add(slab);
      slabGeo.dispose();
    }
    // recessed downlights, about one per 3 m²
    const discGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20);
    for (const r of this.rooms) {
      if (r.type === 'balcony') continue;
      const W = r.inner.x1 - r.inner.x0,
        D = r.inner.z1 - r.inner.z0;
      const nx = Math.max(1, Math.min(4, Math.round(W / 1.7))),
        nz = Math.max(1, Math.min(4, Math.round(D / 1.7)));
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const d = new THREE.Mesh(discGeo, this.downlightMat);
          d.position.set(r.inner.x0 + (W * (i + 0.5)) / nx, WALL_H - 0.005, r.inner.z0 + (D * (j + 0.5)) / nz);
          this.ceiling.add(d);
        }
    }

    // sun & shadow frustum
    const sc = this.sun.shadow.camera;
    const e = this.extent * 0.75 + 2;
    sc.left = -e;
    sc.right = e;
    sc.top = e;
    sc.bottom = -e;
    sc.near = 1;
    sc.far = 60;
    sc.updateProjectionMatrix();
    this.sun.position.set(-6, 18, 9);
    this.sun.target.position.set(0, 0, 0);

    // navigation grid (0.1 m) with clearance from walls
    const navCell = fc;
    const clearance = Math.round(ppm * 0.28);
    const blockedPx = dilate(model.wall, model.w, model.h, clearance);
    const block = new Uint8Array(fgw * fgh);
    for (let gy = 0; gy < fgh; gy++)
      for (let gx = 0; gx < fgw; gx++) {
        const x = Math.min(model.w - 1, gx * navCell + (navCell >> 1)),
          y = Math.min(model.h - 1, gy * navCell + (navCell >> 1));
        const i = y * model.w + x;
        block[gy * fgw + gx] = !model.interior[i] || blockedPx[i] ? 1 : 0;
      }
    for (const o of model.openings) {
      const k = classifyOpening(o, isBalcony);
      if (k !== 'window' && k !== 'facade') continue;
      for (let y = Math.floor(o.y0 / navCell) - 1; y <= Math.ceil(o.y1 / navCell) + 1; y++)
        for (let x = Math.floor(o.x0 / navCell) - 1; x <= Math.ceil(o.x1 / navCell) + 1; x++)
          if (x >= 0 && y >= 0 && x < fgw && y < fgh) block[y * fgw + x] = 1;
    }
    this.grid = { block, gw: fgw, gh: fgh, cell: navCell };
    this.clear(this.dust);
    this.dust.add(dustMotes(this.rooms.filter((r) => r.type !== 'balcony').map((r) => r.inner)));

    this.applyBrief(brief, true);
    this.setMode(this.mode);
  }

  private clear(g: THREE.Group) {
    disposeGroup(g);
    g.clear();
  }

  private sideLen(r: EngineRoom, s: Side) {
    const W = r.inner.x1 - r.inner.x0,
      D = r.inner.z1 - r.inner.z0;
    return s % 2 === 0 ? { len: W, depth: D } : { len: D, depth: W };
  }

  private pickAnchor(r: EngineRoom, minLen: number): Side {
    let best: Side = 0,
      bestScore = -1;
    for (const s of [0, 1, 2, 3] as Side[]) {
      const { len } = this.sideLen(r, s);
      const score = r.solid[s] * 2 + Math.min(len / 3.2, 1) - (len < minLen ? 2 : 0);
      if (score > bestScore) (bestScore = score), (best = s);
    }
    return best;
  }

  /** Place an object against side `s`: `along` offset on the wall, `depth` = distance from wall to object centre. */
  private put(obj: THREE.Object3D, r: EngineRoom, s: Side, along: number, depth: number, face: 'in' | 'out' = 'in') {
    const R = r.inner;
    const cx = (R.x0 + R.x1) / 2,
      cz = (R.z0 + R.z1) / 2;
    let x = cx,
      z = cz,
      rot = 0;
    if (s === 0) (x = cx + along), (z = R.z0 + depth), (rot = 0);
    if (s === 2) (x = cx - along), (z = R.z1 - depth), (rot = Math.PI);
    if (s === 1) (x = R.x1 - depth), (z = cz + along), (rot = -Math.PI / 2);
    if (s === 3) (x = R.x0 + depth), (z = cz - along), (rot = Math.PI / 2);
    obj.position.set(x, 0, z);
    obj.rotation.y = rot + (face === 'out' ? Math.PI : 0);
    return obj;
  }

  /** Pick where a photographer would stand: far side of the room, slightly off-centre, clear of furniture. */
  private computeView(r: EngineRoom) {
    const a = r.anchor;
    const { len: L, depth: D } = this.sideLen(r, a);
    const tmp = new THREE.Object3D();
    const clearance = (x: number, z: number) => {
      let c = 9;
      for (const f of this.footprints) {
        const dx = Math.max(f.x0 - x, 0, x - f.x1);
        const dz = Math.max(f.z0 - z, 0, z - f.z1);
        c = Math.min(c, Math.hypot(dx, dz));
      }
      return c;
    };
    let best: { x: number; z: number; along: number } | null = null;
    let bestScore = -Infinity;
    for (let depth = 0.35; depth <= D - 0.3; depth += 0.2)
      for (let along = -(L / 2 - 0.3); along <= L / 2 - 0.3; along += 0.2) {
        this.put(tmp, r, a, along, depth);
        const { x, z } = tmp.position;
        if (this.blockedAt(x, z)) continue;
        const c = clearance(x, z);
        if (c < 0.3) continue;
        const score = -Math.abs(depth - D * 0.9) - 0.6 * Math.abs(Math.abs(along) - L * 0.25) + Math.min(c, 1) * 0.4;
        if (score > bestScore) (bestScore = score), (best = { x, z, along });
      }
    if (best) {
      r.view.set(best.x, EYE, best.z);
      this.put(tmp, r, a, -Math.sign(best.along || 1) * L * 0.12, Math.min(1.0, D * 0.3));
    } else {
      this.put(tmp, r, a, 0, D / 2);
      const s = this.snap(tmp.position.x, tmp.position.z) || new THREE.Vector2(tmp.position.x, tmp.position.z);
      r.view.set(s.x, EYE, s.y);
      this.put(tmp, r, a, 0, 0.2);
    }
    r.focus.set(tmp.position.x, 0.95, tmp.position.z);
  }

  private footprints: WRect[] = [];
  private nav: Uint8Array | null = null;

  /** Furniture becomes an obstacle for walking and for the tour path; then views and path are rebuilt. */
  private refreshNav() {
    const g = this.grid;
    if (!g) return;
    this.footprints = [];
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // open door leaves stand in the room: keep the camera clear of them
    this.openingsGroup.traverse((o) => {
      if (!o.userData.leaf) return;
      box.setFromObject(o);
      this.footprints.push({ x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z });
    });
    for (const grp of [this.furniture, this.fixtures])
      for (const o of grp.children) {
        box.setFromObject(o);
        if (box.isEmpty() || box.max.y < 0.08) continue; // rugs
        this.footprints.push({ x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z });
      }
    const nav = g.block.slice();
    const pad = 0.22;
    for (const f of this.footprints) {
      const [ax, ay] = this.cellOf(f.x0 - pad, f.z0 - pad);
      const [bx, by] = this.cellOf(f.x1 + pad, f.z1 + pad);
      for (let y = Math.max(0, ay); y <= Math.min(g.gh - 1, by); y++)
        for (let x = Math.max(0, ax); x <= Math.min(g.gw - 1, bx); x++) nav[y * g.gw + x] = 1;
    }
    this.nav = nav;
    for (const r of this.rooms) this.computeView(r);
    this.buildTimeline();
  }

  private cellOf(x: number, z: number) {
    const m = this.model!,
      g = this.grid!;
    const px = x * m.pxPerM + (m.hull.x0 + m.hull.x1) / 2;
    const py = z * m.pxPerM + (m.hull.y0 + m.hull.y1) / 2;
    return [Math.floor(px / g.cell), Math.floor(py / g.cell)] as [number, number];
  }
  private cellCenter(cx: number, cy: number) {
    const g = this.grid!;
    return this.toWorld((cx + 0.5) * g.cell, (cy + 0.5) * g.cell);
  }
  private blockedAt(x: number, z: number) {
    const g = this.grid;
    if (!g) return false;
    const [cx, cy] = this.cellOf(x, z);
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return true;
    return !!(this.nav || g.block)[cy * g.gw + cx];
  }
  private snap(x: number, z: number) {
    const g = this.grid!;
    const [cx, cy] = this.cellOf(x, z);
    for (let r = 0; r < 25; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= g.gw || ny >= g.gh) continue;
          if (!(this.nav || g.block)[ny * g.gw + nx]) return this.cellCenter(nx, ny);
        }
    return null;
  }

  // ------------------------------------------------------------ style & furniture

  applyBrief(brief: DesignBrief, structureOnly = false) {
    const styleChanged = !this.brief || this.brief.style !== brief.style || structureOnly;
    this.brief = brief;
    if (styleChanged) {
      this.style = styleById(brief.style);
      this.mats = makeMats(this.style);
      const walls = this.structure.getObjectByName('walls') as THREE.Mesh | undefined;
      if (walls) (walls.material as THREE.MeshStandardMaterial).color.set(this.style.wall);
      const floor = this.structure.getObjectByName('floor-main') as THREE.Mesh | undefined;
      if (floor) {
        const ft = floorTexture(this.style.floor, this.style.floorTone);
        const old = floor.material as THREE.Material;
        floor.material = floorMaterial(ft);
        old.dispose();
        // re-scale uv to the new texture size
        const g = floor.geometry;
        const pos = g.attributes.position,
          uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ft.metres, -pos.getZ(i) / ft.metres);
        uv.needsUpdate = true;
      }
      const ceil = this.ceiling.getObjectByName('ceiling') as THREE.Mesh | undefined;
      if (ceil) (ceil.material as THREE.MeshStandardMaterial).color.set(this.style.ceiling);
      this.buildOpenings();
      this.furnish();
      this.refreshNav();
    }
    this.furniture.visible = brief.furnish;
    this.setLighting(brief.light);
    this.setView(brief.view || 'nature');
  }

  private furnish() {
    this.clear(this.furniture);
    this.clear(this.fixtures);
    const s = this.style,
      m = this.mats;
    const F = this.furniture,
      X = this.fixtures;
    const has = (t: RoomType) => this.rooms.some((r) => r.type === t);
    for (const r of this.rooms) {
      const a = r.anchor;
      const opp = ((a + 2) % 4) as Side;
      const { len: L, depth: D } = this.sideLen(r, a);
      const perp = [((a + 1) % 4) as Side, ((a + 3) % 4) as Side].sort((p, q) => r.solid[q] - r.solid[p]);
      const add = (g: THREE.Group, obj: THREE.Object3D) => g.add(obj);

      if (r.type === 'living') {
        if (L < 1.8 || D < 2) continue;
        const sw = Math.max(1.6, Math.min(2.4, L - 1.0));
        add(F, this.put(this.piece('sofa', { w: sw }), r, a, 0, 0.5));
        const artL = this.put(this.piece('art', { w: Math.min(1.3, sw * 0.6) }), r, a, 0, 0.02);
        artL.position.y = 1.32;
        add(F, artL);
        const zone = Math.min(D, 4.4);
        const rw = Math.min(sw + 0.7, L - 0.3),
          rd = Math.min(2.0, zone - 1.1);
        if (rd > 1) add(F, this.put(this.piece('rug', { w: rw, d: rd }), r, a, 0, 0.75 + rd / 2));
        add(F, this.put(this.piece('coffeeTable'), r, a, 0, 1.55));
        if (s.id === 'classic' || s.id === 'boho' || s.id === 'modern') {
          const pouf = realFit('pouf', { width: 0.58 });
          if (pouf) add(F, this.put(pouf, r, a, -(sw / 2 - 0.25), 1.75));
        }
        if (D <= 5.4 && D >= 2.8) add(F, this.put(this.piece('tvUnit', { w: Math.min(1.9, L - 0.6) }), r, opp, 0, 0.23));
        else if (D > 5.4) {
          for (const sg of [-1, 1]) add(F, this.put(this.piece('armchair'), r, a, sg * 0.5, 2.75, 'out'));
          if (D - zone >= 2.4 && !has('dining') && !has('kitchen'))
            add(F, this.put(this.piece('diningTable', { seats: L > 3 ? 6 : 4 }), r, a, 0, zone + (D - zone) / 2));
        }
        if (D > 5.4 && D - zone >= 2.4 && !has('dining') && has('kitchen'))
          add(F, this.put(this.piece('diningTable', { seats: L > 3 ? 6 : 4 }), r, a, 0, zone + (D - zone) / 2));
        if (L - sw > 1.4 && D <= 5.4) {
          const ac = this.put(this.piece('armchair'), r, a, sw / 2 + 0.6, 1.35);
          ac.rotation.y -= 0.6;
          add(F, ac);
        }
        if (L - sw > 0.7) add(F, this.put(this.piece('floorLamp'), r, a, -(sw / 2 + 0.3), 0.3));
        if (s.plants > 0.3) add(F, this.put(this.piece('plant', { w: 1.5 }), r, opp, L / 2 - 0.35, 0.35));
      } else if (r.type === 'master' || r.type === 'bedroom') {
        const bw = L >= 2.6 ? 1.6 : L >= 2.1 ? 1.4 : 0;
        if (!bw || D < 2.4) continue;
        add(F, this.put(this.piece('bed', { w: bw }), r, a, 0, 1.1));
        const artB = this.put(this.piece('art', { w: Math.min(1.1, bw * 0.7) }), r, a, 0, 0.02);
        artB.position.y = 1.55;
        add(F, artB);
        if (L >= bw + 1.1)
          for (const sg of [-1, 1]) add(F, this.put(this.piece('nightstand'), r, a, sg * (bw / 2 + 0.33), 0.22));
        if (D >= 3.5) add(F, this.put(this.piece('wardrobe', { w: Math.min(2.4, L - 0.6) }), r, opp, 0, 0.3));
        else if ((L - bw) / 2 >= 1.15) add(F, this.put(this.piece('wardrobe', { w: Math.min(2.0, D - 0.4) }), r, perp[0], 0, 0.3));
        add(F, this.put(this.piece('rug', { w: Math.min(bw + 1.0, L - 0.3), d: 1.6 }), r, a, 0, 1.75));
        if (s.plants > 0.5 && L > 3) add(F, this.put(this.piece('plant', { w: 1.2 }), r, a, L / 2 - 0.3, 0.3));
      } else if (r.type === 'kids') {
        if (L < 1.6 || D < 2.2) continue;
        add(F, this.put(this.piece('singleBed'), r, a, -(L / 2) + 0.55, 1.1));
        if (D >= 3.3) add(F, this.put(this.piece('desk'), r, opp, 0, 0.33));
        else if (L >= 2.8) add(F, this.put(this.piece('desk'), r, a, L / 2 - 0.7, 0.33));
        add(F, this.put(this.piece('shelf'), r, perp[0], 0, 0.18));
        add(F, this.put(this.piece('rug', { w: 1.4, d: 1.0 }), r, a, L / 2 - 1.0, Math.min(D - 0.8, 1.8)));
      } else if (r.type === 'office' || r.type === 'mamad') {
        if (L < 1.5 || D < 1.8) continue;
        add(F, this.put(this.piece('desk'), r, a, 0, 0.33));
        add(F, this.put(this.piece('shelf'), r, perp[0], 0, 0.18));
        if (D > 2.8 && L > 2.4) {
          const ac = this.put(this.piece('armchair'), r, opp, L / 2 - 0.6, 0.6);
          add(F, ac);
        }
        if (s.plants > 0.4) add(F, this.put(this.piece('plant', { w: 1.1 }), r, a, -L / 2 + 0.3, 0.3));
      } else if (r.type === 'dining') {
        add(F, this.put(this.piece('diningTable', { seats: L > 3.2 ? 6 : 4 }), r, a, 0, D / 2));
        if (D >= 3.6) add(F, this.put(this.piece('sideboard'), r, a, 0, 0.22));
      } else if (r.type === 'kitchen') {
        if (L >= 1.6) add(X, this.put(kitchenRun(s, m, L - 0.04), r, a, 0, 0.3));
        const pl = this.sideLen(r, perp[0]);
        if (L < 2.6 && pl.len > 2.2) add(X, this.put(kitchenRun(s, m, pl.len - 0.7, false), r, perp[0], 0.35, 0.3));
        if (D >= 3.3) add(F, this.put(this.piece('diningTable', { seats: 4 }), r, a, 0, Math.max(1.9, D - 1.0)));
      } else if (r.type === 'bathroom') {
        add(X, this.put(bathSet(s, m, L), r, a, -L / 2 + Math.min(1.0, L * 0.45) / 2 + 0.05, 0.24));
        if (D > 1.8 && L > 1.4) add(X, this.put(showerGlass(m), r, opp, L / 2 - 0.5, 0.9));
      } else if (r.type === 'balcony') {
        if (Math.min(L, D) >= 1.2) {
          const b = this.put(this.piece('bistroSet'), r, a, 0, D / 2);
          if (L < D) b.rotation.y += Math.PI / 2;
          add(F, b);
        }
        for (const sg of [-1, 1]) add(F, this.put(this.piece('plant', { w: 1.3 }), r, a, sg * (L / 2 - 0.3), 0.3));
      } else if (r.type === 'hall') {
        if (L >= 2.2 && D >= 1.5) add(F, this.put(this.piece('sideboard', { w: Math.min(1.4, L - 0.6) }), r, a, 0, 0.22));
      }
    }
    // curtains are styling, so they come and go with the furniture
    const om = this.openingMatsCache;
    if (om) for (const spec of this.openingSpecs) if (spec.curtains) this.furniture.add(buildOpening(spec, om, WALL_H, 'curtains'));
    // tag lamp shades for evening glow
    this.furniture.traverse((o) => {
      if (o.userData.lamp) (o as THREE.Mesh).material = this.mats.lampShade;
    });
  }

  private library = new Map<FurnitureKind, { obj: THREE.Object3D; rotate: number }>();

  /** Real 3D models (GLB) uploaded by the user replace the procedural piece of that kind. */
  setLibrary(lib: Map<FurnitureKind, { obj: THREE.Object3D; rotate: number }>) {
    this.library = lib;
    if (this.model) {
      this.furnish();
      this.refreshNav();
      this.furniture.visible = this.brief?.furnish ?? true;
    }
  }

  private piece(kind: FurnitureKind, opts: { w?: number; d?: number; seats?: number } = {}) {
    const lib = this.library.get(kind);
    if (!lib) return buildFurniture(kind, this.style, this.mats, opts);
    const holder = new THREE.Group();
    const obj = lib.obj.clone(true);
    obj.rotation.y = (lib.rotate * Math.PI) / 180;
    const wrap = new THREE.Group();
    wrap.add(obj);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    const [fw, fd] = FOOTPRINT[kind];
    const targetW = kind === 'rug' ? opts.w || fw : kind === 'sofa' || kind === 'tvUnit' || kind === 'sideboard' || kind === 'wardrobe' ? opts.w || fw : fw;
    const k = Math.min(targetW / Math.max(size.x, 0.01), (kind === 'rug' ? opts.d || fd : fd * 1.6) / Math.max(size.z, 0.01));
    wrap.scale.setScalar(k);
    const b2 = new THREE.Box3().setFromObject(wrap);
    const c = b2.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -b2.min.y, -c.z);
    wrap.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.libraryAsset = true;
      }
    });
    holder.add(wrap);
    return holder;
  }

  private openingMatsCache: ReturnType<typeof openingMats> | null = null;

  private buildOpenings() {
    this.clear(this.openingsGroup);
    this.clear(this.windowLights);
    const walls = this.structure.getObjectByName('walls') as THREE.Mesh | undefined;
    const wallMat = (walls?.material as THREE.Material) || new THREE.MeshStandardMaterial({ color: this.style.wall });
    const om = openingMats(this.style, this.mats, wallMat);
    curtainBreeze(om.curtain);
    this.openingMatsCache = om;
    for (const spec of this.openingSpecs) this.openingsGroup.add(buildOpening(spec, om, WALL_H));
    // daylight through the glass: soft area lights at the biggest openings
    const lit = this.openingSpecs.filter((o) => glazing(o.kind)).sort((a, b) => b.width - a.width).slice(0, 8);
    for (const o of lit) {
      const gz = glazing(o.kind)!;
      const h = gz.y1 - gz.y0;
      const light = new THREE.RectAreaLight('#fff4e6', 5.5, o.width * 0.9, h);
      const n = o.along === 'x' ? new THREE.Vector3(0, 0, o.inward) : new THREE.Vector3(o.inward, 0, 0);
      light.position.set(o.cx, gz.y0 + h / 2, o.cz).addScaledVector(n, o.depth / 2 + 0.03);
      light.lookAt(light.position.clone().add(n));
      this.windowLights.add(light);
    }
  }

  private setLighting(light: 'day' | 'evening') {
    this.clear(this.roomLights);
    const evening = light === 'evening';
    this.hemi.intensity = evening ? 0.15 : 0.75;
    this.sun.intensity = evening ? 0 : 2.6;
    this.scene.environmentIntensity = evening ? 0.1 : 0.5;
    // windows read bright by day, like an interior photograph exposed for the room
    this.scene.backgroundIntensity = evening ? 0.22 : 1.3;
    this.renderer.toneMappingExposure = evening ? 1.3 : 1.15;
    this.mats.lampShade.emissiveIntensity = evening ? 2.2 : 0;
    this.windowLights.visible = !evening;
    this.downlightMat.emissiveIntensity = evening ? 4 : 0.6;
    if (evening) {
      const rooms = [...this.rooms].sort((a, b) => b.areaM2 - a.areaM2).slice(0, 8);
      for (const r of rooms) {
        const c = new THREE.Vector3((r.inner.x0 + r.inner.x1) / 2, WALL_H - 0.35, (r.inner.z0 + r.inner.z1) / 2);
        const pl = new THREE.PointLight('#ffcf98', 9 + r.areaM2 * 0.35, Math.max(4, Math.sqrt(r.areaM2) * 2.2), 1.6);
        pl.position.copy(c);
        this.roomLights.add(pl);
      }
    }
  }

  // ------------------------------------------------------------ tour timeline

  private buildTimeline() {
    this.samples = [];
    if (!this.rooms.length || !this.grid) {
      this.duration = OVERVIEW;
      return;
    }
    const order: EngineRoom[] = [];
    // corridors and stores are walked through, not presented
    const pool = this.rooms.filter((r) => {
      if (r.type === 'storage' || r.type === 'hall') return false;
      const W = r.inner.x1 - r.inner.x0,
        D = r.inner.z1 - r.inner.z0;
      return Math.min(W, D) >= 1.2 || r.type === 'bathroom';
    });
    const living = pool.find((r) => r.type === 'living') || pool[0];
    order.push(living);
    let rest = pool.filter((r) => r !== living);
    const balconies = rest.filter((r) => r.type === 'balcony');
    rest = rest.filter((r) => r.type !== 'balcony');
    let cur = living;
    while (rest.length) {
      rest.sort((a, b) => a.view.distanceTo(cur.view) - b.view.distanceTo(cur.view));
      cur = rest.shift()!;
      order.push(cur);
    }
    order.push(...balconies);

    const dt = 1 / this.fps;
    const S = this.samples;
    const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
    const pushSample = (x: number, z: number, yaw: number, pitch: number, room: number) => {
      if (S.length) {
        const prev = S[S.length - 1].yaw;
        while (yaw - prev > Math.PI) yaw -= Math.PI * 2;
        while (yaw - prev < -Math.PI) yaw += Math.PI * 2;
      }
      S.push({ x, z, yaw, pitch, room });
    };

    const look = (r: EngineRoom, idx: number, dur: number, sweep: number, dolly = 0) => {
      const base = yawTo(r.view, r.focus);
      const n = Math.round(dur / dt);
      const dir = new THREE.Vector2(Math.sin(base), Math.cos(base));
      for (let i = 0; i <= n; i++) {
        const k = ease(i / n);
        const p = new THREE.Vector2(r.view.x, r.view.z).addScaledVector(dir, dolly * k);
        pushSample(p.x, p.y, base - sweep / 2 + sweep * k, -0.08, idx);
      }
    };

    const move = (a: EngineRoom, b: EngineRoom, idx: number) => {
      const g = this.grid!;
      const s = this.cellOf(a.view.x, a.view.z),
        t = this.cellOf(b.view.x, b.view.z);
      const cells =
        (this.nav && astar(this.nav, g.gw, g.gh, s[0], s[1], t[0], t[1])) || astar(g.block, g.gw, g.gh, s[0], s[1], t[0], t[1]);
      let pts: THREE.Vector2[];
      if (cells && cells.length > 1) pts = cells.map(([cx, cy]) => this.cellCenter(cx, cy));
      else pts = [new THREE.Vector2(a.view.x, a.view.z), new THREE.Vector2(b.view.x, b.view.z)];
      // Chaikin smoothing
      for (let it = 0; it < 3 && pts.length > 2; it++) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          out.push(pts[i].clone().lerp(pts[i + 1], 0.25), pts[i].clone().lerp(pts[i + 1], 0.75));
        }
        out.push(pts[pts.length - 1]);
        pts = out;
      }
      const curve = new THREE.SplineCurve(pts);
      const len = curve.getLength();
      const dur = Math.max(1.2, len / 0.95);
      const n = Math.round(dur / dt);
      const startYaw = S.length ? S[S.length - 1].yaw : 0;
      const endYaw = yawTo(b.view, b.focus);
      const headingAt = (u: number) => {
        const p = curve.getPointAt(u);
        const ahead = curve.getPointAt(Math.min(1, u + 1.1 / Math.max(len, 0.5)));
        return p.distanceTo(ahead) > 0.05 ? Math.atan2(ahead.x - p.x, ahead.y - p.y) : endYaw;
      };
      // a person turns to face the way out before walking, and turns to the room on arrival:
      // never walk backwards, never whip round mid-stride
      const turn = (x: number, z: number, from: number, to: number) => {
        let d = to - from;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 0.35) return;
        const m = Math.round((0.6 + Math.abs(d) * 0.8) / dt);
        for (let i = 1; i <= m; i++) pushSample(x, z, from + d * ease(i / m), -0.06, idx);
      };
      const first = curve.getPointAt(0);
      const h0 = headingAt(0);
      turn(first.x, first.y, startYaw, h0);
      for (let i = 1; i <= n; i++) {
        const u = ease(i / n);
        const p = curve.getPointAt(u);
        let yaw = headingAt(u);
        const k = i / n;
        if (k < 0.15) yaw = lerpAngle(h0, yaw, k / 0.15);
        pushSample(p.x, p.y, yaw, -0.05, idx);
      }
      // arrive facing where the room's slow pan begins, so the pan follows without a jolt
      const last = S[S.length - 1];
      turn(last.x, last.z, last.yaw, endYaw - (b.areaM2 > 14 ? 1.1 : 0.8) / 2);
    };

    order.forEach((r, i) => {
      if (i > 0) move(order[i - 1], r, i);
      const big = r.areaM2 > 14;
      look(r, i, big ? 5.2 : 3.6, big ? 1.1 : 0.8, i === 0 ? 0.5 : 0);
    });

    // smooth yaw/position (forward + backward pass)
    const smooth = (key: 'x' | 'z' | 'yaw', a: number) => {
      for (let i = 1; i < S.length; i++) S[i][key] = S[i - 1][key] + (S[i][key] - S[i - 1][key]) * a;
      for (let i = S.length - 2; i >= 0; i--) S[i][key] = S[i + 1][key] + (S[i][key] - S[i + 1][key]) * a;
    };
    smooth('yaw', 0.12);
    smooth('x', 0.35);
    smooth('z', 0.35);
    // a steady operator never pans faster than ~75°/s: rate-limit both ways and meet in the middle
    const maxStep = 1.3 * dt;
    const fwd = S.map((x) => x.yaw),
      bwd = fwd.slice();
    for (let i = 1; i < fwd.length; i++) fwd[i] = fwd[i - 1] + Math.max(-maxStep, Math.min(maxStep, fwd[i] - fwd[i - 1]));
    for (let i = bwd.length - 2; i >= 0; i--) bwd[i] = bwd[i + 1] + Math.max(-maxStep, Math.min(maxStep, bwd[i] - bwd[i + 1]));
    S.forEach((x, i) => (x.yaw = (fwd[i] + bwd[i]) / 2));
    this.tourRooms = order;
    this.duration = OVERVIEW + S.length / this.fps;
  }

  private tourRooms: EngineRoom[] = [];

  /** Fade-to-black amount at time t (cut from overview to walkthrough). */
  fadeAt(t: number) {
    const d = Math.abs(t - OVERVIEW);
    const edge = t > this.duration - 0.6 ? (t - (this.duration - 0.6)) / 0.6 : 0;
    return Math.max(d < 0.4 ? 1 - d / 0.4 : 0, Math.min(1, edge));
  }

  private poseAt(t: number): { room: EngineRoom | null; overview: boolean } {
    if (t < OVERVIEW || !this.samples.length) {
      const k = Math.min(1, t / OVERVIEW);
      const ang = -0.6 + k * 0.9;
      const r = this.extent * 0.62 + 2;
      const h = this.extent * 0.72 + 3 - k * 1.2;
      this.camera.position.set(Math.sin(ang) * r, h, Math.cos(ang) * r);
      this.camera.lookAt(0, 0, 0);
      return { room: null, overview: true };
    }
    const f = (t - OVERVIEW) * this.fps;
    const i = Math.min(this.samples.length - 1, Math.floor(f));
    const j = Math.min(this.samples.length - 1, i + 1);
    const u = f - i;
    const a = this.samples[i],
      b = this.samples[j];
    const x = a.x + (b.x - a.x) * u,
      z = a.z + (b.z - a.z) * u;
    const yaw = a.yaw + (b.yaw - a.yaw) * u;
    const pitch = a.pitch + (b.pitch - a.pitch) * u;
    // a hint of hand-held camera: breathing, not shaking
    const hx = Math.sin(t * 0.71) * 0.008 + Math.sin(t * 1.9) * 0.002;
    const hy = Math.sin(t * 0.53 + 1) * 0.006;
    const hyaw = Math.sin(t * 0.37) * 0.004;
    this.camera.position.set(x + hx * Math.cos(yaw), EYE + hy, z - hx * Math.sin(yaw));
    const ly = yaw + hyaw;
    this.camera.lookAt(
      this.camera.position.x + Math.sin(ly) * Math.cos(pitch),
      this.camera.position.y + Math.sin(pitch),
      this.camera.position.z + Math.cos(ly) * Math.cos(pitch),
    );
    return { room: this.tourRooms[a.room] || null, overview: false };
  }

  // ------------------------------------------------------------ modes & input

  setMode(mode: Mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'doll';
    this.city.visible = mode !== 'doll' && !this.photoSky;
    if (mode === 'doll') {
      this.ceiling.visible = false;
      this.camera.position.set(this.extent * 0.55, this.extent * 1.05 + 2, this.extent * 0.75);
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = 3;
      this.controls.maxDistance = this.extent * 3;
      this.controls.update();
      this.playing = false;
    } else if (mode === 'walk') {
      this.ceiling.visible = true;
      const start = this.rooms.find((r) => r.type === 'living') || this.rooms[0];
      if (start) {
        this.walk.pos.copy(start.view);
        this.walk.yaw = Math.atan2(start.focus.x - start.view.x, start.focus.z - start.view.z);
      }
      this.walk.pitch = -0.05;
      this.walk.target = null;
      this.playing = false;
    } else {
      this.ceiling.visible = true;
    }
    this.updateFov();
  }

  play() {
    if (this.mode !== 'tour') this.setMode('tour');
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
  }

  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'walk') return;
      this.dragging = { x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode !== 'walk') return;
      const dx = e.clientX - this.dragging.x,
        dy = e.clientY - this.dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragging.moved = true;
      this.walk.yaw += dx * 0.004;
      this.walk.pitch = Math.max(-0.9, Math.min(0.6, this.walk.pitch + dy * 0.003));
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      if (this.mode !== 'walk' || !this.dragging) return;
      const moved = this.dragging.moved;
      this.dragging = null;
      if (moved) return;
      // click on floor → walk there
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.floorMeshes, false)[0];
      if (hit) {
        const s = this.blockedAt(hit.point.x, hit.point.z) ? this.snap(hit.point.x, hit.point.z) : new THREE.Vector2(hit.point.x, hit.point.z);
        if (s) this.walk.target = new THREE.Vector3(s.x, EYE, s.y);
      }
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.mode !== 'walk') return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.walk.keys.add(k);
    else this.walk.keys.delete(k);
  };

  /** For on-screen arrows on touch devices. */
  nudge(forward: number, turn: number) {
    this.walk.yaw += turn * 0.35;
    if (forward) {
      const step = new THREE.Vector3(Math.sin(this.walk.yaw), 0, Math.cos(this.walk.yaw)).multiplyScalar(forward * 0.9);
      const tgt = this.walk.pos.clone().add(step);
      if (!this.blockedAt(tgt.x, tgt.z)) this.walk.target = tgt;
    }
  }

  private stepWalk(dt: number) {
    const w = this.walk;
    const keys = w.keys;
    let f = 0,
      turn = 0;
    if (keys.has('w') || keys.has('arrowup')) f += 1;
    if (keys.has('s') || keys.has('arrowdown')) f -= 1;
    if (keys.has('a') || keys.has('arrowleft')) turn += 1;
    if (keys.has('d') || keys.has('arrowright')) turn -= 1;
    w.yaw += turn * dt * 1.4;
    if (f) {
      w.target = null;
      const nx = w.pos.x + Math.sin(w.yaw) * f * dt * 1.4;
      const nz = w.pos.z + Math.cos(w.yaw) * f * dt * 1.4;
      if (!this.blockedAt(nx, w.pos.z)) w.pos.x = nx;
      if (!this.blockedAt(w.pos.x, nz)) w.pos.z = nz;
    } else if (w.target) {
      const d = w.target.clone().sub(w.pos);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.03) w.target = null;
      else w.pos.addScaledVector(d, Math.min(1, dt * 2.6));
    }
    this.camera.position.copy(w.pos);
    this.camera.lookAt(
      w.pos.x + Math.sin(w.yaw) * Math.cos(w.pitch),
      w.pos.y + Math.sin(w.pitch),
      w.pos.z + Math.cos(w.yaw) * Math.cos(w.pitch),
    );
  }

  private currentRoomAt(x: number, z: number) {
    for (const r of this.rooms) {
      const m = 0.4;
      if (x > r.inner.x0 - m && x < r.inner.x1 + m && z > r.inner.z0 - m && z < r.inner.z1 + m) return r;
    }
    return null;
  }

  // ------------------------------------------------------------ render

  private updateFov() {
    const aspect = this.camera.aspect;
    if (this.mode === 'doll') this.camera.fov = 45;
    else {
      const hfov = (78 * Math.PI) / 180;
      const v = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
      this.camera.fov = Math.max(52, Math.min(86, v));
    }
    this.camera.updateProjectionMatrix();
  }

  resize() {
    if (this.exporting) return;
    const w = this.container.clientWidth || 800,
      h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.updateFov();
  }

  /** Everything that moves on its own: breeze, leaves, dust, clouds, the sun. */
  private tick(seconds: number) {
    timeUniform.value = seconds;
    if (this.photoSky && this.viewTex) {
      // the real panorama belongs to the windows; overhead views get a calm studio backdrop
      const inside = this.mode !== 'doll' && this.ceiling.visible;
      this.scene.background = inside ? this.viewTex : this.studioBg;
      this.scene.backgroundRotation.y = this.viewRotation + seconds * 0.004;
    }
    const a = 0.9 + seconds * 0.002;
    this.sun.position.set(Math.cos(a) * 12, 18, Math.sin(a) * 12);
    this.dust.visible = this.brief?.light !== 'evening' && this.mode !== 'doll' && this.ceiling.visible;
  }

  private viewRotation = 0;
  private viewTex: THREE.Texture | null = null;
  private studioBg = new THREE.Color('#d9d5cd');

  /** The real panorama seen through the windows. */
  setView(view: WindowView) {
    if (this.view === view) return;
    this.view = view;
    loadView(view)
      .then((t) => {
        if (this.disposed || this.view !== view) return;
        this.viewTex = t;
        this.scene.background = t;
        this.scene.backgroundIntensity = this.brief?.light === 'evening' ? 0.22 : 1.3;
        this.viewRotation = view === 'sea' ? 2.2 : view === 'city' ? 0.6 : 1.2;
        this.photoSky = true;
        this.sky.visible = false;
        this.city.visible = false;
      })
      .catch(() => {});
  }

  /** Rebuild furniture after real models or the user's library finished loading. */
  refurnish() {
    if (!this.model) return;
    this.furnish();
    this.refreshNav();
    this.furniture.visible = this.brief?.furnish ?? true;
  }

  private draw() {
    this.updateFocus();
    if (this.lens) this.lens.uniforms.seed.value = (this.lens.uniforms.seed.value + 0.6180339) % 1;
    if (this.hq && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Pull focus to what the centre of the frame sees, smoothly, like a focus puller. */
  private updateFocus() {
    if (this.bloom) this.bloom.enabled = !this.lightFx;
    if (!this.dof) return;
    const on = this.hq && !this.lightFx && this.mode !== 'doll' && this.ceiling.visible;
    this.dof.enabled = on;
    if (!on) return;
    this.focusRay.setFromCamera(new THREE.Vector2(0, -0.1), this.camera);
    this.focusRay.far = 30;
    const hit = this.focusRay.intersectObjects([this.structure, this.furniture, this.fixtures], true)[0];
    const target = Math.max(1.2, Math.min(12, hit ? hit.distance : 8));
    this.focusDist += (target - this.focusDist) * 0.08;
    (this.dof.uniforms as Record<string, THREE.IUniform>).focus.value = this.focusDist;
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    if (this.exporting || this.idle || this.contextLost) return;
    const frameMs = now - this.last;
    // a GPU that can't keep up first loses depth of field and glow, then the full pipeline
    if (this.hq && frameMs > 55 && frameMs < 1000) {
      if (++this.slowFrames > 45) {
        this.slowFrames = 0;
        if (!this.lightFx) this.lightFx = true;
        else this.hq = false;
      }
    } else if (this.slowFrames > 0) this.slowFrames--;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(now / 1000);
    let info: FrameInfo = { t: this.t, duration: this.duration, room: '', area: 0, fade: 0 };
    if (this.mode === 'tour') {
      if (this.playing) {
        this.t += dt;
        if (this.t >= this.duration) {
          this.t = this.duration;
          this.playing = false;
        }
      }
      const p = this.poseAt(this.t);
      this.ceiling.visible = !p.overview;
      this.city.visible = !p.overview && !this.photoSky;
      info = { t: this.t, duration: this.duration, room: p.room?.name || '', area: p.room?.areaM2 || 0, fade: this.fadeAt(this.t) };
    } else if (this.mode === 'walk') {
      this.stepWalk(dt);
      const r = this.currentRoomAt(this.walk.pos.x, this.walk.pos.z);
      info.room = r?.name || '';
      info.area = r?.areaM2 || 0;
    } else {
      this.controls.update();
      info.labels = this.projectLabels();
    }
    this.draw();
    this.onFrame?.(info);
  }

  private projectLabels() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    return this.rooms.map((r) => {
      const v = new THREE.Vector3((r.inner.x0 + r.inner.x1) / 2, 0.2, (r.inner.z0 + r.inner.z1) / 2).project(this.camera);
      return { name: r.name, area: r.areaM2, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    });
  }

  // ------------------------------------------------------------ export helpers

  beginExport(w: number, h: number) {
    this.exporting = true;
    this.playing = false;
    this.mode = 'tour';
    this.controls.enabled = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(1);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.updateFov();
    return this.renderer.domElement;
  }

  renderAt(t: number) {
    const p = this.poseAt(t);
    this.ceiling.visible = !p.overview;
    this.city.visible = !p.overview && !this.photoSky;
    this.tick(t);
    this.draw();
    return { room: p.room?.name || '', area: p.room?.areaM2 || 0, fade: this.fadeAt(t) };
  }

  endExport() {
    this.exporting = false;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.resize();
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
  }

  snapshot(type = 'image/jpeg') {
    this.draw();
    return this.renderer.domElement.toDataURL(type, 0.92);
  }

  // ------------------------------------------------------------ speed-ramp reel

  private roomAtExact(x: number, z: number) {
    const m = this.model;
    if (!m) return null;
    const px = Math.round(x * m.pxPerM + (m.hull.x0 + m.hull.x1) / 2),
      py = Math.round(z * m.pxPerM + (m.hull.y0 + m.hull.y1) / 2);
    if (px < 0 || py < 0 || px >= m.w || py >= m.h) return null;
    const l = m.labels[py * m.w + px];
    return this.rooms.find((r) => r.label === l) || null;
  }

  /** Walk from a to b over the floor grid (A*, Chaikin-smoothed), as points. */
  private walkPath(a: THREE.Vector2, b: THREE.Vector2) {
    const g = this.grid!;
    const s = this.cellOf(a.x, a.y),
      t = this.cellOf(b.x, b.y);
    const cells = (this.nav && astar(this.nav, g.gw, g.gh, s[0], s[1], t[0], t[1])) || astar(g.block, g.gw, g.gh, s[0], s[1], t[0], t[1]);
    let pts = cells && cells.length > 1 ? cells.map(([cx, cy]) => this.cellCenter(cx, cy)) : [a.clone(), b.clone()];
    pts[0] = a.clone();
    pts[pts.length - 1] = b.clone();
    for (let it = 0; it < 3 && pts.length > 2; it++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i].clone().lerp(pts[i + 1], 0.25), pts[i].clone().lerp(pts[i + 1], 0.75));
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  /** Step from p toward q while the floor stays free; returns the last free point. */
  private reach(p: THREE.Vector2, q: THREE.Vector2, keep = 0.35) {
    const d = q.clone().sub(p);
    const len = d.length();
    d.normalize();
    let last = p.clone();
    for (let k = 0.1; k <= len; k += 0.1) {
      const c = p.clone().addScaledVector(d, k);
      // stay clear of walls by `keep` metres to either side
      if (this.blockedAt(c.x, c.y) || this.blockedAt(c.x + d.y * keep, c.y - d.x * keep) || this.blockedAt(c.x - d.y * keep, c.y + d.x * keep)) break;
      last = c;
    }
    return last;
  }

  buildReel(): ReelPath | null {
    if (!this.grid || !this.rooms.length) return null;
    const byType = (...ts: RoomType[]) => {
      for (const t of ts) {
        const r = this.rooms.filter((x) => x.type === t).sort((a, b) => b.areaM2 - a.areaM2)[0];
        if (r) return r;
      }
      return null;
    };
    const living = byType('living', 'dining') || [...this.rooms].sort((a, b) => b.areaM2 - a.areaM2)[0];
    const bed = byType('master', 'bedroom', 'kids', 'office');
    const kitchen = byType('kitchen', 'dining');
    // the widest glazed opening of the living room is where we fly in
    let best: { c: THREE.Vector2; n: THREE.Vector2; w: number } | null = null;
    for (const o of this.openingSpecs) {
      if (o.kind !== 'window' && o.kind !== 'slider' && o.kind !== 'facade') continue;
      const n = o.along === 'x' ? new THREE.Vector2(0, o.inward) : new THREE.Vector2(o.inward, 0);
      const c = new THREE.Vector2(o.cx, o.cz);
      const inside = c.clone().addScaledVector(n, 0.6);
      if (this.roomAtExact(inside.x, inside.y) !== living) continue;
      if (!best || o.width > best.w) best = { c, n, w: o.width };
    }
    const lv = new THREE.Vector2(living.view.x, living.view.z);
    if (!best) {
      // no window found: start from the living room's viewpoint, backing in from its far side
      const f = new THREE.Vector2(living.focus.x, living.focus.z);
      const n = f.clone().sub(lv).normalize();
      best = { c: lv.clone().addScaledVector(n, -0.5), n, w: 1 };
    }
    const out = best.c.clone().addScaledVector(best.n, -1.8);
    const inn = this.reach(best.c.clone().addScaledVector(best.n, 0.3), best.c.clone().addScaledVector(best.n, 1.3), 0.15);
    /** the first `len` metres of a walk */
    const head = (pts: THREE.Vector2[], len: number) => {
      const o = [pts[0]];
      let acc = 0;
      for (let i = 1; i < pts.length && acc < len; i++) {
        const d = pts[i].distanceTo(pts[i - 1]);
        if (acc + d > len) {
          o.push(pts[i - 1].clone().lerp(pts[i], (len - acc) / d));
          break;
        }
        acc += d;
        o.push(pts[i]);
      }
      return o.length > 1 ? o : [pts[0], pts[0].clone().add(new THREE.Vector2(0.01, 0))];
    };

    type Seg = { pts: THREE.Vector2[]; look: 'ahead' | 'normal' | THREE.Vector3; pan?: number };
    const lglide = head(this.walkPath(inn, lv), 1.4);
    const segs: Seg[] = [
      { pts: [out, inn], look: 'normal' },
      { pts: lglide, look: living.focus, pan: 0.35 },
    ];
    const names = [living.name];
    let cur = lglide[lglide.length - 1];
    const visit = (r: EngineRoom) => {
      const v = new THREE.Vector2(r.view.x, r.view.z);
      const f = new THREE.Vector2(r.focus.x, r.focus.z);
      segs.push({ pts: this.walkPath(cur, v), look: 'ahead' });
      // from the photographer's viewpoint, ease in toward the focus (bed, island) for the material details
      const close = this.reach(v, v.clone().add(f.clone().sub(v).normalize().multiplyScalar(Math.max(0.3, Math.min(1.6, v.distanceTo(f) - 1.0)))), 0.15);
      const pts = close.distanceTo(v) > 0.25 ? [v, v.clone().lerp(close, 0.5), close] : [v, v.clone().add(new THREE.Vector2(0.01, 0))];
      segs.push({ pts, look: r.focus, pan: 0.45 });
      names.push(r.name);
      cur = pts[pts.length - 1];
    };
    if (bed) visit(bed);
    if (kitchen && kitchen !== living) visit(kitchen);

    // resample every segment at 5 cm, remembering where each starts
    const pts: ReelPath['pts'] = [];
    const keys: number[] = [0];
    const step = 0.05;
    for (const sg of segs) {
      const curve = sg.pts.length > 2 ? new THREE.SplineCurve(sg.pts) : new THREE.LineCurve(sg.pts[0], sg.pts[1]);
      const len = Math.max(step, curve.getLength());
      // a glide always gets enough samples to carry its slow pan, even when it barely moves
      const n = Math.max(sg.pan ? 40 : 2, Math.round(len / step));
      for (let i = pts.length ? 1 : 0; i <= n; i++) {
        const u = i / n;
        const p = curve.getPointAt(u);
        let yaw = 0,
          pitch = -0.04;
        if (sg.look === 'normal') yaw = Math.atan2(best.n.x, best.n.y);
        else if (sg.look === 'ahead') {
          const a = curve.getPointAt(Math.min(1, u + 1.2 / len));
          yaw = a.distanceTo(p) > 0.05 ? Math.atan2(a.x - p.x, a.y - p.y) : pts.length ? pts[pts.length - 1].yaw : 0;
        } else {
          const f = sg.look;
          const d = Math.hypot(f.x - p.x, f.z - p.y);
          yaw = Math.atan2(f.x - p.x, f.z - p.y) + (sg.pan || 0) * (u - 0.5);
          pitch = -Math.max(0.06, Math.min(0.42, Math.atan2(EYE - 0.55, d)));
        }
        if (pts.length) {
          const prev = pts[pts.length - 1].yaw;
          while (yaw - prev > Math.PI) yaw -= Math.PI * 2;
          while (yaw - prev < -Math.PI) yaw += Math.PI * 2;
        }
        pts.push({ x: p.x, z: p.y, yaw, pitch });
      }
      keys.push(pts.length - 1);
    }
    // steady the view: the operator anticipates turns over about a metre
    const W = 14;
    const yaws = pts.map((p) => p.yaw),
      pitches = pts.map((p) => p.pitch);
    pts.forEach((p, i) => {
      let a = 0,
        b = 0,
        n = 0;
      for (let k = Math.max(0, i - W); k <= Math.min(pts.length - 1, i + W); k++, n++) {
        a += yaws[k];
        b += pitches[k];
      }
      p.yaw = a / n;
      p.pitch = b / n;
    });
    // key list: outside, in, living end, then per visited room: [start, end]
    const k = [keys[0], keys[1], keys[2]];
    for (let i = 3; i + 1 < keys.length; i += 2) k.push(keys[i], keys[i + 1]);
    return { pts, keys: k, rooms: names };
  }

  /** Render one frame from an arbitrary eye pose (for the reel). */
  renderPose(x: number, z: number, yaw: number, pitch: number, time: number) {
    this.camera.position.set(x, EYE, z);
    this.camera.lookAt(x + Math.sin(yaw) * Math.cos(pitch), EYE + Math.sin(pitch), z + Math.cos(yaw) * Math.cos(pitch));
    this.ceiling.visible = true;
    this.city.visible = !this.photoSky;
    this.tick(time);
    this.draw();
  }

  roomsInTour() {
    return this.tourRooms.map((r) => ({ name: r.name, area: r.areaM2, type: r.type }));
  }

  /** The walkthrough as chapters: one per visit to a room, with its start and end time. */
  chapters() {
    const out: { name: string; area: number; t0: number; t1: number }[] = [];
    let prev = -1;
    this.samples.forEach((s, i) => {
      if (s.room === prev) return;
      prev = s.room;
      const r = this.tourRooms[s.room];
      const t = OVERVIEW + i / this.fps;
      if (out.length) out[out.length - 1].t1 = t;
      out.push({ name: r?.name || '', area: r?.areaM2 || 0, t0: t, t1: this.duration });
    });
    // brief pass-throughs are not chapters of their own
    return out.filter((c) => c.t1 - c.t0 >= 2.5);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.clear(this.structure);
    this.clear(this.furniture);
    this.clear(this.fixtures);
    this.clear(this.openingsGroup);
    this.composer?.dispose();
    this.renderer.dispose();
    // hand the WebGL context back now: browsers allow only a handful at a time
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/** A renderer, retrying with lighter settings when the first request for a GPU context fails. */
function createRenderer() {
  const tries: THREE.WebGLRendererParameters[] = [
    { antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' },
    { antialias: false, preserveDrawingBuffer: true },
    { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false, powerPreference: 'low-power' },
  ];
  let last: unknown;
  for (const p of tries) {
    try {
      return new THREE.WebGLRenderer(p);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Neighbouring buildings and trees seen through the windows, as if the flat were a few floors up. */
function cityContext() {
  const g = new THREE.Group();
  const groundY = -12;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#cfc8ba', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  g.add(ground);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const facade = ['#e9e4da', '#ddd6c9', '#f1eee7', '#d4cdc0', '#e4ddd0'];
  const winTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#8f9aa1';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) x.fillRect(8 + i * 30, 10 + j * 30, 18, 16);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rnd() * 0.2;
    const dist = 34 + rnd() * 40;
    const w = 12 + rnd() * 16,
      d = 10 + rnd() * 12,
      h = 14 + rnd() * 26;
    const tex = winTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 6, h / 6);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: facade[i % facade.length], map: tex, roughness: 0.9 }),
    );
    m.position.set(Math.sin(ang) * dist, groundY + h / 2, Math.cos(ang) * dist);
    m.rotation.y = ang;
    g.add(m);
  }
  const leaf = new THREE.MeshStandardMaterial({ color: '#6f8457', roughness: 1, flatShading: true });
  for (let i = 0; i < 30; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 26 + rnd() * 30;
    const s = 1.8 + rnd() * 1.8;
    const t = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), leaf);
    t.position.set(Math.sin(ang) * dist, groundY + 2 + s, Math.cos(ang) * dist);
    t.scale.y = 1.2;
    g.add(t);
  }
  return g;
}

function floorMaterial(ft: import('./textures').FloorFinish) {
  return new THREE.MeshPhysicalMaterial({
    map: ft.tex,
    color: ft.color || new THREE.Color('#ffffff'),
    roughness: ft.rough,
    roughnessMap: ft.roughMap || null,
    bumpMap: ft.bump || null,
    bumpScale: 1.2,
    clearcoat: ft.bump ? 0.25 : 0.1,
    clearcoatRoughness: 0.4,
  });
}
