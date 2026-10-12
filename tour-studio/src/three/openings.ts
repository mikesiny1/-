/**
 * Doors, windows and balcony sliders, built into the wall gaps the plan reader found.
 * Each piece is built in a local frame: the opening runs along X (width W), the wall
 * thickness is along Z (T) and +Z faces into the room.
 */
import * as THREE from 'three';
import type { OpeningKind } from '../lib/plan';
import type { StyleDef } from '../lib/styles';
import type { Mats } from './furniture';

export const DOOR_H = 2.1;
const WIN_SILL = 0.9;
const WIN_HEAD = 2.25;
const SLIDE_HEAD = 2.35;

export interface OpeningSpec {
  kind: OpeningKind;
  cx: number;
  cz: number;
  along: 'x' | 'z';
  width: number;
  depth: number;
  /** +1 if the room (or the side doors swing into) is towards +world axis, -1 otherwise */
  inward: 1 | -1;
  curtains: boolean;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export interface OpeningMats {
  wall: THREE.Material;
  frame: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  entry: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  sill: THREE.MeshStandardMaterial;
  curtain: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
}

export function openingMats(s: StyleDef, m: Mats, wall: THREE.Material): OpeningMats {
  const darkFrames = s.id === 'industrial' || s.id === 'modern' || s.id === 'japandi';
  const woodDoors = s.id === 'japandi' || s.id === 'mediterranean' || s.id === 'boho';
  return {
    wall,
    frame: new THREE.MeshStandardMaterial({ color: darkFrames ? '#2b2b2a' : '#e9e7e2', roughness: 0.45, metalness: 0.4 }),
    leaf: woodDoors ? m.wood : new THREE.MeshStandardMaterial({ color: s.id === 'industrial' ? '#2e2d2b' : '#f1efea', roughness: 0.4 }),
    entry: new THREE.MeshStandardMaterial({ color: s.id === 'classic' ? '#3b2a20' : '#4a4642', roughness: 0.35, metalness: 0.15 }),
    trim: new THREE.MeshStandardMaterial({ color: s.id === 'industrial' ? '#2e2d2b' : '#f4f2ed', roughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#e8f0f2',
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.16,
      envMapIntensity: 1.4,
      depthWrite: false,
    }),
    sill: new THREE.MeshStandardMaterial({ color: s.stone, roughness: 0.3 }),
    curtain: new THREE.MeshStandardMaterial({
      color: s.id === 'industrial' ? '#cfcac2' : '#f2eee6',
      roughness: 1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.93,
    }),
    metal: m.metal,
  };
}

function frameRect(g: THREE.Group, w: number, y0: number, y1: number, bar: number, mat: THREE.Material) {
  g.add(box(w, bar, 0.07, mat, 0, y0, 0));
  g.add(box(w, bar, 0.07, mat, 0, y1 - bar, 0));
  g.add(box(bar, y1 - y0, 0.07, mat, -w / 2 + bar / 2, y0, 0));
  g.add(box(bar, y1 - y0, 0.07, mat, w / 2 - bar / 2, y0, 0));
}

function glassPane(w: number, h: number, mat: THREE.Material, x: number, y: number, z: number) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  p.position.set(x, y + h / 2, z);
  p.renderOrder = 2;
  return p;
}

