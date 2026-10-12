/**
 * Floor-plan reading.
 *
 * An uploaded plan is reduced to a binary "ink" mask, thin strokes (text,
 * dimension lines, door swings, furniture symbols, window lines) are removed by
 * a morphological opening, and what is left is treated as walls. Rooms are the
 * connected free areas once doorways are temporarily closed.
 */
import type { PlanRoom, PlanSettings, RoomType } from './types';

export const WORK_MAX = 1000;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RoomRegion {
  label: number;
  areaM2: number;
  /** pixel count */
  area: number;
  bbox: Rect;
  /** largest axis-aligned rectangle fully inside the room, in working px */
  inner: Rect;
  /** fraction of wall directly behind each side of `inner`: top, right, bottom, left */
  solid: [number, number, number, number];
  wallThickness: number;
  /** typical thickness of walls between this room and the outside (0 if none) */
  extWall: number;
  touchesOutside: boolean;
}

export type OpeningKind = 'door' | 'passage' | 'window' | 'slider' | 'entry';

export interface Opening {
  /** band covering the gap in the wall, working px */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 'x' = gap runs along x (in a horizontal wall) */
  axis: 'x' | 'y';
  widthM: number;
  /** room labels on each side (0 = none/outside); side A is the smaller coordinate */
  la: number;
  lb: number;
  outA: boolean;
  outB: boolean;
  glazed: boolean;
}

export interface PlanModel {
  openings: Opening[];
  w: number;
  h: number;
  scale: number; // working px per source px
  wall: Uint8Array;
  interior: Uint8Array;
  labels: Int32Array;
  regions: Map<number, RoomRegion>;
  hull: Rect;
  pxPerM: number;
  medianWall: number;
}

// ---------------------------------------------------------------- masks

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += src[row + x];
    for (let x = 0; x < w; x++) {
      const add = x + r;
      if (add < w) count += src[row + add];
      const rem = x - r - 1;
      if (rem >= 0) count -= src[row + rem];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const add = y + r;
      if (add < h) count += tmp[add * w + x];
      const rem = y - r - 1;
      if (rem >= 0) count -= tmp[rem * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

const invert = (m: Uint8Array) => m.map((v) => (v ? 0 : 1));

function erode(src: Uint8Array, w: number, h: number, r: number) {
  return invert(dilate(invert(src), w, h, r));
}

function floodFrom(passable: Uint8Array, w: number, h: number, seeds: number[]): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const s of seeds) if (passable[s] && !seen[s]) (seen[s] = 1), stack.push(s);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0 && passable[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), stack.push(i - 1);
    if (x < w - 1 && passable[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), stack.push(i + 1);
    if (i >= w && passable[i - w] && !seen[i - w]) (seen[i - w] = 1), stack.push(i - w);
    if (i < w * (h - 1) && passable[i + w] && !seen[i + w]) (seen[i + w] = 1), stack.push(i + w);
  }
  return seen;
}

function components(mask: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const boxes: Rect[] = [{ x0: 0, y0: 0, x1: 0, y1: 0 }];
  let next = 1;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const l = next++;
    let size = 0;
    const b: Rect = { x0: w, y0: h, x1: 0, y1: 0 };
    labels[s] = l;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of nb) if (n >= 0 && mask[n] && !labels[n]) (labels[n] = l), stack.push(n);
    }
    sizes.push(size);
    boxes.push(b);
  }
  return { labels, sizes, boxes, count: next - 1 };
}

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    best = 0,
    t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) (best = between), (t = i);
  }
  return t;
}

// ---------------------------------------------------------------- image → gray

export interface Raster {
  w: number;
  h: number;
  scale: number;
  gray: Uint8Array;
}

export function rasterize(img: HTMLImageElement | HTMLCanvasElement): Raster {
  const sw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const sh = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const scale = Math.min(1, WORK_MAX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    // treat strong colour (furniture symbols, coloured room fills) as light
    const r = data[j],
      g = data[j + 1],
      b = data[j + 2];
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = mx - mn > 60 ? Math.max(lum, 200) : lum;
  }
  return { w, h, scale, gray };
}

export function autoThreshold(r: Raster) {
  return Math.min(150, Math.max(60, Math.round(otsu(r.gray) * 0.8)));
}

