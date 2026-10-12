/**
 * Real, photo-scanned assets that ship with the studio (see CREDITS.md):
 * furniture and decor models, material maps and HDR environments.
 * Everything loads lazily; until an asset arrives the procedural piece is used.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export const mediaUrl = (path: string) => new URL('media/' + path, document.baseURI).toString();

export type RealId = 'glamSofa' | 'carvedSofa' | 'damaskChair' | 'velvetChair' | 'pouf' | 'flowers' | 'plant' | 'olives' | 'sconce';

const FILES: Record<RealId, string> = {
  glamSofa: 'GlamVelvetSofa.glb',
  carvedSofa: 'SheenWoodLeatherSofa.glb',
  damaskChair: 'ChairDamaskPurplegold.glb',
  velvetChair: 'SheenChair.glb',
  pouf: 'SpecularSilkPouf.glb',
  flowers: 'GlassVaseFlowers.glb',
  plant: 'DiffuseTransmissionPlant.glb',
  olives: 'IridescentDishWithOlives.glb',
  sconce: 'AnisotropyBarnLamp.glb',
};

const models = new Map<RealId, THREE.Object3D>();
let loading: Promise<void> | null = null;

export function loadRealModels() {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all(
    (Object.keys(FILES) as RealId[]).map(async (id) => {
      try {
        const g = await loader.loadAsync(mediaUrl('models/' + FILES[id]));
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            m.userData.libraryAsset = true;
            // transmission needs an extra full render pass every frame; clear glass reads the same at room scale
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats as THREE.MeshPhysicalMaterial[]) {
              if (mat.transmission > 0) {
                mat.transmission = 0;
                mat.transparent = true;
                mat.opacity = Math.min(mat.opacity, 0.3);
                mat.depthWrite = false;
                mat.roughness = Math.min(mat.roughness, 0.1);
              }
            }
            if (/glass/i.test(m.name) || mats.some((x) => /glass/i.test(x.name))) m.castShadow = false;
          }
        });
        models.set(id, g.scene);
      } catch {
        /* offline or blocked: the procedural piece stays */
      }
    }),
  ).then(() => undefined);
  return loading;
}

export const hasReal = (id: RealId) => models.has(id);

/** A copy of the model scaled to the given width (or height), centred, standing on y=0, facing +Z. */
export function realFit(id: RealId, size: { width?: number; height?: number }): THREE.Group | null {
  const src = models.get(id);
  if (!src) return null;
  const wrap = new THREE.Group();
  const obj = src.clone(true);
  wrap.add(obj);
  const box = new THREE.Box3().setFromObject(wrap);
  const s = box.getSize(new THREE.Vector3());
  const k = size.width ? size.width / s.x : size.height ? size.height / s.y : 1;
  obj.scale.multiplyScalar(k);
  const b2 = new THREE.Box3().setFromObject(wrap);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  const g = new THREE.Group();
  g.add(wrap);
  return g;
}

// ---------------------------------------------------------------- material maps

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

export type RealTex =
  | 'wood_grain'
  | 'wood_normal'
  | 'wood_orm'
  | 'leather_normal'
  | 'velvet_normal'
  | 'damask'
  | 'damask_normal'
  | 'paisley'
  | 'paisley_normal'
  | 'stripe'
  | 'stripe_normal'
  | 'floor_wood'
  | 'floor_bump'
  | 'floor_rough';

const COLOR_MAPS = new Set<RealTex>(['wood_grain', 'damask', 'paisley', 'stripe', 'floor_wood']);

export function realTex(name: RealTex, repeat = 1) {
  const key = name + '|' + repeat;
  const hit = texCache.get(key);
  if (hit) return hit;
  const t = texLoader.load(mediaUrl('tex/' + name + '.jpg'));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (COLOR_MAPS.has(name)) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------- environments

export type WindowView = 'nature' | 'sea' | 'city';
const VIEWS: Record<WindowView, string> = {
  nature: 'spruit_sunrise_1k.hdr',
  sea: 'blouberg_sunrise_2_1k.hdr',
  city: 'pedestrian_overpass_1k.hdr',
};

const hdrCache = new Map<string, Promise<THREE.Texture>>();

export function loadView(view: WindowView) {
  const f = VIEWS[view];
  let p = hdrCache.get(f);
  if (!p) {
    p = new RGBELoader().loadAsync(mediaUrl('hdri/' + f)).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    hdrCache.set(f, p);
  }
  return p;
}

/** Photographed interior used for reflections and soft fill light. */
export function loadInteriorEnv() {
  let p = hdrCache.get('apartment');
  if (!p) {
    p = new EXRLoader().loadAsync(mediaUrl('hdri/apartment.exr')).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    hdrCache.set('apartment', p);
  }
  return p;
}
