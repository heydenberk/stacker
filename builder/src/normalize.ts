import he from 'he';

export function decodeEntities(s: string): string {
  return he.decode(s);
}

/** Comparable form: no accents/punctuation, lowercase, "&" → "and", no leading "the". */
export function normText(s: string): string {
  const t = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.replace(/^the /, '');
}

const EDITION = /\b(remaster(ed)?|deluxe|expanded|anniversary|edition|version|mono|stereo|bonus|reissue|legacy|special)\b/i;

/** Drop "(Remastered 2014)", "[Deluxe Edition]", " - 2009 Remaster" and similar. */
export function stripEdition(title: string): string {
  let t = title.replace(/\s*[([]([^)\]]*)[)\]]/g, (group: string, inner: string) => (EDITION.test(inner) ? '' : group));
  t = t.replace(/\s+[-–—]\s+[^-–—]*$/, (suffix: string) => (EDITION.test(suffix) ? '' : suffix));
  return t.trim();
}

/** RYM writes alternate titles as "Main [Alternate]"; return both. */
export function titleVariants(title: string): string[] {
  const m = title.match(/^(.*?)\s*\[(.+)\]\s*$/);
  if (!m) return [title];
  return [m[1].trim(), m[2].trim()].filter((v) => v.length > 0);
}
