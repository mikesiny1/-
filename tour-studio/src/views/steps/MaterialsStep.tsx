import { useEffect, useState } from 'react';
import { Drop, Icon, useToast } from '../../components/ui';
import { blobUrl, deleteBlob, putBlob, uid } from '../../lib/db';
import { autoTunePlan, getRaster, readPlanLabels } from '../../lib/project';
import { pdfPages, pdfToPlan, type PdfPage } from '../../lib/pdf';
import { wallColorCopy } from '../../lib/wallcolor';
import type { PhotoEntry, RoomType } from '../../lib/types';
import type { StepProps } from '../ProjectView';

/** Downscale very large images before storing them locally. */
async function shrink(file: File, max = 2400): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 3_000_000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.9));
}

const GUESS: RoomType[] = ['living', 'kitchen', 'master', 'bedroom', 'bathroom', 'balcony'];

export default function MaterialsStep({ p, update, next }: StepProps) {
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [pick, setPick] = useState<{ file: File; pages: PdfPage[] } | null>(null);
  const toast = useToast();

  useEffect(() => {
    blobUrl(p.planBlobId).then(setPlanUrl);
  }, [p.planBlobId]);
  useEffect(() => {
    Promise.all(p.photos.map(async (ph) => [ph.id, (await blobUrl(ph.blobId)) || ''] as const)).then((e) => setThumbs(Object.fromEntries(e)));
  }, [p.photos]);

  const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const onPlan = async ([f]: File[]) => {
    setPick(null);
    if (isPdf(f)) {
      setBusy('plan');
      setProgress('פותח את קובץ ה-PDF…');
      try {
        const pages = await pdfPages(f);
        // a brochure with several apartments: the client picks which one to read
        if (pages.length) return setPick({ file: f, pages });
      } finally {
        setBusy('');
        setProgress('');
      }
    }
    await readPlan(f, 1);
  };

  // small names are read at two sizes (each catches words the other misses); a name found twice counts once
  const readLabels = async (blobId: string, r: NonNullable<Awaited<ReturnType<typeof getRaster>>>, sharp?: { blob: Blob; scale: number }) => {
    const parts = sharp ? 2 : 1;
    const say = (i: number) => (k: number) => setProgress(`קורא את שמות החדרים בתוכנית ${Math.round(((i + k) / parts) * 100)}%`);
    const a = await readPlanLabels(blobId, r, say(0));
    if (!sharp) return a;
    const b = await readPlanLabels(sharp.blob, r, say(1), sharp.scale);
    const near = Math.max(r.w, r.h) * 0.02;
    return [...a, ...b.filter((l) => !a.some((o) => o.type === l.type && Math.hypot(o.x - l.x, o.y - l.y) < near))];
  };

  const readPlan = async (f: File, pageNo: number) => {
    setPick(null);
    setBusy('plan');
    try {
      let src: Blob = f;
      let viewId: string | null = null;
      let pdfLabels: { type: RoomType; text: string; x: number; y: number }[] | null = null;
      let ocrCopy: { blob: Blob; scale: number } | undefined;
      if (isPdf(f)) {
        setProgress(pageNo > 1 ? `קורא את עמוד ${pageNo} בקובץ…` : 'קורא את קובץ ה-PDF…');
        const pdf = await pdfToPlan(f, 2400, pageNo);
        // an architect's PDF: read the drawing without its lettering, show it as printed
        if (pdf.hasText || pdf.cutPen) {
          src = pdf.clean;
          viewId = await putBlob(pdf.full);
          // names drawn as outlines aren't in the text layer: those are read off the printed page
          pdfLabels = pdf.labels.length ? pdf.labels : null;
          ocrCopy = pdf.ocr;
        } else src = pdf.full;
      } else {
        // walls painted in one flat colour: read them by that colour, show the plan as it is
        const walls = await wallColorCopy(f);
        if (walls) {
          viewId = await putBlob(await shrink(f, 2000));
          src = walls;
        }
      }
      const id = await putBlob(src instanceof File ? await shrink(src, 2000) : src);
      const r = await getRaster(id);
      // room names: straight from the PDF's text layer, otherwise read off the picture
      const labels = !r
        ? []
        : pdfLabels
          ? pdfLabels.map((l) => ({ ...l, x: l.x * r.scale, y: l.y * r.scale }))
          : await readLabels(viewId || id, r, ocrCopy);
      const plan = r
        ? await autoTunePlan(r, p.details.sqm, p.details.rooms, (k) => setProgress(`קורא את התוכנית · בודק הגדרות קריאה ${Math.round(k * 100)}%`), labels)
        : null;
      setProgress('');
      if (p.planBlobId) deleteBlob(p.planBlobId);
      if (p.planViewBlobId) deleteBlob(p.planViewBlobId);
      update((x) => ({ ...x, planBlobId: id, planViewBlobId: viewId, plan, status: x.status === 'draft' ? 'in_progress' : x.status }));
      toast(plan?.rooms.length ? `זוהו ${plan.rooms.length} חללים בתוכנית` : 'התוכנית נטענה — נעבור עליה בשלב הקריאה');
    } finally {
      setBusy('');
    }
  };

  const onPhotos = async (files: File[]) => {
    setBusy('photos');
    try {
      const added: PhotoEntry[] = [];
      for (const f of files) {
        const blobId = await putBlob(await shrink(f));
        added.push({ id: uid(), blobId, roomType: GUESS[(p.photos.length + added.length) % GUESS.length], caption: '', staged: [] });
      }
      update((x) => ({ ...x, photos: [...x.photos, ...added], status: x.status === 'draft' ? 'in_progress' : x.status }));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">שלב 2</div>
          <h1>תוכנית ותמונות</h1>
          <p>
            מתוכנית דירה נבנה מודל תלת-ממדי שאפשר להסתובב בו ולרהט אותו. מתמונות נבנה סיור קולנועי עם הלבשה וירטואלית. אפשר להעלות את שניהם.
          </p>
        </div>
      </div>

      <div className="materials">
        <section>
          <Drop
            accept="image/*,application/pdf"
            icon="plan"
            title={p.planBlobId ? 'החלפת תוכנית' : 'תוכנית דירה'}
            text={busy === 'plan' ? progress || 'קורא את התוכנית…' : 'PDF, JPG או PNG — תוכנית מכר, תוכנית אדריכל או סקיצה'}
            cta="בחירת קובץ"
            onFiles={onPlan}
          />
          {pick && (
            <div className="pagepick">
              <div className="pagepick-head">
                <b>בקובץ {pick.pages.length} עמודים</b>
                <span className="muted small">בחרו את הדירה שממנה ייבנה הסיור</span>
              </div>
              <div className="pagepick-grid">
                {pick.pages.map((pg) => (
                  <button key={pg.n} className="pagepick-item" onClick={() => readPlan(pick.file, pg.n)}>
                    <img src={pg.thumb} alt={`עמוד ${pg.n}`} />
                    <span>
                      <b>{pg.title || `עמוד ${pg.n}`}</b>
                      <span className="mono">{pg.n}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!pick && planUrl && (
            <div className="planprev">
              <img src={planUrl} alt="תוכנית" />
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            המערכת בודקת כמה דרכי קריאה ובוחרת את המדויקת. קירות מלאים, קירות בקו כפול וקירות אפורים נתמכים. בקובץ PDF עם כמה דירות בוחרים את הדירה מתוך תצוגת העמודים.
          </p>
        </section>

        <section>
          <Drop
            accept="image/*"
            multiple
            icon="photo"
            title="צילומי הנכס"
            text={busy === 'photos' ? 'מעלה…' : 'אפשר לבחור כמה תמונות יחד. רוחב, באור יום.'}
            cta="בחירת תמונות"
            onFiles={onPhotos}
          />
          {p.photos.length > 0 && (
            <div className="photostrip">
              {p.photos.map((ph) => (
                <div key={ph.id} style={{ backgroundImage: thumbs[ph.id] ? `url(${thumbs[ph.id]})` : undefined }}>
                  <button
                    title="הסרה"
                    onClick={() => {
                      deleteBlob(ph.blobId);
                      update((x) => ({ ...x, photos: x.photos.filter((y) => y.id !== ph.id) }));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            טיפ צילום: מצלמים מפינת החדר בגובה החזה, טלפון במצב רוחב, כל האורות דלוקים.
          </p>
        </section>
      </div>

      <div className="step-foot">
        <button className="btn" onClick={next} disabled={!p.planBlobId && !p.photos.length}>
          המשך לבריף העיצוב
        </button>
        {!p.planBlobId && !p.photos.length && (
          <span className="small muted row">
            <Icon name="arrowL" /> צריך לפחות תוכנית אחת או תמונה אחת
          </span>
        )}
      </div>
    </>
  );
}
