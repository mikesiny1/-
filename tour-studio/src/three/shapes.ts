/** Geometry and surface helpers that make procedural furniture read as real objects. */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Upholstery block: a finely subdivided box with rounded edges and an optional "puff"
 * (filled cushion bulge). Smooth normals, box-projected UVs.
 */
export function softBox(w: number, h: number, d: number, r: number, puff = 0) {
  const key = [w, h, d, r, puff].map((v) => v.toFixed(3)).join('|');
  const hit = geoCache.get(key);
  if (hit) return hit;
  r = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const seg = (v: number) => Math.max(4, Math.min(24, Math.round(v * 18)));
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const hx = w / 2 - r,
    hy = h / 2 - r,
    hz = d / 2 - r;
  const v = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-10) v.copy(c).add(dir.normalize().multiplyScalar(r));
    if (puff) {
      const u = v.x / (w / 2),
        s = v.y / (h / 2),
        t = v.z / (d / 2);
      const fu = 1 - u * u,
        fs = 1 - s * s,
        ft = 1 - t * t;
      v.y *= 1 + puff * fu * ft;
      v.x *= 1 + puff * 0.35 * fs * ft;
      v.z *= 1 + puff * 0.35 * fu * fs;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  boxUV(g, 1);
  geoCache.set(key, g);
  return g;
}

/** Box-projected UVs from the dominant normal axis (world-scale, `metres` per texture tile). */
export function boxUV(g: THREE.BufferGeometry, metres = 1) {
  const pos = g.attributes.position,
    nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)),
      ny = Math.abs(nor.getY(i)),
      nz = Math.abs(nor.getZ(i));
    let a: number, b: number;
    if (ny >= nx && ny >= nz) (a = pos.getX(i)), (b = pos.getZ(i));
    else if (nx >= nz) (a = pos.getZ(i)), (b = pos.getY(i));
    else (a = pos.getX(i)), (b = pos.getY(i));
    uv[i * 2] = a / metres;
    uv[i * 2 + 1] = b / metres;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Turned object from a profile of [radius, height] points (vases, pots, lamp bases). */
export function turned(profile: [number, number][], segments = 40) {
  const key = 'lathe' + JSON.stringify(profile) + segments;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}

