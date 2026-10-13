/**
 * Procedural furniture. Every piece is built in metres, centred on its footprint,
 * standing on y=0 and facing +Z (the "front" a person would sit or look at).
 *
 * Realism comes from three things: soft, filled upholstery geometry (softBox with puff),
 * physically based materials (fabric sheen and weave normals, wood grain, ceramic gloss),
 * and styling objects a designer would add (throws, cushions, books, vases, art).
 */
import * as THREE from 'three';
import type { StyleDef } from '../lib/styles';
import type { FurnitureKind } from '../lib/types';
import { rugTexture } from './textures';
import { artTexture, leafGeometry, softBox, turned, weaveNormal } from './shapes';
import { hasReal, realFit, realTex } from './real';
import { leafSway } from './anim';

export interface Mats {
  wood: THREE.MeshPhysicalMaterial;
  woodDark: THREE.MeshPhysicalMaterial;
  fabric: THREE.MeshPhysicalMaterial;
  fabricAlt: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  linen: THREE.MeshPhysicalMaterial;
  bedding: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  stone: THREE.MeshPhysicalMaterial;
  ceramic: THREE.MeshPhysicalMaterial;
  ceramicDark: THREE.MeshPhysicalMaterial;
  leaf: THREE.MeshStandardMaterial;
  leafDark: THREE.MeshStandardMaterial;
  stem: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  pot: THREE.MeshPhysicalMaterial;
  black: THREE.MeshStandardMaterial;
  screen: THREE.MeshPhysicalMaterial;
  lampShade: THREE.MeshStandardMaterial;
  bulb: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  white: THREE.MeshPhysicalMaterial;
  lacquer: THREE.MeshPhysicalMaterial;
  rug: THREE.MeshStandardMaterial;
  books: THREE.MeshStandardMaterial[];
  art: THREE.MeshStandardMaterial[];
  frame: THREE.MeshStandardMaterial;
  rattan: THREE.MeshPhysicalMaterial;
}

function fabricMat(color: string, kind: 'linen' | 'boucle' | 'velvet' | 'leather') {
  const c = new THREE.Color(color);
  if (kind === 'leather')
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.5,
      clearcoat: 0.3,
      clearcoatRoughness: 0.5,
      normalMap: realTex('leather_normal', 3),
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
  if (kind === 'velvet')
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.8,
      sheen: 1,
      sheenRoughness: 0.35,
      sheenColor: c.clone().offsetHSL(0, -0.05, 0.3),
      normalMap: realTex('velvet_normal', 3),
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.92,
    sheen: 0.6,
    sheenRoughness: 0.8,
    sheenColor: c.clone().offsetHSL(0, -0.05, 0.25),
    normalMap: weaveNormal(kind),
    normalScale: new THREE.Vector2(kind === 'boucle' ? 0.9 : 0.45, kind === 'boucle' ? 0.9 : 0.45),
  });
}

/** Scanned wood (grain, relief, roughness) tinted to the style's species. */
function woodMat(color: string, seed: number, gloss: boolean) {
  const rep = seed === 1 ? 2.6 : 3;
  const tint = new THREE.Color(color).multiplyScalar(1.45);
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    map: realTex('wood_grain', rep),
    normalMap: realTex('wood_normal', rep),
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: realTex('wood_orm', rep),
    roughness: gloss ? 0.55 : 0.95,
    clearcoat: gloss ? 0.55 : 0.05,
    clearcoatRoughness: 0.3,
  });
}

/** Real woven fabric for scatter cushions and throws, by style. */
function patternMat(s: StyleDef, fallback: THREE.MeshPhysicalMaterial) {
  const pat = s.id === 'classic' ? 'damask' : s.id === 'boho' ? 'paisley' : s.id === 'mediterranean' || s.id === 'scandi' ? 'stripe' : null;
  if (!pat) return fallback;
  const rep = pat === 'stripe' ? 3 : 2.2;
  return new THREE.MeshPhysicalMaterial({
    color: pat === 'stripe' ? new THREE.Color(s.accent).lerp(new THREE.Color('#ffffff'), 0.35) : '#ffffff',
    map: realTex(pat, rep),
    normalMap: realTex((pat + '_normal') as 'damask_normal', rep),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.9,
    sheen: 0.5,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color('#ffffff'),
  });
}

export function makeMats(s: StyleDef): Mats {
  const mats = buildMats(s);
  leafSway(mats.leaf);
  leafSway(mats.leafDark);
  return mats;
}

