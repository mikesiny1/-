/** Renders furniture pieces to transparent images so they can be staged on photos. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { styleById } from '../lib/styles';
import type { FurnitureKind, StyleId } from '../lib/types';
import { buildFurniture, disposeGroup, FOOTPRINT, makeMats } from './furniture';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** width of the piece in metres (for sensible default sizing) */
  metres: number;
  /** fraction of sprite height that is the footprint's base (for drop shadow) */
}

let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
const cache = new Map<string, Sprite>();

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(640, 640, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  return renderer;
}

/** view: 0 = front, 1 = turned right, 2 = turned left */
export function furnitureSprite(kind: FurnitureKind, style: StyleId, view: 0 | 1 | 2): Sprite {
  const key = `${kind}|${style}|${view}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = getRenderer();
  const s = styleById(style);
  const mats = makeMats(s);
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const obj = buildFurniture(kind, s, mats, kind === 'rug' ? { w: 2.4, d: 1.7 } : {});
  obj.traverse((o) => {
    if (o.userData.pendant) o.visible = false;
  });
  obj.rotation.y = view === 1 ? -0.6 : view === 2 ? 0.6 : 0;
  scene.add(obj);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8a990', 1.2));
  const key1 = new THREE.DirectionalLight('#fff5e8', 2.2);
  key1.position.set(-3, 6, 4);
  key1.castShadow = true;
  key1.shadow.mapSize.set(1024, 1024);
  const sc = key1.shadow.camera;
  sc.left = sc.bottom = -3;
  sc.right = sc.top = 3;
  scene.add(key1);
  // shadow catcher
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.28 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  scene.add(catcher);

  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const elev = kind === 'rug' ? 0.75 : 0.28;
  const dist = Math.max(size.x, size.y * 1.4, size.z) * 2.6 + 1;
  cam.position.set(center.x, center.y + Math.sin(elev) * dist, center.z + Math.cos(elev) * dist);
  cam.lookAt(center);
  r.render(scene, cam);

  // crop to content
  const src = r.domElement;
  const tmp = document.createElement('canvas');
  tmp.width = src.width;
  tmp.height = src.height;
  const tg = tmp.getContext('2d', { willReadFrequently: true })!;
  tg.drawImage(src, 0, 0);
  const data = tg.getImageData(0, 0, tmp.width, tmp.height).data;
  let x0 = tmp.width,
    y0 = tmp.height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < tmp.height; y++)
    for (let x = 0; x < tmp.width; x++)
      if (data[(y * tmp.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0 + 1);
  out.height = Math.max(1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(tmp, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  disposeGroup(obj);
  const sprite = { canvas: out, metres: FOOTPRINT[kind][0] };
  cache.set(key, sprite);
  return sprite;
}

export function clearSpriteCache() {
  cache.clear();
}
