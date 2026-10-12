import { useEffect, useMemo, useState } from 'react';
import { deleteBlob, getLibrary, putBlob, saveLibrary, type LibraryEntry } from '../lib/db';
import { FURNITURE_NAMES } from '../lib/styles';
import type { FurnitureKind } from '../lib/types';
import { loadModel } from '../three/library';
import { furnitureSprite } from '../three/sprites';
import { Icon, useToast } from '../components/ui';

const KINDS: FurnitureKind[] = [
  'sofa',
  'armchair',
  'coffeeTable',
  'tvUnit',
  'diningTable',
  'bed',
  'singleBed',
  'nightstand',
  'wardrobe',
  'desk',
  'sideboard',
  'shelf',
  'floorLamp',
  'plant',
  'bistroSet',
  'rug',
];

function Thumb({ kind }: { kind: FurnitureKind }) {
  const src = useMemo(() => furnitureSprite(kind, 'scandi', 1).canvas.toDataURL(), [kind]);
  return <img src={src} alt="" />;
}

export default function Library() {
  const [list, setList] = useState<LibraryEntry[]>([]);
  const [busy, setBusy] = useState<FurnitureKind | null>(null);
  const toast = useToast();
  useEffect(() => {
    getLibrary().then(setList);
  }, []);
  const save = (l: LibraryEntry[]) => {
    setList(l);
    saveLibrary(l);
  };

  const upload = async (kind: FurnitureKind, f: File) => {
    setBusy(kind);
    try {
      const blobId = await putBlob(f);
      await loadModel(blobId); // validates the file
      const old = list.find((e) => e.kind === kind);
      if (old) deleteBlob(old.blobId);
      save([...list.filter((e) => e.kind !== kind), { kind, blobId, name: f.name, rotate: 0 }]);
      toast(`${FURNITURE_NAMES[kind]}: הדגם נטען ויופיע בכל הסיורים`);
    } catch {
      toast('לא ניתן לקרוא את הקובץ. נדרש קובץ GLB תקין.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <div className="dash-head">
        <div>
          <div className="eyebrow">ספריית ריהוט</div>
          <h1>דגמים אמיתיים לסיורים</h1>
          <p>
            כל סוג רהיט מגיע עם דגם מובנה בכל הסגנונות. לנאמנות מלאה אפשר להחליף אותו בדגם תלת-ממדי אמיתי בפורמט GLB — של ספק שאתם עובדים איתו, או מספרייה
            חופשית כמו Poly Haven. הדגם מוקטן אוטומטית למידה הנכונה ומוצב בכל הסיורים.
          </p>
        </div>
      </div>

      <div className="libgrid">
        {KINDS.map((k) => {
          const e = list.find((x) => x.kind === k);
          return (
            <div key={k} className={'libcard' + (e ? ' custom' : '')}>
              <div className="libthumb">
                <Thumb kind={k} />
              </div>
              <div className="libbody">
                <b>{FURNITURE_NAMES[k]}</b>
                <span className="small muted">{e ? e.name : 'דגם מובנה'}</span>
                {e && (
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <span className="small muted">סיבוב</span>
                    <select
                      className="select"
                      style={{ height: 28, width: 84, fontSize: 12 }}
                      value={e.rotate}
                      onChange={(ev) => save(list.map((x) => (x.kind === k ? { ...x, rotate: Number(ev.target.value) } : x)))}
                    >
                      {[0, 90, 180, 270].map((d) => (
                        <option key={d} value={d}>
                          {d}°
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="libact">
                <label className="btn ghost sm">
                  {busy === k ? 'טוען…' : e ? 'החלפה' : 'העלאת GLB'}
                  <input
                    type="file"
                    accept=".glb,model/gltf-binary"
                    hidden
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      ev.target.value = '';
                      if (f) upload(k, f);
                    }}
                  />
                </label>
                {e && (
                  <button
                    className="x"
                    title="חזרה לדגם המובנה"
                    onClick={() => {
                      deleteBlob(e.blobId);
                      save(list.filter((x) => x.kind !== k));
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>
        הדגם צריך לעמוד על הרצפה ולפנות קדימה. אם הוא מוצב הפוך, שנו את הסיבוב. דגמים כבדים (מעל 10MB) מאטים את הסיור.
      </p>
    </main>
  );
}