function buildMats(s: StyleDef): Mats {
  const upholstery: 'linen' | 'boucle' | 'velvet' | 'leather' =
    s.id === 'industrial' ? 'leather' : s.id === 'classic' ? 'velvet' : s.id === 'japandi' || s.id === 'boho' ? 'boucle' : 'linen';
  const gloss = s.id === 'classic' || s.id === 'modern';
  return {
    wood: woodMat(s.wood, 1, gloss),
    woodDark: woodMat(s.woodDark, 2, gloss),
    fabric: fabricMat(s.fabric, upholstery),
    fabricAlt: fabricMat(s.fabricAlt, s.id === 'classic' ? 'velvet' : 'linen'),
    accent: patternMat(s, fabricMat(s.accent, 'linen')),
    linen: fabricMat('#efebe3', 'linen'),
    bedding: fabricMat(s.id === 'industrial' ? '#d9d6d0' : '#f4f1ea', 'linen'),
    metal: new THREE.MeshStandardMaterial({ color: s.metal, roughness: s.metalRough, metalness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b39056', roughness: 0.3, metalness: 1 }),
    stone: new THREE.MeshPhysicalMaterial({ color: s.stone, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: '#ece7de', roughness: 0.25, clearcoat: 0.8 }),
    ceramicDark: new THREE.MeshPhysicalMaterial({ color: s.id === 'mediterranean' || s.id === 'boho' ? '#a5603e' : '#3f3c38', roughness: 0.55, clearcoat: 0.3 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#4f6d3a', roughness: 0.55, side: THREE.DoubleSide }),
    leafDark: new THREE.MeshStandardMaterial({ color: '#36502a', roughness: 0.55, side: THREE.DoubleSide }),
    stem: new THREE.MeshStandardMaterial({ color: '#5b4a35', roughness: 0.9 }),
    soil: new THREE.MeshStandardMaterial({ color: '#3a2e24', roughness: 1 }),
    pot: new THREE.MeshPhysicalMaterial({
      color: s.id === 'mediterranean' || s.id === 'boho' ? '#b5714b' : s.id === 'industrial' ? '#5a5853' : '#dcd6cc',
      roughness: s.id === 'mediterranean' || s.id === 'boho' ? 0.95 : 0.5,
      clearcoat: s.id === 'mediterranean' || s.id === 'boho' ? 0 : 0.3,
    }),
    black: new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.45, metalness: 0.3 }),
    screen: new THREE.MeshPhysicalMaterial({ color: '#07090c', roughness: 0.08, clearcoat: 1, metalness: 0.1 }),
    lampShade: new THREE.MeshStandardMaterial({
      color: '#f3eadb',
      roughness: 0.95,
      emissive: '#ffd9a0',
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff7e8', emissive: '#ffe2b0', emissiveIntensity: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#e3ecec', roughness: 0.03, transparent: true, opacity: 0.25, depthWrite: false }),
    white: new THREE.MeshPhysicalMaterial({ color: '#f1efea', roughness: 0.42, clearcoat: 0.2 }),
    lacquer: new THREE.MeshPhysicalMaterial({
      color: s.id === 'industrial' ? '#2c2b29' : s.id === 'classic' ? '#e9e3d8' : s.id === 'modern' ? '#d7d3cc' : '#ece8e1',
      roughness: 0.35,
      clearcoat: 0.5,
    }),
    rug: new THREE.MeshStandardMaterial({
      map: rugTexture(s.rugPattern, s.rug, s.rugAlt),
      roughness: 1,
      normalMap: weaveNormal('boucle'),
      normalScale: new THREE.Vector2(0.5, 0.5),
    }),
    books: ['#7b5e45', '#c9bba3', '#3e4a52', s.accent, '#e5ddd0', '#5a5f4a', '#a4473a', '#2f3b33'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
    ),
    art: [0, 1, 2].map(
      (i) =>
        new THREE.MeshStandardMaterial({
          map: artTexture([s.accent, s.fabricAlt, s.woodDark, s.rugAlt], s.id === 'industrial' ? '#d8d3ca' : '#f1ece3', i + s.id.length),
          roughness: 0.85,
        }),
    ),
    frame: new THREE.MeshStandardMaterial({
      color: s.id === 'classic' ? '#b39056' : s.id === 'modern' || s.id === 'industrial' ? '#1e1e1e' : s.wood,
      roughness: 0.4,
      metalness: s.id === 'classic' ? 0.9 : 0.1,
    }),
    rattan: new THREE.MeshPhysicalMaterial({ color: '#c8a46e', roughness: 0.8, normalMap: weaveNormal('linen'), normalScale: new THREE.Vector2(1.2, 1.2) }),
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

/** Soft block whose bottom sits at y. */
const soft = (w: number, h: number, d: number, r: number, puff: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  mesh(softBox(w, h, d, r, puff), mat, x, y + h / 2, z);

/** Crisp block with a tiny bevel (cabinetry, table tops). */
const block = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, bevel = 0.004) =>
  mesh(softBox(w, h, d, bevel, 0), mat, x, y + h / 2, z);

const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 28) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z);

const lathe = (profile: [number, number][], mat: THREE.Material, x = 0, y = 0, z = 0) => mesh(turned(profile), mat, x, y, z);

function legs(g: THREE.Group, s: StyleDef, m: Mats, w: number, d: number, h: number, inset = 0.06, splay = true) {
  const pts = [
    [-w / 2 + inset, -d / 2 + inset],
    [w / 2 - inset, -d / 2 + inset],
    [-w / 2 + inset, d / 2 - inset],
    [w / 2 - inset, d / 2 - inset],
  ];
  for (const [x, z] of pts) {
    if (s.legs === 'metal') g.add(block(0.022, h, 0.022, m.metal, x, 0, z, 0.003));
    else if (s.legs === 'turned') {
      g.add(lathe([[0.012, 0], [0.016, 0.03], [0.022, h * 0.5], [0.02, h * 0.85], [0.024, h * 0.9], [0.02, h], [0, h]], m.woodDark, x, 0, z));
      g.add(cyl(0.014, 0.014, 0.025, m.brass, x, 0, z, 12));
    } else {
      const leg = mesh(turned([[0, 0], [0.013, 0], [0.019, h * 0.95], [0.02, h], [0, h]], 16), m.wood, x, 0, z);
      if (splay) {
        leg.rotation.z = Math.sign(x) * -0.06;
        leg.rotation.x = Math.sign(z) * 0.06;
      }
      g.add(leg);
    }
  }
}

// ---------------------------------------------------------------- decor

function vase(m: Mats, x: number, y: number, z: number, scale = 1, dark = false) {
  if (scale >= 0.85 && hasReal('flowers')) {
    const r = realFit('flowers', { width: 0.24 * scale })!;
    r.position.set(x, y, z);
    return r;
  }
  const g = new THREE.Group();
  const p: [number, number][] = [
    [0, 0],
    [0.05, 0],
    [0.075, 0.06],
    [0.08, 0.13],
    [0.05, 0.22],
    [0.035, 0.27],
    [0.042, 0.3],
    [0.036, 0.3],
    [0.03, 0.27],
  ].map(([r, h]) => [r * scale, h * scale]);
  g.add(lathe(p, dark ? m.ceramicDark : m.ceramic));
  // a few dried branches
  for (let i = 0; i < 4; i++) {
    const b = cyl(0.0025, 0.004, 0.45 * scale, m.stem, 0, 0.27 * scale, 0, 5);
    b.rotation.set((i - 1.5) * 0.18, i * 1.3, (i % 2 ? 1 : -1) * 0.15);
    g.add(b);
  }
  g.position.set(x, y, z);
  return g;
}

function bookStack(m: Mats, x: number, y: number, z: number, n = 3, rot = 0) {
  const g = new THREE.Group();
  let h = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.24 - i * 0.025,
      d = 0.17 - i * 0.015,
      t = 0.025 + (i % 2) * 0.01;
    const b = block(w, t, d, m.books[(i * 3 + Math.round(x * 10)) % m.books.length], 0, h, 0, 0.003);
    b.rotation.y = (i - 1) * 0.08;
    g.add(b);
    h += t;
  }
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

function bowl(m: Mats, x: number, y: number, z: number) {
  return lathe(
    [
      [0, 0],
      [0.05, 0],
      [0.12, 0.04],
      [0.14, 0.07],
      [0.135, 0.07],
      [0.11, 0.045],
      [0, 0.012],
    ],
    m.ceramicDark,
    x,
    y,
    z,
  );
}

function tableLamp(s: StyleDef, m: Mats, x: number, y: number, z: number, scale = 1) {
  const g = new THREE.Group();
  const base: [number, number][] =
    s.id === 'japandi' || s.id === 'boho'
      ? [[0, 0], [0.06, 0], [0.09, 0.08], [0.085, 0.16], [0.04, 0.22], [0.012, 0.25], [0, 0.25]]
      : [[0, 0], [0.065, 0], [0.065, 0.015], [0.015, 0.03], [0.012, 0.25], [0, 0.25]];
  g.add(lathe(base.map(([r, h]) => [r * scale, h * scale]), s.id === 'classic' ? m.brass : m.ceramic));
  const shade = mesh(new THREE.CylinderGeometry(0.1 * scale, 0.14 * scale, 0.19 * scale, 36, 1, true), m.lampShade, 0, 0.33 * scale, 0);
  shade.castShadow = false;
  shade.userData.lamp = true;
  g.add(shade);
  g.add(mesh(new THREE.SphereGeometry(0.025 * scale, 12, 8), m.bulb, 0, 0.3 * scale, 0));
  g.position.set(x, y, z);
  return g;
}

export function wallArt(s: StyleDef, m: Mats, w = 1.0, h = 0.75, variant = 0) {
  const g = new THREE.Group();
  const fd = 0.03;
  g.add(block(w, h, fd, m.frame, 0, 0, 0, 0.003));
  const mat = mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), m.art[variant % m.art.length], 0, h / 2, fd / 2 + 0.001);
  mat.castShadow = false;
  g.add(mat);
  return g;
}

// ---------------------------------------------------------------- pieces

function sofa(s: StyleDef, m: Mats, w = 2.3) {
  const realId = s.id === 'classic' ? 'carvedSofa' : s.id === 'modern' ? 'glamSofa' : null;
  if (realId && hasReal(realId)) {
    const r = realFit(realId, { width: Math.min(w, realId === 'carvedSofa' ? 2.45 : 2.3) });
    if (r) return r;
  }
  const g = new THREE.Group();
  const d = 0.98;
  const legH = s.id === 'japandi' || s.id === 'boho' ? 0.05 : 0.13;
  const armW = s.id === 'modern' ? 0.14 : s.id === 'classic' ? 0.22 : 0.19;
  const armH = s.id === 'japandi' ? 0.36 : 0.44;
  const R = 0.04 + s.softness * 0.5;
  const up = m.fabric;
  legs(g, s, m, w - 0.12, d - 0.12, legH, 0.04, false);
  g.add(soft(w, 0.2, d, 0.035, 0, up, 0, legH, 0));
  g.add(soft(w - 0.02, 0.5, 0.2, R, 0.04, up, 0, legH + 0.12, -d / 2 + 0.1));
  for (const sg of [-1, 1]) {
    if (s.id === 'classic') {
      g.add(soft(armW, armH - 0.08, d, 0.05, 0.05, up, sg * (w / 2 - armW / 2), legH + 0.06, 0));
      const roll = mesh(new THREE.CylinderGeometry(armW * 0.6, armW * 0.6, d - 0.02, 24), up, sg * (w / 2 - armW / 2), legH + armH, 0);
      roll.rotation.x = Math.PI / 2;
      g.add(roll);
    } else g.add(soft(armW, armH, d, R, 0.05, up, sg * (w / 2 - armW / 2), legH + 0.04, 0));
  }
  const inner = w - armW * 2;
  const seats = inner > 1.9 ? 3 : 2;
  const sw = inner / seats;
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + sw * (i + 0.5);
    g.add(soft(sw - 0.012, 0.17, d - 0.26, 0.05, 0.07, up, x, legH + 0.19, 0.07));
    const back = soft(sw - 0.025, 0.46, 0.2, 0.07, 0.09, up, x, legH + 0.33, -d / 2 + 0.29);
    back.rotation.x = -0.16;
    g.add(back);
  }
  // scatter cushions
  const pillows: [THREE.Material, number, number][] = [
    [m.accent, -inner / 2 + 0.28, 0.35],
    [m.fabricAlt, -inner / 2 + 0.56, 0.15],
    [m.linen, inner / 2 - 0.3, -0.3],
  ];
  if (s.id === 'boho' || s.id === 'mediterranean') pillows.push([m.accent, inner / 2 - 0.58, -0.1]);
  for (const [mat, x, rot] of pillows) {
    const p = soft(0.46, 0.46, 0.15, 0.06, 0.2, mat, x, legH + 0.33, -d / 2 + 0.43);
    p.rotation.set(-0.28, rot, rot * 0.25);
    g.add(p);
  }
  // throw blanket folded over the arm
  const side = w / 2 - armW / 2;
  g.add(soft(armW + 0.06, 0.03, 0.5, 0.012, 0.1, m.linen, side, legH + armH + 0.03, 0.05));
  const drape = soft(0.03, 0.3, 0.5, 0.012, 0.1, m.linen, side + armW / 2 + 0.02, legH + armH - 0.25, 0.05);
  g.add(drape);
  return g;
}

function armchair(s: StyleDef, m: Mats) {
  const realId = s.id === 'classic' ? 'damaskChair' : s.id === 'boho' || s.id === 'mediterranean' || s.id === 'modern' ? 'velvetChair' : null;
  if (realId && hasReal(realId)) {
    const r = realFit(realId, { width: 0.82 });
    if (r) return r;
  }
  const g = new THREE.Group();
  const w = 0.78,
    d = 0.82,
    legH = 0.17;
  const up = s.id === 'industrial' ? m.fabric : m.fabricAlt;
  if (s.id === 'scandi' || s.id === 'japandi' || s.id === 'mediterranean') {
    // timber frame lounge chair
    legs(g, s, m, w - 0.04, d - 0.04, 0.42, 0.02, false);
    for (const sg of [-1, 1]) g.add(block(0.05, 0.03, d, m.wood, sg * (w / 2 - 0.025), 0.56, 0, 0.01));
    g.add(soft(w - 0.1, 0.13, d - 0.1, 0.05, 0.08, up, 0, 0.36, 0.03));
    const back = soft(w - 0.12, 0.5, 0.13, 0.06, 0.1, up, 0, 0.47, -d / 2 + 0.1);
    back.rotation.x = -0.25;
    g.add(back);
    return g;
  }
  legs(g, s, m, w - 0.08, d - 0.08, legH, 0.04, false);
  g.add(soft(w, 0.18, d, 0.04, 0, up, 0, legH, 0));
  g.add(soft(w, 0.5, 0.16, 0.06, 0.06, up, 0, legH + 0.15, -d / 2 + 0.08));
  for (const sg of [-1, 1]) g.add(soft(0.13, 0.27, d, 0.05, 0.06, up, sg * (w / 2 - 0.065), legH + 0.14, 0));
  g.add(soft(w - 0.25, 0.13, d - 0.2, 0.05, 0.08, up, 0, legH + 0.17, 0.06));
  const p = soft(0.4, 0.36, 0.13, 0.05, 0.2, m.accent, 0, legH + 0.32, -d / 2 + 0.24);
  p.rotation.x = -0.25;
  g.add(p);
  return g;
}

function coffeeTable(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  if (s.id === 'japandi' || s.id === 'scandi' || s.id === 'boho' || s.id === 'mediterranean') {
    g.add(lathe([[0, 0.33], [0.46, 0.33], [0.47, 0.345], [0.465, 0.37], [0, 0.37]], m.wood));
    g.add(lathe([[0, 0], [0.3, 0], [0.31, 0.02], [0.29, 0.33], [0, 0.33]], s.id === 'boho' ? m.woodDark : m.wood));
  } else {
    g.add(block(1.15, 0.035, 0.62, m.stone, 0, 0.35, 0, 0.008));
    if (s.legs === 'metal') {
      for (const sg of [-1, 1]) {
        g.add(block(0.02, 0.35, 0.56, m.metal, sg * 0.52, 0, 0, 0.003));
      }
      g.add(block(1.06, 0.015, 0.02, m.metal, 0, 0.02, 0, 0.003));
    } else g.add(block(0.9, 0.35, 0.42, m.woodDark, 0, 0, 0, 0.006));
  }
  const top = s.id === 'japandi' || s.id === 'scandi' || s.id === 'boho' || s.id === 'mediterranean' ? 0.37 : 0.385;
  g.add(bookStack(m, 0.12, top, 0.05, 3, 0.3));
  // a cup of tea set down a moment ago
  const cup = hasReal('teacup') ? realFit('teacup', { width: 0.15 }) : null;
  if (cup) {
    cup.position.set(0.14, top, 0.02);
    cup.rotation.y = 0.6;
    g.add(cup);
    g.add(vase(m, -0.12, top, 0.12, 0.6, true));
  } else {
    g.add(bowl(m, -0.2, top, -0.05));
    g.add(vase(m, -0.05, top, 0.15, 0.6, true));
  }
  return g;
}

function rug(s: StyleDef, m: Mats, w = 2.4, d = 1.7) {
  const g = new THREE.Group();
  const r = block(w, 0.012, d, m.rug, 0, 0, 0, 0.004);
  r.castShadow = false;
  g.add(r);
  return g;
}

function tvUnit(s: StyleDef, m: Mats, w = 1.9) {
  const g = new THREE.Group();
  const h = 0.46,
    d = 0.42,
    legH = s.id === 'japandi' || s.id === 'modern' ? 0.02 : 0.12;
  if (legH > 0.05) legs(g, s, m, w, d, legH, 0.08, false);
  const body = s.id === 'modern' ? m.lacquer : m.wood;
  g.add(block(w, h, d, body, 0, legH, 0, 0.006));
  if (s.id === 'japandi' || s.id === 'scandi' || s.id === 'mediterranean') {
    // slatted fronts
    for (let x = -w / 2 + 0.03; x < w / 2 - 0.02; x += 0.035) g.add(block(0.018, h - 0.06, 0.012, m.woodDark, x, legH + 0.03, d / 2, 0.002));
  } else for (let i = 1; i < 3; i++) g.add(block(0.004, h - 0.04, 0.004, m.black, -w / 2 + (w / 3) * i, legH + 0.02, d / 2, 0.001));
  const top = legH + h;
  // wall-mounted TV
  g.add(block(1.3, 0.75, 0.03, m.black, 0, top + 0.32, -d / 2 + 0.02, 0.004));
  g.add(mesh(new THREE.PlaneGeometry(1.27, 0.72), m.screen, 0, top + 0.32 + 0.375, -d / 2 + 0.036));
  g.add(vase(m, w / 2 - 0.2, top, 0, 0.9));
  g.add(bookStack(m, -w / 2 + 0.3, top, 0, 2));
  g.add(tableLamp(s, m, -w / 2 + 0.6, top, -0.02, 0.8));
  return g;
}

function chair(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  if (s.id === 'mediterranean' || s.id === 'boho') {
    legs(g, s, m, 0.44, 0.46, 0.45, 0.03);
    g.add(block(0.46, 0.04, 0.46, m.rattan, 0, 0.45, 0, 0.01));
    g.add(block(0.44, 0.03, 0.03, m.wood, 0, 0.62, -0.21, 0.01));
    g.add(block(0.4, 0.22, 0.015, m.rattan, 0, 0.65, -0.21, 0.004));
    g.add(block(0.44, 0.03, 0.03, m.wood, 0, 0.87, -0.21, 0.01));
    return g;
  }
  legs(g, s, m, 0.44, 0.46, 0.45, 0.03);
  const seatMat = s.id === 'industrial' ? m.woodDark : s.id === 'japandi' || s.id === 'scandi' ? m.wood : m.fabric;
  g.add(soft(0.46, 0.05, 0.46, 0.015, s.id === 'modern' || s.id === 'classic' ? 0.12 : 0, seatMat, 0, 0.44, 0));
  if (s.id === 'scandi' || s.id === 'japandi') {
    // bent-wood back rail on spindles
    for (const x of [-0.18, -0.06, 0.06, 0.18]) g.add(cyl(0.007, 0.007, 0.3, m.wood, x, 0.49, -0.2, 8));
    const rail = soft(0.46, 0.06, 0.04, 0.015, 0, m.wood, 0, 0.78, -0.21);
    g.add(rail);
  } else {
    const back = soft(0.44, 0.36, 0.06, 0.025, 0.08, seatMat, 0, 0.5, -0.21);
    back.rotation.x = -0.1;
    g.add(back);
  }
  return g;
}

function pendant(s: StyleDef, m: Mats, drop: number) {
  const g = new THREE.Group();
  g.add(cyl(0.003, 0.003, drop, m.black, 0, -drop, 0, 6));
  g.add(cyl(0.05, 0.05, 0.02, m.black, 0, -0.02, 0, 16));
  let shade: THREE.Mesh;
  if (s.id === 'industrial' || s.id === 'modern')
    shade = lathe([[0.02, 0], [0.04, -0.02], [0.07, -0.07], [0.18, -0.18], [0.19, -0.19]], m.metal, 0, -drop, 0);
  else if (s.id === 'japandi' || s.id === 'scandi') shade = mesh(new THREE.SphereGeometry(0.16, 40, 24), m.lampShade, 0, -drop - 0.14, 0);
  else shade = lathe([[0.025, 0], [0.09, -0.025], [0.19, -0.18], [0.2, -0.22]], m.rattan, 0, -drop, 0);
  (shade.material as THREE.Material).side = THREE.DoubleSide;
  shade.castShadow = false;
  if (shade.material === m.lampShade) shade.userData.lamp = true;
  g.add(shade);
  g.add(mesh(new THREE.SphereGeometry(0.04, 12, 8), m.bulb, 0, -drop - 0.12, 0));
  return g;
}

function diningTable(s: StyleDef, m: Mats, seats = 6) {
  const g = new THREE.Group();
  const w = seats >= 6 ? 1.9 : 1.3,
    d = 0.92;
  const round = s.id === 'japandi' || (s.id === 'scandi' && seats <= 4);
  if (round) {
    g.add(lathe([[0, 0.72], [0.6, 0.72], [0.61, 0.735], [0.6, 0.755], [0, 0.755]], m.wood));
    g.add(lathe([[0, 0], [0.26, 0], [0.27, 0.02], [0.09, 0.08], [0.07, 0.72], [0, 0.72]], m.wood));
  } else {
    g.add(block(w, 0.04, d, s.id === 'classic' || s.id === 'modern' ? m.stone : m.wood, 0, 0.72, 0, 0.008));
    if (s.id === 'industrial') {
      for (const sg of [-1, 1]) {
        g.add(block(0.05, 0.72, d - 0.1, m.metal, sg * (w / 2 - 0.15), 0, 0, 0.003));
      }
    } else legs(g, s, m, w, d, 0.72, 0.08, false);
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
      place(Math.sin(a) * 0.74, Math.cos(a) * 0.74, a + Math.PI);
    }
  } else {
    const per = seats >= 6 ? 3 : 2;
    for (let i = 0; i < per; i++) {
      const x = -w / 2 + (w / per) * (i + 0.5);
      place(x, -d / 2 - 0.14, 0);
      place(x, d / 2 + 0.14, Math.PI);
    }
  }
  // table styling: runner, vase, bowl
  if (!round) g.add(block(Math.min(w - 0.4, 1.2), 0.004, 0.36, m.linen, 0, 0.76, 0, 0.001));
  g.add(vase(m, -0.15, 0.76, 0, 1.1));
  const olives = hasReal('olives') ? realFit('olives', { width: 0.3 }) : null;
  if (olives) {
    olives.position.set(0.3, 0.76, 0.05);
    g.add(olives);
  } else g.add(bowl(m, 0.25, 0.76, 0.05));
  const p = pendant(s, m, 0.8);
  p.position.y = 2.7;
  p.userData.pendant = true;
  g.add(p);
  return g;
}