// ---------------------------------------------------------------- analysis

export function extractWalls(r: Raster, threshold: number, minWall: number, fillOutline = 0) {
  const { w, h, gray } = r;
  let ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < threshold ? 1 : 0;
  // walls drawn as two parallel lines (unfilled): close the gap between them first
  if (fillOutline > 0) ink = close(ink, w, h, fillOutline);
  const rad = Math.max(1, Math.floor(minWall / 2));
  const opened = dilate(erode(ink, w, h, rad), w, h, rad);
  // keep only parts of the original ink (opening may slightly bloat corners)
  for (let i = 0; i < opened.length; i++) opened[i] &= ink[i];
  // drop small specks (bold text, symbols)
  const { labels, sizes, boxes } = components(opened, w, h);
  const minSpan = Math.max(w, h) * 0.035;
  const keep = sizes.map((s, l) => {
    if (l === 0) return 0;
    const b = boxes[l];
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    return s > 30 && span > minSpan ? 1 : 0;
  });
  for (let i = 0; i < opened.length; i++) opened[i] = labels[i] ? keep[labels[i]] : 0;
  return opened;
}

function orthoHull(wall: Uint8Array, w: number, h: number) {
  const hull = new Uint8Array(w * h);
  const rowMin = new Int32Array(h).fill(w),
    rowMax = new Int32Array(h).fill(-1);
  const colMin = new Int32Array(w).fill(h),
    colMax = new Int32Array(w).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (wall[y * w + x]) {
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
        if (y < colMin[x]) colMin[x] = y;
        if (y > colMax[x]) colMax[x] = y;
      }
  for (let y = 0; y < h; y++)
    for (let x = rowMin[y]; x <= rowMax[y]; x++) if (y >= colMin[x] && y <= colMax[x]) hull[y * w + x] = 1;
  return hull;
}

function bboxOf(mask: Uint8Array, w: number, h: number): Rect {
  const b: Rect = { x0: w, y0: h, x1: 0, y1: 0 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
  if (b.x1 < b.x0) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  return b;
}

/** Morphological closing: bridges gaps (windows, doors) narrower than 2r. */
function close(mask: Uint8Array, w: number, h: number, r: number) {
  return erode(dilate(mask, w, h, r), w, h, r);
}

function borderSeeds(w: number, h: number) {
  const seeds: number[] = [];
  for (let x = 0; x < w; x++) seeds.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) seeds.push(y * w, y * w + w - 1);
  return seeds;
}

/** Everything enclosed by the (gap-bridged) outer walls, walls included. */
function interiorOf(wall: Uint8Array, w: number, h: number, bridge: number) {
  // pad so the closing treats the area beyond the image as open space
  const P = bridge + 2;
  const pw = w + 2 * P,
    ph = h + 2 * P;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) padded.set(wall.subarray(y * w, y * w + w), (y + P) * pw + P);
  const closed = close(padded, pw, ph, bridge);
  const passable = closed.map((v) => (v ? 0 : 1));
  const outside = floodFrom(passable, pw, ph, borderSeeds(pw, ph));
  const interior = new Uint8Array(w * h);
  const closedC = new Uint8Array(w * h);
  let area = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + P) * pw + x + P;
      interior[y * w + x] = outside[i] ? 0 : 1;
      closedC[y * w + x] = closed[i];
      area += interior[y * w + x];
    }
  // open outline (e.g. a balcony with no parapet drawn) → fall back to the orthogonal hull
  const hull = orthoHull(closedC, w, h);
  let hullArea = 0;
  for (const v of hull) hullArea += v;
  if (area < hullArea * 0.55) return { interior: hull, area: hullArea };
  return { interior, area };
}

/** Thin drawn lines (glazing, door leaves, built-ins) that still divide space; text removed. */
function separators(r: Raster, threshold: number) {
  const { w, h, gray } = r;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < threshold ? 1 : 0;
  const { labels, boxes } = components(ink, w, h);
  const minSpan = Math.max(w, h) * 0.025;
  const keep = boxes.map((b, l) => (l && Math.max(b.x1 - b.x0, b.y1 - b.y0) > minSpan ? 1 : 0));
  for (let i = 0; i < ink.length; i++) ink[i] = labels[i] ? keep[labels[i]] : 0;
  return ink;
}

