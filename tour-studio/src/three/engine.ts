import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { astar, dilate, downsample, mergeRects, regionAt, type PlanModel } from '../lib/plan';
import { roomName, styleById, type StyleDef } from '../lib/styles';
import type { DesignBrief, PlanRoom, RoomType } from '../lib/types';
import { bathSet, buildFurniture, disposeGroup, kitchenRun, makeMats, showerGlass, type Mats } from './furniture';
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

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#e6e3dc');

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
    );
    this.scene.add(sky);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: '#d4cbbb', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.add(this.structure, this.ceiling, this.fixtures, this.furniture, this.roomLights);

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
    const wallMat = new THREE.MeshStandardMaterial({ color: this.style.wall, roughness: 0.92 });
    wallMat.name = 'wall';
    if (wallGeos.length) {
      const walls = new THREE.Mesh(mergeGeometries(wallGeos), wallMat);
      walls.castShadow = walls.receiveShadow = true;
      walls.name = 'walls';
      this.structure.add(walls);
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
      [finish.main, new THREE.MeshStandardMaterial({ map: ft.tex, roughness: ft.rough }), ft.metres, 'floor-main'],
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
      const cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: this.style.ceiling, roughness: 1 }));
      cm.name = 'ceiling';
      this.ceiling.add(cm);
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
    this.grid = { block, gw: fgw, gh: fgh, cell: navCell };

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
    const box = new THREE.Box3();
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
        const mat = floor.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.map = ft.tex;
        mat.roughness = ft.rough;
        mat.needsUpdate = true;
        // re-scale uv to the new texture size
        const g = floor.geometry;
        const pos = g.attributes.position,
          uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ft.metres, -pos.getZ(i) / ft.metres);
        uv.needsUpdate = true;
      }
      const ceil = this.ceiling.getObjectByName('ceiling') as THREE.Mesh | undefined;
      if (ceil) (ceil.material as THREE.MeshStandardMaterial).color.set(this.style.ceiling);
      this.furnish();
      this.refreshNav();
    }
    this.furniture.visible = brief.furnish;
    this.setLighting(brief.light);
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
        add(F, this.put(buildFurniture('sofa', s, m, { w: sw }), r, a, 0, 0.5));
        const zone = Math.min(D, 4.4);
        const rw = Math.min(sw + 0.7, L - 0.3),
          rd = Math.min(2.0, zone - 1.1);
        if (rd > 1) add(F, this.put(buildFurniture('rug', s, m, { w: rw, d: rd }), r, a, 0, 0.75 + rd / 2));
        add(F, this.put(buildFurniture('coffeeTable', s, m), r, a, 0, 1.55));
        if (D <= 5.4 && D >= 2.8) add(F, this.put(buildFurniture('tvUnit', s, m, { w: Math.min(1.9, L - 0.6) }), r, opp, 0, 0.23));
        else if (D > 5.4) {
          for (const sg of [-1, 1]) add(F, this.put(buildFurniture('armchair', s, m), r, a, sg * 0.5, 2.75, 'out'));
          if (D - zone >= 2.4 && !has('dining') && !has('kitchen'))
            add(F, this.put(buildFurniture('diningTable', s, m, { seats: L > 3 ? 6 : 4 }), r, a, 0, zone + (D - zone) / 2));
        }
        if (D > 5.4 && D - zone >= 2.4 && !has('dining') && has('kitchen'))
          add(F, this.put(buildFurniture('diningTable', s, m, { seats: L > 3 ? 6 : 4 }), r, a, 0, zone + (D - zone) / 2));
        if (L - sw > 1.4 && D <= 5.4) {
          const ac = this.put(buildFurniture('armchair', s, m), r, a, sw / 2 + 0.6, 1.35);
          ac.rotation.y -= 0.6;
          add(F, ac);
        }
        if (L - sw > 0.7) add(F, this.put(buildFurniture('floorLamp', s, m), r, a, -(sw / 2 + 0.3), 0.3));
        if (s.plants > 0.3) add(F, this.put(buildFurniture('plant', s, m, { w: 1.5 }), r, opp, L / 2 - 0.35, 0.35));
      } else if (r.type === 'master' || r.type === 'bedroom') {
        const bw = L >= 2.6 ? 1.6 : L >= 2.1 ? 1.4 : 0;
        if (!bw || D < 2.4) continue;
        add(F, this.put(buildFurniture('bed', s, m, { w: bw }), r, a, 0, 1.1));
        if (L >= bw + 1.1)
          for (const sg of [-1, 1]) add(F, this.put(buildFurniture('nightstand', s, m), r, a, sg * (bw / 2 + 0.33), 0.22));
        if (D >= 3.5) add(F, this.put(buildFurniture('wardrobe', s, m, { w: Math.min(2.4, L - 0.6) }), r, opp, 0, 0.3));
        else if ((L - bw) / 2 >= 1.15) add(F, this.put(buildFurniture('wardrobe', s, m, { w: Math.min(2.0, D - 0.4) }), r, perp[0], 0, 0.3));
        add(F, this.put(buildFurniture('rug', s, m, { w: Math.min(bw + 1.0, L - 0.3), d: 1.6 }), r, a, 0, 1.75));
        if (s.plants > 0.5 && L > 3) add(F, this.put(buildFurniture('plant', s, m, { w: 1.2 }), r, a, L / 2 - 0.3, 0.3));
      } else if (r.type === 'kids') {
        if (L < 1.6 || D < 2.2) continue;
        add(F, this.put(buildFurniture('singleBed', s, m), r, a, -(L / 2) + 0.55, 1.1));
        if (D >= 3.3) add(F, this.put(buildFurniture('desk', s, m), r, opp, 0, 0.33));
        else if (L >= 2.8) add(F, this.put(buildFurniture('desk', s, m), r, a, L / 2 - 0.7, 0.33));
        add(F, this.put(buildFurniture('shelf', s, m), r, perp[0], 0, 0.18));
        add(F, this.put(buildFurniture('rug', s, m, { w: 1.4, d: 1.0 }), r, a, L / 2 - 1.0, Math.min(D - 0.8, 1.8)));
      } else if (r.type === 'office' || r.type === 'mamad') {
        if (L < 1.5 || D < 1.8) continue;
        add(F, this.put(buildFurniture('desk', s, m), r, a, 0, 0.33));
        add(F, this.put(buildFurniture('shelf', s, m), r, perp[0], 0, 0.18));
        if (D > 2.8 && L > 2.4) {
          const ac = this.put(buildFurniture('armchair', s, m), r, opp, L / 2 - 0.6, 0.6);
          add(F, ac);
        }
        if (s.plants > 0.4) add(F, this.put(buildFurniture('plant', s, m, { w: 1.1 }), r, a, -L / 2 + 0.3, 0.3));
      } else if (r.type === 'dining') {
        add(F, this.put(buildFurniture('diningTable', s, m, { seats: L > 3.2 ? 6 : 4 }), r, a, 0, D / 2));
        if (D >= 3.6) add(F, this.put(buildFurniture('sideboard', s, m), r, a, 0, 0.22));
      } else if (r.type === 'kitchen') {
        if (L >= 1.6) add(X, this.put(kitchenRun(s, m, L - 0.04), r, a, 0, 0.3));
        const pl = this.sideLen(r, perp[0]);
        if (L < 2.6 && pl.len > 2.2) add(X, this.put(kitchenRun(s, m, pl.len - 0.7, false), r, perp[0], 0.35, 0.3));
        if (D >= 3.3) add(F, this.put(buildFurniture('diningTable', s, m, { seats: 4 }), r, a, 0, Math.max(1.9, D - 1.0)));
      } else if (r.type === 'bathroom') {
        add(X, this.put(bathSet(s, m, L), r, a, -L / 2 + Math.min(1.0, L * 0.45) / 2 + 0.05, 0.24));
        if (D > 1.8 && L > 1.4) add(X, this.put(showerGlass(m), r, opp, L / 2 - 0.5, 0.9));
      } else if (r.type === 'balcony') {
        if (Math.min(L, D) >= 1.2) {
          const b = this.put(buildFurniture('bistroSet', s, m), r, a, 0, D / 2);
          if (L < D) b.rotation.y += Math.PI / 2;
          add(F, b);
        }
        for (const sg of [-1, 1]) add(F, this.put(buildFurniture('plant', s, m, { w: 1.3 }), r, a, sg * (L / 2 - 0.3), 0.3));
      } else if (r.type === 'hall') {
        if (L >= 1.8 && D >= 1.1) add(F, this.put(buildFurniture('sideboard', s, m, { w: Math.min(1.4, L - 0.5) }), r, a, 0, 0.22));
      }
    }
    // tag lamp shades for evening glow
    this.furniture.traverse((o) => {
      if (o.userData.lamp) (o as THREE.Mesh).material = this.mats.lampShade;
    });
  }

  private setLighting(light: 'day' | 'evening') {
    this.clear(this.roomLights);
    const evening = light === 'evening';
    this.hemi.intensity = evening ? 0.18 : 1.1;
    this.sun.intensity = evening ? 0 : 2.4;
    this.scene.environmentIntensity = evening ? 0.12 : 0.55;
    this.renderer.toneMappingExposure = evening ? 1.25 : 1.05;
    this.mats.lampShade.emissiveIntensity = evening ? 2.2 : 0;
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
    const pool = this.rooms.filter((r) => r.type !== 'storage');
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
      for (let i = 1; i <= n; i++) {
        const u = ease(i / n);
        const p = curve.getPointAt(u);
        const ahead = curve.getPointAt(Math.min(1, u + 0.9 / Math.max(len, 0.5)));
        let yaw = p.distanceTo(ahead) > 0.05 ? Math.atan2(ahead.x - p.x, ahead.y - p.y) : endYaw;
        const k = i / n;
        if (k < 0.2) yaw = lerpAngle(startYaw, yaw, k / 0.2);
        if (k > 0.7) yaw = lerpAngle(yaw, endYaw, (k - 0.7) / 0.3);
        pushSample(p.x, p.y, yaw, -0.05, idx);
      }
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
    this.camera.position.set(x, EYE, z);
    this.camera.lookAt(x + Math.sin(yaw) * Math.cos(pitch), EYE + Math.sin(pitch), z + Math.cos(yaw) * Math.cos(pitch));
    return { room: this.tourRooms[a.room] || null, overview: false };
  }

  // ------------------------------------------------------------ modes & input

  setMode(mode: Mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'doll';
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
    this.camera.aspect = w / h;
    this.updateFov();
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    if (this.exporting) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
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
    this.renderer.render(this.scene, this.camera);
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
    this.camera.aspect = w / h;
    this.updateFov();
    return this.renderer.domElement;
  }

  renderAt(t: number) {
    const p = this.poseAt(t);
    this.ceiling.visible = !p.overview;
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL(type, 0.92);
  }

  roomsInTour() {
    return this.tourRooms.map((r) => ({ name: r.name, area: r.areaM2, type: r.type }));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.clear(this.structure);
    this.clear(this.furniture);
    this.clear(this.fixtures);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
