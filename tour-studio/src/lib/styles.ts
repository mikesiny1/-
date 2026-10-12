import type { Budget, FurnitureKind, Household, RoomType, StyleId } from './types';

export type FloorKind = 'oak' | 'herringbone' | 'concrete' | 'terrazzo' | 'tile' | 'walnut';
export type RugPattern = 'plain' | 'stripe' | 'border' | 'kilim' | 'grid';

export interface StyleDef {
  id: StyleId;
  name: string;
  latin: string;
  line: string;
  story: string;
  materials: string[];
  wall: string;
  ceiling: string;
  floor: FloorKind;
  floorTone: string;
  wood: string;
  woodDark: string;
  fabric: string;
  fabricAlt: string;
  accent: string;
  metal: string;
  metalRough: number;
  stone: string;
  rug: string;
  rugAlt: string;
  rugPattern: RugPattern;
  legs: 'wood' | 'metal' | 'turned';
  softness: number; // corner radius factor for upholstery
  plants: number; // 0..1 density
  /** grading applied to photo tours, very subtle */
  grade: { warmth: number; contrast: number; saturation: number };
}

export const STYLES: StyleDef[] = [
  {
    id: 'modern',
    name: 'מודרני נקי',
    latin: 'Contemporary',
    line: 'קווים ישרים, משטחים חלקים, מעט פריטים — כל אחד במקומו.',
    story:
      'בסיס אפור-חם עם נגיעות שחור מט. ספה נמוכה וארוכה מגדירה את הסלון, שולחן אוכל מוקף כיסאות מרופדים, ותאורה עקיפה שמשאירה את החלל רגוע. מתאים לקונים שמחפשים דירה "מוכנה לכניסה".',
    materials: ['פורצלן אפור בהיר', 'פורניר אלון מעושן', 'בד פשתן אפור', 'מתכת שחורה מט'],
    wall: '#e9e6e0',
    ceiling: '#f4f3f0',
    floor: 'tile',
    floorTone: '#cfccc6',
    wood: '#8a7360',
    woodDark: '#4a3d33',
    fabric: '#8d8a85',
    fabricAlt: '#3b3a38',
    accent: '#b36b3e',
    metal: '#1f1f1f',
    metalRough: 0.5,
    stone: '#e8e5df',
    rug: '#b8b2a8',
    rugAlt: '#8e877c',
    rugPattern: 'border',
    legs: 'metal',
    softness: 0.03,
    plants: 0.5,
    grade: { warmth: 0, contrast: 1.04, saturation: 0.98 },
  },
  {
    id: 'scandi',
    name: 'סקנדינבי',
    latin: 'Scandinavian',
    line: 'בהיר, אוורירי ונגיש. עץ בהיר, טקסטיל רך והרבה אור.',
    story:
      'פרקט אלון בהיר, קירות לבנים-חמים וטקסטיל צמר בגווני שמנת ואפור. הריהוט על רגלי עץ דקות כדי שהרצפה "תנשום" והחדרים ייראו גדולים יותר. הבחירה הבטוחה למשפחות צעירות.',
    materials: ['פרקט אלון מולבן', 'צמר ובוקלה', 'עץ אשור', 'קרמיקה מט'],
    wall: '#f2efe9',
    ceiling: '#f8f7f4',
    floor: 'oak',
    floorTone: '#d9c6a5',
    wood: '#d2b48c',
    woodDark: '#a7835a',
    fabric: '#d9d4cb',
    fabricAlt: '#7d8a8f',
    accent: '#c99a5b',
    metal: '#d9d6d0',
    metalRough: 0.6,
    stone: '#ece9e3',
    rug: '#e7e1d6',
    rugAlt: '#b9b2a6',
    rugPattern: 'grid',
    legs: 'wood',
    softness: 0.06,
    plants: 0.8,
    grade: { warmth: 0.02, contrast: 1.0, saturation: 0.95 },
  },
  {
    id: 'japandi',
    name: 'ג׳פנדי',
    latin: 'Japandi',
    line: 'שקט יפני ופונקציונליות סקנדינבית. נמוך, טבעי ומדוד.',
    story:
      'פלטה של חול, עץ אגוז ופחם. ריהוט נמוך, מעט אביזרים וחומרים טבעיים — פשתן, נייר אורז, עץ גושני. החלל מרגיש מסודר ויקר בלי להיות קר. עובד מצוין בדירות קטנות.',
    materials: ['עץ אגוז', 'פשתן גולמי', 'טיח מינרלי', 'אבן טבעית'],
    wall: '#e6dfd3',
    ceiling: '#efeae2',
    floor: 'oak',
    floorTone: '#b8956a',
    wood: '#7a5a3c',
    woodDark: '#3e2e22',
    fabric: '#cbbfa9',
    fabricAlt: '#5d5a52',
    accent: '#6b7a5a',
    metal: '#2c2a27',
    metalRough: 0.7,
    stone: '#d8d0c3',
    rug: '#d4c9b5',
    rugAlt: '#a89a82',
    rugPattern: 'plain',
    legs: 'wood',
    softness: 0.08,
    plants: 0.6,
    grade: { warmth: 0.04, contrast: 1.02, saturation: 0.9 },
  },
  {
    id: 'industrial',
    name: 'תעשייתי לופט',
    latin: 'Industrial Loft',
    line: 'בטון, מתכת ועור. אופי עירוני עם חום של עץ ממוחזר.',
    story:
      'רצפת בטון מוחלק, ספת עור קוניאק, מדפי מתכת ועץ גושני. התאורה בגוונים חמים מאזנת את החומרים הקשים. מושך קונים צעירים ומשקיעים בדירות בעיר.',
    materials: ['בטון מוחלק', 'עור קוניאק', 'פלדה שחורה', 'עץ ממוחזר'],
    wall: '#d9d6d1',
    ceiling: '#e3e1dd',
    floor: 'concrete',
    floorTone: '#9d9a94',
    wood: '#6b4a32',
    woodDark: '#3a2a1e',
    fabric: '#8b5a35',
    fabricAlt: '#3d3d3b',
    accent: '#a0522d',
    metal: '#232323',
    metalRough: 0.45,
    stone: '#bdbab4',
    rug: '#6d6a64',
    rugAlt: '#3f3d3a',
    rugPattern: 'stripe',
    legs: 'metal',
    softness: 0.04,
    plants: 0.4,
    grade: { warmth: 0.03, contrast: 1.08, saturation: 0.92 },
  },
  {
    id: 'mediterranean',
    name: 'ים-תיכוני',
    latin: 'Mediterranean',
    line: 'טרצו, ראטן, פשתן וגוונים של אדמה וים.',
    story:
      'קירות בגוון גיר חם, רצפת טרצו, ריהוט קש וראטן וטקסטיל בגווני טרקוטה וזית. נגיעות קרמיקה בעבודת יד. מרגיש כמו דירת חופשה — מתאים במיוחד לדירות עם מרפסת.',
    materials: ['טרצו', 'ראטן וקש', 'פשתן טרקוטה', 'קרמיקה עבודת יד'],
    wall: '#efe6d8',
    ceiling: '#f6f1e8',
    floor: 'terrazzo',
    floorTone: '#e2d8c8',
    wood: '#b5895a',
    woodDark: '#7a5534',
    fabric: '#e8dcc8',
    fabricAlt: '#b8643d',
    accent: '#6f7d4a',
    metal: '#8a6a3a',
    metalRough: 0.4,
    stone: '#eae1d2',
    rug: '#d9c7a8',
    rugAlt: '#b8643d',
    rugPattern: 'kilim',
    legs: 'wood',
    softness: 0.09,
    plants: 1,
    grade: { warmth: 0.06, contrast: 1.0, saturation: 1.03 },
  },
  {
    id: 'classic',
    name: 'קלאסי עכשווי',
    latin: 'Modern Classic',
    line: 'פרקט הרינגבון, קטיפה ופליז. אלגנטי בלי להיות כבד.',
    story:
      'פרקט בדוגמת אדרה, קירות בגוון גרגיר, ספת קטיפה בירוק בקבוק ונגיעות פליז מוברש. פרופורציות סימטריות ותאורה רכה. משדר יוקרה — מתאים לנכסי פרימיום ודירות גן.',
    materials: ['פרקט הרינגבון אגוז', 'קטיפה', 'פליז מוברש', 'שיש קלקטה'],
    wall: '#ece6dc',
    ceiling: '#f5f2ec',
    floor: 'herringbone',
    floorTone: '#a87d52',
    wood: '#6a4630',
    woodDark: '#3b2619',
    fabric: '#e4dccd',
    fabricAlt: '#2f4a3e',
    accent: '#b08d57',
    metal: '#b08d57',
    metalRough: 0.3,
    stone: '#f1eee8',
    rug: '#c9bca6',
    rugAlt: '#7c6a52',
    rugPattern: 'border',
    legs: 'turned',
    softness: 0.07,
    plants: 0.5,
    grade: { warmth: 0.04, contrast: 1.03, saturation: 1.0 },
  },
  {
    id: 'boho',
    name: 'בוהו מודרני',
    latin: 'Modern Boho',
    line: 'שכבות של טקסטורות, צמחייה ומלאכת יד, בצבעוניות מאופקת.',
    story:
      'בסיס לבן-חם, שטיחי קילים, ראטן, מקרמה והרבה ירוק. הספה רכה ונמוכה, והאביזרים מספרים סיפור. מתאים להשכרה לצעירים ולנכסים עם אופי.',
    materials: ['ראטן', 'כותנה ומקרמה', 'עץ מנגו', 'קילים'],
    wall: '#f1ebe1',
    ceiling: '#f7f3ec',
    floor: 'oak',
    floorTone: '#c9a77c',
    wood: '#9c6b43',
    woodDark: '#5e3d24',
    fabric: '#e9dfcf',
    fabricAlt: '#c07a4e',
    accent: '#8c8a4a',
    metal: '#9b7a4c',
    metalRough: 0.5,
    stone: '#ece4d6',
    rug: '#c9a988',
    rugAlt: '#8e4e33',
    rugPattern: 'kilim',
    legs: 'wood',
    softness: 0.1,
    plants: 1,
    grade: { warmth: 0.07, contrast: 1.0, saturation: 1.02 },
  },
];