function bed(s: StyleDef, m: Mats, w = 1.6) {
  const g = new THREE.Group();
  const L = 2.05;
  const frameMat = s.id === 'modern' || s.id === 'classic' ? m.fabric : m.wood;
  const legH = s.id === 'japandi' ? 0.02 : 0.08;
  if (frameMat === m.wood) g.add(block(w + 0.08, 0.24, L, m.wood, 0, legH, 0, 0.01));
  else g.add(soft(w + 0.1, 0.26, L + 0.02, 0.04, 0.02, frameMat, 0, legH, 0));
  if (legH > 0.05) legs(g, s, m, w, L, legH, 0.05, false);
  const mt = legH + 0.24;
  g.add(soft(w - 0.02, 0.22, L - 0.06, 0.06, 0.04, m.white, 0, mt, 0.01));
  // duvet with overhang on three sides
  const dy = mt + 0.2;
  const dl = L * 0.74;
  const dz = L / 2 - dl / 2 + 0.03;
  g.add(soft(w + 0.06, 0.1, dl, 0.05, 0.12, m.bedding, 0, dy, dz));
  for (const sg of [-1, 1]) g.add(soft(0.035, 0.3, dl - 0.02, 0.015, 0.06, m.bedding, sg * (w / 2 + 0.035), dy - 0.22, dz));
  g.add(soft(w + 0.1, 0.28, 0.035, 0.015, 0.06, m.bedding, 0, dy - 0.2, dz + dl / 2 + 0.01));
  // folded throw across the foot
  g.add(soft(w + 0.12, 0.05, 0.42, 0.02, 0.25, m.accent, 0, dy + 0.1, L / 2 - 0.32));
  g.add(soft(w + 0.14, 0.24, 0.03, 0.012, 0.05, m.accent, 0, dy - 0.13, L / 2 - 0.1));
  // pillows: sleeping pillows, euro shams, a small cushion
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i - 0.5) * (w / 2);
    const p = soft(w / n - 0.12, 0.14, 0.46, 0.06, 0.22, m.bedding, x, mt + 0.22, -L / 2 + 0.32);
    p.rotation.x = -0.2;
    g.add(p);
    const e = soft(w / n - 0.16, 0.5, 0.13, 0.06, 0.18, m.linen, x, mt + 0.26, -L / 2 + 0.16);
    e.rotation.x = -0.18;
    g.add(e);
  }
  const c = soft(0.45, 0.32, 0.13, 0.05, 0.22, m.fabricAlt, 0, mt + 0.3, -L / 2 + 0.42);
  c.rotation.x = -0.2;
  g.add(c);
  // headboard
  const hbH = s.id === 'japandi' ? 0.8 : s.id === 'classic' ? 1.25 : 1.05;
  if (s.id === 'classic' || s.id === 'modern') {
    const ch = Math.max(5, Math.round((w + 0.14) / 0.22));
    const cw = (w + 0.14) / ch;
    for (let i = 0; i < ch; i++)
      g.add(soft(cw - 0.006, hbH, 0.1, 0.04, 0.18, s.id === 'classic' ? m.fabricAlt : frameMat, -(w + 0.14) / 2 + cw * (i + 0.5), legH, -L / 2 - 0.05));
  } else if (s.id === 'japandi' || s.id === 'scandi') {
    g.add(block(w + 0.14, hbH, 0.05, m.wood, 0, legH, -L / 2 - 0.03, 0.01));
    for (let x = -w / 2; x <= w / 2; x += 0.06) g.add(block(0.025, hbH - 0.1, 0.012, m.woodDark, x, legH + 0.05, -L / 2 - 0.002, 0.002));
  } else if (s.id === 'boho' || s.id === 'mediterranean') {
    g.add(block(w + 0.14, hbH, 0.05, m.wood, 0, legH, -L / 2 - 0.03, 0.01));
    g.add(block(w, hbH - 0.2, 0.02, m.rattan, 0, legH + 0.1, -L / 2 + 0.002, 0.004));
  } else g.add(soft(w + 0.14, hbH, 0.09, 0.03, 0.04, frameMat, 0, legH, -L / 2 - 0.045));
  return g;
}

