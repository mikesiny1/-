/**
 * Speed-ramp reel, 9:16, ~10 s: a building photo with the flat's window marked, an explosive zoom
 * through that window into the 3D apartment, braking glides through the living room, a bedroom and
 * the kitchen joined by fast dashes through the doorways, then a full rewind back out to the photo.
 * One continuous camera path; motion blur only while the camera is fast.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { ReelPath, TourEngine } from '../three/engine';

export interface Exterior {
  img: HTMLImageElement;
  /** marked window, 0..1 of the photo */
  x: number;
  y: number;
}

const FPS = 30;
const SHUTTER = 0.5 / FPS; // 180° shutter
const ZMAX = 16;

// ------------------------------------------------------------ timing

/** Monotone cubic (Fritsch–Carlson) through (t, s) keys: hard ramps, never overshooting. */
function monotone(ts: number[], ss: number[], endStill: boolean) {
  const n = ts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ss[i + 1] - ss[i]) / (ts[i + 1] - ts[i]));
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  m[0] = d[0];
  m[n - 1] = endStill ? 0 : d[n - 2];
  return (t: number) => {
    if (t <= ts[0]) return ss[0];
    if (t >= ts[n - 1]) return ss[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i],
      u = (t - ts[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1,
      h10 = u ** 3 - 2 * u ** 2 + u,
      h01 = -2 * u ** 3 + 3 * u ** 2,
      h11 = u ** 3 - u ** 2;
    return h00 * ss[i] + h10 * h * m[i] + h01 * ss[i + 1] + h11 * h * m[i + 1];
  };
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const inOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export interface ReelPlan {
  duration: number;
  /** path position (points) at time t, or null while only the photo shows */
  s: (t: number) => number;
  photoAlpha: (t: number) => number;
  zoom: (t: number) => number;
  hand: (t: number) => number;
  rewindStart: number;
}

export function planReel(path: ReelPath): ReelPlan {
  const T = [1.0, 1.5, 3.0, 3.4, 5.0, 5.4, 7.7].slice(0, path.keys.length);
  // with fewer rooms, the last glide still gets its full braking length
  const fwd = monotone(T, path.keys, true);
  const tEnd = T[T.length - 1];
  const rewind = 1.8;
  const back0 = tEnd,
    back1 = tEnd + rewind;
  const duration = back1 + 0.5;
  const last = path.keys[path.keys.length - 1];
  return {
    duration,
    rewindStart: back0,
    s: (t) => {
      if (t <= back0) return fwd(t);
      return last * (1 - inOutCubic(Math.min(1, (t - back0) / rewind)));
    },
    photoAlpha: (t) => (t < back0 ? 1 - smooth(1.18, 1.46, t) : smooth(back1 - 0.32, back1 - 0.04, t)),
    zoom: (t) => {
      if (t < 1.0) return 1 + 0.05 * t; // slow push-in on the building
      if (t < 1.5) return 1.05 * Math.pow(ZMAX / 1.05, Math.pow((t - 1.0) / 0.5, 2.2)); // explosive
      if (t < back1 - 0.4) return ZMAX;
      if (t < back1) return 1.05 * Math.pow(ZMAX / 1.05, Math.pow(1 - (t - (back1 - 0.4)) / 0.4, 2.2));
      return 1.05;
    },
    hand: (t) => (t < 1.0 ? 1 - smooth(0.82, 1.0, t) : smooth(back1 - 0.05, back1 + 0.2, t)),
  };
}

// ------------------------------------------------------------ drawing

function poseAt(path: ReelPath, s: number) {
  const P = path.pts;
  const i = Math.max(0, Math.min(P.length - 2, Math.floor(s)));
  const u = Math.max(0, Math.min(1, s - i));
  const a = P[i],
    b = P[i + 1];
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + (b.yaw - a.yaw) * u, pitch: a.pitch + (b.pitch - a.pitch) * u };
}

function drawPhoto(g: CanvasRenderingContext2D, W: number, H: number, ex: Exterior, z: number, z0: number) {
  const iw = ex.img.naturalWidth,
    ih = ex.img.naturalHeight;
  const base = Math.max(W / iw, H / ih);
  // the marked window glides to the centre of the frame as we zoom in
  const fit = { x: (W - iw * base) / 2 + ex.x * iw * base, y: (H - ih * base) / 2 + ex.y * ih * base };
  const k = Math.min(1, (z - 1) / 3);
  const ax = fit.x + (W / 2 - fit.x) * k,
    ay = fit.y + (H * 0.45 - fit.y) * k;
  // radial zoom blur: smear between the zoom at the start and the end of the shutter
  const n = Math.abs(Math.log(z / z0)) > 0.05 ? 7 : 1;
  for (let i = 0; i < n; i++) {
    const zz = n === 1 ? z : z0 * Math.pow(z / z0, i / (n - 1));
    const sc = base * zz;
    g.globalAlpha = 1 / (i + 1);
    g.drawImage(ex.img, ax - ex.x * iw * sc, ay - ex.y * ih * sc, iw * sc, ih * sc);
  }
  g.globalAlpha = 1;
  return { ax, ay };
}

/** A black leather glove, index finger pointing at (tx, ty). */
export function drawHand(g: CanvasRenderingContext2D, tx: number, ty: number, scale: number, alpha: number, t: number) {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  // the arm comes in from the lower right; a breath of movement
  const bob = Math.sin(t * 2.4) * 4 * scale;
  g.translate(tx + 18 * scale, ty + 22 * scale + bob);
  g.rotate(Math.atan2(1, 0.62));
  g.scale(scale, scale);
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  const leather = g.createLinearGradient(0, -60, 0, 90);
  leather.addColorStop(0, '#3a3c40');
  leather.addColorStop(0.35, '#17181a');
  leather.addColorStop(1, '#070708');
  g.fillStyle = leather;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  // forearm and cuff
  rr(300, -42, 520, 130, 52);
  // fist
  rr(118, -46, 220, 128, 50);
  // curled fingers (knuckles)
  for (const [x, y] of [
    [150, 52],
    [196, 62],
    [244, 64],
  ]) {
    g.beginPath();
    g.ellipse(x, y, 34, 26, 0.2, 0, Math.PI * 2);
    g.fill();
  }
  // thumb along the side
  g.beginPath();
  g.ellipse(170, -44, 62, 22, -0.22, 0, Math.PI * 2);
  g.fill();
  // index finger, pointing
  rr(-6, -20, 160, 38, 19);
  g.shadowColor = 'transparent';
  // leather sheen and seams
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(10, -14);
  g.lineTo(140, -16);
  g.moveTo(130, -38);
  g.quadraticCurveTo(220, -52, 320, -36);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(330, -40);
  g.lineTo(330, 86);
  g.moveTo(350, -40);
  g.lineTo(350, 86);
  g.stroke();
  g.restore();
}

function drawMarker(g: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, t: number) {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha * (0.65 + 0.35 * Math.sin(t * 5));
  g.strokeStyle = '#fff';
  g.lineWidth = 3 * s;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 12;
  g.beginPath();
  g.arc(x, y, 34 * s, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------ render + encode

export interface ReelOpts {
  engine: TourEngine;
  path: ReelPath;
  exterior: Exterior | null;
  W: number;
  H: number;
  out: HTMLCanvasElement;
  onProgress: (k: number) => void;
  signal: { cancelled: boolean };
  /** brand strip, captions etc. drawn on top of each finished frame */
  overlay?: (g: CanvasRenderingContext2D, t: number, duration: number) => void;
}

export async function renderReel(o: ReelOpts): Promise<{ blob: Blob; mime: string } | null> {
  const { engine, path, exterior, W, H, out } = o;
  const plan = planReel(path);
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  const acc = document.createElement('canvas');
  acc.width = W;
  acc.height = H;
  const ga = acc.getContext('2d')!;
  const glc = engine.beginExport(W, H);

  const frame = (t: number) => {
    const pa = exterior ? plan.photoAlpha(t) : 0;
    // the 3D apartment, motion-blurred by subframes while the camera is fast
    if (pa < 0.999) {
      const s1 = plan.s(t),
        s0 = plan.s(t - SHUTTER);
      const speed = (Math.abs(s1 - s0) * 0.05) / SHUTTER; // metres per second
      const K = Math.max(1, Math.min(10, Math.round(speed / 1.6)));
      for (let i = 0; i < K; i++) {
        const tt = K === 1 ? t : t - SHUTTER + (SHUTTER * i) / (K - 1);
        const p = poseAt(path, plan.s(tt));
        engine.renderPose(p.x, p.z, p.yaw, p.pitch, tt);
        ga.globalAlpha = 1 / (i + 1);
        ga.drawImage(glc, 0, 0, W, H);
      }
      ga.globalAlpha = 1;
      g.globalAlpha = 1;
      g.drawImage(acc, 0, 0);
    }
    if (exterior && pa > 0.001) {
      g.save();
      g.globalAlpha = 1;
      if (pa < 0.999) {
        // crossfade: draw the photo onto a scratch layer, then blend it
        ga.clearRect(0, 0, W, H);
        const m = drawPhoto(ga, W, H, exterior, plan.zoom(t), plan.zoom(t - SHUTTER));
        g.globalAlpha = pa;
        g.drawImage(acc, 0, 0);
        g.globalAlpha = 1;
        drawMarker(g, m.ax, m.ay, W / 1080, plan.hand(t), t);
      } else {
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        const m = drawPhoto(g, W, H, exterior, plan.zoom(t), plan.zoom(t - SHUTTER));
        drawMarker(g, m.ax, m.ay, W / 1080, plan.hand(t), t);
        drawHand(g, m.ax, m.ay, W / 1080, plan.hand(t), t);
      }
      g.restore();
    }
    o.overlay?.(g, t, plan.duration);
  };

  try {
    const frames = Math.round(plan.duration * FPS);
    // offline, frame-exact encoding: H.264 where the browser has an encoder, else VP9 (both in MP4)
    let cfg: { mux: 'avc' | 'vp9'; codec: string } | null = null;
    if (typeof VideoEncoder !== 'undefined') {
      const opts: { mux: 'avc' | 'vp9'; codec: string }[] = [
        { mux: 'avc', codec: W * H > 1280 * 720 ? 'avc1.640032' : 'avc1.64001f' },
        { mux: 'vp9', codec: 'vp09.00.40.08' },
      ];
      for (const c of opts) {
        const ok = await VideoEncoder.isConfigSupported({ codec: c.codec, width: W, height: H, bitrate: 12_000_000, framerate: FPS }).catch(() => null);
        if (ok?.supported) {
          cfg = c;
          break;
        }
      }
    }
    if (cfg) {
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: cfg.mux, width: W, height: H }, fastStart: 'in-memory' });
      let failed: Error | null = null;
      const enc = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => (failed = e as Error),
      });
      enc.configure({ codec: cfg.codec, width: W, height: H, bitrate: 12_000_000, framerate: FPS });
      for (let i = 0; i < frames; i++) {
        if (o.signal.cancelled) {
          enc.close();
          return null;
        }
        frame(i / FPS);
        const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % 60 === 0 });
        vf.close();
        if (failed) throw failed;
        o.onProgress(i / frames);
        // let the page breathe and the encoder drain
        if (enc.encodeQueueSize > 4 || i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      await enc.flush();
      muxer.finalize();
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
    }
    // fallback: real-time capture of the same frames
    const { record } = await import('./exporter');
    return await record({ canvas: out, duration: plan.duration, music: false, onProgress: o.onProgress, signal: o.signal, draw: frame });
  } finally {
    engine.endExport();
  }
}
