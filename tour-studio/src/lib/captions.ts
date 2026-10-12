import { factsLine, priceLine } from './overlay';
import { styleById } from './styles';
import type { Brand, Project } from './types';

const tag = (s: string) => '#' + s.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');

function hashtags(p: Project) {
  const d = p.details;
  const tags = [d.dealType === 'rent' ? 'דירה_להשכרה' : 'דירה_למכירה', 'נדלן', 'סיור_וירטואלי'];
  if (d.city) tags.push(tag(d.city).slice(1), tag('נדלן ' + d.city).slice(1));
  if (d.rooms) tags.push(`${d.rooms}_חדרים`.replace('.', '_'));
  if (p.design.furnish) tags.push('הום_סטיילינג', 'עיצוב_פנים');
  return tags.map((t) => '#' + t).join(' ');
}

function contact(b: Brand) {
  return [b.agentName, b.agentPhone].filter(Boolean).join(' · ');
}

export function captions(p: Project, b: Brand) {
  const d = p.details;
  const s = styleById(p.design.style);
  const price = priceLine(p);
  const where = [d.address, d.city].filter(Boolean).join(', ');
  const facts = factsLine(p).replace(/ {2}· {2}/g, ' | ');
  const staged = p.design.furnish
    ? `הסיור כולל הדמיית עיצוב בסגנון ${s.name} — כדי שיהיה קל לדמיין את הבית מוכן למגורים.`
    : '';

  const instagram = [
    `${d.dealType === 'rent' ? 'להשכרה' : 'למכירה'} · ${d.title || where}`,
    '',
    facts,
    price ? `מחיר: ${price}` : '',
    d.description ? '\n' + d.description : '',
    staged ? '\n' + staged : '',
    '',
    contact(b) ? `לתיאום ביקור: ${contact(b)}` : 'לפרטים ותיאום ביקור — בהודעה פרטית',
    '',
    hashtags(p),
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const facebook = [
    `${d.title || 'נכס חדש'}${where ? ' — ' + where : ''}`,
    '',
    `${facts}${price ? ' | ' + price : ''}`,
    '',
    d.description || 'דירה מוארת ומתוכננת היטב, עם חלוקה נוחה וחללים שמתאימים לחיים אמיתיים.',
    staged ? '\n' + staged : '',
    '',
    'צפו בסיור המלא בסרטון, ואם זה מדבר אליכם — נשמח לתאם ביקור.',
    contact(b) ? `לתיאום: ${contact(b)}` : '',
    b.agencyName ? b.agencyName : '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const whatsapp = [
    `שלום${d.clientName ? ' ' + d.clientName.split(' ')[0] : ''},`,
    `מצרף סיור וירטואלי ב${d.title ? d.title : 'נכס'}${where ? ' ב' + where : ''}.`,
    facts + (price ? ` | ${price}` : ''),
    p.design.furnish ? `הוספתי הדמיה של הדירה מרוהטת בסגנון ${s.name}, כדי שיהיה קל לדמיין.` : '',
    'אשמח לשמוע מה דעתך ולתאם ביקור.',
    b.agentName ? `\n${b.agentName}${b.agencyName ? ', ' + b.agencyName : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const emailSubject = `סיור וירטואלי — ${d.title || where || 'נכס'}${price ? ' | ' + price : ''}`;
  const emailBody = [
    `שלום${d.clientName ? ' ' + d.clientName : ''},`,
    '',
    `כפי שדיברנו, מצורף סיור וירטואלי בנכס${where ? ' ב' + where : ''}.`,
    '',
    `פרטי הנכס: ${facts}${price ? ', ' + price : ''}.`,
    d.description ? d.description : '',
    p.design.furnish ? `\nבסיור מוצגת הדמיית עיצוב בסגנון ${s.name} (${s.materials.slice(0, 3).join(', ')}). ההדמיה להמחשה בלבד ואינה חלק מהנכס.` : '',
    '',
    'אשמח לענות על כל שאלה ולתאם ביקור בזמן שנוח לך.',
    '',
    'בברכה,',
    [b.agentName, b.agencyName, b.agentPhone, b.agentEmail].filter(Boolean).join('\n'),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { instagram, facebook, whatsapp, emailSubject, emailBody };
}

export function waLink(phone: string, text: string) {
  let num = phone.replace(/[^\d]/g, '');
  if (num.startsWith('0')) num = '972' + num.slice(1);
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export function mailLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