export const styleById = (id: StyleId) => STYLES.find((s) => s.id === id) || STYLES[0];

export const ROOM_TYPES: { id: RoomType; name: string }[] = [
  { id: 'living', name: 'סלון' },
  { id: 'kitchen', name: 'מטבח' },
  { id: 'dining', name: 'פינת אוכל' },
  { id: 'master', name: 'חדר הורים' },
  { id: 'bedroom', name: 'חדר שינה' },
  { id: 'kids', name: 'חדר ילדים' },
  { id: 'office', name: 'חדר עבודה' },
  { id: 'mamad', name: 'ממ״ד' },
  { id: 'bathroom', name: 'חדר רחצה' },
  { id: 'balcony', name: 'מרפסת' },
  { id: 'hall', name: 'מבואה / מסדרון' },
  { id: 'storage', name: 'מחסן / שירות' },
];

export const roomName = (t: RoomType) => ROOM_TYPES.find((r) => r.id === t)?.name || t;

export const FURNITURE_NAMES: Record<FurnitureKind, string> = {
  sofa: 'ספה',
  armchair: 'כורסה',
  coffeeTable: 'שולחן סלון',
  rug: 'שטיח',
  tvUnit: 'מזנון',
  diningTable: 'פינת אוכל',
  bed: 'מיטה זוגית',
  nightstand: 'שידת לילה',
  wardrobe: 'ארון',
  desk: 'שולחן עבודה',
  plant: 'עציץ',
  floorLamp: 'מנורה עומדת',
  sideboard: 'קונסולה',
  singleBed: 'מיטת יחיד',
  bistroSet: 'פינת ישיבה למרפסת',
  shelf: 'כוננית',
  art: 'תמונה לקיר',
};

export const HOUSEHOLDS: { id: Household; name: string; hint: string }[] = [
  { id: 'couple', name: 'זוג צעיר', hint: 'פינת עבודה, אירוח קטן, אווירה' },
  { id: 'family', name: 'משפחה', hint: 'עמידות, אחסון, חדרי ילדים' },
  { id: 'single', name: 'יחיד/ה', hint: 'גמישות, חלל פתוח' },
  { id: 'investor', name: 'משקיעים / השכרה', hint: 'ניטרלי, עמיד, מושך לשוכרים' },
];

export const BUDGETS: { id: Budget; name: string; hint: string }[] = [
  { id: 'smart', name: 'חסכוני', hint: 'רשתות, פריטים זמינים' },
  { id: 'mid', name: 'בינוני', hint: 'שילוב רשתות ומעצבים' },
  { id: 'premium', name: 'פרימיום', hint: 'יבוא ונגרות בהתאמה' },
];
