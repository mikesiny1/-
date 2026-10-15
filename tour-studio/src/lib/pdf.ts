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
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));

/**
 * Renders the first page of a PDF plan (pdf.js is loaded only when needed). Architects' PDFs keep
 * text as text: it is read directly for room names, and left out of the copy the reader analyses,
 * so dimensions, titles and labels can never be mistaken for walls.
 */
export async function pdfToPlan(file: Blob, maxSide = 2400): Promise<PdfPlan> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
    const canvas = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      return { c, g };
    };

    const full = canvas();
    await page.render({ canvasContext: full.g, viewport: vp }).promise;

    // the same page with every text-drawing call silenced
    const clean = canvas();
    const g = clean.g as CanvasRenderingContext2D & Record<string, unknown>;
    g.fillText = () => {};
    g.strokeText = () => {};
    await page.render({ canvasContext: clean.g, viewport: vp }).promise;

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
    return { clean: await toBlob(clean.c), full: await toBlob(full.c), labels, hasText: items.length > 3 };
  } finally {
    doc.destroy();
  }
}

/** The page as one image (kept for callers that only need a picture). */
export async function pdfToImage(file: Blob, maxSide = 2400): Promise<Blob> {
  return (await pdfToPlan(file, maxSide)).full;
}