/** Estimate pixels-per-metre from the declared floor area. */
export function estimateScale(r: Raster, wall: Uint8Array, sqm: number) {
  // Without a scale yet, bridge gaps up to ~1/6 of the plan's size (≈2m windows on a typical flat).
  const wb = bboxOf(wall, r.w, r.h);
  const bridge = Math.round(Math.max(wb.x1 - wb.x0, wb.y1 - wb.y0) * 0.085);
  const { interior, area } = interiorOf(wall, r.w, r.h, bridge);
  if (!area) return 50;
  if (sqm > 10) return Math.sqrt(area / (sqm * 1.1));
  const b = bboxOf(interior, r.w, r.h);
  return Math.max(b.x1 - b.x0, b.y1 - b.y0) / 14;
}

/** Largest rectangle of 1s in a grid (histogram method). */
function maxRect(grid: Uint8Array, gw: number, gh: number): Rect | null {
  const heights = new Int32Array(gw);
  let best = 0;
  let res: Rect | null = null;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) heights[x] = grid[y * gw + x] ? heights[x] + 1 : 0;
    const stack: number[] = [];
    for (let x = 0; x <= gw; x++) {
      const hh = x < gw ? heights[x] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= hh) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = height * (x - left);
        // prefer less extreme rectangles a little
        if (area > best && height > 0) {
          best = area;
          res = { x0: left, y0: y - height + 1, x1: x - 1, y1: y };
        }
      }
      stack.push(x);
    }
  }
  return res;
}

