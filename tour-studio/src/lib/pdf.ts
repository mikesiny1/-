import { typeOfWord } from './roomwords';
import type { RoomType } from './types';

export interface PdfPlan {
  /** the drawing without its lettering: what the plan reader analyses */
  clean: Blob;
  /** the page as printed: what people see */
  full: Blob;
  /** room names found in the PDF's own text layer, in image pixels */
  labels: { type: RoomType; text: string; x: number; y: number }[];
  /** the PDF has a real text layer (not a scan) */
  hasText: boolean;
  /** the analysed copy keeps only the heaviest pen (the cut walls of a working drawing) */
  cutPen: boolean;
  /**
   * names drawn as shapes, not text, are read by OCR: a sharper copy of the page for it, and the
   * size of its pixels in image pixels
   */
  ocr?: { blob: Blob; scale: number };
}

const lum = (style: unknown) => {
  if (typeof style !== 'string') return 255;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(style);
  if (m) return 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
  const r = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(style);
  return r ? 0.299 * +r[1] + 0.587 * +r[2] + 0.114 * +r[3] : 255;
};

/**
 * Watches the pens pdf.js draws with. pdf.js sets the line width (in user units) just before each
 * stroke, then may scale the context up for hairlines: so the true width is the one set, times the
 * transform at the moment it was set.
 * 'measure' tallies dark strokes by true width; 'filter' only lets through strokes of the cut pen.
 */
function watchPens(g: CanvasRenderingContext2D, mode: 'measure' | 'filter', cut = 0) {
  const proto = CanvasRenderingContext2D.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'lineWidth')!;
  let trueWidth = 1;
  Object.defineProperty(g, 'lineWidth', {
    configurable: true,
    get() {
      return desc.get!.call(g);
    },
    set(v: number) {
      const m = g.getTransform();
      trueWidth = v * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      desc.set!.call(g, v);
    },
  });
  const tally = new Map<number, number>();
  const nativeStroke = proto.stroke;
  (g as unknown as { stroke: (...a: unknown[]) => void }).stroke = function (...a: unknown[]) {
    const dark = lum(g.strokeStyle) < 90;
    if (mode === 'measure') {
      if (dark) {
        const k = Math.round(trueWidth * 20) / 20;
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      return (nativeStroke as (...x: unknown[]) => void).apply(g, a);
    }
    if (!dark || trueWidth < cut * 0.8) return;
    // draw the cut pen solid, at least ~2 px, so it survives scaling down for analysis
    const m = g.getTransform();
    const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const prev = desc.get!.call(g);
    desc.set!.call(g, Math.max(prev, 2 / sc));
    g.strokeStyle = '#000';
    (nativeStroke as (...x: unknown[]) => void).apply(g, a);
    desc.set!.call(g, prev);
  };
  if (mode === 'filter') {
    // dark solid fills (poché walls) stay; light fills (rooms, furniture, paper) go
    const nativeFill = proto.fill;
    (g as unknown as { fill: (...a: unknown[]) => void }).fill = function (...a: unknown[]) {
      if (lum(g.fillStyle) < 90) (nativeFill as (...x: unknown[]) => void).apply(g, a);
    };
  }
  return {
    /** the heaviest dark pen that is used a fair amount, if lighter dark pens are common too */
    cutWidth() {
      const total = [...tally.values()].reduce((x, y) => x + y, 0);
      if (total < 50) return 0;
      const widths = [...tally.entries()].sort((x, y) => y[0] - x[0]);
      let acc = 0;
      for (const [wd, n] of widths) {
        acc += n;
        if (n >= Math.max(15, total * 0.04)) {
          // only worth it when a good share of dark strokes are thinner than this pen
          const thinner = total - acc;
          return thinner > total * 0.25 && wd > 0 ? wd : 0;
        }
      }
      return 0;
    },
  };
}

/**
 * Where the drawing sits on a sheet, in canvas pixels: the biggest cluster of ink once nearby
 * strokes are merged, leaving out the sheet frame (spans the page) and the title column (a tall,
 * narrow strip at the side).
 */