function nightstand(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  const legH = s.id === 'japandi' ? 0.02 : 0.14;
  if (legH > 0.05) legs(g, s, m, 0.46, 0.38, legH, 0.03, false);
  g.add(block(0.48, 0.4, 0.38, s.id === 'modern' ? m.lacquer : m.wood, 0, legH, 0, 0.006));
  g.add(block(0.44, 0.003, 0.004, m.black, 0, legH + 0.2, 0.19, 0.001));
  g.add(block(0.1, 0.012, 0.015, s.id === 'classic' ? m.brass : m.metal, 0, legH + 0.29, 0.197, 0.003));
  const top = legH + 0.4;
  g.add(tableLamp(s, m, -0.08, top, -0.03, 0.95));
  g.add(bookStack(m, 0.13, top, 0.05, 2, 0.4));
  return g;
}

function wardrobe(s: StyleDef, m: Mats, w = 1.8) {
  const g = new THREE.Group();
  const h = 2.4,
    d = 0.6;
  const body = s.id === 'modern' || s.id === 'scandi' || s.id === 'classic' ? m.lacquer : m.wood;
  g.add(block(w, 0.08, d - 0.05, m.black, 0, 0, -0.02, 0.002));
  g.add(block(w, h - 0.08, d, body, 0, 0.08, 0, 0.004));
  const doors = Math.max(2, Math.round(w / 0.55));
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    g.add(block(dw - 0.006, h - 0.1, 0.02, body, x, 0.09, d / 2 + 0.008, 0.003));
    if (s.id === 'classic') {
      g.add(block(dw - 0.14, 0.9, 0.008, body, x, 0.3, d / 2 + 0.02, 0.01));
      g.add(block(dw - 0.14, 0.9, 0.008, body, x, 1.32, d / 2 + 0.02, 0.01));
    }
    const hx = x + (i % 2 ? -1 : 1) * (dw / 2 - 0.05);
    g.add(block(0.014, 0.32, 0.022, s.id === 'classic' ? m.brass : m.metal, hx, 0.95, d / 2 + 0.03, 0.004));
  }
  return g;
}