export function analyzePlan(r: Raster, s: PlanSettings): PlanModel {
  const { w, h } = r;
  const pxPerM = s.pxPerM;
  const wall = extractWalls(r, s.threshold, s.minWall, s.fillOutline ? Math.round(s.fillOutline * pxPerM) : 0);

  // Interior: everything enclosed by the outer walls once window/door gaps up to ~2.4m are bridged.
  const { interior } = interiorOf(wall, w, h, Math.round(pxPerM * 1.3));

  // Rooms: free space with doorways sealed. Thin lines (glazing, door leaves) also divide space.
  const doorR = Math.max(1, Math.round((s.doorGap * pxPerM) / 2));
  const sealed = dilate(wall, w, h, doorR);
  const sep = s.thinLines === false ? null : separators(r, Math.min(215, s.threshold + 60));
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = interior[i] && !sealed[i] && !(sep && sep[i]) ? 1 : 0;
  const comp = components(free, w, h);
  const labels = new Int32Array(w * h);
  const tiny = 0.25 * pxPerM * pxPerM;
  for (let i = 0; i < labels.length; i++) {
    const l = comp.labels[i];
    labels[i] = l && comp.sizes[l] >= tiny ? l : 0;
  }
  if (sep) mergeIslands(labels, comp.sizes, wall, w, h, 6 * pxPerM * pxPerM, doorR + Math.round(pxPerM * 0.2));
  // drop what is still too small to be a room (closets, door swings)
  const sizeOf = new Map<number, number>();
  for (const l of labels) if (l) sizeOf.set(l, (sizeOf.get(l) || 0) + 1);
  const minPx = 0.8 * pxPerM * pxPerM;
  for (let i = 0; i < labels.length; i++) if (labels[i] && (sizeOf.get(labels[i]) || 0) < minPx) labels[i] = 0;
  // grow labels into the rest of the floor (multi-source BFS)
  const floor = new Uint8Array(w * h);
  for (let i = 0; i < floor.length; i++) floor[i] = interior[i] && !wall[i] ? 1 : 0;
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i]) frontier.push(i);
  const maxSteps = doorR * 2 + 4;
  for (let step = 0; step < maxSteps && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const l = labels[i];
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of nb) {
        if (n < 0 || n >= w * h) continue;
        if (floor[n] && !labels[n]) {
          labels[n] = l;
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // rooms the user outlined by hand win over automatic segmentation
  let nextLabel = 0;
  for (const l of labels) if (l > nextLabel) nextLabel = l;
  for (const room of s.rooms) {
    const rc = room.rect;
    if (!rc) continue;
    const L = ++nextLabel;
    for (let y = Math.max(0, Math.floor(rc.y0)); y <= Math.min(h - 1, Math.ceil(rc.y1)); y++)
      for (let x = Math.max(0, Math.floor(rc.x0)); x <= Math.min(w - 1, Math.ceil(rc.x1)); x++) {
        const i = y * w + x;
        interior[i] = 1;
        if (!wall[i]) labels[i] = L;
      }
  }

  // wall thickness samples
  const thickness = measureWallThickness(wall, w, h);

  // regions
  const regions = new Map<number, RoomRegion>();
  const cell = Math.max(1, Math.round(pxPerM * 0.1));
  const gw = Math.ceil(w / cell),
    gh = Math.ceil(h / cell);
  const hb = bboxOf(interior, w, h);
  const present = new Set<number>();
  for (const l of labels) if (l) present.add(l);
  const areaByLabel = new Map<number, number>();
  for (const l of labels) if (l) areaByLabel.set(l, (areaByLabel.get(l) || 0) + 1);

  for (const l of present) {
    const grid = new Uint8Array(gw * gh);
    const bbox: Rect = { x0: w, y0: h, x1: 0, y1: 0 };
    // a grid cell belongs to the room only if all sampled px are this room
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let ok = 1;
        for (let dy = 0; dy < cell && ok; dy += Math.max(1, cell >> 1))
          for (let dx = 0; dx < cell && ok; dx += Math.max(1, cell >> 1)) {
            const x = gx * cell + dx,
              y = gy * cell + dy;
            if (x >= w || y >= h || labels[y * w + x] !== l) ok = 0;
          }
        grid[gy * gw + gx] = ok;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (labels[y * w + x] === l) {
          if (x < bbox.x0) bbox.x0 = x;
          if (x > bbox.x1) bbox.x1 = x;
          if (y < bbox.y0) bbox.y0 = y;
          if (y > bbox.y1) bbox.y1 = y;
        }
    const mr = maxRect(grid, gw, gh);
    const inner: Rect = mr
      ? { x0: mr.x0 * cell, y0: mr.y0 * cell, x1: (mr.x1 + 1) * cell, y1: (mr.y1 + 1) * cell }
      : { ...bbox };
    const area = areaByLabel.get(l) || 0;
    const solid = sideSolidity(inner, wall, labels, l, w, h, Math.round(pxPerM * 0.35));
    const tk = regionWallThickness(labels, l, thickness, w, h);
    const ext = exteriorWall(labels, l, wall, interior, w, h);
    const touchesOutside =
      bbox.x0 - hb.x0 < pxPerM * 0.6 ||
      hb.x1 - bbox.x1 < pxPerM * 0.6 ||
      bbox.y0 - hb.y0 < pxPerM * 0.6 ||
      hb.y1 - bbox.y1 < pxPerM * 0.6;
    regions.set(l, {
      label: l,
      area,
      areaM2: area / (pxPerM * pxPerM),
      bbox,
      inner,
      solid,
      wallThickness: tk,
      extWall: ext,
      touchesOutside,
    });
  }

  const allT = [...regions.values()].map((r) => r.wallThickness).filter((t) => t > 0);
  allT.sort((a, b) => a - b);
  const medianWall = allT.length ? allT[Math.floor(allT.length / 2)] : 0;

  const openings = detectOpenings(wall, interior, labels, sep || separators(r, Math.min(215, s.threshold + 60)), pxPerM, w, h);

  return { w, h, scale: r.scale, wall, interior, labels, regions, hull: hb, pxPerM, medianWall, openings };
}

/**
 * Finds gaps between collinear wall segments: doors, passages, windows and balcony sliders.
 * Works on the wall mask decomposed into rectangles, pairing each segment end with the next
 * segment of the same thickness along the same line.
 */
function detectOpenings(wall: Uint8Array, interior: Uint8Array, labels: Int32Array, ink: Uint8Array, ppm: number, w: number, h: number): Opening[] {
  const cell = Math.max(1, Math.round(ppm * 0.05));
  const { grid, gw, gh } = downsample(wall, w, h, cell, 0.45);
  const rects = mergeRects(grid, gw, gh).map((b) => ({ x0: b.x * cell, y0: b.y * cell, x1: (b.x + b.w) * cell, y1: (b.y + b.h) * cell }));
  const maxT = ppm * 0.5;
  const minGap = ppm * 0.55,
    maxGap = ppm * 5.5;
  const out: Opening[] = [];
  const at = (x: number, y: number) => {
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return { l: 0, inside: false };
    const i = yi * w + xi;
    return { l: labels[i], inside: !!interior[i] };
  };
  for (const axis of ['x', 'y'] as const) {
    // project to (along, across) coordinates
    const segs = rects
      .map((r) => (axis === 'x' ? { a0: r.x0, a1: r.x1, c0: r.y0, c1: r.y1 } : { a0: r.y0, a1: r.y1, c0: r.x0, c1: r.x1 }))
      .filter((r) => r.c1 - r.c0 <= maxT && r.a1 - r.a0 >= (r.c1 - r.c0) * 0.6);
    segs.sort((p, q) => p.a0 - q.a0);
    for (const A of segs) {
      const tA = A.c1 - A.c0;
      let best: (typeof segs)[number] | null = null;
      for (const B of segs) {
        if (B.a0 <= A.a1 + minGap * 0.5 || B.a0 - A.a1 > maxGap) continue;
        const tB = B.c1 - B.c0;
        const ov = Math.min(A.c1, B.c1) - Math.max(A.c0, B.c0);
        if (ov < 0.6 * Math.min(tA, tB) || Math.abs(tA - tB) > Math.max(tA, tB) * 0.6) continue;
        if (!best || B.a0 < best.a0) best = B;
      }
      if (!best) continue;
      const g0 = A.a1,
        g1 = best.a0;
      if (g1 - g0 < minGap) continue;
      const c0 = Math.max(A.c0, best.c0),
        c1 = Math.min(A.c1, best.c1);
      // the band must be empty of walls, and no wall may cross it
      let wallPx = 0,
        inkPx = 0,
        n = 0;
      for (let a = Math.ceil(g0) + 1; a < g1 - 1; a++)
        for (let c = Math.ceil(c0); c < c1; c++) {
          const x = axis === 'x' ? a : c,
            y = axis === 'x' ? c : a;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          n++;
          wallPx += wall[y * w + x];
          inkPx += ink[y * w + x];
        }
      if (!n || wallPx / n > 0.12) continue;
      const mid = (g0 + g1) / 2;
      const reach = (c1 - c0) / 2 + ppm * 0.35;
      const cm = (c0 + c1) / 2;
      const pa = axis === 'x' ? at(mid, cm - reach) : at(cm - reach, mid);
      const pb = axis === 'x' ? at(mid, cm + reach) : at(cm + reach, mid);
      if (!pa.inside && !pb.inside) continue;
      // don't pair walls across an open room: both sides must be close to the band
      out.push({
        x0: axis === 'x' ? g0 : c0,
        x1: axis === 'x' ? g1 : c1,
        y0: axis === 'x' ? c0 : g0,
        y1: axis === 'x' ? c1 : g1,
        axis,
        widthM: (g1 - g0) / ppm,
        la: pa.l,
        lb: pb.l,
        outA: !pa.inside,
        outB: !pb.inside,
        glazed: inkPx / n > 0.03,
      });
    }
  }
  return out;
}

export function classifyOpening(o: Opening, isBalcony: (label: number) => boolean): OpeningKind {
  const exterior = o.outA || o.outB;
  const toBalcony = isBalcony(o.la) !== isBalcony(o.lb);
  if (toBalcony) return o.widthM >= 1.3 ? 'slider' : 'door';
  if (exterior) {
    if (o.glazed) return o.widthM >= 2.2 ? 'slider' : 'window';
    return o.widthM <= 1.4 ? 'entry' : 'window';
  }
  return o.widthM <= 1.25 ? 'door' : 'passage';
}

/**
 * Regions enclosed mostly by thin lines (furniture symbols, door swings) and touching a
 * single neighbour are part of that neighbour, not rooms of their own.
 */
function mergeIslands(labels: Int32Array, sizes: number[], wall: Uint8Array, w: number, h: number, maxPx: number, reach: number) {
  const pixels = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l && sizes[l] < maxPx) {
      let a = pixels.get(l);
      if (!a) pixels.set(l, (a = []));
      a.push(i);
    }
  }
  const order = [...pixels.keys()].sort((a, b) => sizes[a] - sizes[b]);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const l of order) {
    const px = pixels.get(l)!;
    let strong = 0,
      total = 0;
    const neigh = new Map<number, number>();
    for (let k = 0; k < px.length; k += 3) {
      const i = px[k];
      const x = i % w,
        y = (i - x) / w;
      for (const [dx, dy] of dirs) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || labels[ny * w + nx] === l) continue;
        total++;
        for (let s = 1; s <= reach; s++) {
          const qx = x + dx * s,
            qy = y + dy * s;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) break;
          const q = qy * w + qx;
          if (wall[q]) {
            strong++;
            break;
          }
          const ql = labels[q];
          if (ql && ql !== l) {
            neigh.set(ql, (neigh.get(ql) || 0) + 1);
            break;
          }
        }
      }
    }
    if (!total || strong / total > 0.5 || !neigh.size) continue;
    const [best, cnt] = [...neigh.entries()].sort((a, b) => b[1] - a[1])[0];
    const others = [...neigh.values()].reduce((a, b) => a + b, 0) - cnt;
    if (others > cnt * 0.25) continue;
    for (const i of px) labels[i] = best;
    sizes[best] += sizes[l];
    const bp = pixels.get(best);
    if (bp) bp.push(...px);
  }
}

