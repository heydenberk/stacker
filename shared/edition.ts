/** Edition and remaster markers in album and track names. Dependency-free: used by the builder and the web app. */
export const EDITION_RX =
  /\b(re-?master(ed)?|remastering|deluxe|expanded|anniversary|edition|reissue|re-issue|mono|stereo|bonus tracks?|(album|original|expanded|deluxe) version)\b/i;

/** Drop "(Remastered 2014)", "[Deluxe Edition]", " - 2009 Remaster" and similar. */
export function stripEdition(title: string): string {
  let t = title.replace(/\s*(\([^()]*\)|\[[^[\]]*\])/g, (group: string) => (EDITION_RX.test(group) ? '' : group));
  t = t.replace(/\s+[-–—]\s+[^-–—]*$/, (suffix: string) => (EDITION_RX.test(suffix) ? '' : suffix));
  t = t.trim();
  return t === '' ? title.trim() : t;
}
