import { useCallback, useEffect, useRef, useState } from 'react';
import { go } from '../App';
import { getProject, saveProject } from '../lib/db';
import { stepDone } from '../lib/project';
import type { Project } from '../lib/types';
import { STATUS_NAME } from './Dashboard';
import DetailsStep from './steps/DetailsStep';
import MaterialsStep from './steps/MaterialsStep';
import BriefStep from './steps/BriefStep';
import PlanStep from './steps/PlanStep';
import PhotosStep from './steps/PhotosStep';
import TourStep from './steps/TourStep';
import PublishStep from './steps/PublishStep';

export interface StepProps {
  p: Project;
  update: (fn: (p: Project) => Project) => void;
  next: () => void;
}

export default function ProjectView({ id, step }: { id: string; step: string }) {
  const [p, setP] = useState<Project | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<number>();
  const latest = useRef<Project | null>(null);

  useEffect(() => {
    getProject(id).then((x) => {
      if (!x) go('/');
      else {
        latest.current = x;
        setP(x);
      }
    });
  }, [id]);

  const flush = useCallback(async () => {
    if (!latest.current) return;
    await saveProject(latest.current);
    setSaved(true);
  }, []);

  useEffect(() => {
    const before = () => {
      if (latest.current) saveProject(latest.current);
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      clearTimeout(timer.current);
      before();
    };
  }, []);

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setP((cur) => {
        if (!cur) return cur;
        const n = fn(cur);
        latest.current = n;
        return n;
      });
      setSaved(false);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    [flush],
  );

  if (!p) return <main className="page" />;

  const done = stepDone(p);
  const steps: { id: string; name: string; done: boolean }[] = [
    { id: 'details', name: 'פרטי הנכס', done: done.details },
    { id: 'materials', name: 'תוכנית ותמונות', done: done.materials },
    { id: 'brief', name: 'בריף עיצוב', done: done.brief },
  ];
  if (p.planBlobId) steps.push({ id: 'plan', name: 'קריאת התוכנית', done: done.plan });
  if (p.photos.length) steps.push({ id: 'photos', name: 'הלבשת תמונות', done: p.photos.some((x) => x.staged.length) });
  steps.push({ id: 'tour', name: 'הסיור', done: done.tour }, { id: 'publish', name: 'פרסום ושליחה', done: done.publish });

  const idx = Math.max(0, steps.findIndex((s) => s.id === step));
  const cur = steps[idx];
  const next = () => {
    const n = steps[idx + 1];
    if (n) go(`/p/${p.id}/${n.id}`);
    window.scrollTo({ top: 0 });
  };
  const props: StepProps = { p, update, next };

  return (
    <div className="proj">
      <aside className="side">
        <a className="back" href="#/">
          → כל הנכסים
        </a>
        <div>
          <h2>{p.details.title || p.details.address || 'נכס חדש'}</h2>
          <span className={'status ' + p.status} style={{ marginTop: 6 }}>
            {STATUS_NAME[p.status]}
          </span>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button className={s.id === cur.id ? 'on' : ''} onClick={() => go(`/p/${p.id}/${s.id}`)}>
                <em>{String(i + 1).padStart(2, '0')}</em>
                {s.name}
                {s.done && s.id !== cur.id ? <i className="done" /> : <span />}
              </button>
            </li>
          ))}
        </ol>
        <div className="save">{saved ? 'כל השינויים נשמרו' : 'שומר…'}</div>
      </aside>
      <main className="main">
        <div className="stepbar">
          <button className="btn quiet sm" disabled={idx === 0} onClick={() => go(`/p/${p.id}/${steps[idx - 1].id}`)}>
            → {idx > 0 ? steps[idx - 1].name : 'הקודם'}
          </button>
          <div className="progress" aria-label={`שלב ${idx + 1} מתוך ${steps.length}`}>
            <i style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
          </div>
          <span className="small muted">
            שלב {idx + 1} מתוך {steps.length}
          </span>
          <a className="btn quiet sm" href={`#/present/${p.id}`} title="תצוגה נקייה להצגה ללקוח">
            מצגת ללקוח
          </a>
          <button className="btn quiet sm" disabled={idx === steps.length - 1} onClick={next}>
            {idx < steps.length - 1 ? steps[idx + 1].name : 'הבא'} ←
          </button>
        </div>
        {cur.id === 'details' && <DetailsStep {...props} />}
        {cur.id === 'materials' && <MaterialsStep {...props} />}
        {cur.id === 'brief' && <BriefStep {...props} />}
        {cur.id === 'plan' && <PlanStep {...props} />}
        {cur.id === 'photos' && <PhotosStep {...props} />}
        {cur.id === 'tour' && <TourStep {...props} />}
        {cur.id === 'publish' && <PublishStep {...props} />}
      </main>
    </div>
  );
}
