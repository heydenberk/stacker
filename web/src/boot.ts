/** Absolute URL of the app root, e.g. ('https://heydenberk.com', '/stacker/') -> 'https://heydenberk.com/stacker/'. */
export function appRootUrl(origin: string, baseUrl: string): string {
  const base = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return `${origin.replace(/\/+$/, '')}${base.endsWith('/') ? base : `${base}/`}`;
}

/**
 * Spotify redirect params from a query string. Spotify always echoes `state`, so this is null unless
 * `state` is present together with `code` or `error`.
 */
export function authCallbackParams(search: string): { code: string | null; error: string | null } | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const error = params.get('error');
  if (params.get('state') === null || (code === null && error === null)) return null;
  return { code, error };
}