function desk(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  g.add(block(1.3, 0.03, 0.62, m.wood, 0, 0.72, 0, 0.006));
  if (s.id !== 'industrial') g.add(block(0.4, 0.13, 0.5, m.wood, 0.4, 0.58, -0.02, 0.004));
  legs(g, s, m, 1.3, 0.62, 0.72, 0.04, false);
  const top = 0.75;
  // laptop
  g.add(block(0.32, 0.012, 0.22, m.metal, 0.05, top, 0.06, 0.003));
  const lid = new THREE.Group();
  lid.add(block(0.32, 0.22, 0.008, m.metal, 0, 0, 0, 0.002));
  lid.add(mesh(new THREE.PlaneGeometry(0.3, 0.19), m.screen, 0, 0.11, 0.005));
  lid.position.set(0.05, top + 0.012, -0.05);
  lid.rotation.x = -0.22;
  g.add(lid);
  g.add(tableLamp(s, m, -0.48, top, -0.15, 0.85));
  g.add(bookStack(m, 0.45, top, -0.12, 3, -0.2));
  g.add(cyl(0.035, 0.03, 0.1, m.ceramic, -0.25, top, -0.18, 20));
  const c = chair(s, m);
  c.position.set(0, 0, 0.55);
  c.rotation.y = Math.PI;
  g.add(c);
  return g;
}

