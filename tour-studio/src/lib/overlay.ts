/** Typography and frames burned into exported videos and covers. */
import type { Brand, Project } from './types';

export const SERIF = '"Frank Ruhl Libre", "David Libre", serif';
export const SANS = 'Assistant, "Segoe UI", Arial, sans-serif';

export function priceLine(p: Project) {
  const d = p.details;
  if (!d.price) return '';
  const n = Number(String(d.price).replace(/[^\d]/g, ''));
  const v = n ? '₪' + n.toLocaleString('he-IL') : d.price;
  return d.dealType === 'rent' ? `${v} לחודש` : v;
}

export function factsLine(p: Project) {
  const d = p.details;
  const parts = [];
  if (d.rooms) parts.push(`${d.rooms} חדרים`);
  if (d.sqm) parts.push(`${d.sqm} מ״ר`);
  if (d.floor) parts.push(`קומה ${d.floor}`);
  return parts.join('  ·  ');
}

function rtl(g: CanvasRenderingContext2D) {
  g.direction = 'rtl';
  g.textAlign = 'right';
}

/** Fit text by shrinking font until it fits the width. */
function fitFont(g: CanvasRenderingContext2D, text: string, family: string, weight: number, size: number, maxW: number) {
  let s = size;
  do {
    g.font = `${weight} ${s}px ${family}`;
    if (g.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 10);
  return s;
}

export interface OverlayState {
  t: number;
  duration: number;
  room: string;
  area: number;
  fade: number;
  roomChangedAt: number;
}

/** Draw all title-safe overlays for frame t. */
export function drawOverlays(g: CanvasRenderingContext2D, W: number, H: number, p: Project, b: Brand, s: OverlayState, logo: HTMLImageElement | null) {
  const u = Math.min(W, H) / 100; // design unit
  const pad = u * 6;
  const portrait = H > W;
  rtl(g);
  g.save();

  // soft vignette at the bottom for legibility
  const grd = g.createLinearGradient(0, H * 0.55, 0, H);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = grd;
  g.fillRect(0, H * 0.55, W, H * 0.45);

  // brand mark — top right
  g.fillStyle = 'rgba(255,255,255,0.95)';
  let topY = pad;
  if (logo) {
    const lh = u * 7;
    const lw = (logo.width / logo.height) * lh;
    g.drawImage(logo, W - pad - lw, topY, lw, lh);
  } else if (b.agencyName) {
    g.font = `600 ${u * 3.1}px ${SANS}`;
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = u;
    g.fillText(b.agencyName, W - pad, topY + u * 3.2);
    g.shadowBlur = 0;
  }

  const intro = Math.min(1, Math.max(0, (4.2 - s.t) / 0.8));
  const outroStart = s.duration - 4.5;
  const outro = Math.min(1, Math.max(0, (s.t - outroStart) / 0.8));

  // intro title
  if (intro > 0) {
    g.globalAlpha = intro;
    const title = p.details.title || p.details.address || 'נכס חדש';
    const area = [p.details.address && p.details.title ? p.details.address : '', p.details.city].filter(Boolean).join(', ');
    const maxW = W - pad * 2;
    const y = portrait ? H * 0.62 : H * 0.6;
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,0.4)';
    g.shadowBlur = u * 1.5;
    g.font = `500 ${u * 2.6}px ${SANS}`;
    g.fillText(p.details.dealType === 'rent' ? 'להשכרה' : 'למכירה', W - pad, y);
    const fs = fitFont(g, title, SERIF, 500, u * (portrait ? 8 : 7.5), maxW);
    g.fillText(title, W - pad, y + fs * 1.15);
    g.font = `400 ${u * 3.2}px ${SANS}`;
    if (area) g.fillText(area, W - pad, y + fs * 1.15 + u * 5.5);
    g.font = `600 ${u * 3.2}px ${SANS}`;
    g.fillText(factsLine(p), W - pad, y + fs * 1.15 + u * 10.5);
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  // room lower-third
  const since = s.t - s.roomChangedAt;
  if (s.room && intro <= 0 && outro <= 0) {
    const a = Math.min(1, since / 0.5);
    g.globalAlpha = a;
    const x = W - pad;
    const y = H - pad - u * (portrait ? 14 : 4);
    g.fillStyle = '#fff';
    g.fillRect(x - u * 0.5 + 0, y - u * 9.5, u * 0.5, u * 10);
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = u;
    g.font = `500 ${u * 5.2}px ${SERIF}`;
    g.fillText(s.room, x - u * 2.2, y - u * 3.6);
    if (s.area > 1) {
      g.font = `400 ${u * 2.8}px ${SANS}`;
      g.fillText(`כ-${Math.round(s.area)} מ״ר`, x - u * 2.2, y + u * 0.2);
    }
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  // persistent price tag (after intro)
  const price = priceLine(p);
  if (price && intro <= 0 && outro <= 0) {
    g.font = `600 ${u * 3}px ${SANS}`;
    const tw = g.measureText(price).width;
    const bx = pad,
      by = pad;
    g.fillStyle = 'rgba(20,18,16,0.72)';
    g.fillRect(bx, by, tw + u * 4, u * 6);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.direction = 'ltr';
    g.fillText(price, bx + u * 2, by + u * 4.1);
    rtl(g);
  }

  // outro card
  if (outro > 0) {
    g.globalAlpha = outro * 0.88;
    g.fillStyle = '#1e1c19';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = outro;
    g.fillStyle = '#f3f0e8';
    const cx = W / 2;
    g.textAlign = 'center';
    let y = H * (portrait ? 0.36 : 0.3);
    g.font = `400 ${u * 3}px ${SANS}`;
    g.fillText('לתיאום ביקור בנכס', cx, y);
    y += u * 9;
    const name = b.agentName || b.agencyName || '';
    if (name) {
      const fs = fitFont(g, name, SERIF, 500, u * 7, W - pad * 2);
      g.fillText(name, cx, y);
      y += fs * 0.6;
    }
    if (b.agentPhone) {
      y += u * 6;
      g.font = `600 ${u * 5}px ${SANS}`;
      g.direction = 'ltr';
      g.fillText(b.agentPhone, cx, y);
      rtl(g);
      g.textAlign = 'center';
    }
    y += u * 7;
    g.font = `400 ${u * 2.6}px ${SANS}`;
    const sub = [b.agencyName && b.agentName ? b.agencyName : '', b.license ? `רישיון ${b.license}` : ''].filter(Boolean).join('  ·  ');
    if (sub) g.fillText(sub, cx, y);
    g.font = `400 ${u * 2.1}px ${SANS}`;
    g.globalAlpha = outro * 0.7;
    g.fillText('הדמיית עיצוב להמחשה בלבד. הריהוט אינו כלול בנכס.', cx, H - pad);
    g.globalAlpha = 1;
  }

  // fade
  if (s.fade > 0) {
    g.globalAlpha = s.fade;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
  g.restore();
}

/** Draws a cover still: photo/render + editorial frame. */
export function drawCover(g: CanvasRenderingContext2D, W: number, H: number, src: CanvasImageSource, sw: number, sh: number, p: Project, b: Brand) {
  const k = Math.max(W / sw, H / sh);
  g.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
  const u = Math.min(W, H) / 100;
  const pad = u * 6;
  const grd = g.createLinearGradient(0, H * 0.45, 0, H);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  rtl(g);
  g.fillStyle = '#fff';
  const title = p.details.title || p.details.address || 'נכס חדש';
  const fs = fitFont(g, title, SERIF, 500, u * 8, W - pad * 2);
  const base = H - pad - u * 12;
  g.fillText(title, W - pad, base);
  g.font = `400 ${u * 3.2}px ${SANS}`;
  g.fillText([p.details.city, factsLine(p)].filter(Boolean).join('  ·  '), W - pad, base + u * 6);
  const price = priceLine(p);
  if (price) {
    g.font = `600 ${u * 3.6}px ${SANS}`;
    g.fillText(price, W - pad, base + u * 11.5);
  }
  if (b.agencyName) {
    g.font = `600 ${u * 2.8}px ${SANS}`;
    g.fillText(b.agencyName, W - pad, pad + u * 3);
  }
  void fs;
}
