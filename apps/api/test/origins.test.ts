import { describe, expect, it } from 'vitest';
import { allowedOrigin } from '../src/lib/security.js';

describe('allowedOrigin', () => {
  it('accepts the website, the desktop app and requests without an Origin', () => {
    expect(allowedOrigin('http://localhost:3000')).toBe(true);
    expect(allowedOrigin('app://dev102')).toBe(true);
    expect(allowedOrigin(undefined)).toBe(true);
  });

  it('accepts the browser extension whose ID is fixed by its manifest key', () => {
    expect(allowedOrigin('chrome-extension://fgfompcfejncbbpbipjokoniblfihbnm')).toBe(true);
  });

  it('accepts the website on another local port in development (npm start picks the next free one)', () => {
    expect(allowedOrigin('http://localhost:3001')).toBe(true);
    expect(allowedOrigin('http://127.0.0.1:3005')).toBe(true);
    expect(allowedOrigin('http://localhost.evil.example:3000')).toBe(false);
  });

  it('refuses other extensions and sites', () => {
    expect(allowedOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(allowedOrigin('https://evil.example')).toBe(false);
  });
});