/** For each wall pixel next to free space, how thick is the wall going outward. Stored on the free pixel. */
function measureWallThickness(wall: Uint8Array, w: number, h: number) {
  const t = new Uint16Array(w * h);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      if (wall[i]) continue;
      for (const [dx, dy] of dirs) {
        if (!wall[i + dy * w + dx]) continue;
        let n = 0;
        let cx = x + dx,
          cy = y + dy;
        while (cx >= 0 && cy >= 0 && cx < w && cy < h && wall[cy * w + cx] && n < 80) {
          n++;
          cx += dx;
          cy += dy;
        }
        if (n < 80) t[i] = Math.max(t[i], n);
      }
    }
  return t;
}

function exteriorWall(labels: Int32Array, l: number, wall: Uint8Array, interior: Uint8Array, w: number, h: number) {
  const vals: number[] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < w * h; i += 2) {
    if (labels[i] !== l) continue;
    const x = i % w,
      y = (i - x) / w;
    for (const [dx, dy] of dirs) {
      let cx = x + dx,
        cy = y + dy,
        n = 0;
      while (cx >= 0 && cy >= 0 && cx < w && cy < h && wall[cy * w + cx] && n < 80) {
        n++;
        cx += dx;
        cy += dy;
      }
      if (!n || n >= 80) continue;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || !interior[cy * w + cx]) vals.push(n);
    }
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