/** A single leaf: pointed oval, slightly cupped and bent, base at origin, pointing +Y. */
export function leafGeometry(len: number, wid: number, bend = 0.25) {
  const key = `leaf${len}|${wid}|${bend}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid * 0.6, len * 0.15, wid * 0.55, len * 0.7, 0, len);
  s.bezierCurveTo(-wid * 0.55, len * 0.7, -wid * 0.6, len * 0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i);
    const t = y / len;
    // cup across the width, droop along the length
    pos.setZ(i, (x * x) / (wid * 1.6) - bend * len * t * t);
  }
  g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- textures

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const texCache = new Map<string, THREE.Texture>();

/** Fabric weave as a tangent-space normal map. */
export function weaveNormal(kind: 'linen' | 'boucle' | 'velvet' | 'leather' = 'linen') {
  const hit = texCache.get('n' + kind);
  if (hit) return hit;
  const N = 256;
  const r = rng(kind.length * 97);
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      if (kind === 'linen') v = Math.sin(x * 1.6) * 0.5 + Math.sin(y * 1.6 + (x % 7)) * 0.5 + r() * 0.6;
      else if (kind === 'boucle') v = r() * 1.4;
      else if (kind === 'velvet') v = r() * 0.25;
      else v = 0;
      hgt[y * N + x] = v;
    }
  if (kind === 'boucle' || kind === 'leather') {
    // blobs / grain
    for (let k = 0; k < (kind === 'boucle' ? 900 : 2500); k++) {
      const cx = r() * N,
        cy = r() * N,
        rad = kind === 'boucle' ? 2 + r() * 3 : 1 + r() * 2;
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          const d = Math.hypot(x - cx, y - cy) / rad;
          if (d < 1) hgt[((y + N) % N) * N + ((x + N) % N)] += (1 - d * d) * (kind === 'boucle' ? 1.2 : 0.5);
        }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const strength = kind === 'velvet' ? 0.6 : 1.6;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const hx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x - 1 + N) % N)];
      const hy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
      const n = new THREE.Vector3(-hx * strength, -hy * strength, 1).normalize();
      const i = (y * N + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === 'leather' ? 3 : 6, kind === 'leather' ? 3 : 6);
  texCache.set('n' + kind, t);
  return t;
}

/** Coloured wood grain: straight-sawn boards with growth lines and pores. */
export function woodGrain(color: string, seed = 1) {
  const key = 'w' + color + seed;
  const hit = texCache.get(key);
  if (hit) return hit;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(color);
  const r = rng(seed * 131 + color.charCodeAt(1));
  g.fillStyle = color;
  g.fillRect(0, 0, N, N);
  const boards = 4;
  for (let b = 0; b < boards; b++) {
    const y0 = (b * N) / boards;
    const tint = base.clone().offsetHSL(0, (r() - 0.5) * 0.04, (r() - 0.5) * 0.05);
    g.fillStyle = '#' + tint.getHexString();
    g.fillRect(0, y0, N, N / boards);
    const lines = 26 + Math.floor(r() * 14);
    for (let i = 0; i < lines; i++) {
      const yy = y0 + r() * (N / boards);
      const dark = base.clone().offsetHSL(0, 0.02, -0.08 - r() * 0.1);
      g.strokeStyle = `rgba(${Math.round(dark.r * 255)},${Math.round(dark.g * 255)},${Math.round(dark.b * 255)},${0.18 + r() * 0.3})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      const amp = 2 + r() * 6,
        fr = 0.004 + r() * 0.01,
        ph = r() * 6;
      for (let x = 0; x <= N; x += 8) {
        const y = yy + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 3.1 + ph) * amp * 0.3;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y0, N, 1);
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
    g.fillRect(r() * N, r() * N, 1 + r() * 3, 0.8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Abstract art for frames on the walls, composed from the style's palette. */
export function artTexture(colors: string[], ground: string, seed: number) {
  const key = 'art' + colors.join() + ground + seed;
  const hit = texCache.get(key);
  if (hit) return hit;
  const W = 512,
    H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed * 7919);
  g.fillStyle = ground;
  g.fillRect(0, 0, W, H);
  const kind = seed % 3;
  if (kind === 0) {
    // soft organic shapes
    for (let i = 0; i < 5; i++) {
      g.fillStyle = colors[i % colors.length];
      g.globalAlpha = 0.85;
      g.beginPath();
      const cx = W * (0.2 + r() * 0.6),
        cy = H * (0.2 + r() * 0.6),
        rad = 60 + r() * 140;
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
        const rr = rad * (0.8 + Math.sin(a * 3 + i) * 0.12 + r() * 0.05);
        const x = cx + Math.cos(a) * rr,
          y = cy + Math.sin(a) * rr;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.fill();
    }
  } else if (kind === 1) {
    // arch and sun
    g.fillStyle = colors[0];
    g.beginPath();
    g.moveTo(W * 0.22, H * 0.85);
    g.lineTo(W * 0.22, H * 0.45);
    g.arc(W * 0.5, H * 0.45, W * 0.28, Math.PI, 0);
    g.lineTo(W * 0.78, H * 0.85);
    g.fill();
    g.fillStyle = colors[1 % colors.length];
    g.beginPath();
    g.arc(W * 0.62, H * 0.3, W * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors[2 % colors.length];
    g.fillRect(W * 0.1, H * 0.85, W * 0.8, H * 0.03);
  } else {
    // brush strokes
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = colors[i % colors.length];
      g.lineWidth = 18 + r() * 40;
      g.lineCap = 'round';
      g.globalAlpha = 0.8;
      g.beginPath();
      const y = H * (0.15 + r() * 0.7);
      g.moveTo(W * (0.1 + r() * 0.2), y);
      g.bezierCurveTo(W * 0.4, y - 80 + r() * 160, W * 0.6, y - 80 + r() * 160, W * (0.7 + r() * 0.2), y + (r() - 0.5) * 60);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // paper / canvas grain
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},0.04)`;
    g.fillRect(r() * W, r() * H, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