function drawingBox(c: HTMLCanvasElement) {
  const W = 400;
  const k = W / Math.max(c.width, c.height);
  const w = Math.max(1, Math.round(c.width * k)),
    h = Math.max(1, Math.round(c.height * k));
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  const g = t.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 600 ? 1 : 0;
  // sheet frames and the title column's rules are straight lines across most of the page: erase them
  const long = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; ) {
      if (!ink[y * w + x]) {
        x++;
        continue;
      }
      const a = x;
      while (x < w && ink[y * w + x]) x++;
      if (x - a > w * 0.6) for (let k = a; k < x; k++) long[y * w + k] = 1;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; ) {
      if (!ink[y * w + x]) {
        y++;
        continue;
      }
      const a = y;
      while (y < h && ink[y * w + x]) y++;
      if (y - a > h * 0.6) for (let k = a; k < y; k++) long[k * w + x] = 1;
    }
  for (let i = 0; i < ink.length; i++) if (long[i]) ink[i] = 0;
  // merge strokes closer than ~1.5% of the sheet
  const r = Math.max(2, Math.round(W * 0.015));
  const grow = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) grow[yy * w + xx] = 1;
        }
    }
  const lab = new Int32Array(w * h);
  let best = { score: 0, x0: 0, y0: 0, x1: c.width, y1: c.height };
  for (let s = 0, n = 1; s < w * h; s++) {
    if (!grow[s] || lab[s]) continue;
    const st = [s];
    lab[s] = n;
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0,
      mass = 0;
    const inked: number[] = [];
    while (st.length) {
      const i = st.pop()!;
      const x = i % w,
        y = (i - x) / w;
      mass += ink[i];
      if (ink[i]) inked.push(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && grow[j] && !lab[j] && Math.abs((j % w) - x) <= 1) (lab[j] = n), st.push(j);
    }
    n++;
    const bw = x1 - x0 + 1,
      bh = y1 - y0 + 1;
    if (bw > w * 0.9 && bh > h * 0.9) continue; // the sheet frame
    // frames and panels: their ink runs along the edges of their own box
    const e = Math.max(2, Math.round(Math.max(bw, bh) * 0.03));
    let edge = 0;
    for (const i of inked) {
      const x = i % w,
        y = (i - x) / w;
      if (x - x0 < e || x1 - x < e || y - y0 < e || y1 - y < e) edge++;
    }
    if (inked.length && edge / inked.length > 0.55 && bw * bh > w * h * 0.05) continue;
    const aspect = Math.max(bw / bh, bh / bw);
    const score = mass / (1 + Math.max(0, aspect - 2.2) * 2);
    if (score > best.score) best = { score, x0, y0, x1, y1 };
  }
  if (!best.score) return { x0: 0, y0: 0, x1: c.width, y1: c.height };
  const m = Math.round(Math.max(best.x1 - best.x0, best.y1 - best.y0) * 0.05);
  return {
    x0: Math.max(0, (best.x0 - m) / k),
    y0: Math.max(0, (best.y0 - m) / k),
    x1: Math.min(c.width, (best.x1 + 1 + m) / k),
    y1: Math.min(c.height, (best.y1 + 1 + m) / k),
  };
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));

/**
 * Renders one page of a PDF plan (pdf.js is loaded only when needed). Architects' PDFs keep
 * text as text: it is read directly for room names, and left out of the copy the reader analyses,
 * so dimensions, titles and labels can never be mistaken for walls.
 */
async function openPdf(file: Blob) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return { doc, pdfjs };
}

export interface PdfPage {
  /** 1-based page number */
  n: number;
  thumb: string;
  /** the most prominent short text on the page — usually the apartment or type name */
  title: string;
}

/**
 * A sales brochure holds one apartment per page: small previews so the right one can be chosen.
 * Returns an empty list for a single-page file.
 */
