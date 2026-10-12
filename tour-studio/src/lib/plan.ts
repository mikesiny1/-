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

export type OpeningKind = 'door' | 'passage' | 'window' | 'slider' | 'entry' | 'facade';

export interface Opening {
  /** band covering the gap in the wall, working px */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 'x' = gap runs along x (in a horizontal wall) */
  axis: 'x' | 'y';
  widthM: number;
  /** a stretch of the outer envelope with no masonry: built as a glass wall */
  facade?: boolean;
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
  for (const s of seeds) if (passable[s] && !seen[s]) ((seen[s] = 1), stack.push(s));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0 && passable[i - 1] && !seen[i - 1]) ((seen[i - 1] = 1), stack.push(i - 1));
    if (x < w - 1 && passable[i + 1] && !seen[i + 1]) ((seen[i + 1] = 1), stack.push(i + 1));
    if (i >= w && passable[i - w] && !seen[i - w]) ((seen[i - w] = 1), stack.push(i - w));
    if (i < w * (h - 1) && passable[i + w] && !seen[i + w]) ((seen[i + w] = 1), stack.push(i + w));
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
      for (const n of nb) if (n >= 0 && mask[n] && !labels[n]) ((labels[n] = l), stack.push(n));
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
    if (between > best) ((best = between), (t = i));
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
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1;
    if (s <= 30 || span <= minSpan) return 0;
    return 1;
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
  for (let y = 0; y < h; y++) for (let x = rowMin[y]; x <= rowMax[y]; x++) if (y >= colMin[x] && y <= colMax[x]) hull[y * w + x] = 1;
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

/** Walls plus thin facade lines (glazing drawn in light grey) close to the building. */
function withFacade(r: Raster, wall: Uint8Array, m: number) {
  const { w, h } = r;
  const facadeInk = separators(r, 228);
  const wb = bboxOf(wall, w, h);
  const seal = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const inBox = x >= wb.x0 - m && x <= wb.x1 + m && y >= wb.y0 - m && y <= wb.y1 + m;
      seal[i] = wall[i] || (facadeInk[i] && inBox) ? 1 : 0;
    }
  return seal;
}

