/**
 * Sales plans often paint the walls one flat colour (a light grey or a brand tint) and draw the
 * furniture in dark lines, so "darkest = wall" picks the sofa instead of the wall. When one solid
 * colour clearly dominates the drawing, it is taken as the walls: painted black for the reader,
 * with the rest of the drawing kept as faint lines (windows and railings still separate rooms).
 */
export async function wallColorCopy(file: Blob, max = 2000): Promise<Blob | null> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const id = g.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const n = c.width * c.height;

  // colour histogram on a 4-bit grid; white, floor tints and paving left out
  const hist = new Map<number, number>();
  let ink = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4],
      gg = d[i * 4 + 1],
      b = d[i * 4 + 2];
    if (r + gg + b > 3 * 225) continue;
    ink++;
    const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  if (ink < n * 0.02) return null;
  let top = -1,
    topN = 0;
  for (const [key, v] of hist) if (v > topN) (top = key), (topN = v);
  // the exact colour: mean of that bucket
  let sr = 0,
    sg = 0,
    sb = 0,
    cnt = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4],
      gg = d[i * 4 + 1],
      b = d[i * 4 + 2];
    if ((((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4)) !== top) continue;
    sr += r;
    sg += gg;
    sb += b;
    cnt++;
  }
  const cr = sr / cnt,
    cg = sg / cnt,
    cb = sb / cnt;
  const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
  // black walls are read well as they are; very pale fills are floors and tiles
  if (lum < 70 || lum > 225) return null;
  const near = (i: number) => Math.abs(d[i * 4] - cr) + Math.abs(d[i * 4 + 1] - cg) + Math.abs(d[i * 4 + 2] - cb) < 24;
  let hits = 0;
  for (let i = 0; i < n; i++) if (near(i)) hits++;
  if (hits < ink * 0.25 || hits < n * 0.015) return null;

  // a wall is thick: most of the colour lies inside solid runs, not on thin strokes
  let solid = 0;
  const t = Math.max(2, Math.round(Math.max(c.width, c.height) * 0.002));
  for (let y = t; y < c.height - t; y += 2)
    for (let x = t; x < c.width - t; x += 2) {
      const i = y * c.width + x;
      if (near(i) && near(i - t) && near(i + t) && near(i - t * c.width) && near(i + t * c.width)) solid++;
    }
  if (solid * 4 < hits * 0.3) return null;

  for (let i = 0; i < n; i++) {
    let v = 255;
    if (near(i)) v = 0;
    else {
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      if (l < 150) v = 215;
    }
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  g.putImageData(id, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