/** A gathered curtain panel: a plane with soft vertical folds. */
function curtainPanel(w: number, h: number, mat: THREE.Material) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(12, Math.round(w * 40)), 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i);
    const folds = Math.sin(x * 34) * 0.03 + Math.sin(x * 13 + 1.3) * 0.012;
    // a little looser at the hem
    pos.setZ(i, folds * (1 + (0.5 - y / h) * 0.25));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildOpening(o: OpeningSpec, mats: OpeningMats, wallH: number, part: 'structure' | 'curtains' = 'structure') {
  const g = new THREE.Group();
  if (part === 'curtains') return orient(addCurtains(g, o, mats), o);
  const W = o.width,
    T = o.depth;
  const head = (y: number) => g.add(box(W + 0.002, wallH - y, T, mats.wall, 0, y, 0));

  if (o.kind === 'window') {
    g.add(box(W + 0.002, WIN_SILL, T, mats.wall, 0, 0, 0));
    head(WIN_HEAD);
    frameRect(g, W, WIN_SILL, WIN_HEAD, 0.05, mats.frame);
    const panes = W > 1.3 ? 2 : 1;
    if (panes === 2) g.add(box(0.05, WIN_HEAD - WIN_SILL, 0.07, mats.frame, 0, WIN_SILL, 0));
    for (let i = 0; i < panes; i++) {
      const pw = (W - 0.1) / panes;
      g.add(glassPane(pw - 0.02, WIN_HEAD - WIN_SILL - 0.1, mats.glass, -W / 2 + 0.05 + pw * (i + 0.5), WIN_SILL + 0.05, 0));
    }
    g.add(box(W + 0.08, 0.025, T / 2 + 0.05, mats.sill, 0, WIN_SILL - 0.025, T / 4 + 0.025));
  } else if (o.kind === 'slider') {
    head(SLIDE_HEAD);
    frameRect(g, W, 0, SLIDE_HEAD, 0.06, mats.frame);
    const n = W > 3 ? 3 : 2;
    const pw = (W - 0.12) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.06 + pw * (i + 0.5);
      const z = i % 2 ? 0.03 : -0.03;
      const panel = new THREE.Group();
      frameRect(panel, pw + 0.03, 0.03, SLIDE_HEAD - 0.06, 0.04, mats.frame);
      panel.add(glassPane(pw - 0.05, SLIDE_HEAD - 0.17, mats.glass, 0, 0.07, 0));
      panel.position.set(x, 0, z);
      g.add(panel);
    }
  } else if (o.kind === 'passage') {
    if (W < 2.6) head(2.35);
  } else {
    // door or entry
    const entry = o.kind === 'entry';
    head(DOOR_H);
    const trimW = 0.07,
      trimD = 0.015;
    for (const face of [-1, 1]) {
      const z = face * (T / 2 + trimD / 2);
      g.add(box(trimW, DOOR_H + trimW, trimD, mats.trim, -W / 2 - trimW / 2 + 0.01, 0, z));
      g.add(box(trimW, DOOR_H + trimW, trimD, mats.trim, W / 2 + trimW / 2 - 0.01, 0, z));
      g.add(box(W + trimW * 2 - 0.02, trimW, trimD, mats.trim, 0, DOOR_H, z));
    }
    const lw = W - 0.03;
    const leaf = new THREE.Group();
    const slab = box(lw, DOOR_H - 0.02, 0.045, entry ? mats.entry : mats.leaf, lw / 2, 0.005, 0);
    leaf.add(slab);
    if (entry) {
      // panelled security door
      for (const y of [0.35, 1.15]) leaf.add(box(lw - 0.24, 0.62, 0.012, mats.entry, lw / 2, y, 0.028));
    }
    const handleX = lw - 0.08;
    for (const side of [-1, 1]) {
      const h = box(0.13, 0.018, 0.018, mats.metal, handleX - 0.05, 1.0, side * 0.045);
      leaf.add(h);
    }
    leaf.position.set(-W / 2 + 0.015, 0, 0);
    // interior doors stand open against the wall, the entry is closed
    leaf.rotation.y = entry ? 0 : -Math.PI / 2 + 0.08;
    leaf.userData.leaf = !entry;
    g.add(leaf);
  }

  return orient(g, o);
}

function addCurtains(g: THREE.Group, o: OpeningSpec, mats: OpeningMats) {
  if (!o.curtains || (o.kind !== 'window' && o.kind !== 'slider')) return g;
  const W = o.width,
    T = o.depth;
  const top = o.kind === 'slider' ? SLIDE_HEAD + 0.22 : WIN_HEAD + 0.28;
  const h = top - 0.03;
  const z = T / 2 + 0.13;
  const pw = Math.max(0.35, Math.min(0.75, W * 0.24));
  for (const side of [-1, 1]) {
    const c = curtainPanel(pw, h, mats.curtain);
    c.position.set(side * (W / 2 + 0.18 - pw / 2), 0.03 + h / 2, z);
    g.add(c);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W + 0.5, 10), mats.metal);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, top + 0.02, z);
  g.add(rod);
  return g;
}

/** Local X along the opening, local +Z into the room. */
function orient(g: THREE.Group, o: OpeningSpec) {
  if (o.along === 'x') g.rotation.y = o.inward === 1 ? 0 : Math.PI;
  else g.rotation.y = o.inward === 1 ? Math.PI / 2 : -Math.PI / 2;
  g.position.set(o.cx, 0, o.cz);
  return g;
}

/** Height of the glazed area, for placing window light. */
export function glazing(kind: OpeningKind) {
  if (kind === 'window') return { y0: WIN_SILL, y1: WIN_HEAD };
  if (kind === 'slider') return { y0: 0.05, y1: SLIDE_HEAD };
  return null;
}