/** Estimate pixels-per-metre from the declared floor area. */
export function estimateScale(r: Raster, wall: Uint8Array, sqm: number) {
  // Without a scale yet, bridge gaps up to ~1/6 of the plan's size (≈2m windows on a typical flat).
  const wb = bboxOf(wall, r.w, r.h);
  const span = Math.max(wb.x1 - wb.x0, wb.y1 - wb.y0);
  const bridge = Math.round(span * 0.085);
  const { interior, area } = interiorOf(withFacade(r, wall, Math.round(span * 0.012)), r.w, r.h, bridge);
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
  if (!s.fillOutline) addPartitions(r, wall, Math.min(200, s.threshold + 40), pxPerM, glazingMask(r, wall, pxPerM, 2.2, true));

  // Interior: everything enclosed by the outer walls once window/door gaps up to ~2.6m are bridged.
  // Thin facade lines (glazing drawn in light grey) count too, but only close to the building, so
  // sheet frames, dimension lines and legends far from the walls can't enclose anything.
  const seal = withFacade(r, wall, Math.round(pxPerM * 0.15));
  const interior = mainBody(interiorOf(seal, w, h, Math.round(pxPerM * 1.3)).interior, w, h, pxPerM);

  // Rooms: free space with doorways sealed. Thin lines (glazing, door leaves) also divide space.
  const doorR = Math.max(1, Math.round((s.doorGap * pxPerM) / 2));
  const sealed = dilate(wall, w, h, doorR);
  const sep = s.thinLines === false ? null : separators(r, Math.min(215, s.threshold + 60));
  if (sep) {
    const glass = glazingMask(r, wall, pxPerM);
    for (let i = 0; i < sep.length; i++) sep[i] |= glass[i];
  }
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

  // floor no room reached (a corridor narrower than a doorway is sealed whole) is a space of its own
  let nextLabel = 0;
  for (const l of labels) if (l > nextLabel) nextLabel = l;
  {
    const rest = new Uint8Array(w * h);
    for (let i = 0; i < rest.length; i++) rest[i] = floor[i] && !labels[i] ? 1 : 0;
    const rc = components(rest, w, h);
    const ids = rc.sizes.map((sz) => (sz >= 1.5 * pxPerM * pxPerM ? ++nextLabel : 0));
    for (let i = 0; i < rest.length; i++) if (rc.labels[i] && ids[rc.labels[i]]) labels[i] = ids[rc.labels[i]];
  }

  // rooms the user outlined by hand win over automatic segmentation
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
      ? {
          x0: mr.x0 * cell,
          y0: mr.y0 * cell,
          x1: (mr.x1 + 1) * cell,
          y1: (mr.y1 + 1) * cell,
        }
      : { ...bbox };
    const area = areaByLabel.get(l) || 0;
    const solid = sideSolidity(inner, wall, labels, l, w, h, Math.round(pxPerM * 0.35));
    const tk = regionWallThickness(labels, l, thickness, w, h);
    const ext = exteriorWall(labels, l, wall, interior, w, h);
    const touchesOutside =
      bbox.x0 - hb.x0 < pxPerM * 0.6 || hb.x1 - bbox.x1 < pxPerM * 0.6 || bbox.y0 - hb.y0 < pxPerM * 0.6 || hb.y1 - bbox.y1 < pxPerM * 0.6;
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
  openings.push(...facadeGlazing(wall, interior, labels, openings, separators(r, 228), pxPerM, w, h));

  return {
    w,
    h,
    scale: r.scale,
    wall,
    interior,
    labels,
    regions,
    hull: hb,
    pxPerM,
    medianWall,
    openings,
  };
}

/**
 * Finds gaps between collinear wall segments: doors, passages, windows and balcony sliders.
 * Works on the wall mask decomposed into rectangles, pairing each segment end with the next
 * segment of the same thickness along the same line.
 */
function detectOpenings(wall: Uint8Array, interior: Uint8Array, labels: Int32Array, ink: Uint8Array, ppm: number, w: number, h: number): Opening[] {
  const cell = Math.max(1, Math.round(ppm * 0.05));
  const { grid, gw, gh } = downsample(wall, w, h, cell, 0.45);
  const rects = mergeRects(grid, gw, gh).map((b) => ({
    x0: b.x * cell,
    y0: b.y * cell,
    x1: (b.x + b.w) * cell,
    y1: (b.y + b.h) * cell,
  }));
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
  if (o.facade) return 'facade';
  const exterior = o.outA || o.outB;
  const toBalcony = isBalcony(o.la) !== isBalcony(o.lb);
  if (toBalcony) return o.widthM >= 1.3 ? 'slider' : 'door';
  if (exterior) {
    if (o.glazed) return o.widthM >= 2.2 ? 'slider' : 'window';
    return o.widthM <= 1.4 ? 'entry' : 'window';
  }
  return o.widthM <= 1.25 ? 'door' : 'passage';
}

interface Seg {
  axis: 'x' | 'y';
  a0: number;
  a1: number;
  c0: number;
  c1: number;
}

