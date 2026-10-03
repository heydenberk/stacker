import { describe, expect, it } from 'vitest';
import { appRootUrl, authCallbackParams } from './boot';

describe('appRootUrl', () => {
  it('joins origin and base', () => {
    expect(appRootUrl('https://heydenberk.com', '/stacker/')).toBe('https://heydenberk.com/stacker/');
  });
  it('tolerates trailing/missing slashes', () => {
    expect(appRootUrl('https://heydenberk.com/', '/stacker/')).toBe('https://heydenberk.com/stacker/');
    expect(appRootUrl('https://heydenberk.com', '/stacker')).toBe('https://heydenberk.com/stacker/');
    expect(appRootUrl('http://127.0.0.1:5173', '/')).toBe('http://127.0.0.1:5173/');
  });
});

describe('authCallbackParams', () => {
  it('code with state', () => {
    expect(authCallbackParams('?code=abc&state=xyz')).toEqual({ code: 'abc', error: null });
  });
  it('error with state', () => {
    expect(authCallbackParams('?error=access_denied&state=xyz')).toEqual({ code: null, error: 'access_denied' });
  });
  it('code without state is not a Spotify redirect', () => {
    expect(authCallbackParams('?code=abc')).toBeNull();
  });
  it('error without state is not a Spotify redirect', () => {
    expect(authCallbackParams('?error=access_denied')).toBeNull();
  });
  it('state alone is not a Spotify redirect', () => {
    expect(authCallbackParams('?state=xyz')).toBeNull();
  });
  it('neither', () => {
    expect(authCallbackParams('')).toBeNull();
    expect(authCallbackParams('?foo=bar')).toBeNull();
  });
  it('code with other params', () => {
    expect(authCallbackParams('?code=abc&state=xyz&foo=1')).toEqual({ code: 'abc', error: null });
  });
});
