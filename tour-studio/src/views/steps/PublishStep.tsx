import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrand } from '../../App';
import { loadPhotoImages } from '../../components/PhotoPlayer';
import { Icon, Seg, Switch, fmtDate, useToast } from '../../components/ui';
import { useEngine } from '../../components/useEngine';
import { captions, mailLink, waLink } from '../../lib/captions';
import { blobUrl, loadImage, putBlob } from '../../lib/db';
import { download, FORMATS, record, slug, type Format } from '../../lib/exporter';
import { drawCover, drawOverlays } from '../../lib/overlay';
import { PhotoTour } from '../../lib/photoTour';
import { renderReel } from '../../lib/reel';
import { styleById } from '../../lib/styles';
import type { ShareLog } from '../../lib/types';
import type { StepProps } from '../ProjectView';

function Caption({ title, text, onCopy }: { title: string; text: string; onCopy: () => void }) {
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <div className="caption">
      <header>
        <b>{title}</b>
        <button
          className="btn quiet sm"
          onClick={() => {
            navigator.clipboard?.writeText(v);
            onCopy();
          }}
        >
          <Icon name="copy" /> העתקה
        </button>
      </header>
      <textarea value={v} onChange={(e) => setV(e.target.value)} />
    </div>
  );
}

export default function PublishStep({ p, update }: StepProps) {
  const { brand } = useBrand();
  const toast = useToast();
  const has3d = !!(p.planBlobId && p.plan?.rooms.length);
  const [source, setSource] = useState<'3d' | 'photos'>(has3d ? '3d' : 'photos');
  const [fmt, setFmt] = useState<Format>(FORMATS[0]);
  const [kind, setKind] = useState<'tour' | 'ramp'>('tour');
  const [extUrl, setExtUrl] = useState<string | null>(null);
  useEffect(() => {
    blobUrl(p.exterior?.blobId).then(setExtUrl);
  }, [p.exterior?.blobId]);
  const [quality, setQuality] = useState<'hd' | 'fast'>('hd');
  const [music, setMusic] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<{ url: string; blob: Blob; mime: string } | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const hidden = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLCanvasElement>(null);
  const cancel = useRef({ cancelled: false });
  const { engine, ready } = useEngine(hidden, p, source === '3d' && has3d);
  const cap = useMemo(() => captions(p, brand), [p, brand]);
  useEffect(() => {
    if (engine) engine.idle = true;
  }, [engine]);

  useEffect(() => {
    blobUrl(p.coverBlobId).then(setCoverUrl);
  }, [p.coverBlobId]);

  const dims = () => {
    const k = quality === 'hd' ? 1 : 2 / 3;
    return { W: Math.round((fmt.w * k) / 2) * 2, H: Math.round((fmt.h * k) / 2) * 2 };
  };

  const log = (channel: ShareLog['channel'], note: string, sent = false) =>
    update((x) => ({ ...x, shares: [...x.shares, { at: Date.now(), channel, note }], status: sent ? 'sent' : x.status }));

  const produceRamp = async () => {
    if (!engine || !ready) return setErr('המודל עדיין נבנה, נסו שוב בעוד רגע.');
    const path = engine.buildReel();
    if (!path) return setErr('לא נמצאו חדרים לסרטון. בדקו את שלב קריאת התוכנית.');
    const img = p.exterior ? await loadImage(p.exterior.blobId) : null;
    const k = quality === 'hd' ? 1 : 2 / 3;
    const W = Math.round((1080 * k) / 2) * 2,
      H = Math.round((1920 * k) / 2) * 2;
    cancel.current = { cancelled: false };
    setProgress(0);
    try {
      const res = await renderReel({
        engine,
        path,
        exterior: img && p.exterior ? { img, x: p.exterior.x, y: p.exterior.y } : null,
        W,
        H,
        out: out.current!,
        onProgress: setProgress,
        signal: cancel.current,
        overlay: (g, t, dur) => {
          // the property and the agent, quietly, on the closing frame
          const a = Math.max(0, Math.min(1, (t - (dur - 0.45)) / 0.3));
          if (a <= 0) return;
          const s = W / 1080;
          g.save();
          g.globalAlpha = a;
          const grad = g.createLinearGradient(0, H * 0.72, 0, H);
          grad.addColorStop(0, 'rgba(10,11,12,0)');
          grad.addColorStop(1, 'rgba(10,11,12,0.78)');
          g.fillStyle = grad;
          g.fillRect(0, H * 0.72, W, H * 0.28);
          g.fillStyle = '#f4f2ee';
          g.textAlign = 'right';
          g.direction = 'rtl';
          g.font = `300 ${Math.round(58 * s)}px 'IBM Plex Sans Hebrew', sans-serif`;
          g.fillText(p.details.title || 'הדירה', W - 64 * s, H - 190 * s);
          g.font = `400 ${Math.round(32 * s)}px 'IBM Plex Sans Hebrew', sans-serif`;
          const line = [[p.details.address, p.details.city].filter(Boolean).join(', '), p.details.price ? `${p.details.price} ₪` : '']
            .filter(Boolean)
            .join(' · ');
          g.fillText(line, W - 64 * s, H - 136 * s);
          const agent = [brand.agencyName, brand.agentName, brand.agentPhone].filter(Boolean).join(' · ');
          if (agent) {
            g.fillStyle = '#d9c9a3';
            g.font = `500 ${Math.round(28 * s)}px 'IBM Plex Sans Hebrew', sans-serif`;
            g.fillText(agent, W - 64 * s, H - 84 * s);
          }
          g.restore();
        },
      });
      if (res) {
        setVideo({ url: URL.createObjectURL(res.blob), blob: res.blob, mime: res.mime });
        update((x) => ({ ...x, status: x.status === 'sent' ? 'sent' : 'ready' }));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const produce = async () => {
    setErr('');
    setVideo(null);
    if (kind === 'ramp') return produceRamp();
    const c = out.current!;
    const { W, H } = dims();
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const logo = await loadImage(brand.logoBlobId);
    const st = { room: '', changed: 0 };
    cancel.current = { cancelled: false };
    let duration = 0;
    let frame: (t: number) => { room: string; area: number; fade: number };
    let cleanup = () => {};

    if (source === '3d') {
      if (!engine || !ready) return setErr('המודל עדיין נבנה, נסו שוב בעוד רגע.');
      const glc = engine.beginExport(W, H);
      duration = engine.duration;
      frame = (t) => {
        const r = engine.renderAt(t);
        g.drawImage(glc, 0, 0, W, H);
        return r;
      };
      cleanup = () => engine.endExport();
    } else {
      const imgs = await loadPhotoImages(p);
      const tour = new PhotoTour(p.photos, imgs, p.design.style, p.design.furnish);
      duration = tour.duration;
      frame = (t) => ({ ...tour.draw(g, W, H, t), area: 0, fade: 0 });
    }
    if (!duration) return setErr('אין מה להפיק — חסרים חדרים או תמונות.');

    setProgress(0);
    try {
      const res = await record({
        canvas: c,
        duration,
        music,
        signal: cancel.current,
        onProgress: setProgress,
        draw: (t) => {
          const r = frame(t);
          if (r.room !== st.room) {
            st.room = r.room;
            st.changed = t;
          }
          drawOverlays(g, W, H, p, brand, { t, duration, room: r.room, area: r.area, fade: r.fade, roomChangedAt: st.changed }, logo);
        },
      });
      if (res) {
        setVideo({ url: URL.createObjectURL(res.blob), blob: res.blob, mime: res.mime });
        update((x) => ({ ...x, status: x.status === 'sent' ? 'sent' : 'ready' }));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      cleanup();
      setProgress(null);
    }
  };

  const makeCover = async () => {
    const W = 1080,
      H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    if (source === '3d' && engine && ready) {
      const glc = engine.beginExport(1080, 1350);
      engine.renderAt(5.2);
      drawCover(g, W, H, glc, glc.width, glc.height, p, brand);
      engine.endExport();
    } else {
      const imgs = await loadPhotoImages(p);
      const tour = new PhotoTour(p.photos.slice(0, 1), imgs, p.design.style, p.design.furnish);
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      tour.draw(tmp.getContext('2d')!, W, H, 0.01);
      drawCover(g, W, H, tmp, W, H, p, brand);
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const id = await putBlob(blob);
    update((x) => ({ ...x, coverBlobId: id }));
    download(blob, `${slug(p.details.title || p.details.address)}-cover.jpg`);
    log('download', 'תמונת שער');
  };

  const ext = video?.mime.includes('mp4') ? 'mp4' : 'webm';
  const fileName = `${slug(p.details.title || p.details.address)}-${kind === 'ramp' ? 'speed-ramp' : fmt.id}.${ext}`;
  const canShareFile =
    typeof navigator !== 'undefined' &&
    !!navigator.canShare &&
    !!video &&
    navigator.canShare({ files: [new File([video.blob], fileName, { type: video.blob.type })] });

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">פרסום ושליחה</div>
          <h1>מוכן לרשתות וללקוח</h1>
          <p>מפיקים סרטון ממותג בפורמט המתאים, תמונת שער וטקסטים מוכנים. את הסרטון אפשר להוריד, לשתף מהנייד או לשלוח ללקוח בוואטסאפ ובמייל.</p>
        </div>
      </div>

      <div className="publayout">
        <div className="stack">
          {has3d && p.photos.length > 0 && (
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                מקור הסרטון
              </div>
              <Seg
                value={source}
                onChange={setSource}
                options={[
                  { id: '3d', label: 'סיור תלת-ממד' },
                  { id: 'photos', label: 'סיור תמונות' },
                ]}
              />
            </div>
          )}
          {has3d && (
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                סוג הסרטון
              </div>
              <Seg
                value={kind}
                onChange={(v) => {
                  setKind(v);
                  setVideo(null);
                  if (v === 'ramp') {
                    setSource('3d');
                    setFmt(FORMATS[0]);
                  }
                }}
                options={[
                  { id: 'tour', label: 'סיור מלא' },
                  { id: 'ramp', label: 'ספיד-ראמפ מהבניין · 10 שנ׳' },
                ]}
              />
            </div>
          )}
          {kind === 'ramp' && (
            <section className="panel">
              <header>
                <h3>צילום הבניין</h3>
                <span className="spacer" />
                <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
                  <Icon name="image" /> {p.exterior ? 'החלפת תמונה' : 'העלאת תמונה'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const id = await putBlob(f);
                      update((x) => ({ ...x, exterior: { blobId: id, x: 0.5, y: 0.45 } }));
                      toast('עכשיו לחצו על החלון של הדירה בתמונה');
                    }}
                  />
                </label>
              </header>
              <div className="in stack">
                {extUrl && p.exterior ? (
                  <>
                    <div className="small muted">לחצו על החלון של הדירה. משם המצלמה נכנסת פנימה, ושם היד מצביעה.</div>
                    <div
                      className="extpick"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const x = (e.clientX - r.left) / r.width,
                          y = (e.clientY - r.top) / r.height;
                        update((q) => ({ ...q, exterior: { ...q.exterior!, x, y } }));
                      }}
                    >
                      <img src={extUrl} alt="צילום הבניין" />
                      <i style={{ left: `${p.exterior.x * 100}%`, top: `${p.exterior.y * 100}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="small muted">
                    מעלים צילום של הבניין מבחוץ ומסמנים את החלון של הדירה. הסרטון מתחיל ביד שמצביעה על החלון, טס פנימה דרכו, עובר בסלון, בחדר השינה
                    ובמטבח — וחוזר לאחור עד הבניין. בלי צילום, הסרטון מתחיל ונגמר מול חלון הסלון מבחוץ.
                  </div>
                )}
              </div>
            </section>
          )}
          {kind === 'tour' && (
            <div className="fmt">
              {FORMATS.map((f) => (
                <button key={f.id} className={f.id === fmt.id ? 'on' : ''} onClick={() => setFmt(f)}>
                  <span
                    className="shape"
                    style={{ width: (f.w / f.h) * 34 > 40 ? 40 : (f.w / f.h) * 34, height: f.w > f.h ? 40 * (f.h / f.w) : 34 }}
                  />
                  <div>
                    <b>{f.name}</b>
                    <span>{f.hint}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="row wrap" style={{ gap: 22 }}>
            <Switch on={p.design.furnish} onChange={(v) => update((x) => ({ ...x, design: { ...x.design, furnish: v } }))}>
              ריהוט {p.design.furnish ? `(${styleById(p.design.style).name})` : 'כבוי'}
            </Switch>
            <Switch on={music} onChange={setMusic}>
              מוזיקת רקע שקטה
            </Switch>
            <Seg
              value={quality}
              onChange={setQuality}
              options={[
                { id: 'hd', label: 'איכות מלאה' },
                { id: 'fast', label: 'הפקה מהירה' },
              ]}
            />
          </div>

          <div className="render" style={{ aspectRatio: kind === 'ramp' ? '9 / 16' : `${fmt.w} / ${fmt.h}`, maxHeight: 560 }}>
            <canvas ref={out} style={{ display: progress !== null ? 'block' : 'none', width: '100%', height: '100%' }} />
            {progress === null && video && <video src={video.url} controls playsInline style={{ width: '100%', height: '100%' }} />}
            {progress === null && !video && <div className="ph">הסרטון יופיע כאן. ההפקה רצה בזמן אמת — כדאי להשאיר את הלשונית פתוחה.</div>}
            {progress !== null && <div className="prog" style={{ width: `${progress * 100}%` }} />}
          </div>
          {err && (
            <div className="notice" style={{ color: 'var(--danger)' }}>
              {err}
            </div>
          )}

          <div className="row wrap">
            {progress === null ? (
              <button className="btn lg" onClick={produce} disabled={source === '3d' && !ready}>
                <Icon name="film" /> {video ? 'הפקה מחדש' : 'הפקת סרטון'}
              </button>
            ) : (
              <button className="btn lg ghost" onClick={() => (cancel.current.cancelled = true)}>
                עצירה ({Math.round(progress * 100)}%)
              </button>
            )}
            {video && progress === null && (
              <>
                <button
                  className="btn ghost lg"
                  onClick={() => {
                    download(video.blob, fileName);
                    log('download', `סרטון ${fmt.name}`);
                  }}
                >
                  <Icon name="download" /> הורדה
                </button>
                {canShareFile && (
                  <button
                    className="btn ghost lg"
                    onClick={async () => {
                      try {
                        await navigator.share({ files: [new File([video.blob], fileName, { type: video.blob.type })], text: cap.whatsapp });
                        log('share', 'שיתוף מהמכשיר', true);
                      } catch {
                        /* cancelled */
                      }
                    }}
                  >
                    <Icon name="share" /> שיתוף
                  </button>
                )}
              </>
            )}
            <button className="btn quiet" onClick={makeCover}>
              <Icon name="image" /> תמונת שער
            </button>
          </div>
          {video && !video.mime.includes('mp4') && (
            <p className="small muted">הדפדפן הפיק קובץ WebM. לאינסטגרם ולוואטסאפ עדיף MP4 — מפיקים ב-Chrome או Edge עדכניים.</p>
          )}
          {coverUrl && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <img src={coverUrl} alt="" style={{ width: 120, border: '1px solid var(--line)' }} />
              <span className="small muted">תמונת השער האחרונה. מתאימה לפוסט בפיד ולתמונה ממוזערת.</span>
            </div>
          )}
          <div ref={hidden} style={{ position: 'fixed', left: -10000, top: 0, width: 640, height: 360, pointerEvents: 'none' }} />
        </div>

        <div className="stack">
          <section className="panel">
            <header>
              <h3>שליחה ללקוח</h3>
              <span className="spacer" />
              <span className="small muted">{p.details.clientName || 'לא הוגדר לקוח'}</span>
            </header>
            <div className="in stack">
              <p className="small muted">
                מורידים את הסרטון, ואז שולחים. בוואטסאפ ההודעה נפתחת מוכנה — נשאר רק לצרף את הקובץ. במחשב אפשר לגרור את הסרטון לחלון השיחה.
              </p>
              <div className="row wrap">
                <a
                  className="btn"
                  href={waLink(p.details.clientPhone, cap.whatsapp)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => log('whatsapp', p.details.clientName || p.details.clientPhone || 'וואטסאפ', true)}
                >
                  <Icon name="chat" /> וואטסאפ {p.details.clientPhone ? 'ללקוח' : ''}
                </a>
                <a
                  className="btn ghost"
                  href={mailLink(p.details.clientEmail, cap.emailSubject, cap.emailBody)}
                  onClick={() => log('email', p.details.clientEmail || 'מייל', true)}
                >
                  <Icon name="mail" /> מייל
                </a>
              </div>
              {p.shares.length > 0 && (
                <ul className="log">
                  {[...p.shares]
                    .reverse()
                    .slice(0, 6)
                    .map((s, i) => (
                      <li key={i}>
                        <span>
                          {{ whatsapp: 'וואטסאפ', email: 'מייל', download: 'הורדה', share: 'שיתוף' }[s.channel]} · {s.note}
                        </span>
                        <span>{fmtDate(s.at)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </section>

          <Caption title="אינסטגרם / טיקטוק" text={cap.instagram} onCopy={() => toast('הטקסט הועתק')} />
          <Caption title="פייסבוק" text={cap.facebook} onCopy={() => toast('הטקסט הועתק')} />
          <Caption title="הודעה ללקוח" text={cap.whatsapp} onCopy={() => toast('הטקסט הועתק')} />
        </div>
      </div>
    </>
  );
}
