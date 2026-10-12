import type { Budget, DesignBrief, FurnitureKind, Household, RoomType, StyleId } from './types';
import { FURNITURE_NAMES, roomName, styleById } from './styles';

/** What a designer would put in each room type, ordered by importance. */
export const ROOM_RECIPE: Record<RoomType, FurnitureKind[]> = {
  living: ['sofa', 'rug', 'coffeeTable', 'tvUnit', 'armchair', 'floorLamp', 'plant', 'art'],
  dining: ['diningTable', 'sideboard', 'plant'],
  kitchen: ['diningTable'],
  master: ['bed', 'nightstand', 'wardrobe', 'rug', 'plant', 'art'],
  bedroom: ['bed', 'nightstand', 'wardrobe', 'rug'],
  kids: ['singleBed', 'desk', 'shelf', 'rug'],
  office: ['desk', 'shelf', 'armchair', 'plant'],
  mamad: ['desk', 'shelf', 'armchair'],
  bathroom: [],
  balcony: ['bistroSet', 'plant'],
  hall: ['sideboard', 'plant'],
  storage: [],
};

const ROOM_TIPS: Partial<Record<RoomType, (s: StyleId) => string>> = {
  living: (s) =>
    s === 'japandi' || s === 'scandi'
      ? 'הספה ממוקמת מול נקודת המבט מהכניסה, כך שהחלל נקרא מיד כ"סלון". שטיח גדול שכל הרגליים הקדמיות עליו — מאחד את הפינה.'
      : 'הספה נשענת על הקיר הארוך והמלא, והמזנון מולה. שטיח שמחבר בין הפריטים יוצר "אי" ברור בתוך החלל הפתוח.',
  kitchen: () => 'שולחן קטן או בר ישיבה הופכים מטבח לחלל מגורים — זה מה שקונים זוכרים מהסיור.',
  dining: () => 'מנורה תלויה מעל שולחן האוכל מגדירה אותו גם בלי קירות. רוחב מעבר מומלץ סביב השולחן: 90 ס״מ.',
  master: () => 'ראש המיטה צמוד לקיר המלא הרחוק מהדלת, עם שידות זהות משני הצדדים — סימטריה משדרת רוגע.',
  bedroom: () => 'מיטה זוגית ממורכזת, טקסטיל בהיר. החדר מוצג כחדר אורחים או חדר שינה נוסף — מגדיל את ערך הנכס בעיני הקונה.',
  kids: () => 'מיטת יחיד לאורך הקיר משחררת רצפה למשחק; שולחן עבודה ליד החלון.',
  office: () => 'שולחן עבודה עם מבט אל החדר ולא אל הקיר — כך החלל נראה גדול גם בווידאו.',
  mamad: () => 'הממ״ד מוצג כחדר עבודה שקט — שימוש יומיומי שקונים מעריכים.',
  balcony: () => 'פינת ישיבה קטנה ועציצים גבוהים — המרפסת היא תמונת הסיום של הסיור.',
  hall: () => 'קונסולה צרה ומראה בכניסה — הרושם הראשון של הנכס.',
};

const HOUSEHOLD_NOTE: Record<Household, string> = {
  couple: 'ההלבשה מכוונת לזוג צעיר: פינת עבודה בחדר הנוסף, שולחן אוכל לארבעה וסלון לאירוח קטן.',
  family: 'ההלבשה מכוונת למשפחה: חדרי ילדים מוגדרים, אחסון גלוי ושולחן אוכל לשישה.',
  single: 'ההלבשה מכוונת ליחיד/ה: חלל פתוח, פחות פריטים ויותר אוויר.',
  investor: 'ההלבשה ניטרלית ועמידה — מראה שמושך שוכרים ומצטלם היטב במודעה.',
};

/** Rough per-item price ranges in ILS for a staging estimate. */
const PRICE: Record<FurnitureKind, [number, number]> = {
  sofa: [3500, 9000],
  armchair: [1200, 3500],
  coffeeTable: [600, 2200],
  rug: [700, 3000],
  tvUnit: [1200, 4000],
  diningTable: [2500, 8000],
  bed: [2800, 8000],
  nightstand: [400, 1400],
  wardrobe: [3000, 9000],
  desk: [800, 2800],
  plant: [150, 600],
  floorLamp: [350, 1500],
  sideboard: [1200, 4500],
  singleBed: [1200, 3500],
  bistroSet: [900, 3000],
  shelf: [500, 2000],
  art: [300, 1800],
};

const BUDGET_FACTOR: Record<Budget, number> = { smart: 0, mid: 0.45, premium: 1 };

export interface StagingLine {
  room: string;
  items: string[];
  tip: string;
  cost: number;
}

export function stagingPlan(rooms: RoomType[], brief: DesignBrief) {
  const f = BUDGET_FACTOR[brief.budget];
  const lines: StagingLine[] = [];
  const seen = new Map<RoomType, number>();
  for (const t of rooms) {
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    const recipe = ROOM_RECIPE[t];
    if (!recipe.length) continue;
    const items = recipe.map((k) => (k === 'nightstand' ? 'זוג שידות לילה' : FURNITURE_NAMES[k]));
    const cost = recipe.reduce((sum, k) => {
      const [lo, hi] = PRICE[k];
      const one = lo + (hi - lo) * f;
      return sum + (k === 'nightstand' ? one * 2 : one);
    }, 0);
    lines.push({
      room: roomName(t) + (n > 1 ? ` ${n}` : ''),
      items,
      tip: ROOM_TIPS[t]?.(brief.style) || '',
      cost: Math.round(cost / 100) * 100,
    });
  }
  const total = lines.reduce((s, l) => s + l.cost, 0);
  return { lines, total, household: HOUSEHOLD_NOTE[brief.household] };
}

/** Recommend a style the way a designer would after a short brief. */
export function recommendStyle(household: Household, budget: Budget, sqm: number): { id: StyleId; why: string } {
  if (budget === 'premium' && sqm >= 110)
    return { id: 'classic', why: 'נכס גדול בתקציב פרימיום — קלאסי עכשווי מדגיש את הפרופורציות ואת איכות הגמר.' };
  if (household === 'investor')
    return { id: 'modern', why: 'לנכס להשקעה עדיף מראה נקי וניטרלי שכל שוכר יכול לדמיין את עצמו בו.' };
  if (household === 'family')
    return { id: 'scandi', why: 'סקנדינבי בהיר ועמיד — חם, פרקטי ומצטלם מצוין בסיור.' };
  if (sqm && sqm < 70)
    return { id: 'japandi', why: 'בדירה קומפקטית ריהוט נמוך ופלטה מאופקת מגדילים את החלל בעין.' };
  return { id: 'mediterranean', why: 'טקסטורות טבעיות וצבעי אדמה יוצרים סיור עם אווירה — מה שעוצר גלילה ברשתות.' };
}

export function styleSummary(brief: DesignBrief) {
  const s = styleById(brief.style);
  return `${s.name} — ${s.materials.slice(0, 3).join(', ')}`;
}

export const formatILS = (n: number) => '₪' + n.toLocaleString('he-IL');
