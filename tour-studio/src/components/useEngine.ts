import { useEffect, useState, type RefObject } from 'react';
import { getRaster, modelFor } from '../lib/project';
import type { Project } from '../lib/types';
import { TourEngine } from '../three/engine';

/** Creates a TourEngine inside `ref` and keeps it in sync with the project. */
export function useEngine(ref: RefObject<HTMLDivElement>, p: Project, enabled = true) {
  const [engine, setEngine] = useState<TourEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !ref.current) return;
    let e: TourEngine;
    try {
      e = new TourEngine(ref.current);
    } catch {
      setError('הדפדפן לא תומך בתלת-ממד (WebGL). נסו Chrome, Edge או Safari עדכניים.');
      return;
    }
    setEngine(e);
    return () => {
      e.dispose();
      setEngine(null);
      setReady(false);
    };
  }, [enabled, ref]);

  const roomsKey = JSON.stringify(p.plan?.rooms.map((r) => [r.type, Math.round(r.sx), Math.round(r.sy), r.name]));
  const settingsKey = p.plan ? [p.plan.threshold, p.plan.minWall, p.plan.doorGap, p.plan.pxPerM].join('|') : '';

  useEffect(() => {
    if (!engine || !p.planBlobId || !p.plan) return;
    let alive = true;
    (async () => {
      const r = await getRaster(p.planBlobId!);
      if (!r || !alive) return;
      const model = modelFor(p.planBlobId!, r, p.plan!);
      engine.build(model, p.plan!.rooms, p.design);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, p.planBlobId, roomsKey, settingsKey]);

  useEffect(() => {
    if (engine && ready) engine.applyBrief(p.design);
  }, [engine, ready, p.design]);

  return { engine, ready, error };
}
