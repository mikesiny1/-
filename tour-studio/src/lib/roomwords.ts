/** Hebrew room names as printed on plans, mapped to room types. */
import type { RoomType } from './types';

// word stems → room type; the first match wins, so the specific ones come first
const WORDS: [RegExp, RoomType][] = [
  [/הורים/, 'master'],
  [/ילדים/, 'kids'],
  [/שינה/, 'bedroom'],
  [/ממד|מ\.מ\.ד|מרחב מוגן/, 'mamad'],
  [/מטבח|מטבחון/, 'kitchen'],
  [/מרפס|גזוזטר|מרפ"ש/, 'balcony'],
  [/סלון|מגורים|אוכל|טרקלין/, 'living'],
  [/רחצה|אמבט|מקלחת|שירות|שרות|אורחים|ש\.א/, 'bathroom'],
  [/עבודה|ספריה|משרד/, 'office'],
  [/מבוא|מסדרון|פרוזדור|כניסה|לובי/, 'hall'],
  [/מחסן|כביסה|ארונות|מזווה/, 'storage'],
];

export function typeOfWord(raw: string): RoomType | null {
  const w = raw.replace(/[֑-ׇ'"״׳`]/g, '').trim();
  if (w.length < 2) return null;
  for (const [re, t] of WORDS) if (re.test(w) || re.test([...w].reverse().join(''))) return t;
  return null;
}
