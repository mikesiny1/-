import { useEffect, useMemo, useRef, useState } from 'react';
import PhotoPlayer from '../../components/PhotoPlayer';
import { fmtTime, Icon, Seg, Switch, useToast } from '../../components/ui';
import { useEngine } from '../../components/useEngine';
import { formatILS, stagingPlan } from '../../lib/designer';
import { STYLES, styleById } from '../../lib/styles';
import type { DesignBrief, RoomType } from '../../lib/types';
import type { FrameInfo, Mode } from '../../three/engine';
import type { StepProps } from '../ProjectView';

type Chapter = { name: string; area: number; t0: number; t1: number };

export function Viewer3D({ p, initialMode = 'tour' }: { p: StepProps['p']; initialMode?: Mode }) {
  const box = useRef<HTMLDivElement>(null);
  const { engine, ready, error } = useEngine(box, p);
  const [f, setF] = useState<FrameInfo | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [playing, setPlaying] = useState(false);
  const [hq, setHq] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  useEffect(() => {
    if (engine) setHq(engine.hq);
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    let last = 0;
    let dur = -1;
    engine.onFrame = (info) => {
      const now = performance.now();
      if (now - last < 60 && info.labels === undefined) return;
      last = now;
      if (info.duration !== dur) {
        dur = info.duration;
        setChapters(engine.chapters());
      }
      setF(info);
      setPlaying(engine.playing);
    };
    return () => {
      engine.onFrame = null;
    };
  }, [engine]);

  useEffect(() => {
    if (engine && ready && initialMode !== 'tour') engine.setMode(initialMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, ready]);

  const t = f?.t || 0;
  const switchMode = (m: Mode) => {
    setMode(m);
    engine?.setMode(m);
  };

  return (
    <>
      <div className="toolbar">
        <Seg
          value={mode}
          onChange={switchMode}
          options={[
            {
              id: 'tour',
              label: (
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="film" /> סיור מודרך
                </span>
              ),
            },
            {
              id: 'walk',
              label: (
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="walk" /> הליכה חופשית
                </span>
              ),
            },
            {
              id: 'doll',
              label: (
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="cube" /> תצוגת בובות
                </span>
              ),
            },
          ]}
        />
        <span className="spacer" />
        <Seg
          value={hq ? 'hq' : 'fast'}
          onChange={(v) => {
            setHq(v === 'hq');
            if (engine) engine.hq = v === 'hq';
          }}
          options={[
            { id: 'hq', label: 'איכות מלאה' },
            { id: 'fast', label: 'מהיר' },
          ]}
        />
      </div>
      <div className="viewer">
        <div className="gl" ref={box} />
        {error && <div className="hint">{error}</div>}
        {!ready && !error && <div className="hint">בונה את הדירה…</div>}
        {mode === 'tour' && f && <div className="fade" style={{ opacity: f.fade }} />}
        {mode !== 'doll' && f?.room && (
          <div className="roomtag" key={f.room}>
            {mode === 'tour' && chapters.length > 0 && (
              <span className="num">
                {String(Math.max(1, chapters.findIndex((c) => t >= c.t0 && t < c.t1) + 1)).padStart(2, '0')} /{' '}
                {String(chapters.length).padStart(2, '0')}
              </span>
            )}
            <b>{f.room}</b>
            {f.area > 1 && <span>כ-{Math.round(f.area)} מ״ר</span>}
          </div>
        )}
        {mode === 'doll' &&
          f?.labels?.map((l, i) => (
            <span key={i} className="lbl" style={{ right: `calc(100% - ${l.x}px)`, top: l.y }}>
              {l.name}
              <i>{Math.round(l.area)} מ״ר</i>
            </span>
          ))}
        {mode === 'walk' && (
          <>
            <div className="hint">גררו כדי להסתכל · לחצו על הרצפה כדי ללכת · מקשי החצים</div>
            <div className="walkpad">
              <span />
              <button onClick={() => engine?.nudge(1, 0)} aria-label="קדימה">
                ↑
              </button>
              <span />
              <button onClick={() => engine?.nudge(0, 1)} aria-label="שמאלה">
                ↶
              </button>
              <button onClick={() => engine?.nudge(-1, 0)} aria-label="אחורה">
                ↓
              </button>
              <button onClick={() => engine?.nudge(0, -1)} aria-label="ימינה">
                ↷
              </button>
            </div>
          </>
        )}
        {mode === 'tour' && (
          <div className="vbar">
            <div className="vrow">
              <button
                className="pp"
                onClick={() => {
                  if (!engine) return;
                  if (engine.playing) engine.pause();
                  else engine.play();
                  setPlaying(engine.playing);
                }}
                aria-label={playing ? 'השהיה' : 'ניגון'}
              >
                <Icon name={playing ? 'pause' : 'play'} />
              </button>
              <div className="track">
                <input
                  type="range"
                  min={0}
                  max={f?.duration || 1}
                  step={0.01}
                  value={t}
                  onChange={(e) => engine?.seek(Number(e.target.value))}
                  aria-label="מיקום בסיור"
                  style={{ direction: 'ltr', ['--p' as string]: `${(t / (f?.duration || 1)) * 100}%` }}
                />
              </div>
              <span className="time">
                {fmtTime(t)} / {fmtTime(f?.duration || 0)}
              </span>
            </div>
            {chapters.length > 1 && (
              <nav className="chapters" aria-label="חדרים בסיור">
                {chapters.map((c, i) => {
                  const on = t >= c.t0 && t < c.t1;
                  return (
                    <button key={i} className={on ? 'on' : ''} aria-current={on ? 'true' : undefined} onClick={() => engine?.seek(c.t0 + 0.05)}>
                      <b>{c.name}</b>
                      <span>
                        {fmtTime(c.t0)}
                        {c.area > 1 ? ` · ${Math.round(c.area)} מ״ר` : ''}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function TourStep({ p, update, next }: StepProps) {
  const has3d = !!(p.planBlobId && p.plan?.rooms.length);
  const [view, setView] = useState<'3d' | 'photos'>(has3d ? '3d' : 'photos');
  const toast = useToast();
  const b = p.design;
  const set = <K extends keyof DesignBrief>(k: K, v: DesignBrief[K]) => update((x) => ({ ...x, design: { ...x.design, [k]: v } }));
  const s = styleById(b.style);

  const roomTypes: RoomType[] = useMemo(
    () => (has3d ? p.plan!.rooms.map((r) => r.type) : p.photos.map((ph) => ph.roomType)),
    [has3d, p.plan, p.photos],
  );
  const plan = stagingPlan(roomTypes, b);

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">הסיור הווירטואלי</div>
          <h1>הדירה, חדר אחר חדר</h1>
          <p>אפשר לשנות סגנון, להדליק ולכבות את הריהוט ולעבור לאור ערב — הכול מתעדכן בזמן אמת, גם תוך כדי הסיור.</p>
        </div>
        <span className="spacer" />
        {has3d && p.photos.length > 0 && (
          <Seg
            value={view}
            onChange={setView}
            options={[
              { id: '3d', label: 'סיור תלת-ממד' },
              { id: 'photos', label: 'סיור תמונות' },
            ]}
          />
        )}
      </div>

      <div className="tourlayout">
        <div>{view === '3d' && has3d ? <Viewer3D p={p} /> : <PhotoPlayer p={p} />}</div>

        <div>
          <section className="panel">
            <header>
              <h3>עיצוב בזמן הסיור</h3>
            </header>
            <div className="in stack">
              <Switch on={b.furnish} onChange={(v) => set('furnish', v)}>
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="sofa" /> {b.furnish ? 'הדירה מרוהטת' : 'הדירה ריקה'}
                </span>
              </Switch>
              <div>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  סגנון ריהוט
                </div>
                <div className="chips">
                  {STYLES.map((st) => (
                    <button key={st.id} className={'chip' + (st.id === b.style ? ' on' : '')} onClick={() => set('style', st.id)}>
                      <i style={{ background: st.fabricAlt }} />
                      {st.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  הנוף מהחלונות
                </div>
                <Seg
                  value={b.view || 'nature'}
                  onChange={(v) => set('view', v)}
                  options={[
                    { id: 'nature', label: 'טבע' },
                    { id: 'sea', label: 'ים' },
                    { id: 'city', label: 'עיר' },
                  ]}
                />
              </div>
              <div className="row">
                <Seg
                  value={b.light}
                  onChange={(v) => set('light', v)}
                  options={[
                    {
                      id: 'day',
                      label: (
                        <span className="row" style={{ gap: 6 }}>
                          <Icon name="sun" /> יום
                        </span>
                      ),
                    },
                    {
                      id: 'evening',
                      label: (
                        <span className="row" style={{ gap: 6 }}>
                          <Icon name="moon" /> ערב
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </section>

          {b.furnish && (
            <section className="panel">
              <header>
                <h3>הערות המעצב</h3>
              </header>
              <div className="in" style={{ paddingBottom: 0 }}>
                <div className="palette">
                  {[s.wall, s.floorTone, s.wood, s.fabric, s.fabricAlt, s.accent].map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </div>
                <p className="small" style={{ color: 'var(--ink-2)' }}>
                  {plan.household}
                </p>
              </div>
              <ul className="notes">
                {plan.lines.map((l, i) => (
                  <li key={i}>
                    <div className="h">
                      {l.room}
                      <span>{formatILS(l.cost)}</span>
                    </div>
                    <div className="items">{l.items.join(' · ')}</div>
                    {l.tip && <div className="tip">{l.tip}</div>}
                  </li>
                ))}
              </ul>
              <div className="total">
                <span>הערכת הלבשה פיזית</span>
                <span>{formatILS(plan.total)}</span>
              </div>
              <div className="in small muted" style={{ paddingTop: 0 }}>
                טווח משוער לרכישת ריהוט ברמת "{['חסכוני', 'בינוני', 'פרימיום'][['smart', 'mid', 'premium'].indexOf(b.budget)]}". לא כולל הובלה והתקנה.
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="step-foot">
        <button
          className="btn"
          onClick={() => {
            update((x) => ({ ...x, status: x.status === 'sent' ? 'sent' : 'ready' }));
            toast('הסיור סומן כמוכן לפרסום');
            next();
          }}
        >
          הסיור מוכן — לפרסום ושליחה
        </button>
      </div>
    </>
  );
}