function plant(s: StyleDef, m: Mats, tall = 1.4) {
  const big = tall > 1.1;
  if (hasReal('plant') && (!big || s.id === 'mediterranean' || s.id === 'boho' || tall <= 1.3)) {
    const r = realFit('plant', { height: Math.min(1.25, tall * 0.85) });
    if (r) return r;
  }
  const g = new THREE.Group();
  const potH = big ? 0.42 : 0.3,
    potR = big ? 0.2 : 0.15;
  if (s.id === 'boho' || s.id === 'mediterranean') {
    // woven basket
    g.add(lathe([[0, 0], [potR * 0.85, 0], [potR, potH * 0.2], [potR * 1.02, potH], [potR * 0.95, potH], [0, potH * 0.9]], m.rattan));
  } else
    g.add(
      lathe(
        [
          [0, 0],
          [potR * 0.8, 0],
          [potR * 0.82, 0.02],
          [potR, potH * 0.85],
          [potR * 1.02, potH],
          [potR * 0.95, potH],
          [0, potH * 0.92],
        ],
        m.pot,
      ),
    );
  g.add(cyl(potR * 0.94, potR * 0.94, 0.01, m.soil, 0, potH * 0.9, 0, 24));
  let seed = Math.round(tall * 100) + s.id.length;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (big && s.id !== 'mediterranean') {
    // fiddle-leaf fig: a few trunks with big leaves
    const leaf = leafGeometry(0.26, 0.17, 0.2);
    for (let k = 0; k < 3; k++) {
      const trunkH = tall * (0.75 + r() * 0.25);
      const tx = (r() - 0.5) * 0.08,
        tz = (r() - 0.5) * 0.08;
      const trunk = cyl(0.008, 0.014, trunkH, m.stem, tx, potH * 0.9, tz, 6);
      trunk.rotation.z = (r() - 0.5) * 0.15;
      g.add(trunk);
      const n = 9 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const y = potH + trunkH * (0.35 + (i / n) * 0.65);
        const l = mesh(leaf, i % 3 ? m.leaf : m.leafDark, tx, y, tz);
        l.rotation.set(-0.9 - r() * 0.6, r() * Math.PI * 2, 0, 'YXZ');
        const sc = 0.8 + r() * 0.5;
        l.scale.setScalar(sc);
        g.add(l);
      }
    }
  } else {
    // olive / small-leaved shrub
    const leaf = leafGeometry(0.07, 0.022, 0.1);
    const trunkH = tall * 0.6;
    g.add(cyl(0.01, 0.018, trunkH, m.stem, 0, potH * 0.9, 0, 6));
    for (let i = 0; i < 180; i++) {
      const a = r() * Math.PI * 2;
      const y = potH + trunkH * 0.6 + r() * (tall - potH - trunkH * 0.6);
      const rad = 0.05 + r() * 0.24 * Math.sin(((y - potH) / tall) * Math.PI);
      const l = mesh(leaf, i % 3 ? m.leaf : m.leafDark, Math.cos(a) * rad, y, Math.sin(a) * rad);
      l.rotation.set(r() * Math.PI, a, r() * Math.PI);
      l.castShadow = false;
      g.add(l);
    }
  }
  return g;
}

