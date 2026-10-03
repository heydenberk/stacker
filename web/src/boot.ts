/** Absolute URL of the app root, e.g. ('https://heydenberk.com', '/stacker/') -> 'https://heydenberk.com/stacker/'. */
export function appRootUrl(origin: string, baseUrl: string): string {
  const base = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return `${origin.replace(/\/+$/, '')}${base.endsWith('/') ? base : `${base}/`}`;
}

/** Spotify redirect params from a query string; null when neither `code` nor `error` is present. */
export function authCallbackParams(search: string): { code: string | null; error: string | null } | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const error = params.get('error');
  return code === null && error === null ? null : { code, error };
}
