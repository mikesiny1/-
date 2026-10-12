import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Icon, Range, Seg, Switch } from '../../components/ui';
import { blobUrl, loadImage, uid } from '../../lib/db';
import { drawStaged } from '../../lib/photoTour';
import { FURNITURE_NAMES, ROOM_TYPES, styleById } from '../../lib/styles';
import type { FurnitureKind, PhotoEntry, RoomType, StagedItem, StyleId } from '../../lib/types';
import { furnitureSprite } from '../../three/sprites';
import type { StepProps } from '../ProjectView';

const KINDS: FurnitureKind[] = [
  'sofa',
  'armchair',
  'coffeeTable',
  'rug',
  'tvUnit',
  'diningTable',
  'bed',
  'nightstand',
  'wardrobe',
  'desk',
  'sideboard',
  'shelf',
  'singleBed',
  'bistroSet',
  'floorLamp',
  'plant',
];

/** Designer's starting point per room type — positions are relative to the photo. */
const SUGGEST: Partial<Record<RoomType, Omit<StagedItem, 'id'>[]>> = {
  living: [
    { kind: 'rug', view: 0, x: 0.5, y: 0.93, w: 0.52 },
    { kind: 'sofa', view: 0, x: 0.47, y: 0.8, w: 0.42 },
    { kind: 'coffeeTable', view: 0, x: 0.5, y: 0.94, w: 0.2 },
    { kind: 'armchair', view: 2, x: 0.16, y: 0.9, w: 0.17 },
    { kind: 'plant', view: 0, x: 0.84, y: 0.8, w: 0.1 },
  ],
  dining: [
    { kind: 'diningTable', view: 0, x: 0.5, y: 0.88, w: 0.45 },
    { kind: 'plant', view: 0, x: 0.85, y: 0.78, w: 0.1 },
  ],
  kitchen: [{ kind: 'diningTable', view: 1, x: 0.55, y: 0.92, w: 0.36 }],
  master: [
    { kind: 'rug', view: 0, x: 0.5, y: 0.95, w: 0.55 },
    { kind: 'bed', view: 0, x: 0.5, y: 0.9, w: 0.4 },
    { kind: 'nightstand', view: 0, x: 0.24, y: 0.77, w: 0.09 },
    { kind: 'nightstand', view: 0, x: 0.76, y: 0.77, w: 0.09 },
  ],
  bedroom: [
    { kind: 'bed', view: 1, x: 0.48, y: 0.9, w: 0.38 },
    { kind: 'nightstand', view: 1, x: 0.24, y: 0.76, w: 0.08 },
  ],
  kids: [
    { kind: 'singleBed', view: 1, x: 0.35, y: 0.9, w: 0.28 },
    { kind: 'desk', view: 2, x: 0.75, y: 0.84, w: 0.22 },
  ],
  office: [
    { kind: 'desk', view: 0, x: 0.5, y: 0.86, w: 0.3 },
    { kind: 'shelf', view: 2, x: 0.85, y: 0.8, w: 0.13 },
    { kind: 'plant', view: 0, x: 0.15, y: 0.8, w: 0.09 },
  ],
  mamad: [
    { kind: 'desk', view: 0, x: 0.5, y: 0.86, w: 0.3 },
    { kind: 'shelf', view: 2, x: 0.85, y: 0.8, w: 0.13 },
  ],
  balcony: [
    { kind: 'bistroSet', view: 0, x: 0.5, y: 0.9, w: 0.34 },
    { kind: 'plant', view: 0, x: 0.12, y: 0.86, w: 0.12 },
    { kind: 'plant', view: 0, x: 0.88, y: 0.86, w: 0.12 },
  ],
  hall: [{ kind: 'sideboard', view: 0, x: 0.5, y: 0.82, w: 0.28 }],
};

function Thumb({ kind, style }: { kind: FurnitureKind; style: StyleId }) {
  const src = useMemo(() => furnitureSprite(kind, style, 0).canvas.toDataURL(), [kind, style]);
  return <img src={src} alt="" />;
}