function floorLamp(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  if (s.id === 'scandi' || s.id === 'boho' || s.id === 'mediterranean') {
    // tripod
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = cyl(0.01, 0.012, 1.3, m.wood, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12, 8);
      leg.rotation.set(-Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
      g.add(leg);
    }
  } else {
    g.add(cyl(0.15, 0.16, 0.025, m.metal, 0, 0, 0, 36));
    g.add(cyl(0.01, 0.01, 1.4, m.metal, 0, 0.02, 0, 10));
  }
  const sh = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.32, 40, 1, true), m.lampShade, 0, 1.45, 0);
  sh.userData.lamp = true;
  sh.castShadow = false;
  g.add(sh);
  g.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), m.bulb, 0, 1.4, 0));
  return g;
}

function sideboard(s: StyleDef, m: Mats, w = 1.6) {
  const g = new THREE.Group();
  const legH = 0.16;
  legs(g, s, m, w, 0.42, legH, 0.06, false);
  g.add(block(w, 0.64, 0.42, s.id === 'modern' ? m.woodDark : m.wood, 0, legH, 0, 0.006));
  if (s.id === 'japandi' || s.id === 'scandi' || s.id === 'mediterranean')
    for (let x = -w / 2 + 0.03; x < w / 2 - 0.02; x += 0.035) g.add(block(0.018, 0.58, 0.012, m.woodDark, x, legH + 0.03, 0.21, 0.002));
  else for (let i = 1; i < 3; i++) g.add(block(0.004, 0.6, 0.004, m.black, -w / 2 + (w / 3) * i, legH + 0.02, 0.21, 0.001));
  const top = legH + 0.64;
  g.add(tableLamp(s, m, w / 2 - 0.25, top, 0, 1.1));
  g.add(vase(m, -w / 2 + 0.25, top, 0.02, 1.2, true));
  g.add(bookStack(m, -w / 2 + 0.55, top, 0.02, 2, 0.2));
  const art = wallArt(s, m, Math.min(1.0, w * 0.6), 0.7, 1);
  art.position.set(0, top + 0.35, -0.2);
  g.add(art);
  return g;
}

function singleBed(s: StyleDef, m: Mats) {
  return bed(s, m, 0.9);
}

function bistroSet(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0.7], [0.33, 0.7], [0.335, 0.72], [0, 0.72]], s.id === 'industrial' ? m.metal : m.wood));
  g.add(cyl(0.02, 0.025, 0.7, m.metal, 0, 0, 0, 12));
  g.add(lathe([[0, 0], [0.2, 0], [0.18, 0.02], [0, 0.03]], m.metal));
  g.add(vase(m, 0.08, 0.72, 0.04, 0.55, true));
  for (const sg of [-1, 1]) {
    const c = chair(s, m);
    c.position.set(sg * 0.64, 0, 0);
    c.rotation.y = -sg * (Math.PI / 2);
    g.add(c);
    const cu = soft(0.4, 0.06, 0.4, 0.03, 0.3, m.accent, sg * 0.64, 0.49, 0);
    g.add(cu);
  }
  return g;
}

function shelf(s: StyleDef, m: Mats) {
  const g = new THREE.Group();
  const w = 0.9,
    h = 1.95,
    d = 0.34;
  const frame = s.id === 'industrial' ? m.metal : m.wood;
  g.add(block(0.025, h, d, frame, -w / 2, 0, 0, 0.003), block(0.025, h, d, frame, w / 2, 0, 0, 0.003));
  g.add(block(w, h, 0.012, s.id === 'industrial' ? m.wood : frame, 0, 0, -d / 2 + 0.006, 0.002));
  let k = 0;
  for (let i = 0; i < 5; i++) {
    const y = 0.05 + i * 0.46;
    g.add(block(w, 0.025, d, i % 2 && s.id === 'industrial' ? m.wood : frame, 0, y, 0, 0.003));
    if (i === 4) break;
    let x = -w / 2 + 0.04;
    const fill = 0.35 + ((i * 37) % 5) / 10;
    while (x < -w / 2 + w * fill) {
      const bw = 0.025 + ((k * 13) % 4) * 0.01;
      const bh = 0.22 + ((k * 7) % 5) * 0.025;
      const b = block(bw, bh, 0.22, m.books[k % m.books.length], x + bw / 2, y + 0.025, 0.02, 0.002);
      if (k % 9 === 8) b.rotation.z = -0.2;
      g.add(b);
      x += bw + 0.002;
      k++;
    }
    if (i % 2 === 0) g.add(vase(m, w / 2 - 0.16, y + 0.025, 0.02, 0.6, i === 2));
    else g.add(bookStack(m, w / 2 - 0.2, y + 0.025, 0.02, 3));
  }
  return g;
}

function art(s: StyleDef, m: Mats, w = 1.1) {
  return wallArt(s, m, w, w * 0.72, 0);
}

export const FOOTPRINT: Record<FurnitureKind, [number, number]> = {
  sofa: [2.3, 0.98],
  armchair: [0.8, 0.82],
  coffeeTable: [1.15, 0.62],
  rug: [2.4, 1.7],
  tvUnit: [1.9, 0.42],
  diningTable: [1.9, 1.95],
  bed: [1.74, 2.15],
  nightstand: [0.48, 0.38],
  wardrobe: [1.8, 0.62],
  desk: [1.3, 1.1],
  plant: [0.5, 0.5],
  floorLamp: [0.44, 0.44],
  sideboard: [1.6, 0.42],
  singleBed: [1.04, 2.15],
  bistroSet: [1.6, 0.7],
  shelf: [0.9, 0.34],
  art: [1.1, 0.04],
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
    case 'art':
      return art(s, m, opts.w);
  }
}

// ---------------------------------------------------------------- fixtures (always present)

