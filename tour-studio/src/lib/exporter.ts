export interface Format {
  id: 'reel' | 'square' | 'wide';
  name: string;
  hint: string;
  w: number;
  h: number;
}

export const FORMATS: Format[] = [
  { id: 'reel', name: 'ריל / סטורי / טיקטוק', hint: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { id: 'square', name: 'פוסט פיד', hint: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { id: 'wide', name: 'יוטיוב / פייסבוק / מייל', hint: '16:9 · 1920×1080', w: 1920, h: 1080 },
];

export function pickMime() {
  const opts = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const o of opts) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o)) return o;
  return '';
}

/** Quiet ambient pad so the video doesn't play in silence. */
function ambient(ctx: AudioContext, dest: AudioNode, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 2);
  master.gain.setValueAtTime(0.16, ctx.currentTime + Math.max(2.1, duration - 2.5));
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  master.connect(lp).connect(dest);
  // Imaj7 – vi7 – IVmaj7 – V(sus) in D, slow
  const chords = [
    [146.83, 185.0, 220.0, 277.18],
    [123.47, 146.83, 185.0, 220.0],
    [98.0, 146.83, 196.0, 246.94],
    [110.0, 146.83, 164.81, 220.0],
  ];
  const len = 4;
  for (let t = 0, i = 0; t < duration; t += len, i++) {
    for (const f of chords[i % chords.length]) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        const st = ctx.currentTime + t;
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(0.05, st + 1.4);
        g.gain.linearRampToValueAtTime(0.0, st + len + 1.2);
        o.connect(g).connect(master);
        o.start(st);
        o.stop(st + len + 1.3);
      }
    }
  }
}

export interface RecordOpts {
  canvas: HTMLCanvasElement;
  duration: number;
  draw: (t: number) => void;
  music: boolean;
  onProgress: (k: number) => void;
  signal: { cancelled: boolean };
}

export async function record(o: RecordOpts): Promise<{ blob: Blob; mime: string } | null> {
  const mime = pickMime();
  if (!mime) throw new Error('הדפדפן לא תומך בהקלטת וידאו. מומלץ Chrome או Edge עדכניים.');
  const stream = o.canvas.captureStream(30);
  let actx: AudioContext | null = null;
  if (o.music) {
    actx = new AudioContext();
    const dest = actx.createMediaStreamDestination();
    ambient(actx, dest, o.duration);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  o.draw(0);
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (o.signal.cancelled) return resolve();
      const t = (performance.now() - t0) / 1000;
      o.draw(Math.min(t, o.duration));
      o.onProgress(Math.min(1, t / o.duration));
      if (t >= o.duration + 0.2) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  actx?.close();
  if (o.signal.cancelled) return null;
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function slug(s: string) {
  return (s || 'tour').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tour';
}
