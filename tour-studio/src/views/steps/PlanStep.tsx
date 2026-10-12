import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Range, useToast } from '../../components/ui';
import { loadImage, uid } from '../../lib/db';
import { autoRooms, classifyOpening, regionAt, roomRectAt, type OpeningKind, type PlanModel, type Raster } from '../../lib/plan';
import { autoTunePlan, getRaster, modelFor } from '../../lib/project';
import { ROOM_TYPES, roomName } from '../../lib/styles';
import type { PlanRoom, PlanSettings, RoomType } from '../../lib/types';
import type { StepProps } from '../ProjectView';

const OPENING_COLORS: Record<OpeningKind, string> = {
  door: '#4f8a4a',
  passage: '#c2a14a',
  window: '#3f7fc4',
  slider: '#2aa6a6',
  entry: '#b0478f',
};
const OPENING_NAMES: Record<OpeningKind, string> = { door: 'דלת', passage: 'מעבר', window: 'חלון', slider: 'ויטרינה', entry: 'כניסה' };

const ROOM_COLORS = ['#c9a36b', '#7f9a7a', '#8aa0b8', '#b88a8a', '#a59ac2', '#c2b37a', '#7fb0ad', '#b9927a', '#9aa37f', '#c7a0b8'];

type Mode = 'view' | 'add' | 'calibrate';