/** Straight axis-aligned strokes in an ink mask (each with its extent along and across). */
function strokeSegments(ink: Uint8Array, w: number, h: number, minLen: number) {
  const segs: Seg[] = [];
  for (const axis of ['x', 'y'] as const) {
    const A = axis === 'x' ? w : h,
      C = axis === 'x' ? h : w;
    const idx = (a: number, c: number) => (axis === 'x' ? c * w + a : a * w + c);
    let open: Seg[] = [];
    for (let c = 0; c < C; c++) {
      const next: Seg[] = [];
      let a = 0;
      while (a < A) {
        if (!ink[idx(a, c)]) {
          a++;
          continue;
        }
        const s0 = a;
        while (a < A && ink[idx(a, c)]) a++;
        if (a - s0 < minLen) continue;
        const r0 = s0,
          r1 = a - 1;
        // the same stroke on the next row: (nearly) the same extent
        const o = open.find((g) => Math.min(g.a1, r1) - Math.max(g.a0, r0) >= 0.85 * Math.max(g.a1 - g.a0, r1 - r0));
        if (o) {
          o.c1 = c;
          o.a0 = Math.min(o.a0, r0);
          o.a1 = Math.max(o.a1, r1);
          next.push(o);
        } else {
          const g: Seg = { axis, a0: r0, a1: r1, c0: c, c1: c };
          segs.push(g);
          next.push(g);
        }
      }
      open = next;
    }
  }
  return segs;
}

/**
 * Glazing drawn as a pair of thin parallel lines (window panes, glass facades), even in light grey.
 * Returned as a mask covering both lines and the band between them: glass divides rooms.
 */
function glazingMask(r: Raster, wall: Uint8Array, ppm: number, minLenM = 0.8, facadeOnly = false) {
  const { w, h, gray } = r;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < 228 && !wall[i] ? 1 : 0;
  const maxT = Math.max(2, Math.round(ppm * 0.06));
  const segs = strokeSegments(ink, w, h, Math.round(ppm * minLenM)).filter((g) => g.c1 - g.c0 + 1 <= maxT);
  const twin = Math.round(ppm * 0.16);
  const reach = Math.round(ppm * 0.3);
  const meetsWall = (a: number, d: number, c0: number, c1: number, axis: 'x' | 'y') => {
    for (let k = 0; k <= reach; k++)
      for (let c = c0 - 2; c <= c1 + 2; c++) {
        const x = axis === 'x' ? a + d * k : c,
          y = axis === 'x' ? c : a + d * k;
        if (x >= 0 && y >= 0 && x < w && y < h && wall[y * w + x]) return true;
      }
    return false;
  };
  const out = new Uint8Array(w * h);
  for (const g of segs)
    for (const o of segs) {
      if (o === g || o.axis !== g.axis || o.c0 <= g.c1 + 1) continue;
      if (o.c0 - g.c1 > twin) continue;
      const a0 = Math.max(g.a0, o.a0),
        a1 = Math.min(g.a1, o.a1);
      if (a1 - a0 < 0.7 * Math.min(g.a1 - g.a0, o.a1 - o.a0)) continue;
      // facade glazing runs into the structure at one end at least (furniture outlines float)
      if (facadeOnly && !meetsWall(a0, -1, g.c0, o.c1, g.axis) && !meetsWall(a1, 1, g.c0, o.c1, g.axis)) continue;
      for (let a = a0; a <= a1; a++) for (let c = g.c0; c <= o.c1; c++) out[g.axis === 'x' ? c * w + a : a * w + c] = 1;
    }
  return out;
}

/**
 * Interior partitions drawn as a single thin line (sales plans often draw only the structure bold).
 * A thin straight line is kept as a wall when both of its ends are held: by a wall, by another kept
 * line (corners, T-junctions) or by a doorway (a door-sized gap, then a wall or a collinear line).
 * What is left out: furniture (floats, or hugs a wall at cabinet depth, or boxes in a small pocket
 * with no door), glazing (a double line, or a line that continues a wall on both ends) and text.
 */