function regionWallThickness(labels: Int32Array, l: number, t: Uint16Array, w: number, h: number) {
  const vals: number[] = [];
  for (let i = 0; i < w * h; i++) if (labels[i] === l && t[i]) vals.push(t[i]);
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  // lower quartile: a room is "thick-walled" only if (almost) all its walls are thick
  return vals[Math.floor(vals.length / 4)];
}

function sideSolidity(r: Rect, wall: Uint8Array, labels: Int32Array, l: number, w: number, h: number, reach: number) {
  const probe = (x: number, y: number, dx: number, dy: number) => {
    for (let k = 1; k <= reach; k++) {
      const px = x + dx * k,
        py = y + dy * k;
      if (px < 0 || py < 0 || px >= w || py >= h) return 1;
      const i = py * w + px;
      if (wall[i]) return 1;
      if (labels[i] && labels[i] !== l) return 0;
    }
    return 0;
  };
  const side = (n: number, f: (k: number) => [number, number, number, number]) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += probe(...f(k));
    return n ? s / n : 0;
  };
  const W = r.x1 - r.x0,
    H = r.y1 - r.y0;
  return [
    side(W, (k) => [r.x0 + k, r.y0, 0, -1]),
    side(H, (k) => [r.x1, r.y0 + k, 1, 0]),
    side(W, (k) => [r.x0 + k, r.y1, 0, 1]),
    side(H, (k) => [r.x0, r.y0 + k, -1, 0]),
  ] as [number, number, number, number];
}

