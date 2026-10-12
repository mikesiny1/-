import { useEffect, useRef, useState } from 'react';
import { useBrand } from '../App';
import { loadImage } from '../lib/db';
import { drawOverlays } from '../lib/overlay';
import { PhotoTour } from '../lib/photoTour';
import type { Project } from '../lib/types';
import { fmtTime, Icon } from './ui';

export async function loadPhotoImages(p: Project) {
  const m = new Map<string, HTMLImageElement>();
  await Promise.all(
    p.photos.map(async (ph) => {
      const img = await loadImage(ph.blobId);
      if (img) m.set(ph.id, img);
    }),
  );
  return m;
}

export default function PhotoPlayer({ p }: { p: Project }) {
  const { brand } = useBrand();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tour, setTour] = useState<PhotoTour | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const st = useRef({ t: 0, room: '', changed: 0 });

  const key = JSON.stringify(p.photos) + p.design.style + p.design.furnish;
  useEffect(() => {
    let alive = true;
    loadPhotoImages(p).then((imgs) => alive && setTour(new PhotoTour(p.photos, imgs, p.design.style, p.design.furnish)));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadImage(brand.logoBlobId).then(setLogo);
  }, [brand.logoBlobId]);

  useEffect(() => {
    if (!tour) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (playing) {
        st.current.t = Math.min(tour.duration, st.current.t + dt);
        if (st.current.t >= tour.duration) setPlaying(false);
        setT(st.current.t);
      }
      const c = canvas.current;
      if (!c) return;
      const W = c.width,
        H = c.height;
      const g = c.getContext('2d')!;
      const r = tour.draw(g, W, H, st.current.t);
      if (r.room !== st.current.room) {
        st.current.room = r.room;
        st.current.changed = st.current.t;
      }
      drawOverlays(g, W, H, p, brand, { t: st.current.t, duration: tour.duration, room: r.room, area: 0, fade: 0, roomChangedAt: st.current.changed }, logo);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tour, playing, p, brand, logo]);

  return (
    <div className="viewer">
      <canvas ref={canvas} width={1280} height={720} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!tour && <div className="hint">טוען תמונות…</div>}
      <div className="vbar">
        <button
          className="pp"
          onClick={() => {
            if (tour && st.current.t >= tour.duration - 0.05) st.current.t = 0;
            setPlaying(!playing);
          }}
          aria-label={playing ? 'השהיה' : 'ניגון'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <input
          type="range"
          min={0}
          max={tour?.duration || 1}
          step={0.01}
          value={t}
          onChange={(e) => {
            st.current.t = Number(e.target.value);
            setT(st.current.t);
          }}
          style={{ direction: 'ltr' }}
        />
        <span className="time">
          {fmtTime(t)} / {fmtTime(tour?.duration || 0)}
        </span>
      </div>
    </div>
  );
}