export default function PhotosStep({ p, update, next }: StepProps) {
  const [sel, setSel] = useState(p.photos[0]?.id || '');
  const [item, setItem] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [show, setShow] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const style = p.design.style;
  const photo = p.photos.find((x) => x.id === sel) || p.photos[0];

  useEffect(() => {
    Promise.all(p.photos.map(async (ph) => [ph.id, (await blobUrl(ph.blobId)) || ''] as const)).then((e) => setUrls(Object.fromEntries(e)));
  }, [p.photos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setImg(null);
    if (photo) loadImage(photo.blobId).then(setImg);
  }, [photo?.blobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPhoto = (fn: (ph: PhotoEntry) => PhotoEntry) =>
    update((x) => ({ ...x, photos: x.photos.map((ph) => (ph.id === photo.id ? fn(ph) : ph)) }));
  const setItemProps = (patch: Partial<StagedItem>) =>
    setPhoto((ph) => ({ ...ph, staged: ph.staged.map((s) => (s.id === item ? { ...s, ...patch } : s)) }));

  // draw
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img || !photo) return;
    const W = Math.min(1600, img.naturalWidth);
    const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const gr = styleById(style).grade;
    g.filter = `contrast(${gr.contrast}) saturate(${gr.saturation}) sepia(${gr.warmth})`;
    g.drawImage(img, 0, 0, W, H);
    g.filter = 'none';
    if (show) drawStaged(g, W, H, photo.staged, style);
    const it = photo.staged.find((s) => s.id === item);
    if (it && show) {
      const sp = furnitureSprite(it.kind, style, it.view);
      const w = it.w * W,
        h = (sp.canvas.height / sp.canvas.width) * w;
      g.setLineDash([8, 6]);
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.strokeRect(it.x * W - w / 2, it.y * H - h, w, h);
      g.setLineDash([]);
    }
  }, [img, photo, style, item, show]);

  if (!photo) return <p className="muted">לא הועלו תמונות.</p>;

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };
  const hit = (x: number, y: number) => {
    const c = canvas.current!;
    const sorted = [...photo.staged].sort((a, b) => (a.kind === 'rug' ? -1 : b.kind === 'rug' ? 1 : a.y - b.y)).reverse();
    for (const s of sorted) {
      const sp = furnitureSprite(s.kind, style, s.view);
      const hw = s.w / 2;
      const hh = ((sp.canvas.height / sp.canvas.width) * s.w * c.width) / c.height;
      if (x > s.x - hw && x < s.x + hw && y > s.y - hh && y < s.y) return s;
    }
    return null;
  };

  const add = (kind: FurnitureKind) => {
    const s: StagedItem = { id: uid(), kind, view: 0, x: 0.5, y: 0.85, w: kind === 'plant' || kind === 'floorLamp' ? 0.1 : kind === 'nightstand' ? 0.09 : 0.3 };
    setPhoto((ph) => ({ ...ph, staged: [...ph.staged, s] }));
    setItem(s.id);
    setShow(true);
  };

  const cur = photo.staged.find((s) => s.id === item);

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">{p.planBlobId ? 'שלב 5' : 'שלב 4'} · הלבשה וירטואלית</div>
          <h1>הלבשת התמונות</h1>
          <p>
            מתחילים מ"הצעת מעצב" לפי סוג החדר, ומזיזים כל פריט למקום. גוררים כדי להזיז, משנים גודל וזווית בצד. כל הפריטים בסגנון {styleById(style).name}.
          </p>
        </div>
      </div>

      <div className="photolayout">
        <div className="plist-v">
          {p.photos.map((ph, i) => (
            <button
              key={ph.id}
              className={ph.id === photo.id ? 'on' : ''}
              style={{ backgroundImage: urls[ph.id] ? `url(${urls[ph.id]})` : undefined }}
              onClick={() => {
                setSel(ph.id);
                setItem(null);
              }}
            >
              <span>
                {i + 1}. {ph.caption || ROOM_TYPES.find((r) => r.id === ph.roomType)?.name}
                {ph.staged.length ? ` · ${ph.staged.length}` : ''}
              </span>
            </button>
          ))}
        </div>

        <div>
          <div className="toolbar">
            <button
              className="btn sm"
              onClick={() => {
                const sug = SUGGEST[photo.roomType] || [];
                setPhoto((ph) => ({ ...ph, staged: sug.map((s) => ({ ...s, id: uid() })) }));
                setItem(null);
                setShow(true);
              }}
            >
              <Icon name="wand" /> הצעת מעצב לחדר
            </button>
            <button className="btn ghost sm" onClick={() => setPhoto((ph) => ({ ...ph, staged: [] }))} disabled={!photo.staged.length}>
              ניקוי
            </button>
            <span className="spacer" />
            <Switch on={show} onChange={setShow}>
              לפני / אחרי
            </Switch>
          </div>
          <div
            className="stage"
            onPointerDown={(e) => {
              if (!show) return;
              const [x, y] = pos(e);
              const s = hit(x, y);
              setItem(s?.id || null);
              if (s) {
                drag.current = { id: s.id, dx: x - s.x, dy: y - s.y };
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const [x, y] = pos(e);
              const d = drag.current;
              setPhoto((ph) => ({
                ...ph,
                staged: ph.staged.map((s) => (s.id === d.id ? { ...s, x: Math.max(0, Math.min(1, x - d.dx)), y: Math.max(0.05, Math.min(1.1, y - d.dy)) } : s)),
              }));
            }}
            onPointerUp={() => (drag.current = null)}
          >
            <canvas ref={canvas} />
          </div>
          <div className="grid2" style={{ marginTop: 16 }}>
            <Field label="סוג החדר בתמונה">
              <select className="select" value={photo.roomType} onChange={(e) => setPhoto((ph) => ({ ...ph, roomType: e.target.value as RoomType }))}>
                {ROOM_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="כיתוב בסרטון (לא חובה)">
              <input className="input" value={photo.caption} placeholder="למשל: סלון עם יציאה למרפסת" onChange={(e) => setPhoto((ph) => ({ ...ph, caption: e.target.value }))} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn ghost sm"
              disabled={p.photos[0].id === photo.id}
              onClick={() =>
                update((x) => {
                  const i = x.photos.findIndex((y) => y.id === photo.id);
                  const a = [...x.photos];
                  [a[i - 1], a[i]] = [a[i], a[i - 1]];
                  return { ...x, photos: a };
                })
              }
            >
              הקדמה בסדר
            </button>
            <button
              className="btn ghost sm"
              disabled={p.photos[p.photos.length - 1].id === photo.id}
              onClick={() =>
                update((x) => {
                  const i = x.photos.findIndex((y) => y.id === photo.id);
                  const a = [...x.photos];
                  [a[i + 1], a[i]] = [a[i], a[i + 1]];
                  return { ...x, photos: a };
                })
              }
            >
              דחייה בסדר
            </button>
          </div>
        </div>

        <div>
          {cur ? (
            <section className="panel">
              <header>
                <h3>{FURNITURE_NAMES[cur.kind]}</h3>
                <span className="spacer" />
                <button
                  className="x"
                  title="הסרה"
                  onClick={() => {
                    setPhoto((ph) => ({ ...ph, staged: ph.staged.filter((s) => s.id !== cur.id) }));
                    setItem(null);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </header>
              <div className="in stack">
                <Range label="גודל" value={Math.round(cur.w * 100)} min={4} max={90} fmt={(v) => v + '%'} onChange={(v) => setItemProps({ w: v / 100 })} />
                <div>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    זווית
                  </div>
                  <Seg
                    value={String(cur.view) as '0' | '1' | '2'}
                    onChange={(v) => setItemProps({ view: Number(v) as 0 | 1 | 2 })}
                    options={[
                      { id: '2', label: 'שמאלה' },
                      { id: '0', label: 'חזית' },
                      { id: '1', label: 'ימינה' },
                    ]}
                  />
                </div>
                <button className="btn ghost sm" onClick={() => setItem(null)}>
                  סיום עריכה
                </button>
              </div>
            </section>
          ) : (
            <section className="panel">
              <header>
                <h3>הוספת פריט</h3>
              </header>
              <div className="in">
                <div className="fgrid">
                  {KINDS.map((k) => (
                    <button key={k} onClick={() => add(k)}>
                      <Thumb kind={k} style={style} />
                      {FURNITURE_NAMES[k]}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            ההלבשה היא סקיצת המחשה. בסרטון מופיעה הערה שהריהוט אינו כלול בנכס.
          </p>
        </div>
      </div>

      <div className="step-foot">
        <button className="btn" onClick={next}>
          לסיור
        </button>
      </div>
    </>
  );
}