export function regionAt(m: PlanModel, x: number, y: number): RoomRegion | null {
  const xi = Math.round(x),
    yi = Math.round(y);
  for (let rad = 0; rad < 12; rad += 2)
    for (let dy = -rad; dy <= rad; dy += Math.max(1, rad))
      for (let dx = -rad; dx <= rad; dx += Math.max(1, rad)) {
        const px = xi + dx,
          py = yi + dy;
        if (px < 0 || py < 0 || px >= m.w || py >= m.h) continue;
        const l = m.labels[py * m.w + px];
        if (l) return m.regions.get(l) || null;
      }
  return null;
}

/** Guess room types the way an Israeli agent would read the plan. */
export function autoRooms(m: PlanModel, declaredRooms: number): PlanRoom[] {
  const regs = [...m.regions.values()].filter((r) => r.areaM2 >= 1.6).sort((a, b) => b.areaM2 - a.areaM2);
  const out: PlanRoom[] = [];
  const used = new Set<number>();
  const push = (r: RoomRegion, type: RoomType, name: string) => {
    used.add(r.label);
    out.push({
      id: 'r' + r.label + '_' + Math.random().toString(36).slice(2, 6),
      type,
      name,
      sx: (r.inner.x0 + r.inner.x1) / 2,
      sy: (r.inner.y0 + r.inner.y1) / 2,
    });
  };
  if (!regs.length) return out;
  push(regs[0], 'living', 'סלון');

  const pxm = m.pxPerM;
  const narrow = (r: RoomRegion) => {
    const iw = (r.inner.x1 - r.inner.x0) / pxm,
      ih = (r.inner.y1 - r.inner.y0) / pxm;
    return Math.min(iw, ih) < 1.7 && Math.max(iw, ih) / Math.max(0.1, Math.min(iw, ih)) > 2.2;
  };

  const exts = regs.map((r) => r.extWall).filter((v) => v > 0).sort((a, b) => a - b);
  const medianExt = exts.length ? exts[Math.floor(exts.length / 2)] : 0;
  for (const r of regs) {
    if (used.has(r.label)) continue;
    if (r.touchesOutside && r.extWall > 0 && r.extWall < medianExt * 0.8) push(r, 'balcony', '');
    else if (narrow(r)) push(r, 'hall', '');
    else if (r.areaM2 < 5.2) push(r, 'bathroom', '');
  }
  const mid = regs.filter((r) => !used.has(r.label));
  // safe room: noticeably thicker walls
  const mamad = mid
    .filter((r) => m.medianWall > 0 && r.wallThickness >= m.medianWall * 1.5 && r.areaM2 > 6 && r.areaM2 < 16)
    .sort((a, b) => b.wallThickness - a.wallThickness)[0];
  if (mamad) push(mamad, 'mamad', 'ממ״ד');
  const rest = mid.filter((r) => !used.has(r.label));
  const bedroomsWanted = Math.max(1, Math.round(declaredRooms || 4) - 1 - (mamad ? 1 : 0));
  let bedrooms = 0;
  for (const r of rest) {
    if (bedrooms < bedroomsWanted) {
      push(r, bedrooms === 0 ? 'master' : 'bedroom', '');
      bedrooms++;
    } else if (!out.some((o) => o.type === 'kitchen')) push(r, 'kitchen', '');
    else push(r, r.touchesOutside ? 'balcony' : 'office', '');
  }
  return out;
}

/**
 * For a click where no room was detected: flood the free space around the point, bounded by
 * walls (doorways sealed) and thin lines. Returns the room's rectangle, or null if it leaks out.
 */
