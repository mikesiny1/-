/**
 * Reads the room names printed on a plan (Hebrew OCR, on device) so rooms get the type the
 * architect wrote — "מרפסת", "מטבח", "ממ״ד" — instead of a guess from their size and shape.
 * Labels are often set vertically inside narrow rooms, so the plan is read in three rotations.
 */
import { createWorker, PSM } from 'tesseract.js';
import type { RoomType } from './types';
import { typeOfWord } from './roomwords';

export interface TextHint {
  type: RoomType;
  text: string;
  /** position in working-image pixels */
  x: number;
  y: number;
}

const media = (p: string) => new URL('media/ocr/' + p, document.baseURI).toString();

let primed: Promise<void> | null = null;
function primeModelCache() {
  primed ??= (async () => {
    const model = new Uint8Array(await (await fetch(media('heb-traineddata.wasm'))).arrayBuffer());
    // tesseract.js keeps models in idb-keyval's default store under "<cachePath>/<lang>.traineddata"
    const db: IDBDatabase = await new Promise((res, rej) => {
      const rq = indexedDB.open('keyval-store');
      rq.onupgradeneeded = () => rq.result.createObjectStore('keyval');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put(model, './heb.traineddata');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  })();
  return primed;
}

/** Image → canvas rotated by k quarter turns clockwise. */
function rotated(src: HTMLCanvasElement, k: 0 | 1 | 3) {
  if (k === 0) return src;
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((k * Math.PI) / 2);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/**
 * @param img the full-resolution plan
 * @param workScale working-image pixels per image pixel (Raster.scale)
 */
export async function readRoomLabels(img: HTMLImageElement | HTMLCanvasElement, workScale: number, onProgress?: (k: number) => void): Promise<TextHint[]> {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  // text needs resolution: CAD lettering is small, so ~3000 px on the long side
  const k = Math.min(2.5, 3000 / Math.max(iw, ih));
  const base = document.createElement('canvas');
  base.width = Math.round(iw * k);
  base.height = Math.round(ih * k);
  const g = base.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, base.width, base.height);
  g.drawImage(img, 0, 0, base.width, base.height);

  // the model ships with the site (named .wasm so any static host serves it). It is placed in the
  // OCR worker's own cache, where the worker looks first, so nothing is fetched from a third-party CDN.
  await primeModelCache();
  const worker = await createWorker('heb', 1, {
    workerPath: media('worker.min.js'),
    corePath: media(''),
    langPath: media(''),
    gzip: false,
    workerBlobURL: false,
  });
  const hints: TextHint[] = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const turns: (0 | 1 | 3)[] = [0, 1, 3];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const c = rotated(base, t);
      const { data } = await worker.recognize(c);
      for (const wd of data.words) {
        if (wd.confidence < 45) continue;
        const type = typeOfWord(wd.text);
        if (!type) continue;
        // centre of the word, back in the unrotated image
        const cx = (wd.bbox.x0 + wd.bbox.x1) / 2,
          cy = (wd.bbox.y0 + wd.bbox.y1) / 2;
        let x = cx,
          y = cy;
        if (t === 1) {
          x = cy;
          y = base.height - cx;
        } else if (t === 3) {
          x = base.width - cy;
          y = cx;
        }
        hints.push({ type, text: wd.text, x: (x / k) * workScale, y: (y / k) * workScale });
      }
      onProgress?.((i + 1) / turns.length);
    }
  } finally {
    await worker.terminate();
  }
  // the same label read in two rotations counts once
  return hints.filter((h, i) => !hints.slice(0, i).some((o) => o.type === h.type && Math.hypot(o.x - h.x, o.y - h.y) < 12));
}
