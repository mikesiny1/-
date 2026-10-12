import { Field, Seg } from '../../components/ui';
import type { PropertyDetails } from '../../lib/types';
import type { StepProps } from '../ProjectView';

export default function DetailsStep({ p, update, next }: StepProps) {
  const d = p.details;
  const set = <K extends keyof PropertyDetails>(k: K, v: PropertyDetails[K]) =>
    update((x) => ({ ...x, details: { ...x.details, [k]: v } }));

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">שלב 1</div>
          <h1>פרטי הנכס</h1>
          <p>הפרטים האלה מופיעים בכותרות הסרטון, בטקסטים לרשתות ובהודעה ללקוח. שטח הדירה עוזר גם לקרוא את קנה המידה של התוכנית.</p>
        </div>
      </div>

      <div className="grid3">
        <Field label="כותרת המודעה" className="span2">
          <input className="input" value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="לדוגמה: דירת 4 חדרים משופצת עם נוף פתוח" />
        </Field>
        <Field label="סוג עסקה">
          <Seg
            value={d.dealType}
            onChange={(v) => set('dealType', v)}
            options={[
              { id: 'sale', label: 'מכירה' },
              { id: 'rent', label: 'השכרה' },
            ]}
          />
        </Field>
        <Field label="כתובת">
          <input className="input" value={d.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="עיר / שכונה">
          <input className="input" value={d.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="קומה">
          <input className="input" value={d.floor} onChange={(e) => set('floor', e.target.value)} placeholder="3 מתוך 6" />
        </Field>
        <Field label="מספר חדרים">
          <input className="input" type="number" step={0.5} min={1} value={d.rooms || ''} onChange={(e) => set('rooms', Number(e.target.value))} />
        </Field>
        <Field label="שטח (מ״ר)" hint="משמש לכיול אוטומטי של התוכנית">
          <input className="input" type="number" min={0} value={d.sqm || ''} onChange={(e) => set('sqm', Number(e.target.value))} />
        </Field>
        <Field label={d.dealType === 'rent' ? 'שכירות חודשית (₪)' : 'מחיר מבוקש (₪)'}>
          <input className="input" inputMode="numeric" value={d.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="תיאור קצר" className="span3" hint="משפט-שניים שיופיעו בפוסט ובמייל">
          <textarea className="textarea" value={d.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>

      <hr className="rule" />
      <h3 style={{ marginBottom: 16 }}>הלקוח שמקבל את הסיור</h3>
      <div className="grid3">
        <Field label="שם">
          <input className="input" value={d.clientName} onChange={(e) => set('clientName', e.target.value)} />
        </Field>
        <Field label="טלפון (לוואטסאפ)">
          <input className="input ltr" value={d.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="050-0000000" />
        </Field>
        <Field label="דוא״ל">
          <input className="input ltr" value={d.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} />
        </Field>
      </div>

      <div className="step-foot">
        <button className="btn" onClick={next}>
          המשך להעלאת חומרים
        </button>
      </div>
    </>
  );
}
