import { useEffect, useState } from 'react';
import { Drop, Icon, useToast } from '../../components/ui';
import { blobUrl, deleteBlob, putBlob, uid } from '../../lib/db';
import { getRaster, initialPlan } from '../../lib/project';
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
  const toast = useToast();

  useEffect(() => {
    blobUrl(p.planBlobId).then(setPlanUrl);
  }, [p.planBlobId]);
  useEffect(() => {
    Promise.all(p.photos.map(async (ph) => [ph.id, (await blobUrl(ph.blobId)) || ''] as const)).then((e) => setThumbs(Object.fromEntries(e)));
  }, [p.photos]);

  const onPlan = async ([f]: File[]) => {
    setBusy('plan');
    try {
      const id = await putBlob(await shrink(f, 2000));
      const r = await getRaster(id);
      const plan = r ? initialPlan(r, p.details.sqm, p.details.rooms) : null;
      if (p.planBlobId) deleteBlob(p.planBlobId);
      update((x) => ({ ...x, planBlobId: id, plan, status: x.status === 'draft' ? 'in_progress' : x.status }));
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
            accept="image/*"
            icon="plan"
            title={p.planBlobId ? 'החלפת תוכנית' : 'תוכנית דירה'}
            text={busy === 'plan' ? 'קורא את התוכנית…' : 'JPG או PNG, תוכנית מכר או סקיצה בשחור-לבן'}
            cta="בחירת קובץ"
            onFiles={onPlan}
          />
          {planUrl && (
            <div className="planprev">
              <img src={planUrl} alt="תוכנית" />
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            עובד הכי טוב עם תוכנית שהקירות בה מסומנים בקו עבה וכהה. PDF — יש לייצא קודם לתמונה.
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
