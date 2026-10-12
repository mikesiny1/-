import { useEffect, useMemo, useRef, useState } from 'react';
import { useBrand } from '../App';
import PhotoPlayer from '../components/PhotoPlayer';
import { Icon } from '../components/ui';
import { blobUrl, getProject } from '../lib/db';
import { formatILS, stagingPlan } from '../lib/designer';
import { factsLine, priceLine } from '../lib/overlay';
import { regionAt } from '../lib/plan';
import { getRaster, modelFor } from '../lib/project';
import { roomName, STYLES, styleById } from '../lib/styles';
import type { Project, StyleId } from '../lib/types';
import { Viewer3D } from './steps/TourStep';

/** A clean page for showing the property to a client on a screen or a shared display. */
export default function Present({ id }: { id: string }) {
  const { brand } = useBrand();
  const [p, setP] = useState<Project | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [areas, setAreas] = useState<{ name: string; area: number }[]>([]);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getProject(id).then((x) => x && setP(x));
  }, [id]);
  useEffect(() => {
    blobUrl(brand.logoBlobId).then(setLogo);
  }, [brand.logoBlobId]);
  useEffect(() => {
    if (!p?.planBlobId || !p.plan) return;
    getRaster(p.planBlobId).then((r) => {
      if (!r) return;
      const m = modelFor(p.planBlobId!, r, p.plan!);
      setAreas(
        p.plan!.rooms.map((room) => ({ name: room.name || roomName(room.type), area: regionAt(m, room.sx, room.sy)?.areaM2 || 0 })).filter((x) => x.area > 0),
      );
    });
  }, [p?.planBlobId, p?.plan]);

  const plan = useMemo(() => (p ? stagingPlan(p.plan?.rooms.map((r) => r.type) || p.photos.map((x) => x.roomType), p.design) : null), [p]);
  if (!p || !plan) return <main className="page" />;

  const setStyle = (style: StyleId) => setP({ ...p, design: { ...p.design, style, furnish: true } });
  const s = styleById(p.design.style);
  const d = p.details;
  const has3d = !!(p.planBlobId && p.plan?.rooms.length);

  return (
    <div className="present">
      <header className="present-top">
        {logo ? <img src={logo} alt="" style={{ height: 34 }} /> : <b className="present-brand">{brand.agencyName || 'מפלס'}</b>}
        <span className="spacer" />
        <a className="btn quiet sm" href={`#/p/${p.id}/tour`}>
          חזרה לעריכה
        </a>
      </header>

      <section className="present-hero">
        <div className="eyebrow">{d.dealType === 'rent' ? 'להשכרה' : 'למכירה'}</div>
        <h1>{d.title || d.address || 'נכס'}</h1>
        <p className="present-where">{[d.address, d.city].filter(Boolean).join(', ')}</p>
        <div className="present-facts">
          <span>{factsLine(p)}</span>
          {priceLine(p) && <b>{priceLine(p)}</b>}
        </div>
      </section>

      <section className="present-stage" ref={stage}>
        {has3d ? <Viewer3D p={p} /> : <PhotoPlayer p={p} />}
        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
          <span className="small muted">הדמיית סגנון:</span>
          <div className="chips">
            {STYLES.map((st) => (
              <button key={st.id} className={'chip' + (st.id === p.design.style && p.design.furnish ? ' on' : '')} onClick={() => setStyle(st.id)}>
                <i style={{ background: st.fabricAlt }} />
                {st.name}
              </button>
            ))}
            <button className={'chip' + (!p.design.furnish ? ' on' : '')} onClick={() => setP({ ...p, design: { ...p.design, furnish: false } })}>
              ללא ריהוט
            </button>
          </div>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => stage.current?.requestFullscreen?.().catch(() => {})}>
            <Icon name="eye" /> מסך מלא
          </button>
        </div>
      </section>

      <section className="present-grid">
        <div>
          <h2>על הנכס</h2>
          {d.description && <p className="present-text">{d.description}</p>}
          {areas.length > 0 && (
            <table className="present-table">
              <tbody>
                {areas.map((a, i) => (
                  <tr key={i}>
                    <td>{a.name}</td>
                    <td>{a.area.toFixed(1)} מ״ר</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h2>הצעת העיצוב</h2>
          <p className="present-text">{s.story}</p>
          <div className="palette" style={{ marginTop: 14 }}>
            {[s.wall, s.floorTone, s.wood, s.fabric, s.fabricAlt, s.accent].map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </div>
          <p className="small muted">{s.materials.join(' · ')}</p>
          <p className="small" style={{ marginTop: 10 }}>
            הערכת עלות להלבשה מלאה: <b>{formatILS(plan.total)}</b>
          </p>
        </div>
        <div className="present-agent">
          <div className="eyebrow">לתיאום ביקור</div>
          <b>{brand.agentName || brand.agencyName || 'הסוכן/ת שלך'}</b>
          {brand.agentPhone && <span className="ltr">{brand.agentPhone}</span>}
          {brand.agentEmail && <span className="ltr">{brand.agentEmail}</span>}
          {brand.license && <span className="small muted">רישיון תיווך {brand.license}</span>}
        </div>
      </section>
      <p className="small muted present-note">הדמיית העיצוב להמחשה בלבד. הריהוט אינו כלול בנכס. השטחים מחושבים מהתוכנית ועשויים לסטות מהמידות בפועל.</p>
    </div>
  );
}