function addPartitions(r: Raster, wall: Uint8Array, threshold: number, ppm: number, glass?: Uint8Array) {
  const { w, h, gray } = r;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < threshold && !wall[i] ? 1 : 0;
  const minLen = Math.max(6, Math.round(ppm * 0.2));
  const maxT = Math.max(2, Math.round(ppm * 0.09));
  const at = (x: number, y: number, m: Uint8Array) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const segs = strokeSegments(ink, w, h, minLen);
  const mid = (g: Seg) => Math.round((g.c0 + g.c1) / 2);
  const pt = (g: Seg, a: number, c = mid(g)) => (g.axis === 'x' ? [a, c] : [c, a]);
  const nearWall = (x: number, y: number, rad = 2) => {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (at(x + dx, y + dy, wall)) return true;
    return false;
  };
  const endA = (g: Seg, end: 0 | 1) => (end ? g.a1 : g.a0);
  const dir = (end: 0 | 1) => (end ? 1 : -1);
  const reachGlass = Math.round(ppm * 0.25);
  // what holds a line: a wall, or glazing (a balcony parapet meets the glass facade)
  const touchesWall = (g: Seg, end: 0 | 1) => {
    const [x, y] = pt(g, endA(g, end) + dir(end) * 2);
    if (nearWall(x, y)) return true;
    if (glass)
      for (let k = 0; k <= reachGlass; k++) {
        const [px, py] = pt(g, endA(g, end) + dir(end) * k);
        if (at(px, py, glass)) return true;
      }
    return false;
  };
  // the wall continues the line's direction past its end → the line sits in a wall gap (a window)
  const continuesWall = (g: Seg, end: 0 | 1) => {
    const L = Math.round(ppm * 0.4);
    let n = 0,
      hit = 0;
    for (let k = 3; k <= L; k++) {
      const [x, y] = pt(g, endA(g, end) + dir(end) * k);
      n++;
      if (at(x, y, wall)) hit++;
    }
    return hit / n > 0.85;
  };
  // a line hugging a parallel wall at cabinet depth is a counter or wardrobe, not a partition
  const hugsWall = (g: Seg) => {
    const c = mid(g);
    const d = Math.round(ppm * 0.75);
    let hits = 0,
      n = 0;
    for (let a = g.a0; a <= g.a1; a += 3) {
      n++;
      let found = false;
      for (const sgn of [-1, 1]) {
        for (let k = 3; k <= d && !found; k += 2) {
          const [x, y] = pt(g, a, c + sgn * k);
          if (at(x, y, wall)) found = true;
        }
      }
      if (found) hits++;
    }
    return n > 0 && hits / n > 0.7;
  };
  let cand = segs.filter((g) => g.c1 - g.c0 + 1 <= maxT && !hugsWall(g));
  // glazing: a parallel twin a few centimetres away
  const twin = Math.round(ppm * 0.16);
  const glazing = new Set<Seg>();
  for (const g of cand)
    for (const o of cand) {
      if (o === g || o.axis !== g.axis) continue;
      const dc = Math.abs(mid(o) - mid(g));
      const ov = Math.min(g.a1, o.a1) - Math.max(g.a0, o.a0);
      const apart = o.c0 > g.c1 + 1 || g.c0 > o.c1 + 1;
      if (apart && dc <= twin && ov > 0.7 * Math.min(g.a1 - g.a0, o.a1 - o.a0)) glazing.add(g);
    }
  cand = cand.filter((g) => !glazing.has(g) && !(continuesWall(g, 0) && continuesWall(g, 1)));

  const touchesLine = (g: Seg, end: 0 | 1, pool: Set<Seg>) => {
    const a = endA(g, end) + dir(end),
      c = mid(g);
    for (const o of pool) {
      if (o === g) continue;
      if (o.axis === g.axis) {
        // collinear continuation
        if (Math.abs(mid(o) - c) <= 3 && (end ? Math.abs(o.a0 - g.a1) <= 4 : Math.abs(g.a0 - o.a1) <= 4)) return o;
      } else if (a >= o.c0 - 4 && a <= o.c1 + 4 && c >= o.a0 - 4 && c <= o.a1 + 4) return o;
    }
    return null;
  };
  const door0 = Math.round(ppm * 0.55),
    door1 = Math.round(ppm * 1.4);
  const doorway = (g: Seg, end: 0 | 1, pool: Set<Seg>) => {
    const e = endA(g, end),
      c = mid(g);
    for (let k = door0; k <= door1; k++) {
      const [x, y] = pt(g, e + dir(end) * k);
      if (nearWall(x, y, 1)) return true;
    }
    for (const o of pool) {
      if (o === g || o.axis !== g.axis || Math.abs(mid(o) - c) > 3) continue;
      const gap = end ? o.a0 - g.a1 : g.a0 - o.a1;
      if (gap >= door0 && gap <= door1) return true;
    }
    return false;
  };
  const held = (g: Seg, end: 0 | 1, pool: Set<Seg>) => touchesWall(g, end) || !!touchesLine(g, end, pool) || doorway(g, end, pool);

  // keep removing lines that are not held at both ends
  const wingLen = Math.round(ppm * 1.5);
  const alive = new Set(cand);
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of [...alive]) {
      const h0 = held(g, 0, alive),
        h1 = held(g, 1, alive);
      // a wing wall may end free in the room when it is long and solidly attached at the other end
      const wing = g.a1 - g.a0 >= wingLen && (h0 || h1);
      if (!(h0 && h1) && !wing) {
        alive.delete(g);
        changed = true;
      }
    }
  }

  // group into networks; a network must reach a real wall
  const groups: Seg[][] = [];
  const seen = new Set<Seg>();
  for (const g of alive) {
    if (seen.has(g)) continue;
    const grp: Seg[] = [];
    const st = [g];
    seen.add(g);
    while (st.length) {
      const q = st.pop()!;
      grp.push(q);
      for (const o of alive) {
        if (seen.has(o)) continue;
        if (
          touchesLine(q, 0, new Set([o])) ||
          touchesLine(q, 1, new Set([o])) ||
          touchesLine(o, 0, new Set([q])) ||
          touchesLine(o, 1, new Set([q]))
        ) {
          seen.add(o);
          st.push(o);
        }
      }
    }
    if (grp.some((q) => touchesWall(q, 0) || touchesWall(q, 1))) groups.push(grp);
  }
  if (!groups.length) return;

  const half = Math.max(1, Math.round(ppm * 0.05));
  const paint = (m: Uint8Array, g: Seg) => {
    const c = mid(g);
    // close the hairline to what holds the line, but keep doorway gaps at their drawn width
    const ext = (end: 0 | 1) => (touchesWall(g, end) || touchesLine(g, end, alive) ? 2 : 0);
    for (let a = g.a0 - ext(0); a <= g.a1 + ext(1); a++)
      for (let k = -half; k <= half; k++) {
        const [x, y] = pt(g, a, c + k);
        if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1;
      }
  };
  // a network that shuts a small doorless pocket against the walls is furniture (a bed, a sofa)
  const pocket = 5 * ppm * ppm;
  const freeSizes = (m: Uint8Array) => {
    const comp = components(
      m.map((v) => (v ? 0 : 1)),
      w,
      h,
    );
    return comp;
  };
  let base = wall.slice();
  let before = freeSizes(base);
  for (const grp of groups) {
    const trial = base.slice();
    for (const g of grp) paint(trial, g);
    const after = freeSizes(trial);
    let bad = false;
    for (let l = 1; l < after.sizes.length && !bad; l++) {
      if (after.sizes[l] >= pocket || after.sizes[l] < 0.1 * ppm * ppm) continue;
      // find one pixel of this pocket and compare with the space it belonged to before
      const b = after.boxes[l];
      for (let y = b.y0; y <= b.y1 && !bad; y++)
        for (let x = b.x0; x <= b.x1; x++) {
          const i = y * w + x;
          if (after.labels[i] !== l) continue;
          const pl = before.labels[i];
          if (pl && before.sizes[pl] > after.sizes[l] + 0.3 * ppm * ppm) bad = true;
          break;
        }
    }
    if (bad) continue;
    base = trial;
    before = after;
  }
  wall.set(base);
}

