import { putBlob, saveProject, uid, loadImage } from './db';
import { canvasToBlob, drawDemoPlan } from './demo';
import { analyzePlan, autoRooms, autoThreshold, defaultPlanSettings, estimateScale, extractWalls, rasterize, type PlanModel, type Raster } from './plan';
import type { PlanSettings, Project } from './types';

export function newProject(): Project {
  const now = Date.now();
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    details: {
      title: '',
      address: '',
      city: '',
      rooms: 4,
      sqm: 0,
      floor: '',
      price: '',
      dealType: 'sale',
      description: '',
      clientName: '',
      clientPhone: '',
      clientEmail: '',
    },
    planBlobId: null,
    plan: null,
    photos: [],
    design: { furnish: true, style: 'scandi', household: 'couple', budget: 'mid', light: 'day' },
    coverBlobId: null,
    shares: [],
  };
}

// ---------------------------------------------------------------- plan model cache

const rasterCache = new Map<string, Raster>();
let modelCache: { key: string; model: PlanModel } | null = null;

export async function getRaster(blobId: string): Promise<Raster | null> {
  const hit = rasterCache.get(blobId);
  if (hit) return hit;
  const img = await loadImage(blobId);
  if (!img) return null;
  const r = rasterize(img);
  rasterCache.set(blobId, r);
  return r;
}

export function modelFor(blobId: string, r: Raster, s: PlanSettings): PlanModel {
  const key = blobId + JSON.stringify({ ...s, rooms: s.rooms.filter((r) => r.rect).map((r) => r.rect) });
  if (modelCache?.key === key) return modelCache.model;
  const model = analyzePlan(r, s);
  modelCache = { key, model };
  return model;
}

/** Median clear width of interior doors (both sides inside, 0.55–1.3m at the current scale), as px/m. */
export function scaleFromDoors(m: PlanModel) {
  const widths = m.openings
    .filter((o) => !o.facade && !o.outA && !o.outB)
    .map((o) => (o.axis === 'x' ? o.x1 - o.x0 : o.y1 - o.y0))
    .filter((px) => px / m.pxPerM > 0.5 && px / m.pxPerM < 1.4)
    .sort((a, b) => a - b);
  if (widths.length < 3) return 0;
  return widths[Math.floor(widths.length / 2)] / 0.88;
}

export function scorePlan(m: PlanModel, sqm: number, declaredRooms: number) {
  const rooms = [...m.regions.values()].filter((g) => g.areaM2 >= 1.5 && g.areaM2 <= 70);
  if (rooms.length <= 1) return -100 + rooms.length;
  const total = rooms.reduce((a, g) => a + g.areaM2, 0);
  const biggest = Math.max(...rooms.map((g) => g.areaM2));
  let score = Math.min(rooms.length, 14) * 2;
  if (sqm > 10) score -= (Math.abs(total - sqm * 0.88) / sqm) * 12;
  if (declaredRooms) score -= Math.abs(rooms.length - (declaredRooms + 3)) * 0.8;
  if (biggest > total * 0.65) score -= 5;
  let wallPx = 0;
  for (const v of m.wall) wallPx += v;
  const frac = wallPx / (m.w * m.h);
  if (frac < 0.008 || frac > 0.3) score -= 6;
  // tiny fragments usually mean glazing or symbols were read as walls
  score -= rooms.filter((g) => g.areaM2 < 3.5).length * 2;
  // a reading that keeps doors and windows open is a better reading
  score += Math.min(m.openings.length, 14) * 0.6;
  return score;
}

/**
 * Reads a new plan the way a person would fiddle with the settings: tries several ink
 * thresholds, with and without filling double-line walls, and keeps the reading that
 * gives the most plausible apartment (room count, total area, wall density, openings).
 */
