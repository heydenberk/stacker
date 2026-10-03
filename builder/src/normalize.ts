import he from 'he';

export function decodeEntities(s: string): string {
  return he.decode(s);
}

/** Comparable form: no accents/punctuation/apostrophes, lowercase, "&" → "and", no leading "the". */
export function normText(s: string): string {
  const t = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ß/g, 'ss')
    .replace(/['\u2019]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.replace(/^the /, '');
}

// Shared with the web app, which strips editions from displayed track names.
export { EDITION_RX, stripEdition } from '../../shared/edition';

/** RYM writes alternate titles as "Main [Alternate]"; return both. */
export function titleVariants(title: string): string[] {
  const m = title.match(/^(.*)\s*\[([^[\]]+)\]\s*$/);
  if (!m) return [title];
  return [m[1].trim(), m[2].trim()].filter((v) => v.length > 0);
}
