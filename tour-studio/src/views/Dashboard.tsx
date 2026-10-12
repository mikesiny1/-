import { useEffect, useState } from 'react';
import { go, useBrand } from '../App';
import { blobUrl, deleteProject, listProjects, saveProject } from '../lib/db';
import { factsLine, priceLine } from '../lib/overlay';
import { createDemoProject, newProject } from '../lib/project';
import { styleById } from '../lib/styles';
import type { Project, ProjectStatus } from '../lib/types';
import { fmtDate, Icon, useToast } from '../components/ui';

export const STATUS_NAME: Record<ProjectStatus, string> = {
  draft: 'טיוטה',
  in_progress: 'בעבודה',
  ready: 'מוכן לפרסום',
  sent: 'נשלח ללקוח',
};

function Thumb({ p }: { p: Project }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    blobUrl(p.coverBlobId || p.photos[0]?.blobId || p.planBlobId).then(setSrc);
  }, [p]);
  return <div className="thumb">{src ? <img src={src} alt="" /> : <Icon name="image" size={22} />}</div>;
}

export default function Dashboard() {
  const [items, setItems] = useState<Project[] | null>(null);
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const toast = useToast();
  const { brand } = useBrand();

  const load = () => listProjects().then(setItems);
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const p = await saveProject(newProject());
    go(`/p/${p.id}/details`);
  };
  const demo = async () => {
    setBusy(true);
    try {
      const p = await createDemoProject();
      go(`/p/${p.id}/plan`);
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <main className="page" />;
  const count = (s: ProjectStatus) => items.filter((p) => p.status === s).length;
  const shown = filter === 'all' ? items : items.filter((p) => p.status === filter);

  return (
    <main className="page">
      <div className="dash-head">
        <div>
          <div className="eyebrow">ניהול נכסים</div>
          <h1>הנכסים שלך</h1>
          <p>כל נכס הוא פרויקט: מעלים תוכנית או תמונות, בוחרים סגנון הלבשה, ומקבלים סיור מוכן לרשתות וללקוחות.</p>
        </div>
        <span className="spacer" />
        <button className="btn ghost" onClick={demo} disabled={busy}>
          {busy ? 'מכין…' : 'נכס לדוגמה'}
        </button>
        <button className="btn" onClick={create}>
          <Icon name="plus" /> נכס חדש
        </button>
      </div>

      {!brand.agentName && !brand.agencyName && (
        <div className="notice row" style={{ marginTop: 20, justifyContent: 'space-between' }}>
          <span>שם המשרד, הסוכן והטלפון נצרבים בכל סרטון ובכל הודעה ללקוח. כדאי להשלים אותם לפני הפרסום הראשון.</span>
          <a className="btn ghost sm" href="#/settings">
            השלמת פרופיל
          </a>
        </div>
      )}

      {items.length > 0 && (
        <div className="kpis">
          <div>
            <b>{items.length}</b>
            <span>נכסים בתיק</span>
          </div>
          <div>
            <b>{count('in_progress') + count('draft')}</b>
            <span>בהכנה</span>
          </div>
          <div>
            <b>{count('ready')}</b>
            <span>מוכנים לפרסום</span>
          </div>
          <div>
            <b>{items.reduce((s, p) => s + p.shares.length, 0)}</b>
            <span>שליחות ללקוחות</span>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <div>
            <h2>מתחילים מנכס אחד</h2>
            <p className="muted" style={{ margin: '10px 0 22px', maxWidth: 420 }}>
              אין עדיין נכסים בתיק. אפשר לפתוח נכס חדש, או לפתוח נכס לדוגמה עם תוכנית אדריכלית מוכנה ולראות את כל התהליך.
            </p>
            <div className="row">
              <button className="btn" onClick={create}>
                <Icon name="plus" /> נכס חדש
              </button>
              <button className="btn ghost" onClick={demo} disabled={busy}>
                {busy ? 'מכין…' : 'פתיחת נכס לדוגמה'}
              </button>
            </div>
          </div>
          <ol>
            <li>
              <div>
                <b>פרטי הנכס והלקוח</b>
                <span>כתובת, חדרים, מחיר ולמי שולחים.</span>
              </div>
            </li>
            <li>
              <div>
                <b>תוכנית דירה או תמונות</b>
                <span>JPG או PNG של תוכנית, או צילומים מהנכס.</span>
              </div>
            </li>
            <li>
              <div>
                <b>בריף עיצוב</b>
                <span>סגנון, קהל יעד ותקציב — ההלבשה נבנית לפיהם.</span>
              </div>
            </li>
            <li>
              <div>
                <b>סיור וירטואלי</b>
                <span>הליכה בדירה, תצוגת בובות, הדלקה וכיבוי של הריהוט.</span>
              </div>
            </li>
            <li>
              <div>
                <b>פרסום ושליחה</b>
                <span>סרטון לריל, לפיד וליוטיוב, טקסטים ושליחה בוואטסאפ או במייל.</span>
              </div>
            </li>
          </ol>
        </div>
      ) : (
        <>
          <div className="filters">
            {(['all', 'draft', 'in_progress', 'ready', 'sent'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? `הכול (${items.length})` : `${STATUS_NAME[f]} (${count(f)})`}
              </button>
            ))}
          </div>
          <div className="plist">
            {shown.map((p) => (
              <div className="prow" key={p.id} onClick={() => go(`/p/${p.id}/${p.planBlobId || p.photos.length ? 'tour' : 'details'}`)}>
                <Thumb p={p} />
                <div>
                  <h3>{p.details.title || p.details.address || 'נכס ללא שם'}</h3>
                  <div className="addr">{[p.details.address, p.details.city].filter(Boolean).join(', ') || '—'}</div>
                </div>
                <div className="facts">
                  {factsLine(p) || '—'}
                  <div className="addr">
                    {priceLine(p)}
                    {p.design.furnish ? ` · ${styleById(p.design.style).name}` : ''}
                  </div>
                </div>
                <span className={'status ' + p.status}>{STATUS_NAME[p.status]}</span>
                <span className="date">{fmtDate(p.updatedAt)}</span>
                <button
                  className="x"
                  title={armed === p.id ? 'לחצו שוב כדי למחוק' : 'מחיקה'}
                  style={armed === p.id ? { color: 'var(--danger)', fontSize: 13, whiteSpace: 'nowrap' } : undefined}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (armed !== p.id) {
                      setArmed(p.id);
                      setTimeout(() => setArmed((a) => (a === p.id ? null : a)), 3500);
                      return;
                    }
                    setArmed(null);
                    await deleteProject(p);
                    toast('הנכס נמחק');
                    load();
                  }}
                >
                  {armed === p.id ? 'למחוק?' : <Icon name="trash" />}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
