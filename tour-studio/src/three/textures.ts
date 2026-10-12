import * as THREE from 'three';
import type { FloorKind, RugPattern } from '../lib/styles';
import { realTex } from './real';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return '#' + c.getHexString();
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
}

function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, r: () => number, vertical: boolean) {
  g.fillStyle = shade(base, (r() - 0.5) * 0.07);
  g.fillRect(x, y, w, h);
  g.globalAlpha = 0.09;
  const n = 14;
  for (let i = 0; i < n; i++) {
    g.strokeStyle = r() > 0.5 ? shade(base, -0.12) : shade(base, 0.08);
    g.lineWidth = 0.5 + r() * 1.5;
    g.beginPath();
    if (vertical) {
      const px = x + r() * w;
      g.moveTo(px, y);
      g.bezierCurveTo(px + (r() - 0.5) * 6, y + h * 0.3, px + (r() - 0.5) * 6, y + h * 0.7, px + (r() - 0.5) * 4, y + h);
    } else {
      const py = y + r() * h;
      g.moveTo(x, py);
      g.bezierCurveTo(x + w * 0.3, py + (r() - 0.5) * 6, x + w * 0.7, py + (r() - 0.5) * 6, x + w, py + (r() - 0.5) * 4);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Returns a repeating floor texture and how many metres one tile covers. */
export interface FloorFinish {
  tex: THREE.Texture;
  metres: number;
  rough: number;
  color?: THREE.Color;
  bump?: THREE.Texture;
  roughMap?: THREE.Texture;
}

/** Plank floors use a scanned hardwood floor, tinted to the style's tone. */
export function floorTexture(kind: FloorKind, tone: string): FloorFinish {
  if (kind === 'oak' || kind === 'walnut')
    return {
      tex: realTex('floor_wood'),
      metres: 1.8,
      rough: 1,
      color: new THREE.Color(tone).multiplyScalar(1.3),
      bump: realTex('floor_bump'),
      roughMap: realTex('floor_rough'),
    };
  return proceduralFloor(kind, tone);
}

function proceduralFloor(kind: FloorKind, tone: string): FloorFinish {
  const [c, g] = canvas(1024);
  const r = rng(kind.length * 977 + tone.charCodeAt(2));
  let metres = 4;
  let rough = 0.6;
  if (kind === 'oak' || kind === 'walnut') {
    // 4m x 4m, planks 20cm x 1.6..2.2m
    const pw = 1024 / 20;
    for (let i = 0; i < 20; i++) {
      let y = -r() * 300;
      while (y < 1024) {
        const len = 330 + r() * 230;
        grain(g, i * pw, y, pw, len, tone, r, true);
        g.fillStyle = 'rgba(40,25,10,0.18)';
        g.fillRect(i * pw, y, pw, 1.5);
        y += len;
      }
      g.fillStyle = 'rgba(40,25,10,0.16)';
      g.fillRect(i * pw, 0, 1.2, 1024);
    }
    rough = 0.55;
  } else if (kind === 'herringbone') {
    metres = 2.4;
    const L = 1024 / 4; // 60cm
    const W = L / 6; // 10cm
    g.fillStyle = tone;
    g.fillRect(0, 0, 1024, 1024);
    g.save();
    g.translate(512, 512);
    g.rotate(Math.PI / 4);
    for (let row = -14; row < 14; row++)
      for (let col = -14; col < 14; col++) {
        const x = col * (L + W) * 0.5 + row * W;
        const y = row * W + col * (L - W) * 0.5;
        const vertical = (row + col) % 2 === 0;
        if (vertical) grain(g, x, y, W, L, tone, r, true);
        else grain(g, x, y, L, W, tone, r, false);
        g.strokeStyle = 'rgba(40,25,10,0.22)';
        g.lineWidth = 1;
        g.strokeRect(x, y, vertical ? W : L, vertical ? L : W);
      }
    g.restore();
    rough = 0.45;
  } else if (kind === 'concrete') {
    g.fillStyle = tone;
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.04})`;
      const s = 2 + r() * 30;
      g.beginPath();
      g.arc(r() * 1024, r() * 1024, s, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 512);
    g.lineTo(1024, 512);
    g.moveTo(512, 0);
    g.lineTo(512, 1024);
    g.stroke();
    rough = 0.42;
  } else if (kind === 'terrazzo') {
    metres = 1.2;
    g.fillStyle = tone;
    g.fillRect(0, 0, 1024, 1024);
    const chips = ['#b9b1a4', '#8d8174', '#d8cfc2', '#a7765a', '#6f6a63', '#f2ede5'];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = chips[Math.floor(r() * chips.length)];
      g.beginPath();
      const x = r() * 1024,
        y = r() * 1024,
        s = 2 + r() * 9;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo(x + Math.cos(k * 1.3 + r()) * s, y + Math.sin(k * 1.3 + r()) * s);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.strokeRect(0.5, 0.5, 1023, 1023);
    rough = 0.3;
  } else {
    // large porcelain 60x60
    metres = 1.2;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        g.fillStyle = shade(tone, (r() - 0.5) * 0.03);
        g.fillRect(i * 512, j * 512, 512, 512);
        for (let k = 0; k < 600; k++) {
          g.fillStyle = `rgba(0,0,0,${r() * 0.025})`;
          g.fillRect(i * 512 + r() * 512, j * 512 + r() * 512, 2 + r() * 20, 1 + r() * 3);
        }
      }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, 1024, 2);
    g.fillRect(0, 511, 1024, 2);
    g.fillRect(0, 0, 2, 1024);
    g.fillRect(511, 0, 2, 1024);
    rough = 0.32;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, metres, rough };
}

export function smallTileTexture(tone: string, grout = 'rgba(0,0,0,0.2)', n = 8) {
  const [c, g] = canvas(512);
  const r = rng(n * 31);
  const s = 512 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = shade(tone, (r() - 0.5) * 0.04);
      g.fillRect(i * s, j * s, s, s);
    }
  g.fillStyle = grout;
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * s - 1, 0, 2, 512);
    g.fillRect(0, i * s - 1, 512, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function rugTexture(pattern: RugPattern, a: string, b: string) {
  const [c, g] = canvas(512);
  const r = rng(pattern.length * 101);
  g.fillStyle = a;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = b;
  g.fillStyle = b;
  if (pattern === 'stripe') {
    for (let y = 30; y < 512; y += 64) g.fillRect(0, y, 512, 10 + (y % 3) * 4);
  } else if (pattern === 'border') {
    g.lineWidth = 10;
    g.strokeRect(28, 28, 456, 456);
    g.lineWidth = 3;
    g.strokeRect(50, 50, 412, 412);
  } else if (pattern === 'grid') {
    g.lineWidth = 2;
    g.globalAlpha = 0.6;
    for (let i = 32; i < 512; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (pattern === 'kilim') {
    for (let row = 0; row < 8; row++) {
      const y = row * 64 + 32;
      for (let x = 0; x < 512; x += 64) {
        g.beginPath();
        g.moveTo(x + 32, y - 22);
        g.lineTo(x + 54, y);
        g.lineTo(x + 32, y + 22);
        g.lineTo(x + 10, y);
        g.closePath();
        if ((row + x / 64) % 2) g.fill();
        else {
          g.lineWidth = 4;
          g.stroke();
        }
      }
    }
    g.lineWidth = 16;
    g.strokeRect(8, 8, 496, 496);
  }
  // pile noise
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fine weave noise shared by upholstery so it doesn't look like plastic. */
let weave: THREE.Texture | null = null;
export function weaveTexture() {
  if (weave) return weave;
  const [c, g] = canvas(256);
  const r = rng(7);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2)
    for (let x = 0; x < 256; x += 2) {
      const v = 225 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 2, 2);
    }
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(3, 3);
  weave.colorSpace = THREE.SRGBColorSpace;
  return weave;
}

let woodTex: THREE.Texture | null = null;
export function woodTexture() {
  if (woodTex) return woodTex;
  const [c, g] = canvas(512);
  const r = rng(99);
  grain(g, 0, 0, 512, 512, '#e9e9e9', r, false);
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    const y = r() * 512;
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + (r() - 0.5) * 20, 340, y + (r() - 0.5) * 20, 512, y + (r() - 0.5) * 10);
    g.stroke();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.colorSpace = THREE.SRGBColorSpace;
  return woodTex;
}

export function skyTexture() {
  const [c, g] = canvas(256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#b9cbd8');
  grd.addColorStop(0.45, '#e3e8ea');
  grd.addColorStop(0.55, '#ece8e0');
  grd.addColorStop(1, '#d8d0c2');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
