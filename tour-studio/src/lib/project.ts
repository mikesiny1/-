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
  if (r) p.plan = initialPlan(r, p.details.sqm, p.details.rooms);
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