export function kitchenRun(s: StyleDef, m: Mats, len: number, withUppers = true) {
  const g = new THREE.Group();
  const cab = s.id === 'scandi' || s.id === 'modern' || s.id === 'classic' ? m.lacquer : s.id === 'industrial' ? m.black : m.wood;
  const handle = s.id === 'classic' ? m.brass : m.metal;
  const fridgeW = len > 2.6 ? 0.72 : 0;
  const runLen = len - fridgeW;
  const x0 = -len / 2 + fridgeW;
  g.add(block(runLen, 0.1, 0.54, m.black, x0 + runLen / 2, 0, -0.03, 0.002));
  const units = Math.max(1, Math.round(runLen / 0.6));
  const uw = runLen / units;
  const ovenUnit = Math.min(units - 1, Math.round(units * 0.7));
  for (let i = 0; i < units; i++) {
    const x = x0 + uw * (i + 0.5);
    g.add(block(uw - 0.004, 0.76, 0.58, cab, x, 0.1, 0, 0.003));
    if (i === ovenUnit && units > 1) {
      g.add(block(uw - 0.04, 0.5, 0.02, m.black, x, 0.18, 0.3, 0.003));
      g.add(mesh(new THREE.PlaneGeometry(uw - 0.12, 0.3), m.screen, x, 0.42, 0.312));
      g.add(block(uw - 0.16, 0.012, 0.03, handle, x, 0.64, 0.32, 0.004));
    } else {
      g.add(block(Math.min(0.3, uw - 0.2), 0.012, 0.025, handle, x, 0.78, 0.305, 0.004));
    }
  }
  g.add(block(runLen + 0.01, 0.035, 0.63, m.stone, x0 + runLen / 2, 0.86, 0.015, 0.004));
  // sink + tap
  const sx = x0 + runLen * 0.32;
  g.add(block(0.5, 0.006, 0.4, m.black, sx, 0.894, 0.02, 0.002));
  const tap = new THREE.Group();
  tap.add(cyl(0.015, 0.018, 0.3, m.metal, 0, 0, 0, 16));
  const spout = cyl(0.01, 0.01, 0.2, m.metal, 0, 0.2, 0.08, 12);
  spout.rotation.x = Math.PI / 2;
  tap.add(spout);
  tap.position.set(sx, 0.895, -0.22);
  g.add(tap);
  // hob
  const hx = x0 + uw * (ovenUnit + 0.5);
  g.add(block(0.58, 0.006, 0.5, m.screen, hx, 0.895, 0.02, 0.002));
  // backsplash
  g.add(block(runLen, 0.62, 0.015, s.id === 'mediterranean' || s.id === 'boho' ? m.ceramicDark : m.stone, x0 + runLen / 2, 0.895, -0.3, 0.002));
  if (withUppers) {
    for (let i = 0; i < units; i++) {
      const x = x0 + uw * (i + 0.5);
      if (i === ovenUnit) {
        // range hood
        g.add(block(uw - 0.02, 0.2, 0.4, m.metal, x, 1.6, -0.12, 0.004));
        g.add(block(0.3, 0.5, 0.25, m.metal, x, 1.8, -0.2, 0.004));
      } else {
        g.add(block(uw - 0.004, 0.72, 0.34, cab, x, 1.55, -0.13, 0.003));
        g.add(block(0.012, 0.012, 0.025, handle, x + uw / 2 - 0.06, 1.6, 0.05, 0.002));
      }
    }
    // a little open-shelf styling under the cabinets
    g.add(vase(m, x0 + runLen * 0.12, 0.895, -0.12, 0.7, true));
    g.add(bowl(m, x0 + runLen * 0.55, 0.895, -0.1));
    // two avocado halves on the board, the kitchen is lived in
    for (const [dx, ry] of [[0, 0.4], [0.07, 2.6]] as const) {
      const a = hasReal('avocado') ? realFit('avocado', { height: 0.11 }) : null;
      if (!a) break;
      a.rotation.set(-Math.PI / 2, 0, ry);
      a.position.set(x0 + runLen * 0.47 + dx, 0.895 + 0.028, 0.08 + dx * 0.4);
      g.add(a);
    }
  }
  if (fridgeW) {
    g.add(block(fridgeW - 0.02, 2.2, 0.66, cab, -len / 2 + fridgeW / 2, 0, 0.02, 0.004));
    g.add(block(0.015, 1.1, 0.03, handle, -len / 2 + fridgeW - 0.08, 0.8, 0.37, 0.004));
  }
  return g;
}

export function bathSet(s: StyleDef, m: Mats, len: number) {
  const g = new THREE.Group();
  const vw = Math.min(1.0, len * 0.45);
  g.add(block(vw, 0.45, 0.48, s.id === 'modern' ? m.woodDark : m.wood, 0, 0.4, 0, 0.004));
  g.add(block(vw + 0.02, 0.025, 0.5, m.stone, 0, 0.85, 0, 0.003));
  // vessel basin
  g.add(lathe([[0, 0], [0.12, 0], [0.18, 0.06], [0.2, 0.13], [0.19, 0.13], [0.16, 0.06], [0, 0.03]], m.ceramic, 0, 0.875, 0.03));
  const tap = cyl(0.01, 0.01, 0.3, m.metal, 0, 0.875, -0.2, 12);
  g.add(tap);
  const sp = cyl(0.008, 0.008, 0.14, m.metal, 0, 1.17, -0.14, 10);
  sp.rotation.x = Math.PI / 2;
  g.add(sp);
  // mirror with a soft backlight
  g.add(block(vw * 0.8, 0.8, 0.02, m.glass, 0, 1.15, -0.23, 0.004));
  const glow = block(vw * 0.82, 0.82, 0.005, m.bulb, 0, 1.14, -0.242, 0.001);
  glow.castShadow = false;
  g.add(glow);
  // wall light above the mirror
  const sconce = hasReal('sconce') ? realFit('sconce', { height: 0.26 }) : null;
  if (sconce) {
    sconce.position.set(0, 1.62, -0.24 + 0.12);
    g.add(sconce);
  }
  // towel on a rail
  g.add(cyl(0.008, 0.008, 0.5, m.metal, -vw / 2 - 0.35, 1.2, -0.2, 8).rotateZ(Math.PI / 2));
  g.add(soft(0.42, 0.55, 0.04, 0.015, 0.1, m.linen, -vw / 2 - 0.35, 0.68, -0.18));
  if (len > 1.6) {
    // wall-hung wc
    const x = vw / 2 + 0.38;
    g.add(soft(0.36, 0.34, 0.54, 0.12, 0.1, m.ceramic, x, 0.08, 0.03));
    g.add(soft(0.38, 0.03, 0.5, 0.012, 0, m.ceramic, x, 0.42, 0.04));
    g.add(block(0.2, 0.15, 0.01, m.white, x, 1.0, -0.24, 0.003));
  }
  return g;
}

export function showerGlass(m: Mats) {
  const g = new THREE.Group();
  const p = block(0.9, 2.0, 0.01, m.glass, 0, 0.02, 0, 0.002);
  p.castShadow = false;
  g.add(p);
  g.add(block(0.025, 2.0, 0.025, m.metal, 0.45, 0, 0, 0.003));
  g.add(cyl(0.12, 0.12, 0.01, m.metal, 0.2, 2.1, -0.6, 32));
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.libraryAsset) mesh.geometry.dispose();
  });
}
