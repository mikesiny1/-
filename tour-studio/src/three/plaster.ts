/**
 * Hand-troweled plaster: a tileable, multi-octave noise used as a bump and roughness map, so
 * walls and ceilings catch light unevenly like real paint over plaster instead of reading as flat CG.
 */
import * as THREE from 'three';

let cached: { bump: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;

function periodicNoise(size: number, octaves: [number, number][], seed: number) {
  const out = new Float32Array(size * size);
  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 1664525 + 1013904223) >>> 0;
    return rnd / 4294967296;
  };
  for (const [cells, amp] of octaves) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells,
          fy = (y / size) * cells;
        const x0 = Math.floor(fx),
          y0 = Math.floor(fy);
        let u = fx - x0,
          v = fy - y0;
        u = u * u * (3 - 2 * u);
        v = v * v * (3 - 2 * v);
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
        out[y * size + x] += (a + (b - a) * v) * amp;
      }
  }
  return out;
}

function toTexture(size: number, f: (i: number) => number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, Math.round(f(i) * 255)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function plasterMaps() {
  if (cached) return cached;
  const S = 512;
  // broad trowel waves, mid mottling, fine grain
  const n = periodicNoise(S, [[4, 0.45], [12, 0.3], [48, 0.17], [160, 0.08]], 7);
  cached = {
    bump: toTexture(S, (i) => n[i]),
    rough: toTexture(S, (i) => 0.86 + (n[i] - 0.5) * 0.16),
  };
  return cached;
}

/** Box faces get world-aligned UVs (1 unit = `tile` metres), so the plaster never stretches. */
export function worldUVs(g: THREE.BufferGeometry, tile: number) {
  const pos = g.attributes.position,
    nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)),
      ay = Math.abs(nor.getY(i));
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const [u, v] = ax > 0.5 ? [z, y] : ay > 0.5 ? [x, z] : [x, y];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