export function roomRectAt(r: Raster, m: PlanModel, s: PlanSettings, x: number, y: number): Rect | null {
  const { w, h } = m;
  const doorR = Math.max(1, Math.round((s.doorGap * m.pxPerM) / 2));
  const sealed = dilate(m.wall, w, h, doorR);
  const sep = separators(r, Math.min(215, s.threshold + 60));
  const pass = new Uint8Array(w * h);
  for (let i = 0; i < pass.length; i++) pass[i] = sealed[i] || sep[i] ? 0 : 1;
  // nearest passable pixel to the click
  let seed = -1;
  for (let rad = 0; rad < 40 && seed < 0; rad += 2)
    for (let dy = -rad; dy <= rad && seed < 0; dy += 2)
      for (let dx = -rad; dx <= rad && seed < 0; dx += 2) {
        const px = Math.round(x) + dx,
          py = Math.round(y) + dy;
        if (px >= 0 && py >= 0 && px < w && py < h && pass[py * w + px]) seed = py * w + px;
      }
  if (seed < 0) return null;
  const reg = floodFrom(pass, w, h, [seed]);
  const b = bboxOf(reg, w, h);
  let area = 0;
  for (const v of reg) area += v;
  const touchesEdge = b.x0 <= 1 || b.y0 <= 1 || b.x1 >= w - 2 || b.y1 >= h - 2;
  const m2 = area / (m.pxPerM * m.pxPerM);
  if (touchesEdge || m2 < 0.4 || area > w * h * 0.5) return null;
  return { x0: Math.max(0, b.x0 - doorR), y0: Math.max(0, b.y0 - doorR), x1: Math.min(w - 1, b.x1 + doorR), y1: Math.min(h - 1, b.y1 + doorR) };
}

export function defaultPlanSettings(): PlanSettings {
  return { pxPerM: 50, threshold: 110, minWall: 5, doorGap: 0.95, rooms: [], calibrated: false };
}

// ---------------------------------------------------------------- 3D helpers

export interface Box2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Merge a grid into rectangles (greedy, row runs extended downward). */
export function mergeRects(grid: Uint8Array, gw: number, gh: number): Box2[] {
  const used = new Uint8Array(gw * gh);
  const out: Box2[] = [];
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!grid[i] || used[i]) continue;
      let x1 = x;
      while (x1 + 1 < gw && grid[y * gw + x1 + 1] && !used[y * gw + x1 + 1]) x1++;
      let y1 = y;
      outer: while (y1 + 1 < gh) {
        for (let k = x; k <= x1; k++) if (!grid[(y1 + 1) * gw + k] || used[(y1 + 1) * gw + k]) break outer;
        y1++;
      }
      for (let yy = y; yy <= y1; yy++) for (let k = x; k <= x1; k++) used[yy * gw + k] = 1;
      out.push({ x, y, w: x1 - x + 1, h: y1 - y + 1 });
    }
  return out;
}

export function downsample(mask: Uint8Array, w: number, h: number, cell: number, frac = 0.5) {
  const gw = Math.ceil(w / cell),
    gh = Math.ceil(h / cell);
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let n = 0,
        t = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
          t++;
          n += mask[y * w + x];
        }
      grid[gy * gw + gx] = t && n / t >= frac ? 1 : 0;
    }
  return { grid, gw, gh };
}

/** A* over a coarse occupancy grid. Returns grid cells or null. */
export function astar(block: Uint8Array, gw: number, gh: number, sx: number, sy: number, tx: number, ty: number) {
  const N = gw * gh;
  const start = sy * gw + sx,
    goal = ty * gw + tx;
  if (block[start] || block[goal]) return null;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const hfn = (i: number) => Math.hypot((i % gw) - tx, Math.floor(i / gw) - ty);
  g[start] = 0;
  push(hfn(start), start);
  const D = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  while (heap.length) {
    const [, i] = pop();
    if (i === goal) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const x = i % gw,
      y = (i - x) / gw;
    for (const [dx, dy, c] of D) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const n = ny * gw + nx;
      if (block[n] || closed[n]) continue;
      if (dx && dy && (block[y * gw + nx] || block[ny * gw + x])) continue;
      const ng = g[i] + c;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = i;
        push(ng + hfn(n), n);
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const path: number[] = [];
  for (let c = goal; c >= 0; c = came[c]) {
    path.push(c);
    if (c === start) break;
  }
  return path.reverse().map((i) => [i % gw, Math.floor(i / gw)] as [number, number]);
}

export { dilate };