/** The flat itself: the largest enclosed body plus any sizeable part (e.g. a balcony), holes filled. */
function mainBody(interior: Uint8Array, w: number, h: number, ppm: number) {
  const { labels, sizes } = components(interior, w, h);
  let best = 0;
  for (let l = 1; l < sizes.length; l++) if (sizes[l] > sizes[best] || best === 0) best = l;
  if (!best) return interior;
  const minKeep = Math.max(sizes[best] * 0.08, 3 * ppm * ppm);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = labels[i] && (labels[i] === best || sizes[labels[i]] >= minKeep) ? 1 : 0;
  // fill holes (columns drawn hollow, shafts) so floors and ceilings are continuous
  const outside = floodFrom(
    out.map((v) => (v ? 0 : 1)),
    w,
    h,
    borderSeeds(w, h),
  );
  for (let i = 0; i < out.length; i++) if (!outside[i]) out[i] = 1;
  return out;
}

/**
 * Stretches of the outer edge with no wall and no detected window: in sales plans these are
 * glass facades drawn as faint lines. Returned as openings so the 3D model closes them in glass.
 */
function facadeGlazing(
  wall: Uint8Array,
  interior: Uint8Array,
  labels: Int32Array,
  known: Opening[],
  ink: Uint8Array,
  ppm: number,
  w: number,
  h: number,
): Opening[] {
  const band = Math.max(2, Math.round(ppm * 0.22));
  const inner = erode(interior, w, h, band);
  const wallNear = dilate(wall, w, h, Math.max(1, Math.round(ppm * 0.08)));
  const edge = new Uint8Array(w * h);
  for (let i = 0; i < edge.length; i++) edge[i] = interior[i] && !inner[i] && !wallNear[i] ? 1 : 0;
  // remove known openings (windows, doors) so they are not doubled
  const pad = Math.round(ppm * 0.15);
  for (const o of known)
    for (let y = Math.max(0, Math.floor(o.y0) - pad); y <= Math.min(h - 1, Math.ceil(o.y1) + pad); y++)
      for (let x = Math.max(0, Math.floor(o.x0) - pad); x <= Math.min(w - 1, Math.ceil(o.x1) + pad); x++) edge[y * w + x] = 0;
  const cell = Math.max(1, Math.round(ppm * 0.05));
  const { grid, gw, gh } = downsample(edge, w, h, cell, 0.4);
  const out: Opening[] = [];
  const at = (x: number, y: number) => {
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return { l: 0, inside: false };
    return { l: labels[yi * w + xi], inside: !!interior[yi * w + xi] };
  };
  for (const r of mergeRects(grid, gw, gh)) {
    const x0 = r.x * cell,
      y0 = r.y * cell,
      x1 = (r.x + r.w) * cell,
      y1 = (r.y + r.h) * cell;
    const wx = x1 - x0,
      wy = y1 - y0;
    const axis: 'x' | 'y' = wx >= wy ? 'x' : 'y';
    const len = Math.max(wx, wy),
      thick = Math.min(wx, wy);
    if (len < ppm * 0.8 || thick > ppm * 0.5) continue;
    // only where a facade is actually drawn: faint lines along most of the stretch
    let inked = 0;
    const steps = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < steps; k++) {
      const a = (axis === 'x' ? x0 : y0) + ((k + 0.5) / steps) * len;
      let hit = 0;
      for (let c = (axis === 'x' ? y0 : x0) - 2; c <= (axis === 'x' ? y1 : x1) + 2 && !hit; c++) {
        const px = Math.round(axis === 'x' ? a : c),
          py = Math.round(axis === 'x' ? c : a);
        if (px >= 0 && py >= 0 && px < w && py < h && ink[py * w + px]) hit = 1;
      }
      inked += hit;
    }
    if (inked / steps < 0.5) continue;
    const reach = thick / 2 + ppm * 0.3;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    const pa = axis === 'x' ? at(cx, cy - reach) : at(cx - reach, cy);
    const pb = axis === 'x' ? at(cx, cy + reach) : at(cx + reach, cy);
    if (pa.inside === pb.inside) continue;
    // glass sits on the outer face of the band
    const t = Math.max(thick, ppm * 0.12);
    const o: Opening = {
      x0,
      y0,
      x1,
      y1,
      axis,
      widthM: len / ppm,
      la: pa.l,
      lb: pb.l,
      outA: !pa.inside,
      outB: !pb.inside,
      glazed: true,
      facade: true,
    };
    if (axis === 'x') {
      o.y0 = pa.inside ? y1 - t : y0;
      o.y1 = o.y0 + t;
    } else {
      o.x0 = pa.inside ? x1 - t : x0;
      o.x1 = o.x0 + t;
    }
    out.push(o);
  }
  return out;
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
    if (!total || strong / total > 0.5) continue;
    let best = 0;
    // slivers between overlapping furniture outlines don't count when a real room is next door
    const big = [...neigh.entries()].filter(([q]) => (sizes[q] || 0) >= maxPx);
    if (big.length) for (const [q] of [...neigh.entries()]) if ((sizes[q] || 0) < maxPx) neigh.delete(q);
    if (neigh.size) {
      const [b0, cnt] = [...neigh.entries()].sort((a, b) => b[1] - a[1])[0];
      const others = [...neigh.values()].reduce((a, b) => a + b, 0) - cnt;
      if (others <= cnt * 0.25) best = b0;
      // a sliver between two outlines goes with the larger space beside it
      else if (px.length < maxPx / 4) best = [...neigh.keys()].sort((a, b) => (sizes[b] || 0) - (sizes[a] || 0))[0];
    }
    // drawn furniture often nests (bed inside a bed outline): take the room that surrounds it
    if (!best && strong / total < 0.2 && px.length < maxPx * 0.6) best = surrounding(labels, l, px, w, h, reach * 2);
    if (!best) continue;
    for (const i of px) labels[i] = best;
    sizes[best] = (sizes[best] || 0) + sizes[l];
    const bp = pixels.get(best);
    if (bp) bp.push(...px);
  }
}

