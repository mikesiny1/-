import { Switch } from '../../components/ui';
import { recommendStyle } from '../../lib/designer';
import { BUDGETS, HOUSEHOLDS, STYLES, styleById } from '../../lib/styles';
import type { DesignBrief } from '../../lib/types';
import type { StepProps } from '../ProjectView';

export default function BriefStep({ p, update, next }: StepProps) {
  const b = p.design;
  const set = <K extends keyof DesignBrief>(k: K, v: DesignBrief[K]) => update((x) => ({ ...x, design: { ...x.design, [k]: v } }));
  const rec = recommendStyle(b.household, b.budget, p.details.sqm);
  const recStyle = styleById(rec.id);

  return (
    <>
      <div className="step-head">
        <div>
          <div className="eyebrow">שלב 3 · שיחת מעצב</div>
          <h1>איך הדירה צריכה להרגיש?</h1>
          <p>
            כמה שאלות קצרות, כמו בפגישה ראשונה עם מעצב. לפי התשובות נבחר ריהוט, חומרים ופלטת צבעים — ואפשר לשנות הכול גם בזמן הסיור.
          </p>
        </div>
      </div>

      <div className="qa">
        <div>
          <b>להציג את הדירה מרוהטת?</b>
          <span>הלבשה וירטואלית מגדילה מעורבות ועוזרת לקונים לדמיין את החלל.</span>
        </div>
        <div className="row wrap" style={{ gap: 24 }}>
          <Switch on={b.furnish} onChange={(v) => set('furnish', v)}>
            {b.furnish ? 'כן, להוסיף ריהוט לסיור' : 'לא, להציג את הדירה ריקה'}
          </Switch>
        </div>
      </div>

      <div className="qa">
        <div>
          <b>למי משווקים?</b>
          <span>קהל היעד קובע את סוג ההלבשה.</span>
        </div>
        <div className="optgrid">
          {HOUSEHOLDS.map((h) => (
            <button key={h.id} className={'opt' + (b.household === h.id ? ' on' : '')} onClick={() => set('household', h.id)}>
              <b>{h.name}</b>
              <span>{h.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="qa">
        <div>
          <b>רמת הגימור</b>
          <span>משפיעה על הערכת עלות ההלבשה.</span>
        </div>
        <div className="optgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {BUDGETS.map((h) => (
            <button key={h.id} className={'opt' + (b.budget === h.id ? ' on' : '')} onClick={() => set('budget', h.id)}>
              <b>{h.name}</b>
              <span>{h.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="qa">
        <div>
          <b>סגנון</b>
          <span>איזה סגנון ריהוט הלקוח מעדיף?</span>
        </div>
        <div>
          <div className="rec">
            <span className="muted small">המלצת המעצב: </span>
            <b>{recStyle.name}</b>. <span className="small">{rec.why}</span>{' '}
            {b.style !== rec.id && (
              <button className="btn quiet sm" onClick={() => set('style', rec.id)} style={{ display: 'inline-flex' }}>
                לבחור בהמלצה
              </button>
            )}
          </div>
          <div className="styles">
            {STYLES.map((s) => (
              <button key={s.id} className={'stylecard' + (b.style === s.id ? ' on' : '')} onClick={() => set('style', s.id)}>
                <div className="sw">
                  <i style={{ background: s.wall }} />
                  <i style={{ background: s.floorTone }} />
                  <i style={{ background: s.fabric }} />
                  <i style={{ background: s.fabricAlt }} />
                </div>
                <div className="body">
                  <h3>
                    {s.name} <small>{s.latin}</small>
                  </h3>
                  <p>{s.line}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="qa">
        <div>
          <b>תאורה</b>
          <span>אור יום מצטלם נקי; ערב מוסיף אווירה.</span>
        </div>
        <div className="optgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: 420 }}>
          <button className={'opt' + (b.light === 'day' ? ' on' : '')} onClick={() => set('light', 'day')}>
            <b>אור יום</b>
            <span>בהיר ומזמין</span>
          </button>
          <button className={'opt' + (b.light === 'evening' ? ' on' : '')} onClick={() => set('light', 'evening')}>
            <b>ערב</b>
            <span>מנורות דולקות, חם</span>
          </button>
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 10 }}>
        <div className="eyebrow">כך נעבוד בסגנון {styleById(b.style).name}</div>
        <p style={{ marginTop: 8, fontFamily: 'var(--serif)', fontSize: 17, lineHeight: 1.6 }}>{styleById(b.style).story}</p>
        <p className="small muted" style={{ marginTop: 10 }}>
          חומרים: {styleById(b.style).materials.join(' · ')}
        </p>
      </div>

      <div className="step-foot">
        <button className="btn" onClick={next}>
          {p.planBlobId ? 'המשך לקריאת התוכנית' : 'המשך להלבשת התמונות'}
        </button>
      </div>
    </>
  );
}
