import { describe, it, expect } from 'vitest';
import { toRfc3339Nano } from '../lib/time';
import { signAccessToken, verifyToken, extractToken } from '../lib/auth';
import { localize } from '../lib/i18n';

describe('RFC3339Nano timestamps (§7.3)', () => {
  it('pads ms to 9 fractional digits and keeps Z', () => {
    const out = toRfc3339Nano('2026-06-02T10:30:00.123Z');
    expect(out).toBe('2026-06-02T10:30:00.123000000Z');
    expect(out).toMatch(/\.\d{9}Z$/);
  });
});

describe('auth (§7.1 / Q1)', () => {
  it('signs and verifies an access token', () => {
    const access = signAccessToken('user-1', 'user');
    const claims = verifyToken(access);
    expect(claims?.sub).toBe('user-1');
    expect(claims?.typ).toBe('access');
  });
  it('accepts both X-User-Token and Authorization: Bearer, preferring X-User-Token', () => {
    expect(extractToken({ 'x-user-token': 'A', authorization: 'Bearer B' })).toBe('A');
    expect(extractToken({ authorization: 'Bearer B' })).toBe('B');
    expect(extractToken({}, 'query-token')).toBe('query-token');
    expect(extractToken({})).toBeNull();
  });
});

describe('localization (§15.4)', () => {
  it('localizes by language with en fallback', () => {
    expect(localize('forbidden', 'ru')).toBe('Доступ запрещён');
    expect(localize('forbidden', 'zh')).toBe('Forbidden'); // no zh entry → en
    expect(localize('rate_limited', 'uz')).toBe('Juda koʻp soʻrov');
  });
});
