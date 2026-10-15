/** Hebrew room names as printed on plans, mapped to room types. */
import type { RoomType } from './types';

// word stems → room type; the first match wins, so the specific ones come first
const WORDS: [RegExp, RoomType][] = [
  [/הורים/, 'master'],
  [/ילדים/, 'kids'],
  [/שינה/, 'bedroom'],
  // OCR reads the gershayim of ממ״ד as a yod or two
  [/ממד|ממי{1,2}ד|מ\.מ\.ד|מרחב מוגן/, 'mamad'],
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
  // thin CAD lettering often loses or swaps one letter: accept a near miss on the longer names
  // without the abbreviated "ח." / "ת." in front of the name
  const letters = w.replace(/^[א-ת]\s*\.\s*/, '').replace(/[^א-ת]/g, '');
  if (letters.length >= 4) {
    // the closest name, if it is close enough and clearly closer than any other
    let best: RoomType | null = null,
      bd = 99,
      second = 99;
    for (const [stem, t] of NEAR) {
      if (Math.abs(letters.length - stem.length) > 1) continue;
      const d = editDistance(letters, stem);
      if (d < bd) (second = bd), (bd = d), (best = t);
      else if (d < second) second = d;
    }
    if (best && (bd <= 1 || (bd === 2 && second >= 3 && w.length > letters.length))) return best;
  }
  return null;
}

const NEAR: [string, RoomType][] = [
  ['רחצה', 'bathroom'],
  ['שינה', 'bedroom'],
  ['הורים', 'master'],
  ['ילדים', 'kids'],
  ['מטבח', 'kitchen'],
  ['מרפסת', 'balcony'],
  ['מגורים', 'living'],
  ['סלון', 'living'],
  ['אוכל', 'living'],
  ['שירותים', 'bathroom'],
  ['אמבטיה', 'bathroom'],
  ['מקלחת', 'bathroom'],
  ['מסדרון', 'hall'],
  ['מבואה', 'hall'],
  ['כביסה', 'storage'],
  ['מחסן', 'storage'],
  ['עבודה', 'office'],
];

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