/** Most common other label on a ring just outside the region's bounding box. */
function surrounding(labels: Int32Array, l: number, px: number[], w: number, h: number, pad: number) {
  let x0 = w,
    y0 = h,
    x1 = 0,
    y1 = 0;
  for (const i of px) {
    const x = i % w,
      y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const counts = new Map<number, number>();
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const v = labels[y * w + x];
    if (v && v !== l) counts.set(v, (counts.get(v) || 0) + 1);
  };
  for (let x = x0 - pad; x <= x1 + pad; x += 2) {
    add(x, y0 - pad);
    add(x, y1 + pad);
  }
  for (let y = y0 - pad; y <= y1 + pad; y += 2) {
    add(x0 - pad, y);
    add(x1 + pad, y);
  }
  if (!counts.size) return 0;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, b) => a + b[1], 0);
  return sorted[0][1] / total > 0.6 ? sorted[0][0] : 0;
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
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
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
      if (!n || n >= 40) continue;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || !interior[cy * w + cx]) vals.push(n);
    }
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  // lower quartile: crossings that run along a wall are long, true crossings are short
  return vals[Math.floor(vals.length / 4)];
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

  const exts = regs
    .map((r) => r.extWall)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
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
  return {
    x0: Math.max(0, b.x0 - doorR),
    y0: Math.max(0, b.y0 - doorR),
    x1: Math.min(w - 1, b.x1 + doorR),
    y1: Math.min(h - 1, b.y1 + doorR),
  };
}

export function defaultPlanSettings(): PlanSettings {
  return {
    pxPerM: 50,
    threshold: 110,
    minWall: 5,
    doorGap: 0.95,
    rooms: [],
    calibrated: false,
  };
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