export async function pdfPages(file: Blob, side = 260): Promise<PdfPage[]> {
  const { doc } = await openPdf(file);
  try {
    if (doc.numPages < 2) return [];
    const out: PdfPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
      const page = await doc.getPage(n);
      const b = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: side / Math.max(b.width, b.height) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      let title = '';
      let big = 0;
      const tc = await page.getTextContent();
      for (const it of tc.items as { str?: string; transform?: number[] }[]) {
        const t = (it.str || '').trim();
        if (!t || t.length > 14 || !it.transform) continue;
        const size = Math.hypot(it.transform[0], it.transform[1]);
        if (size > big) {
          big = size;
          title = t;
        }
      }
      out.push({ n, thumb: c.toDataURL('image/jpeg', 0.8), title });
      page.cleanup();
    }
    return out;
  } finally {
    doc.destroy();
  }
}

export async function pdfToPlan(file: Blob, maxSide = 2400, pageNo = 1): Promise<PdfPlan> {
  const { doc, pdfjs } = await openPdf(file);
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    type VP = ReturnType<typeof page.getViewport>;
    const canvas = (vp: VP) => {
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      return { c, g };
    };
    const silence = (g: CanvasRenderingContext2D, images = false) => {
      const x = g as CanvasRenderingContext2D & Record<string, unknown>;
      x.fillText = () => {};
      x.strokeText = () => {};
      if (images) x.drawImage = () => {};
    };

    // 1. a quick look at the whole sheet: which pens are used, and where the drawing is
    const s0 = 1600 / Math.max(base.width, base.height);
    const vp0 = page.getViewport({ scale: s0 });
    const look = canvas(vp0);
    const pens = watchPens(look.g, 'measure');
    await page.render({ canvasContext: look.g, viewport: vp0 }).promise;
    // Working drawings draw what is cut (the walls) with the heaviest pen; dimensions, lettering,
    // furniture, hatching and door swings use lighter ones.
    const cutPdf = pens.cutWidth() / s0;
    const struct0 = canvas(vp0);
    silence(struct0.g, true);
    if (cutPdf) watchPens(struct0.g, 'filter', cutPdf * s0);
    await page.render({ canvasContext: struct0.g, viewport: vp0 }).promise;
    // the drawing on the sheet: frame, title column and site map left out
    let box = drawingBox(struct0.c);
    if (cutPdf) {
      // parts drawn with a lighter pen — a glass facade, a balcony rail — still belong to the
      // apartment: take the whole drawing around the cut walls
      const lines = canvas(vp0);
      silence(lines.g, true);
      await page.render({ canvasContext: lines.g, viewport: vp0 }).promise;
      const all = drawingBox(lines.c);
      const area = (b: typeof box) => (b.x1 - b.x0) * (b.y1 - b.y0);
      const t = (box.x1 - box.x0 + box.y1 - box.y0) * 0.05;
      const holds = all.x0 <= box.x0 + t && all.y0 <= box.y0 + t && all.x1 >= box.x1 - t && all.y1 >= box.y1 - t;
      if (holds && area(all) < area(box) * 3)
        box = { x0: Math.min(box.x0, all.x0), y0: Math.min(box.y0, all.y0), x1: Math.max(box.x1, all.x1), y1: Math.max(box.y1, all.y1) };
    }

    // 2. that area, rendered at full resolution
    const cw = (box.x1 - box.x0) / s0,
      ch = (box.y1 - box.y0) / s0;
    const s1 = Math.min(maxSide / Math.max(cw, ch), 8);
    const vp = page.getViewport({ scale: s1, offsetX: (-box.x0 / s0) * s1, offsetY: (-box.y0 / s0) * s1 });
    const sized = (vp_: VP, sc = s1) => {
      const o = canvas(vp_);
      o.c.width = Math.round(cw * sc);
      o.c.height = Math.round(ch * sc);
      o.g.fillStyle = '#fff';
      o.g.fillRect(0, 0, o.c.width, o.c.height);
      return o;
    };
    const full = sized(vp);
    await page.render({ canvasContext: full.g, viewport: vp }).promise;
    const clean = sized(vp);
    silence(clean.g);
    await page.render({ canvasContext: clean.g, viewport: vp }).promise;
    let structure: HTMLCanvasElement | null = null;
    if (cutPdf) {
      const st = sized(vp);
      silence(st.g, true);
      watchPens(st.g, 'filter', cutPdf * s1);
      await page.render({ canvasContext: st.g, viewport: vp }).promise;
      structure = st.c;
    }

    // the text layer: room names with their place on the page
    const tc = await page.getTextContent();
    type Item = { str: string; x: number; y: number; dx: number; dy: number; len: number; h: number };
    const items: Item[] = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const m = pdfjs.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(m[2], m[3]) || 1;
      const ux = m[0] / (Math.hypot(m[0], m[1]) || 1),
        uy = m[1] / (Math.hypot(m[0], m[1]) || 1);
      const len = it.width * vp.scale;
      items.push({ str: it.str, x: m[4], y: m[5], dx: ux, dy: uy, len, h });
    }
    // glue runs that sit on one baseline (PDFs often store a word letter by letter)
    const words: { text: string; x: number; y: number }[] = [];
    const used = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      let run = [items[i]];
      used.add(i);
      for (let grew = true; grew; ) {
        grew = false;
        for (let j = 0; j < items.length; j++) {
          if (used.has(j)) continue;
          const b = items[j];
          const near = run.some((a) => Math.abs((b.x - a.x) * -a.dy + (b.y - a.y) * a.dx) < a.h * 0.4 && Math.hypot(b.x - a.x, b.y - a.y) < a.len + b.len + a.h * 0.8);
          if (near) {
            run.push(b);
            used.add(j);
            grew = true;
          }
        }
      }
      // order along the baseline, centre of the run
      const a0 = run[0];
      run = run.sort((p, q) => (p.x - a0.x) * a0.dx + (p.y - a0.y) * a0.dy - ((q.x - a0.x) * a0.dx + (q.y - a0.y) * a0.dy));
      const first = run[0],
        last = run[run.length - 1];
      const ex = last.x + last.dx * last.len,
        ey = last.y + last.dy * last.len;
      // half a letter above the baseline, in the text's own 'up' direction
      const cx = (first.x + ex) / 2 + first.dy * first.h * 0.35,
        cy = (first.y + ey) / 2 - first.dx * first.h * 0.35;
      words.push({ text: run.map((r) => r.str).join(''), x: cx, y: cy });
      if (run.length > 1) for (const r of run) words.push({ text: r.str, x: cx, y: cy });
    }
    const labels: PdfPlan['labels'] = [];
    for (const wd of words) {
      const type = typeOfWord(wd.text);
      if (type && !labels.some((l) => l.type === type && Math.hypot(l.x - wd.x, l.y - wd.y) < 20)) labels.push({ type, text: wd.text, x: wd.x, y: wd.y });
    }
    let ocr: PdfPlan['ocr'];
    if (!labels.length) {
      // vector lettering stays sharp at any size: twice the detail for the small room names
      const s2 = Math.min(5000 / Math.max(cw, ch), 16);
      if (s2 > s1 * 1.3) {
        const vp2 = page.getViewport({ scale: s2, offsetX: (-box.x0 / s0) * s2, offsetY: (-box.y0 / s0) * s2 });
        const hi = sized(vp2, s2);
        await page.render({ canvasContext: hi.g, viewport: vp2 }).promise;
        ocr = { blob: await toBlob(hi.c), scale: s1 / s2 };
        hi.c.width = hi.c.height = 0;
      }
    }
    return {
      ocr,
      clean: await toBlob(structure || clean.c),
      full: await toBlob(full.c),
      labels,
      hasText: items.length > 3,
      cutPen: !!structure,
    };
  } finally {
    doc.destroy();
  }
}

/** The page as one image (kept for callers that only need a picture). */
export async function pdfToImage(file: Blob, maxSide = 2400): Promise<Blob> {
  return (await pdfToPlan(file, maxSide)).full;
}
