/** Draws an architect-style sample plan (5 rooms, ~105 m²) so the studio can be tried without files. */
export function drawDemoPlan(variant: 'solid' | 'gray' | 'outline' | 'glass' | 'thin' | 'sheet' = 'solid'): HTMLCanvasElement {
  const S = 60; // px per metre
  const M = 1.4; // margin in metres
  // 'sheet': a sales sheet with a black title block beside the plan
  const extra = variant === 'sheet' ? 4.5 : 0;
  const thinStyle = variant === 'thin' || variant === 'sheet';
  const c = document.createElement('canvas');
  c.width = Math.round((13 + 2 * M + extra) * S);
  c.height = Math.round((11 + 2 * M) * S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfbf8';
  g.fillRect(0, 0, c.width, c.height);
  const X = (m: number) => (m + M + extra) * S;
  if (extra) {
    g.fillStyle = '#1b1b1b';
    g.fillRect(0.2 * S, 0.4 * S, (extra - 0.4) * S, c.height - 0.8 * S);
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 14; k++) g.fillRect(0.5 * S, (0.9 + k * 0.75) * S, (1.2 + ((k * 7) % 5) * 0.5) * S, 0.35 * S);
  }
  const Y = (m: number) => (m + M) * S;

  const ink = variant === 'gray' ? '#8f8f8f' : '#1b1b1b';
  // wall from (x0,y0) to (x1,y1) along an axis, with thickness t metres
  const wall = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    const h = t / 2;
    const r =
      y0 === y1
        ? [X(Math.min(x0, x1) - h), Y(y0 - h), (Math.abs(x1 - x0) + t) * S, t * S]
        : [X(x0 - h), Y(Math.min(y0, y1) - h), t * S, (Math.abs(y1 - y0) + t) * S];
    if (thinStyle && t < 0.2) {
      // sales-plan style: interior partitions as a single thin line
      g.fillStyle = '#3a3a3a';
      if (y0 === y1) g.fillRect(r[0], Y(y0) - 1.5, r[2], 3);
      else g.fillRect(X(x0) - 1.5, r[1], 3, r[3]);
    } else if (variant === 'outline') {
      g.strokeStyle = '#1b1b1b';
      g.lineWidth = 2;
      g.strokeRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2);
    } else {
      g.fillStyle = ink;
      g.fillRect(r[0], r[1], r[2], r[3]);
    }
  };
  // horizontal wall with openings [[from,to],...]
  const hwall = (y: number, x0: number, x1: number, t: number, gaps: [number, number][] = []) => {
    let cur = x0;
    for (const [a, b] of gaps.sort((p, q) => p[0] - q[0])) {
      if (a > cur) wall(cur, y, a - t / 2, y, t);
      cur = b + t / 2;
    }
    if (x1 > cur) wall(cur, y, x1, y, t);
  };
  const vwall = (x: number, y0: number, y1: number, t: number, gaps: [number, number][] = []) => {
    let cur = y0;
    for (const [a, b] of gaps.sort((p, q) => p[0] - q[0])) {
      if (a > cur) wall(x, cur, x, a - t / 2, t);
      cur = b + t / 2;
    }
    if (y1 > cur) wall(x, cur, x, y1, t);
  };

  const E = 0.25; // exterior
  const I = 0.12; // interior partition
  const SAFE = 0.3; // safe-room walls

  // exterior shell 0..13 x 0..9
  hwall(0, 0, 13, E, [
    [1, 2.6],
    [10.2, 11.8],
  ]);
  vwall(13, 0, 9, E, [
    [4.1, 5.1],
    [6.2, 7.8],
  ]);
  hwall(9, 0, 13, E, [
    [0.6, 5.4],
    [9.6, 11.2],
  ]);
  vwall(0, 0, 9, E, [[5.6, 7.6]]);
  // balcony parapet
  g.fillStyle = ink;
  hwall(10.9, 0, 6, 0.15);
  vwall(0, 9, 10.9, 0.15);
  vwall(6, 9, 10.9, 0.15);

  // row 1 partitions (y 0..4)
  vwall(3.6, 0, 4, I);
  hwall(4, 0, 3.6, I, [[2.3, 3.2]]); // kitchen door
  vwall(5.6, 0, 2.6, I);
  // safe room 5.6..9 x 0..4
  vwall(5.6, 2.6, 4, SAFE, []);
  vwall(5.6, 0, 2.6, SAFE);
  vwall(9, 0, 4, SAFE);
  hwall(4, 5.6, 9, SAFE, [[6.0, 6.9]]);
  // bedroom 9..13
  hwall(4, 9, 13, I, [[9.4, 10.3]]);
  // master separation from living, y 5.2 .. 9 at x 8.4
  vwall(8.4, 5.2, 9, I);
  hwall(5.2, 8.4, 13, I, [[11.6, 12.5]]);
  // corridor/living partial wall
  hwall(5.2, 5.4, 8.4, I);
  // bath door (vertical wall at 3.6 between y 2.6..4 open, door at bath bottom)
  hwall(2.6, 3.6, 5.6, I, [[4.1, 4.9]]);

  // window glazing: thin double lines in exterior gaps
  g.strokeStyle = '#3d3d3d';
  g.lineWidth = 1;
  const glazeH = (y: number, a: number, b: number) => {
    for (const o of [-0.05, 0.05]) {
      g.beginPath();
      g.moveTo(X(a), Y(y + o));
      g.lineTo(X(b), Y(y + o));
      g.stroke();
    }
  };
  const glazeV = (x: number, a: number, b: number) => {
    for (const o of [-0.05, 0.05]) {
      g.beginPath();
      g.moveTo(X(x + o), Y(a));
      g.lineTo(X(x + o), Y(b));
      g.stroke();
    }
  };
  glazeH(0, 1, 2.6);
  glazeH(0, 10.2, 11.8);
  glazeV(13, 6.2, 7.8);
  glazeV(0, 5.6, 7.6);
  glazeH(9, 0.6, 5.4);
  glazeH(9, 9.6, 11.2);

  if (variant === 'glass' || thinStyle) {
    // developer-plan look: the living room facades are full-height glazing drawn in thin grey
    g.fillStyle = '#fbfbf8';
    g.fillRect(X(-0.2), Y(4.2), 0.4 * S, 4.9 * S); // left facade of the living room
    g.fillRect(X(-0.2), Y(8.8), 8.6 * S, 0.4 * S); // living facade towards the balcony
    g.strokeStyle = '#b4bcc0';
    g.lineWidth = 1.5;
    for (const o of [-0.06, 0.06]) {
      g.beginPath();
      g.moveTo(X(o), Y(4.2));
      g.lineTo(X(o), Y(9));
      g.moveTo(X(0), Y(9 + o));
      g.lineTo(X(8.4), Y(9 + o));
      g.stroke();
    }
    g.fillStyle = '#9aa3a8';
    for (let y = 4.4; y < 9; y += 1.2) g.fillRect(X(-0.08), Y(y), 0.16 * S, 0.06 * S);
    for (let x = 0.2; x < 8.4; x += 1.4) g.fillRect(X(x), Y(8.92), 0.06 * S, 0.16 * S);
    // grey furniture symbols, as in sales plans
    g.strokeStyle = '#a9a9a9';
    g.lineWidth = 1;
    g.strokeRect(X(0.6), Y(5.0), 2.4 * S, 0.9 * S);
    g.strokeRect(X(0.6), Y(5.0), 0.9 * S, 2.0 * S);
    for (const [cx, cy] of [[3.6, 7.3], [5.6, 7.3]]) {
      g.beginPath();
      g.arc(X(cx), Y(cy), 0.6 * S, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.strokeRect(X(cx + Math.cos(a) * 0.85) - 0.2 * S, Y(cy + Math.sin(a) * 0.85) - 0.2 * S, 0.4 * S, 0.4 * S);
      }
    }
    g.strokeRect(X(9.6), Y(6.4), 1.8 * S, 2.1 * S);
    g.strokeRect(X(10.3), Y(0.5), 1.6 * S, 2.0 * S);
  }

  // door swings
  const swing = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    g.beginPath();
    g.arc(X(cx), Y(cy), r * S, a0, a1);
    g.stroke();
    g.beginPath();
    g.moveTo(X(cx), Y(cy));
    g.lineTo(X(cx) + Math.cos(a1) * r * S, Y(cy) + Math.sin(a1) * r * S);
    g.stroke();
  };
  g.lineWidth = 1;
  swing(2.3, 4, 0.9, -Math.PI / 2, 0);
  swing(4.1, 2.6, 0.8, -Math.PI / 2, 0);
  swing(6.0, 4, 0.9, -Math.PI / 2, 0);
  swing(9.4, 4, 0.9, -Math.PI / 2, 0);
  swing(11.6, 5.2, 0.9, 0, Math.PI / 2);
  swing(13, 4.1, 1.0, Math.PI / 2, Math.PI);

  // furniture symbols & text (should be ignored by the reader)
  g.strokeStyle = '#6a6a6a';
  g.strokeRect(X(0.3), Y(0.3), 0.6 * S, 3.0 * S);
  g.strokeRect(X(10), Y(0.6), 1.8 * S, 2.0 * S);
  g.strokeRect(X(9.5), Y(6.5), 1.8 * S, 2.0 * S);
  g.beginPath();
  g.ellipse(X(4.6), Y(1.3), 0.25 * S, 0.35 * S, 0, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = '#2a2a2a';
  g.font = `${Math.round(0.28 * S)}px Arial`;
  g.textAlign = 'center';
  const label = (t: string, a: string, x: number, y: number) => {
    g.fillText(t, X(x), Y(y));
    g.font = `${Math.round(0.22 * S)}px Arial`;
    g.fillText(a, X(x), Y(y + 0.35));
    g.font = `${Math.round(0.28 * S)}px Arial`;
  };
  label('מטבח', '14.4 מ״ר', 1.8, 2.0);
  label('רחצה', '5.2', 4.6, 1.8);
  label('ממ״ד', '13.6', 7.3, 2.0);
  label('חדר שינה', '16.0', 11, 2.2);
  label('סלון / פ. אוכל', '38.0', 3.8, 7.0);
  label('חדר הורים', '17.5', 10.7, 7.5);
  label('מרפסת', '11.4', 3, 10.1);

  // dimension line at the bottom
  g.strokeStyle = '#555';
  g.beginPath();
  g.moveTo(X(0), Y(11.6));
  g.lineTo(X(13), Y(11.6));
  g.stroke();
  g.fillText('13.00', X(6.5), Y(11.45));
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', q = 0.92): Promise<Blob> {
  return new Promise((res) => c.toBlob((b) => res(b!), type, q));
}
