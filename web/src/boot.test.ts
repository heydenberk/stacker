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
  it('code only', () => {
    expect(authCallbackParams('?code=abc')).toEqual({ code: 'abc', error: null });
  });
  it('error only', () => {
    expect(authCallbackParams('?error=access_denied')).toEqual({ code: null, error: 'access_denied' });
  });
  it('neither', () => {
    expect(authCallbackParams('')).toBeNull();
    expect(authCallbackParams('?foo=bar')).toBeNull();
  });
  it('code with other params', () => {
    expect(authCallbackParams('?code=abc&state=xyz&foo=1')).toEqual({ code: 'abc', error: null });
  });
});
