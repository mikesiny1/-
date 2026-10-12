/**
 * Procedural furniture. Every piece is built in metres, centred on its footprint,
 * standing on y=0 and facing +Z (the "front" a person would sit or look at).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { StyleDef } from '../lib/styles';
import type { FurnitureKind } from '../lib/types';
import { rugTexture, weaveTexture, woodTexture } from './textures';

export interface Mats {
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  fabricAlt: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  linen: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  leafDark: THREE.MeshStandardMaterial;
  pot: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  lampShade: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  white: THREE.MeshStandardMaterial;
  rug: THREE.MeshStandardMaterial;
  books: THREE.MeshStandardMaterial[];
}

export function makeMats(s: StyleDef): Mats {
  const fab = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, map: weaveTexture() });
  const wood = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, map: woodTexture() });
  return {
    wood: wood(s.wood),
    woodDark: wood(s.woodDark),
    fabric: fab(s.fabric),
    fabricAlt: fab(s.fabricAlt),
    accent: fab(s.accent),
    metal: new THREE.MeshStandardMaterial({ color: s.metal, roughness: s.metalRough, metalness: 0.85 }),
    stone: new THREE.MeshStandardMaterial({ color: s.stone, roughness: 0.25 }),
    linen: fab('#f1ede6'),
    leaf: new THREE.MeshStandardMaterial({ color: '#4d6b3c', roughness: 0.7, side: THREE.DoubleSide }),
    leafDark: new THREE.MeshStandardMaterial({ color: '#36502c', roughness: 0.7, side: THREE.DoubleSide }),
    pot: new THREE.MeshStandardMaterial({ color: s.id === 'mediterranean' || s.id === 'boho' ? '#b5714b' : '#d9d4cc', roughness: 0.8 }),
    black: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.5 }),
    screen: new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.15, metalness: 0.2 }),
    lampShade: new THREE.MeshStandardMaterial({
      color: '#f3eadb',
      roughness: 0.9,
      emissive: '#ffd9a0',
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#dfe9ea', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.35 }),
    white: new THREE.MeshStandardMaterial({ color: '#f2f1ee', roughness: 0.35 }),
    rug: new THREE.MeshStandardMaterial({ map: rugTexture(s.rugPattern, s.rug, s.rugAlt), roughness: 1 }),
    books: ['#7b5e45', '#c9bba3', '#3e4a52', s.accent, '#e5ddd0', '#5a5f4a'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
    ),
  };
}

// ---------------------------------------------------------------- primitives

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const rbox = (w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), mat, x, y + h / 2, z);

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);

const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 24) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z);

function legs(g: THREE.Group, s: StyleDef, m: Mats, w: number, d: number, h: number, inset = 0.06) {
  const pts = [
    [-w / 2 + inset, -d / 2 + inset],
    [w / 2 - inset, -d / 2 + inset],
    [-w / 2 + inset, d / 2 - inset],
    [w / 2 - inset, d / 2 - inset],
  ];
  for (const [x, z] of pts) {
    if (s.legs === 'metal') g.add(box(0.025, h, 0.025, m.metal, x, 0, z));
    else if (s.legs === 'turned') {
      g.add(cyl(0.022, 0.014, h, m.woodDark, x, 0, z, 12));
      g.add(cyl(0.016, 0.016, 0.03, m.metal, x, 0, z, 12));
    } else g.add(cyl(0.022, 0.014, h, m.wood, x, 0, z, 12));
  }
}

// ---------------------------------------------------------------- pieces

function sofa(s: StyleDef, m: Mats, w = 2.3) {
  const g = new THREE.Group();
  const d = 0.95,
    r = 0.02 + s.softness * 0.6;
  const legH = s.id === 'japandi' ? 0.06 : 0.14;
  const mat = s.id === 'industrial' ? new THREE.MeshStandardMaterial({ color: s.fabric, roughness: 0.55 }) : m.fabric;
  legs(g, s, m, w - 0.1, d - 0.1, legH, 0.05);
  g.add(rbox(w, 0.2, d, r, mat, 0, legH, 0));
  g.add(rbox(w, 0.42, 0.2, r * 1.3, mat, 0, legH + 0.18, -d / 2 + 0.1));
  g.add(rbox(0.18, 0.28, d, r * 1.3, mat, -w / 2 + 0.09, legH + 0.18, 0));
  g.add(rbox(0.18, 0.28, d, r * 1.3, mat, w / 2 - 0.09, legH + 0.18, 0));
  const seats = w > 2 ? 3 : 2;
  const sw = (w - 0.36) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.18 + sw * (i + 0.5);
    g.add(rbox(sw - 0.01, 0.15, d - 0.25, r * 2, mat, x, legH + 0.2, 0.08));
    g.add(rbox(sw - 0.03, 0.38, 0.16, r * 2.5, mat, x, legH + 0.33, -d / 2 + 0.27));
  }
  // throw pillows
  const p1 = rbox(0.45, 0.42, 0.13, 0.05, m.accent, -w / 2 + 0.45, legH + 0.36, -d / 2 + 0.38);
  p1.rotation.set(-0.25, 0.25, 0.05);
  const p2 = rbox(0.42, 0.4, 0.12, 0.05, m.fabricAlt, w / 2 - 0.45, legH + 0.36, -d / 2 + 0.38);
  p2.rotation.set(-0.25, -0.2, -0.05);
  g.add(p1, p2);
  // folded throw on one arm
  g.add(box(0.36, 0.03, d * 0.7, m.linen, w / 2 - 0.09, legH + 0.46, 0.02));
  return g;
}

function armchair(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  const w = 0.8,
    d = 0.82,
    legH = 0.16;
  const mat = s.id === 'industrial' ? new THREE.MeshStandardMaterial({ color: s.fabric, roughness: 0.55 }) : m.fabricAlt;
  legs(g, s, m, w - 0.08, d - 0.08, legH, 0.04);
  g.add(rbox(w, 0.18, d, 0.04, mat, 0, legH, 0));
  g.add(rbox(w, 0.5, 0.16, 0.05, mat, 0, legH + 0.15, -d / 2 + 0.08));
  g.add(rbox(0.12, 0.26, d, 0.04, mat, -w / 2 + 0.06, legH + 0.15, 0));
  g.add(rbox(0.12, 0.26, d, 0.04, mat, w / 2 - 0.06, legH + 0.15, 0));
  g.add(rbox(w - 0.24, 0.12, d - 0.2, 0.05, mat, 0, legH + 0.17, 0.06));
  return g;
}

function coffeeTable(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  if (s.id === 'japandi' || s.id === 'scandi' || s.id === 'boho' || s.id === 'mediterranean') {
    const top = cyl(0.45, 0.45, 0.05, m.wood, 0, 0.33, 0, 40);
    g.add(top, cyl(0.3, 0.3, 0.33, s.id === 'boho' ? m.woodDark : m.wood, 0, 0, 0, 40));
  } else {
    g.add(box(1.15, 0.03, 0.6, s.id === 'classic' ? m.stone : m.stone, 0, 0.36, 0));
    if (s.legs === 'metal') {
      g.add(box(1.08, 0.02, 0.02, m.metal, 0, 0.34, -0.27), box(1.08, 0.02, 0.02, m.metal, 0, 0.34, 0.27));
      legs(g, s, m, 1.1, 0.56, 0.34, 0.02);
    } else g.add(box(0.9, 0.34, 0.4, m.woodDark, 0, 0, 0));
  }
  // styling: books + bowl
  g.add(box(0.26, 0.04, 0.2, m.books[1], 0.12, 0.39, 0.02));
  g.add(box(0.22, 0.03, 0.17, m.books[2], 0.12, 0.43, 0.02));
  g.add(cyl(0.1, 0.05, 0.06, m.pot, -0.18, 0.38, -0.04));
  return g;
}

function rug(s: StyleDef, m: Mats, w = 2.4, d = 1.7) {
  const g = new THREE.Group();
  const r = box(w, 0.012, d, m.rug, 0, 0, 0);
  r.castShadow = false;
  g.add(r);
  return g;
}

function tvUnit(s: StyleDef, m: Mats, w = 1.9) {
  const g = new THREE.Group();
  const h = 0.45,
    d = 0.42,
    legH = s.id === 'japandi' || s.id === 'modern' ? 0 : 0.12;
  if (legH) legs(g, s, m, w, d, legH, 0.08);
  g.add(box(w, h, d, s.id === 'modern' ? m.white : m.wood, 0, legH, 0));
  for (let i = 1; i < 3; i++) g.add(box(0.004, h - 0.04, 0.004, m.woodDark, -w / 2 + (w / 3) * i, legH + 0.02, d / 2));
  // TV mounted above
  g.add(box(1.24, 0.72, 0.03, m.screen, 0, legH + h + 0.35, -d / 2 + 0.03));
  g.add(cyl(0.07, 0.05, 0.22, m.pot, w / 2 - 0.18, legH + h, 0));
  g.add(box(0.22, 0.05, 0.16, m.books[0], -w / 2 + 0.25, legH + h, 0));
  return g;
}

function chair(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  legs(g, s, m, 0.44, 0.46, 0.45, 0.03);
  const seat = s.id === 'modern' || s.id === 'classic' ? m.fabric : s.id === 'industrial' ? m.woodDark : m.wood;
  g.add(rbox(0.46, 0.05, 0.47, 0.015, seat, 0, 0.44, 0));
  if (s.id === 'mediterranean' || s.id === 'boho') {
    g.add(box(0.44, 0.3, 0.03, m.woodDark, 0, 0.55, -0.22));
  } else g.add(rbox(0.44, 0.34, 0.05, 0.02, seat, 0, 0.5, -0.21));
  return g;
}

function pendant(s: StyleDef, m: Mats, drop: number) {
  const g = new THREE.Group();
  g.add(cyl(0.004, 0.004, drop, m.black, 0, -drop, 0, 6));
  let shade: THREE.Mesh;
  if (s.id === 'industrial' || s.id === 'modern') shade = cyl(0.06, 0.24, 0.22, m.metal, 0, -drop - 0.22, 0, 32);
  else if (s.id === 'japandi' || s.id === 'scandi') shade = mesh(new THREE.SphereGeometry(0.22, 32, 16), m.lampShade, 0, -drop - 0.2, 0);
  else shade = cyl(0.12, 0.28, 0.3, m.lampShade, 0, -drop - 0.3, 0, 32);
  shade.castShadow = false;
  shade.userData.lamp = true;
  g.add(shade);
  return g;
}

function diningTable(s: StyleDef, m: Mats, seats = 6) {
  const g = new THREE.Group();
  const w = seats >= 6 ? 1.8 : 1.2,
    d = 0.9;
  const round = s.id === 'japandi' || (s.id === 'scandi' && seats <= 4);
  if (round) {
    g.add(cyl(0.6, 0.6, 0.04, m.wood, 0, 0.72, 0, 48));
    g.add(cyl(0.08, 0.2, 0.72, m.wood, 0, 0, 0, 24));
  } else {
    g.add(box(w, 0.04, d, s.id === 'classic' || s.id === 'modern' ? m.stone : m.wood, 0, 0.72, 0));
    legs(g, s, m, w, d, 0.72, 0.08);
  }
  const place = (x: number, z: number, rot: number) => {
    const c = chair(s, m);
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    g.add(c);
  };
  if (round) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      place(Math.sin(a) * 0.72, Math.cos(a) * 0.72, a + Math.PI);
    }
  } else {
    const per = seats >= 6 ? 3 : 2;
    for (let i = 0; i < per; i++) {
      const x = -w / 2 + (w / per) * (i + 0.5);
      place(x, -d / 2 - 0.12, 0);
      place(x, d / 2 + 0.12, Math.PI);
    }
  }
  // centerpiece
  g.add(cyl(0.08, 0.06, 0.25, m.pot, 0, 0.76, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), m.leaf, 0, 1.05, 0));
  const p = pendant(s, m, 1.0);
  p.position.y = 2.7;
  p.userData.pendant = true;
  g.add(p);
  return g;
}

function bed(s: StyleDef, m: Mats, w = 1.6) {
  const g = new THREE.Group();
  const L = 2.05;
  const frame = s.id === 'modern' || s.id === 'classic' ? m.fabric : m.wood;
  g.add(rbox(w + 0.08, 0.28, L, 0.02, frame, 0, 0.04, 0));
  g.add(rbox(w - 0.02, 0.22, L - 0.08, 0.05, m.white, 0, 0.3, 0.02));
  // duvet over lower 2/3
  g.add(rbox(w + 0.02, 0.1, L * 0.68, 0.05, m.linen, 0, 0.45, L * 0.16));
  g.add(rbox(w + 0.03, 0.05, 0.5, 0.02, m.accent, 0, 0.53, L * 0.36));
  // pillows
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i - 0.5) * (w / 2);
    const p = rbox(w / n - 0.12, 0.14, 0.4, 0.06, m.linen, x, 0.5, -L / 2 + 0.3);
    p.rotation.x = -0.3;
    g.add(p);
  }
  if (n === 2) g.add(rbox(0.5, 0.32, 0.12, 0.05, m.fabricAlt, 0, 0.52, -L / 2 + 0.48));
  // headboard
  const hb = s.id === 'japandi' ? 0.75 : s.id === 'classic' ? 1.2 : 1.0;
  g.add(rbox(w + 0.12, hb, 0.08, s.softness * 0.5 + 0.01, s.id === 'classic' ? m.fabricAlt : frame, 0, 0.04, -L / 2 - 0.04));
  return g;
}

function nightstand(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  const legH = s.id === 'japandi' ? 0 : 0.12;
  if (legH) legs(g, s, m, 0.46, 0.38, legH, 0.03);
  g.add(box(0.46, 0.42, 0.38, m.wood, 0, legH, 0));
  g.add(box(0.4, 0.004, 0.004, m.woodDark, 0, legH + 0.22, 0.19));
  // lamp
  g.add(cyl(0.06, 0.07, 0.2, m.pot, 0, legH + 0.42, 0));
  const shade = cyl(0.11, 0.14, 0.18, m.lampShade, 0, legH + 0.62, 0);
  shade.userData.lamp = true;
  shade.castShadow = false;
  g.add(shade);
  return g;
}

function wardrobe(s: StyleDef, m: Mats, w = 1.8) {
  const g = new THREE.Group();
  const h = 2.35,
    d = 0.6;
  const mat = s.id === 'modern' || s.id === 'scandi' ? m.white : m.wood;
  g.add(box(w, h, d, mat, 0, 0, 0));
  const doors = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < doors; i++) g.add(box(0.006, h - 0.02, 0.006, m.woodDark, -w / 2 + (w / doors) * i, 0.01, d / 2));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5) + (i % 2 ? -0.22 : 0.22) * (w / doors / 0.6) * 0.4;
    g.add(box(0.012, 0.3, 0.02, m.metal, x, 1.0, d / 2 + 0.01));
  }
  return g;
}

function desk(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  g.add(box(1.3, 0.03, 0.62, m.wood, 0, 0.72, 0));
  legs(g, s, m, 1.3, 0.62, 0.72, 0.04);
  // laptop
  g.add(box(0.32, 0.015, 0.22, m.metal, 0.05, 0.75, 0.05));
  const lid = box(0.32, 0.22, 0.008, m.screen, 0.05, 0.75, -0.06);
  lid.rotation.x = -0.25;
  g.add(lid);
  // lamp
  g.add(cyl(0.07, 0.07, 0.015, m.black, -0.48, 0.75, -0.12));
  g.add(cyl(0.007, 0.007, 0.4, m.black, -0.48, 0.75, -0.12, 6));
  const sh = cyl(0.05, 0.09, 0.12, m.lampShade, -0.48, 1.12, -0.06);
  sh.userData.lamp = true;
  g.add(sh);
  g.add(box(0.2, 0.06, 0.15, m.books[3], 0.45, 0.75, -0.15));
  const c = chair(s, m);
  c.position.set(0, 0, 0.55);
  c.rotation.y = Math.PI;
  g.add(c);
  return g;
}

function plant(s: StyleDef, m: Mats, tall = 1.4) {
  const g = new THREE.Group();
  g.add(cyl(0.17, 0.13, 0.36, m.pot, 0, 0, 0, 24));
  g.add(cyl(0.012, 0.012, tall * 0.6, m.woodDark, 0, 0.3, 0, 6));
  const leafGeo = new THREE.SphereGeometry(0.12, 8, 6);
  leafGeo.scale(1, 0.25, 1.6);
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const y = 0.45 + r() * (tall - 0.45);
    const a = r() * Math.PI * 2;
    const rad = 0.08 + r() * 0.22 * (1 - (y - 0.45) / tall / 1.5);
    const l = mesh(leafGeo, i % 3 ? m.leaf : m.leafDark, Math.cos(a) * rad, y, Math.sin(a) * rad);
    l.rotation.set((r() - 0.5) * 1.2, a, (r() - 0.5) * 0.8);
    g.add(l);
  }
  return g;
}

function floorLamp(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.16, 0.02, m.metal, 0, 0, 0, 32));
  g.add(cyl(0.012, 0.012, 1.45, m.metal, 0, 0.02, 0, 8));
  const sh = cyl(0.17, 0.21, 0.3, m.lampShade, 0, 1.4, 0, 32);
  sh.userData.lamp = true;
  sh.castShadow = false;
  g.add(sh);
  return g;
}

function sideboard(s: StyleDef, m: Mats, w = 1.6) {
  const g = new THREE.Group();
  const legH = 0.16;
  legs(g, s, m, w, 0.42, legH, 0.06);
  g.add(box(w, 0.62, 0.42, s.id === 'modern' ? m.woodDark : m.wood, 0, legH, 0));
  for (let i = 1; i < 3; i++) g.add(box(0.004, 0.58, 0.004, m.woodDark, -w / 2 + (w / 3) * i, legH + 0.02, 0.21));
  const top = legH + 0.62;
  g.add(cyl(0.08, 0.05, 0.34, m.pot, w / 2 - 0.25, top, 0));
  g.add(box(0.24, 0.04, 0.18, m.books[4], -w / 2 + 0.3, top, 0));
  g.add(box(0.2, 0.04, 0.15, m.books[2], -w / 2 + 0.3, top + 0.04, 0));
  // mirror / art above
  g.add(box(0.8, 0.6, 0.02, s.id === 'classic' ? m.metal : m.linen, 0, top + 0.45, -0.19));
  return g;
}

function singleBed(s: StyleDef, m: Mats) {
  return bed(s, m, 0.9);
}

function bistroSet(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  g.add(cyl(0.32, 0.32, 0.03, m.wood, 0, 0.7, 0, 32));
  g.add(cyl(0.025, 0.025, 0.7, m.metal, 0, 0, 0, 8));
  g.add(cyl(0.2, 0.2, 0.02, m.metal, 0, 0, 0, 24));
  for (const sgn of [-1, 1]) {
    const c = chair(s, m);
    c.position.set(sgn * 0.62, 0, 0);
    c.rotation.y = -sgn * Math.PI / 2;
    g.add(c);
  }
  return g;
}

function shelf(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  const w = 0.9,
    h = 1.9,
    d = 0.34;
  const mat = s.id === 'industrial' ? m.metal : m.wood;
  g.add(box(0.025, h, d, mat, -w / 2, 0, 0), box(0.025, h, d, mat, w / 2, 0, 0));
  let k = 0;
  for (let i = 0; i < 5; i++) {
    const y = 0.05 + i * 0.45;
    g.add(box(w, 0.025, d, i % 2 && s.id === 'industrial' ? m.wood : mat, 0, y, 0));
    if (i === 4) break;
    let x = -w / 2 + 0.04;
    const fill = 0.35 + ((i * 37) % 5) / 10;
    while (x < -w / 2 + w * fill) {
      const bw = 0.025 + ((k * 13) % 4) * 0.01;
      const bh = 0.22 + ((k * 7) % 5) * 0.025;
      g.add(box(bw, bh, 0.22, m.books[k % m.books.length], x + bw / 2, y + 0.025, 0));
      x += bw + 0.002;
      k++;
    }
    if (i % 2 === 0) g.add(cyl(0.05, 0.04, 0.14, m.pot, w / 2 - 0.15, y + 0.025, 0));
  }
  return g;
}

export const FOOTPRINT: Record<FurnitureKind, [number, number]> = {
  sofa: [2.3, 0.95],
  armchair: [0.8, 0.82],
  coffeeTable: [1.15, 0.6],
  rug: [2.4, 1.7],
  tvUnit: [1.9, 0.42],
  diningTable: [1.8, 1.9],
  bed: [1.72, 2.15],
  nightstand: [0.46, 0.38],
  wardrobe: [1.8, 0.6],
  desk: [1.3, 1.1],
  plant: [0.5, 0.5],
  floorLamp: [0.4, 0.4],
  sideboard: [1.6, 0.42],
  singleBed: [1.0, 2.15],
  bistroSet: [1.6, 0.7],
  shelf: [0.9, 0.34],
};

export function buildFurniture(kind: FurnitureKind, s: StyleDef, m: Mats, opts: { w?: number; d?: number; seats?: number } = {}) {
  switch (kind) {
    case 'sofa':
      return sofa(s, m, opts.w);
    case 'armchair':
      return armchair(s, m);
    case 'coffeeTable':
      return coffeeTable(s, m);
    case 'rug':
      return rug(s, m, opts.w, opts.d);
    case 'tvUnit':
      return tvUnit(s, m, opts.w);
    case 'diningTable':
      return diningTable(s, m, opts.seats);
    case 'bed':
      return bed(s, m, opts.w);
    case 'nightstand':
      return nightstand(s, m);
    case 'wardrobe':
      return wardrobe(s, m, opts.w);
    case 'desk':
      return desk(s, m);
    case 'plant':
      return plant(s, m, opts.w);
    case 'floorLamp':
      return floorLamp(s, m);
    case 'sideboard':
      return sideboard(s, m, opts.w);
    case 'singleBed':
      return singleBed(s, m);
    case 'bistroSet':
      return bistroSet(s, m);
    case 'shelf':
      return shelf(s, m);
  }
}

// ---------------------------------------------------------------- fixtures (always present)

export function kitchenRun(s: StyleDef, m: Mats, len: number, withUppers = true) {
  const g = new THREE.Group();
  const cab = s.id === 'scandi' || s.id === 'modern' ? m.white : s.id === 'industrial' ? m.black : m.wood;
  const fridgeW = len > 2.6 ? 0.7 : 0;
  const runLen = len - fridgeW;
  const x0 = -len / 2 + fridgeW;
  g.add(box(runLen, 0.86, 0.6, cab, x0 + runLen / 2, 0.04, 0));
  g.add(box(runLen, 0.1, 0.56, m.black, x0 + runLen / 2, 0, -0.02));
  g.add(box(runLen + 0.01, 0.04, 0.63, m.stone, x0 + runLen / 2, 0.9, 0.015));
  const units = Math.max(1, Math.round(runLen / 0.6));
  const uw = runLen / units;
  for (let i = 1; i < units; i++) g.add(box(0.004, 0.84, 0.004, m.woodDark, x0 + uw * i, 0.05, 0.3));
  // sink + tap
  g.add(box(0.5, 0.01, 0.4, m.metal, x0 + runLen * 0.35, 0.94, 0.02));
  g.add(cyl(0.012, 0.012, 0.3, m.metal, x0 + runLen * 0.35, 0.94, -0.2, 8));
  // hob
  g.add(box(0.58, 0.008, 0.5, m.screen, x0 + runLen * 0.72, 0.94, 0.02));
  // backsplash
  g.add(box(runLen, 0.6, 0.015, m.stone, x0 + runLen / 2, 0.94, -0.3));
  if (withUppers) {
    g.add(box(runLen, 0.75, 0.35, cab, x0 + runLen / 2, 1.55, -0.12));
    for (let i = 1; i < units; i++) g.add(box(0.004, 0.73, 0.004, m.woodDark, x0 + uw * i, 1.56, 0.055));
  }
  if (fridgeW) g.add(box(fridgeW - 0.02, 2.15, 0.65, cab, -len / 2 + fridgeW / 2, 0, 0.02));
  g.add(cyl(0.09, 0.07, 0.18, m.pot, x0 + runLen * 0.12, 0.92, -0.1));
  return g;
}

export function bathSet(s: StyleDef, m: Mats, len: number) {
  const g = new THREE.Group();
  const vw = Math.min(1.0, len * 0.45);
  g.add(box(vw, 0.45, 0.48, s.id === 'modern' ? m.woodDark : m.wood, 0, 0.4, 0));
  g.add(box(vw + 0.02, 0.06, 0.5, m.white, 0, 0.85, 0));
  g.add(box(vw * 0.8, 0.8, 0.02, m.glass, 0, 1.1, -0.23));
  g.add(cyl(0.01, 0.01, 0.18, m.metal, 0, 0.91, -0.17, 8));
  if (len > 1.6) {
    // wc
    const x = vw / 2 + 0.35;
    g.add(rbox(0.36, 0.4, 0.55, 0.08, m.white, x, 0, 0.05));
    g.add(rbox(0.38, 0.32, 0.16, 0.03, m.white, x, 0.4, -0.18));
  }
  return g;
}

export function showerGlass(m: Mats) {
  const g = new THREE.Group();
  const p = box(0.9, 2.0, 0.012, m.glass, 0, 0, 0);
  p.castShadow = false;
  g.add(p);
  g.add(box(0.03, 2.0, 0.03, m.metal, 0.45, 0, 0));
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
