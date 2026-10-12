import { useEffect, useState } from 'react';
import { useBrand } from '../App';
import { blobUrl, putBlob } from '../lib/db';
import { Drop, Field, useToast } from '../components/ui';

const ACCENTS = ['#8a5a3b', '#3f5a4a', '#2f4058', '#6b3b4a', '#1e1c19', '#a0742c'];

export default function Settings() {
  const { brand, setBrand } = useBrand();
  const [b, setB] = useState(brand);
  const [logo, setLogo] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => setB(brand), [brand]);
  useEffect(() => {
    blobUrl(b.logoBlobId).then(setLogo);
  }, [b.logoBlobId]);
  const set = (k: keyof typeof b, v: string) => setB({ ...b, [k]: v });

  return (
    <main className="page" style={{ maxWidth: 860 }}>
      <div className="dash-head">
        <div>
          <div className="eyebrow">פרופיל משרד</div>
          <h1>המיתוג שמופיע בכל סיור</h1>
          <p>שם המשרד, איש הקשר והלוגו נצרבים בסרטונים, בתמונות השער ובהודעות ללקוחות.</p>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 30 }}>
        <Field label="שם המשרד / המותג">
          <input className="input" value={b.agencyName} onChange={(e) => set('agencyName', e.target.value)} placeholder="לדוגמה: בית ונוף נדל״ן" />
        </Field>
        <Field label="שם הסוכן/ת">
          <input className="input" value={b.agentName} onChange={(e) => set('agentName', e.target.value)} />
        </Field>
        <Field label="טלפון">
          <input className="input ltr" value={b.agentPhone} onChange={(e) => set('agentPhone', e.target.value)} placeholder="050-0000000" />
        </Field>
        <Field label="דוא״ל">
          <input className="input ltr" value={b.agentEmail} onChange={(e) => set('agentEmail', e.target.value)} />
        </Field>
        <Field label="מספר רישיון תיווך" hint="מופיע בכרטיס הסיום של הסרטון">
          <input className="input ltr" value={b.license} onChange={(e) => set('license', e.target.value)} />
        </Field>
        <Field label="צבע מותג">
          <div className="row">
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => set('accent', c)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: c,
                  border: b.accent === c ? '2px solid var(--paper)' : '0',
                  boxShadow: b.accent === c ? '0 0 0 2px var(--ink)' : 'none',
                  cursor: 'pointer',
                }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <div className="span2">
          <div className="field">
            <span>לוגו (PNG שקוף מומלץ)</span>
          </div>
          <div className="row" style={{ marginTop: 6, alignItems: 'stretch' }}>
            {logo && (
              <div className="card" style={{ padding: 12, display: 'grid', placeItems: 'center', background: '#3a3631' }}>
                <img src={logo} alt="" style={{ maxHeight: 50, maxWidth: 160 }} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <Drop
                accept="image/*"
                icon="image"
                title={logo ? 'החלפת לוגו' : 'העלאת לוגו'}
                text="יוצג בפינת הסרטון"
                cta="בחירת קובץ"
                onFiles={async ([f]) => setB({ ...b, logoBlobId: await putBlob(f) })}
              />
            </div>
          </div>
          {logo && (
            <button className="btn quiet sm" style={{ marginTop: 6 }} onClick={() => setB({ ...b, logoBlobId: null })}>
              הסרת לוגו
            </button>
          )}
        </div>
      </div>
      <div className="step-foot">
        <button
          className="btn"
          onClick={() => {
            setBrand(b);
            toast('הפרופיל נשמר');
          }}
        >
          שמירה
        </button>
      </div>
    </main>
  );
}
