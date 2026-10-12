import { furnitureSprite } from '../three/sprites';
import { roomName, styleById } from './styles';
import type { PhotoEntry, StagedItem, StyleId } from './types';

/** Photo with staged furniture, at the photo's own resolution (capped). */
export function composeStaged(img: HTMLImageElement, items: StagedItem[], style: StyleId, withFurniture: boolean, maxW = 1920) {
  const k = Math.min(1, maxW / img.naturalWidth);
  const W = Math.round(img.naturalWidth * k),
    H = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const gr = styleById(style).grade;
  g.filter = `contrast(${gr.contrast}) saturate(${gr.saturation}) sepia(${gr.warmth})`;
  g.drawImage(img, 0, 0, W, H);
  g.filter = 'none';
  if (withFurniture) drawStaged(g, W, H, items, style);
  return c;
}

export function drawStaged(g: CanvasRenderingContext2D, W: number, H: number, items: StagedItem[], style: StyleId) {
  // farther (higher on the photo) first
  const sorted = [...items].sort((a, b) => (a.kind === 'rug' ? -1 : b.kind === 'rug' ? 1 : a.y - b.y));
  for (const it of sorted) {
    const sp = furnitureSprite(it.kind, style, it.view);
    const w = it.w * W;
    const h = (sp.canvas.height / sp.canvas.width) * w;
    g.drawImage(sp.canvas, it.x * W - w / 2, it.y * H - h, w, h);
  }
}

const FIRST = 6.0;
const SLIDE = 4.6;
const XF = 0.9;
const OUTRO = 4.5;

export class PhotoTour {
  private frames: HTMLCanvasElement[] = [];
  duration: number;
  constructor(
    private photos: PhotoEntry[],
    images: Map<string, HTMLImageElement>,
    style: StyleId,
    withFurniture: boolean,
  ) {
    this.photos = photos.filter((p) => images.has(p.id));
    for (const p of this.photos) this.frames.push(composeStaged(images.get(p.id)!, p.staged, style, withFurniture));
    const n = this.frames.length;
    this.duration = n ? FIRST + (n - 1) * SLIDE + OUTRO : 0;
  }

  private slideStart(i: number) {
    return i === 0 ? 0 : FIRST + (i - 1) * SLIDE;
  }

  private drawKB(g: CanvasRenderingContext2D, W: number, H: number, i: number, t: number, alpha: number) {
    const f = this.frames[i];
    const start = this.slideStart(i);
    const len = (i === 0 ? FIRST : SLIDE) + XF + (i === this.frames.length - 1 ? OUTRO : 0);
    const u = Math.max(0, Math.min(1, (t - start) / len));
    const zoomIn = i % 2 === 0;
    const z = zoomIn ? 1 + 0.1 * u : 1.1 - 0.1 * u;
    const pan = (i % 3) - 1; // -1,0,1
    const base = Math.max(W / f.width, H / f.height) * z;
    const dw = f.width * base,
      dh = f.height * base;
    const ox = (W - dw) / 2 + pan * (dw - W) * 0.5 * (u - 0.5);
    const oy = (H - dh) / 2;
    g.globalAlpha = alpha;
    g.drawImage(f, ox, oy, dw, dh);
    g.globalAlpha = 1;
  }

  /** Draws frame t; returns the room shown. */
  draw(g: CanvasRenderingContext2D, W: number, H: number, t: number) {
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    const n = this.frames.length;
    if (!n) return { room: '', since: 0 };
    let cur = 0;
    for (let i = 0; i < n; i++) if (t >= this.slideStart(i)) cur = i;
    this.drawKB(g, W, H, cur, t, 1);
    const nextStart = cur + 1 < n ? this.slideStart(cur + 1) : Infinity;
    const xfT = t - (nextStart - XF);
    if (xfT > 0 && cur + 1 < n) this.drawKB(g, W, H, cur + 1, t, Math.min(1, xfT / XF));
    const shown = xfT > XF / 2 && cur + 1 < n ? cur + 1 : cur;
    const p = this.photos[shown];
    return { room: p ? p.caption || roomName(p.roomType) : '', since: this.slideStart(shown) };
  }
}