export default function PlanStep({ p, update, next }: StepProps) {
  const [raster, setRaster] = useState<Raster | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [model, setModel] = useState<PlanModel | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [addType, setAddType] = useState<RoomType>('bedroom');
  const [cal, setCal] = useState<{ a?: [number, number]; b?: [number, number] }>({});
  const [calLen, setCalLen] = useState('');
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const toast = useToast();
  const [zoom, setZoom] = useState(1);
  const [tuning, setTuning] = useState<number | null>(null);
  const history = useRef<PlanSettings[]>([]);
  const s = p.plan;

  useEffect(() => {
    if (!p.planBlobId) return;
    getRaster(p.planBlobId).then(setRaster);
    loadImage(p.planBlobId).then(setImg);
  }, [p.planBlobId]);

  // analysis (debounced)
  const analysisKey = s ? JSON.stringify([s.threshold, s.minWall, s.doorGap, s.pxPerM, s.rooms.map((r) => r.rect || 0)]) : '';
  useEffect(() => {
    if (!raster || !s || !p.planBlobId) return;
    const t = setTimeout(() => setModel(modelFor(p.planBlobId!, raster, s)), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raster, analysisKey]);

  const setPlan = (fn: (s: PlanSettings) => PlanSettings) =>
    update((x) => {
      if (!x.plan) return x;
      history.current = [...history.current.slice(-29), x.plan];
      return { ...x, plan: fn(x.plan) };
    });
  const undo = () => {
    const prev = history.current.pop();
    if (prev) update((x) => ({ ...x, plan: prev }));
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const retune = async () => {
    if (!raster) return;
    setTuning(0);
    const next = await autoTunePlan(raster, p.details.sqm, p.details.rooms, setTuning);
    setTuning(null);
    setPlan(() => next);
    toast(`הקריאה עודכנה · ${next.rooms.length} חללים`);
  };

  // label → room index (for colours/areas)
  const roomRegions = useMemo(() => {
    if (!model || !s) return new Map<string, { label: number; area: number } | null>();
    const m = new Map<string, { label: number; area: number } | null>();
    for (const r of s.rooms) {
      const reg = regionAt(model, r.sx, r.sy);
      m.set(r.id, reg ? { label: reg.label, area: reg.areaM2 } : null);
    }
    return m;
  }, [model, s]);

  // draw overlay
  useEffect(() => {
    const c = canvas.current;
    if (!c || !raster || !img) return;
    c.width = raster.w;
    c.height = raster.h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 0.5;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.globalAlpha = 1;
    if (!model || !s) return;
    const colorOf = new Map<number, [number, number, number]>();
    s.rooms.forEach((r, i) => {
      const reg = roomRegions.get(r.id);
      if (reg && !colorOf.has(reg.label)) {
        const hex = ROOM_COLORS[i % ROOM_COLORS.length];
        colorOf.set(reg.label, [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
      }
    });
    const data = g.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    for (let i = 0; i < model.w * model.h; i++) {
      const j = i * 4;
      if (model.wall[i]) {
        d[j] = 30;
        d[j + 1] = 28;
        d[j + 2] = 25;
        d[j + 3] = 255;
      } else if (model.labels[i]) {
        const col = colorOf.get(model.labels[i]);
        const [r, gg, b] = col || [190, 186, 178];
        const a = col ? 0.42 : 0.25;
        d[j] = d[j] * (1 - a) + r * a;
        d[j + 1] = d[j + 1] * (1 - a) + gg * a;
        d[j + 2] = d[j + 2] * (1 - a) + b * a;
      }
    }
    g.putImageData(data, 0, 0);
    // doors and windows the reader found
    const balconyLabels = new Set<number>();
    s.rooms.forEach((r) => {
      if (r.type !== 'balcony') return;
      const reg = roomRegions.get(r.id);
      if (reg) balconyLabels.add(reg.label);
    });
    g.lineWidth = Math.max(2, raster.w / 350);
    for (const o of model.openings) {
      const k = classifyOpening(o, (l) => balconyLabels.has(l));
      g.fillStyle = OPENING_COLORS[k];
      g.globalAlpha = 0.85;
      g.fillRect(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
      g.globalAlpha = 1;
    }
    // calibration line
    if (cal.a) {
      g.strokeStyle = '#8a5a3b';
      g.fillStyle = '#8a5a3b';
      g.lineWidth = Math.max(2, raster.w / 400);
      g.beginPath();
      g.arc(cal.a[0], cal.a[1], g.lineWidth * 2, 0, Math.PI * 2);
      g.fill();
      if (cal.b) {
        g.beginPath();
        g.moveTo(cal.a[0], cal.a[1]);
        g.lineTo(cal.b[0], cal.b[1]);
        g.stroke();
        g.beginPath();
        g.arc(cal.b[0], cal.b[1], g.lineWidth * 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, [raster, img, model, s, roomRegions, cal]);

  if (!s || !p.planBlobId) return <p className="muted">לא הועלתה תוכנית.</p>;

  const toRaster = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height] as [number, number];
  };

  const addRoom = (x: number, y: number, rect?: PlanRoom['rect']) => {
    const room: PlanRoom = { id: uid(), type: addType, name: '', sx: x, sy: y, rect };
    setPlan((pl) => ({ ...pl, rooms: [...pl.rooms, room] }));
    setMode('view');
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode !== 'add' || !model) return;
    const [x, y] = toRaster(e);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = toRaster(e);
    setDrag({ ...drag, x1: x, y1: y });
  };

  const onUp = (e: React.PointerEvent) => {
    if (!model || !raster) return;
    const [x, y] = toRaster(e);
    if (mode === 'add' && drag) {
      setDrag(null);
      const rect = { x0: Math.min(drag.x0, x), y0: Math.min(drag.y0, y), x1: Math.max(drag.x0, x), y1: Math.max(drag.y0, y) };
      const minPx = model.pxPerM * 0.8;
      if (rect.x1 - rect.x0 > minPx && rect.y1 - rect.y0 > minPx) {
        addRoom((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, rect);
        return;
      }
      if (regionAt(model, x, y)) return addRoom(x, y);
      const found = roomRectAt(raster, model, s, x, y);
      if (found) {
        addRoom((found.x0 + found.x1) / 2, (found.y0 + found.y1) / 2, found);
        toast('החדר זוהה לפי הקירות סביבו');
        return;
      }
      toast('לא מצאתי קירות סגורים סביב הנקודה. גררו מלבן על שטח החדר.');
    } else if (mode === 'calibrate') {
      if (!cal.a || cal.b) setCal({ a: [x, y] });
      else setCal({ ...cal, b: [x, y] });
    }
  };

  const applyCal = () => {
    const m = parseFloat(calLen.replace(',', '.'));
    if (!cal.a || !cal.b || !m) return;
    const px = Math.hypot(cal.b[0] - cal.a[0], cal.b[1] - cal.a[1]);
    setPlan((pl) => ({ ...pl, pxPerM: px / m, calibrated: true }));
    setCal({});
    setCalLen('');
    setMode('view');
    toast('קנה המידה עודכן');
  };

  const total = [...roomRegions.values()].reduce((sum, r) => sum + (r?.area || 0), 0);
  const unknownPins = s.rooms.filter((r) => !roomRegions.get(r.id)).length;

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">שלב 4</div>
          <h1>קריאת התוכנית</h1>
          <p>
            המערכת זיהתה את הקירות (בשחור) ואת החללים (בצבע). בדקו שכל חדר מסומן נכון — סוג החדר קובע איזה ריהוט יוצב בו. אם חדרים "נשפכים" זה לזה, הגדילו את רוחב
            הפתחים.
          </p>
        </div>
      </div>

      <div className="planlayout">
        <div>
          <div className="toolbar">
            <div className="seg">
              <button className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>
                תצוגה
              </button>
              <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>
                סימון חדר
              </button>
              <button
                className={mode === 'calibrate' ? 'on' : ''}
                onClick={() => {
                  setMode('calibrate');
                  setCal({});
                }}
              >
                כיול קנה מידה
              </button>
            </div>
            {mode === 'add' && (
              <select className="select" style={{ width: 170, height: 34 }} value={addType} onChange={(e) => setAddType(e.target.value as RoomType)}>
                {ROOM_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <span className="spacer" />
            <div className="seg" title="זום">
              <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1}>
                −
              </button>
              <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.5))}>+</button>
            </div>
            <button className="btn ghost sm" onClick={undo} title="ביטול פעולה (Ctrl+Z)">
              ביטול
            </button>
            <span className="small muted" style={{ flexBasis: '100%' }}>
              {mode === 'add' && 'לחצו בתוך החדר, או גררו מלבן על שטח החדר'}
              {mode === 'calibrate' && !cal.b && 'לחצו על שתי נקודות שהמרחק ביניהן ידוע (למשל קו מידה)'}
            </span>
          </div>
          {mode === 'calibrate' && cal.b && (
            <div className="notice row" style={{ marginBottom: 12 }}>
              <span>המרחק בין הנקודות במציאות:</span>
              <input className="input" style={{ width: 90, height: 32 }} autoFocus value={calLen} onChange={(e) => setCalLen(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyCal()} />
              <span>מטר</span>
              <button className="btn sm" onClick={applyCal}>
                עדכון
              </button>
            </div>
          )}
          <div className="planscroll">
          <div
            className={'planstage' + (mode !== 'view' ? ' adding' : '')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{ touchAction: mode === 'view' ? 'auto' : 'none', width: `${zoom * 100}%` }}
          >
            <canvas ref={canvas} />
            {drag && raster && (
              <span
                className="dragrect"
                style={{
                  left: `${(Math.min(drag.x0, drag.x1) / raster.w) * 100}%`,
                  top: `${(Math.min(drag.y0, drag.y1) / raster.h) * 100}%`,
                  width: `${(Math.abs(drag.x1 - drag.x0) / raster.w) * 100}%`,
                  height: `${(Math.abs(drag.y1 - drag.y0) / raster.h) * 100}%`,
                }}
              />
            )}
            {raster &&
              s.rooms.map((r, i) => (
                <span key={r.id} className="pin" style={{ right: `${100 - (r.sx / raster.w) * 100}%`, top: `${(r.sy / raster.h) * 100}%`, background: ROOM_COLORS[i % ROOM_COLORS.length] }}>
                  <i>{i + 1}</i>
                  {r.name || roomName(r.type)}
                </span>
              ))}
          </div>
          </div>
          <div className="planlegend">
            <span>
              <i style={{ background: '#1e1c19' }} /> קיר
            </span>
            {(Object.keys(OPENING_NAMES) as OpeningKind[]).map((k) => (
              <span key={k}>
                <i style={{ background: OPENING_COLORS[k] }} /> {OPENING_NAMES[k]}
              </span>
            ))}
            <span className="spacer" />
            {model && <span>{model.openings.length} פתחים זוהו</span>}
          </div>
        </div>

        <div>
          <section className="panel">
            <header>
              <h3>חדרים</h3>
              <span className="spacer" />
              <button
                className="btn quiet sm"
                onClick={() => {
                  if (!model) return;
                  setPlan((pl) => ({ ...pl, rooms: autoRooms(model, p.details.rooms) }));
                  toast('החדרים זוהו מחדש');
                }}
              >
                <Icon name="wand" /> זיהוי מחדש
              </button>
            </header>
            {s.rooms.length === 0 ? (
              <div className="in small muted">לא סומנו חדרים. השתמשו ב"סימון חדר" או ב"זיהוי מחדש".</div>
            ) : (
              <ul className="roomlist">
                {s.rooms.map((r, i) => {
                  const reg = roomRegions.get(r.id);
                  return (
                    <li key={r.id}>
                      <span className="n" style={{ color: ROOM_COLORS[i % ROOM_COLORS.length] }}>
                        {i + 1}
                      </span>
                      <select
                        className="select"
                        value={r.type}
                        onChange={(e) =>
                          setPlan((pl) => ({ ...pl, rooms: pl.rooms.map((x) => (x.id === r.id ? { ...x, type: e.target.value as RoomType, name: '' } : x)) }))
                        }
                      >
                        {ROOM_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <span className="a">{reg ? `${reg.area.toFixed(1)} מ״ר` : '—'}</span>
                      <button className="x" title="הסרה" onClick={() => setPlan((pl) => ({ ...pl, rooms: pl.rooms.filter((x) => x.id !== r.id) }))}>
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {s.rooms.length > 0 && (
              <div className="in small muted" style={{ borderTop: '1px solid var(--line)' }}>
                סה״כ שטח מסומן: <b style={{ color: 'var(--ink)' }}>{total.toFixed(0)} מ״ר</b>
                {p.details.sqm ? ` (מוצהר: ${p.details.sqm} מ״ר)` : ''}
                {unknownPins > 0 && <div style={{ color: 'var(--danger)', marginTop: 4 }}>{unknownPins} סימונים לא נמצאים בתוך חדר</div>}
              </div>
            )}
          </section>

          <section className="panel">
            <header>
              <h3>כיוונון קריאה</h3>
              <span className="spacer" />
              <button className="btn quiet sm" onClick={retune} disabled={tuning !== null}>
                <Icon name="wand" /> {tuning !== null ? `בודק… ${Math.round(tuning * 100)}%` : 'קריאה אוטומטית'}
              </button>
            </header>
            <div className="in stack">
              <Range label="רגישות לקווים כהים" value={s.threshold} min={40} max={220} onChange={(v) => setPlan((pl) => ({ ...pl, threshold: v }))} />
              <Range
                label="עובי קיר מינימלי"
                value={s.minWall}
                min={2}
                max={24}
                fmt={(v) => `${((v / s.pxPerM) * 100).toFixed(0)} ס״מ`}
                onChange={(v) => setPlan((pl) => ({ ...pl, minWall: v }))}
              />
              <Range
                label="רוחב פתח להפרדת חדרים"
                value={s.doorGap}
                min={0.5}
                max={2}
                step={0.05}
                fmt={(v) => `${v.toFixed(2)} מ׳`}
                onChange={(v) => setPlan((pl) => ({ ...pl, doorGap: v }))}
              />
              <div className="small muted">
                אם הקירות בתוכנית אפורים ולא מזוהים — הגדילו את הרגישות.
                <br />
                קנה מידה: {s.pxPerM.toFixed(1)} פיקסלים למטר {s.calibrated ? '· מכויל ידנית' : '· הוערך לפי שטח הדירה'}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="step-foot">
        <button className="btn" onClick={next} disabled={!s.rooms.length}>
          {p.photos.length ? 'המשך להלבשת התמונות' : 'בניית הסיור'}
        </button>
      </div>
    </>
  );
}
