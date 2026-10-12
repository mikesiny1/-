import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getBlob, getLibrary, type LibraryEntry } from '../lib/db';
import type { FurnitureKind } from '../lib/types';

const cache = new Map<string, THREE.Object3D>();

export async function loadModel(blobId: string): Promise<THREE.Object3D | null> {
  const hit = cache.get(blobId);
  if (hit) return hit;
  const blob = await getBlob(blobId);
  if (!blob) return null;
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), '');
  cache.set(blobId, gltf.scene);
  return gltf.scene;
}

/** The user's own furniture models, keyed by the furniture type they replace. */
export async function loadLibrary(entries?: LibraryEntry[]) {
  const list = entries || (await getLibrary());
  const map = new Map<FurnitureKind, { obj: THREE.Object3D; rotate: number }>();
  for (const e of list) {
    try {
      const obj = await loadModel(e.blobId);
      if (obj) map.set(e.kind, { obj, rotate: e.rotate });
    } catch {
      /* a broken file simply falls back to the built-in piece */
    }
  }
  return map;
}