/** Room names printed on the plan, read by OCR on this device; empty when OCR is unavailable. */
async function blobImage(b: Blob) {
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/**
 * @param scale image pixels per pixel of this blob (a sharper copy made for reading is larger)
 */
export async function readPlanLabels(
  blobId: string | Blob,
  r: Raster,
  onProgress?: (k: number) => void,
  scale = 1,
): Promise<NonNullable<PlanSettings['labels']>> {
  try {
    const img = typeof blobId === 'string' ? await loadImage(blobId) : await blobImage(blobId);
    if (!img) return [];
    const { readRoomLabels } = await import('./ocr');
    return await readRoomLabels(img, r.scale * scale, onProgress, scale < 1 ? 5000 : 3000);
  } catch {
    return [];
  }
}

export async function autoTunePlan(
  r: Raster,
  sqm: number,
  declaredRooms: number,
  onProgress?: (k: number) => void,
  labels: PlanSettings['labels'] = [],
): Promise<PlanSettings> {
  const base = autoThreshold(r);
  const thresholds = [...new Set([base, 95, 125, 155, 185].map((t) => Math.round(t / 5) * 5))];
  const fillPx = Math.max(2, Math.round(Math.max(r.w, r.h) * 0.006));
  const combos = thresholds.flatMap((t) => [0, fillPx].map((f) => [t, f] as const));
  let best: { s: PlanSettings; score: number; model: PlanModel } | null = null;
  for (let i = 0; i < combos.length; i++) {
    const [t, f] = combos[i];
    onProgress?.(i / combos.length);
    await new Promise((res) => setTimeout(res, 0));
    const s = defaultPlanSettings();
    s.threshold = t;
    const minWall0 = Math.max(3, Math.round(Math.max(r.w, r.h) / 170));
    const walls = extractWalls(r, t, minWall0, f);
    s.pxPerM = estimateScale(r, walls, sqm);
    s.minWall = Math.max(3, Math.min(minWall0, Math.round(s.pxPerM * 0.08)));
    s.fillOutline = f ? f / s.pxPerM : 0;
    let model = analyzePlan(r, s);
    // interior doors are a near-universal 85-90cm: when enough are found they fix the scale
    const doorScale = scaleFromDoors(model);
    if (doorScale && Math.abs(doorScale / s.pxPerM - 1) > 0.04 && doorScale / s.pxPerM > 0.55 && doorScale / s.pxPerM < 1.8) {
      s.pxPerM = doorScale;
      s.scaleSource = 'doors';
      s.minWall = Math.max(3, Math.min(minWall0, Math.round(s.pxPerM * 0.08)));
      s.fillOutline = f ? f / s.pxPerM : 0;
      model = analyzePlan(r, s);
    } else s.scaleSource = doorScale ? 'doors' : sqm > 10 ? 'area' : 'guess';
    const score = scorePlan(model, sqm, declaredRooms) - (f ? 1.5 : 0) - Math.abs(t - base) / 200;
    if (!best || score > best.score) best = { s, score, model };
  }
  onProgress?.(1);
  const s = best!.s;
  s.labels = labels;
  s.rooms = autoRooms(best!.model, declaredRooms, labels);
  return s;
}

/** First read of a newly uploaded plan: pick threshold, scale and rooms automatically. */
export function initialPlan(r: Raster, sqm: number, declaredRooms: number): PlanSettings {
  const s = defaultPlanSettings();
  s.threshold = autoThreshold(r);
  // wall thickness: ~1/150 of the longer side is a good starting point for typical exports
  s.minWall = Math.max(3, Math.round(Math.max(r.w, r.h) / 170));
  const walls = extractWalls(r, s.threshold, s.minWall);
  s.pxPerM = estimateScale(r, walls, sqm);
  // keep minimal wall around 8cm in real size once scale is known
  s.minWall = Math.max(3, Math.min(s.minWall, Math.round(s.pxPerM * 0.08)));
  const model = analyzePlan(r, s);
  s.rooms = autoRooms(model, declaredRooms);
  return s;
}

export async function createDemoProject(): Promise<Project> {
  const p = newProject();
  const canvas = drawDemoPlan();
  p.planBlobId = await putBlob(await canvasToBlob(canvas));
  p.details = {
    ...p.details,
    title: 'דירת 4 חדרים עם מרפסת שמש',
    address: 'רחוב הדקל 12',
    city: 'רמת השרון',
    rooms: 4,
    sqm: 112,
    floor: '4 מתוך 8',
    price: '3,450,000',
    description: 'דירה מרווחת בבניין בוטיק: סלון ופינת אוכל פתוחים למרפסת שמש, מטבח נפרד, ממ״ד, חדר הורים וחדר שינה נוסף. חניה ומחסן.',
    clientName: '',
  };
  p.design.style = 'japandi';
  const r = await getRaster(p.planBlobId);
  if (r) p.plan = await autoTunePlan(r, p.details.sqm, p.details.rooms);
  p.status = 'in_progress';
  return saveProject(p);
}

export function stepDone(p: Project) {
  return {
    details: !!(p.details.title || p.details.address),
    materials: !!(p.planBlobId || p.photos.length),
    brief: true,
    plan: !!(p.plan && p.plan.rooms.length) || (!p.planBlobId && p.photos.length > 0),
    tour: p.status === 'ready' || p.status === 'sent',
    publish: p.shares.length > 0,
  };
}
