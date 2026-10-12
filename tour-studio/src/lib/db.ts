import type { Brand, Project } from './types';

const DB_NAME = 'mifles-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function listProjects(): Promise<Project[]> {
  const all = await tx<Project[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getProject = (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id));

export async function saveProject(p: Project): Promise<Project> {
  const next = { ...p, updatedAt: Date.now() };
  await tx('projects', 'readwrite', (s) => s.put(next));
  return next;
}

export async function deleteProject(p: Project) {
  const blobs = [p.planBlobId, p.coverBlobId, ...p.photos.map((ph) => ph.blobId)].filter(Boolean) as string[];
  await Promise.all(blobs.map((b) => tx('blobs', 'readwrite', (s) => s.delete(b))));
  await tx('projects', 'readwrite', (s) => s.delete(p.id));
}

export async function putBlob(blob: Blob, id = uid()): Promise<string> {
  await tx('blobs', 'readwrite', (s) => s.put(blob, id));
  return id;
}

export const getBlob = (id: string) => tx<Blob | undefined>('blobs', 'readonly', (s) => s.get(id));
export const deleteBlob = (id: string) => tx('blobs', 'readwrite', (s) => s.delete(id));

const urlCache = new Map<string, string>();
export async function blobUrl(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const hit = urlCache.get(id);
  if (hit) return hit;
  const b = await getBlob(id);
  if (!b) return null;
  const url = URL.createObjectURL(b);
  urlCache.set(id, url);
  return url;
}

export async function loadImage(id: string | null | undefined): Promise<HTMLImageElement | null> {
  const url = await blobUrl(id);
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export const defaultBrand: Brand = {
  agencyName: '',
  agentName: '',
  agentPhone: '',
  agentEmail: '',
  license: '',
  accent: '#8a5a3b',
  logoBlobId: null,
};

export async function getBrand(): Promise<Brand> {
  const b = await tx<Brand | undefined>('meta', 'readonly', (s) => s.get('brand'));
  return { ...defaultBrand, ...(b || {}) };
}

export const saveBrand = (b: Brand) => tx('meta', 'readwrite', (s) => s.put(b, 'brand'));

export interface LibraryEntry {
  kind: import('./types').FurnitureKind;
  blobId: string;
  name: string;
  rotate: number;
}

export async function getLibrary(): Promise<LibraryEntry[]> {
  const v = await tx<LibraryEntry[] | undefined>('meta', 'readonly', (s) => s.get('library'));
  return v || [];
}

export const saveLibrary = (l: LibraryEntry[]) => tx('meta', 'readwrite', (s) => s.put(l, 'library'));
