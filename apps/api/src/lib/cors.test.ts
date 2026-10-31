import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { authConfigFromEnv } from '../auth/config.js';
import { serializeClearedCookie, serializeSessionCookie } from '../auth/cookies.js';

const silent = pino({ level: 'silent' });
const WEB = 'http://localhost:33333';
const OTHER = 'https://evil.example.com';

/**
 * Cross-origin access, added when the reverse proxy was removed (2026-10-31): the browser loads
 * pages from the web app's origin and calls the API on its own. These checks need no database:
 * a preflight is answered before any route, and a cookie-less request never resolves a session.
 */
const app = () =>
  createApp({
    logger: silent,
    authConfig: authConfigFromEnv({ NODE_ENV: 'test', APP_URL: WEB }),
  });

describe('CORS for the web origin', () => {
  it('answers a preflight from the web app with the echoed origin, credentials and the cached methods', async () => {
    const res = await request(app())
      .options('/api/v1/auth/me')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(res.headers['access-control-max-age']).toBe('600');
    // Caches must not hand one origin's response to another.
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('allows a credentialled read from the web app and names one origin rather than a wildcard', async () => {
    const res = await request(app()).get('/api/v1/auth/me').set('Origin', WEB);

    // No cookie, so the route itself refuses; the CORS headers still travel with the 401 so the
    // browser hands the body to the caller instead of a opaque network error.
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('tells an origin outside the allowlist nothing, on a preflight and on a real request', async () => {
    const preflight = await request(app())
      .options('/api/v1/auth/me')
      .set('Origin', OTHER)
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    expect(preflight.headers.vary).toMatch(/Origin/);

    const read = await request(app()).get('/api/v1/auth/me').set('Origin', OTHER);
    expect(read.headers['access-control-allow-origin']).toBeUndefined();

    // The CSRF check is unchanged: a state-changing call from elsewhere is refused outright.
    const write = await request(app()).post('/api/v1/auth/sign-out').set('Origin', OTHER);
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('forbidden_origin');
    expect(write.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds no allow-origin header when there is no Origin, as for the server-rendered calls', async () => {
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('session cookie across two origins', () => {
  it('stays host-only by default, which already covers one host on two ports', () => {
    const cookie = serializeSessionCookie('tok', {
      name: 'mbc_session',
      secure: true,
      maxAgeSeconds: 60,
    });
    expect(cookie).not.toMatch(/Domain=/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
  });

  it('widens to the parent domain when COOKIE_DOMAIN is set, and clearing repeats it', () => {
    const config = authConfigFromEnv({
      NODE_ENV: 'test',
      APP_URL: 'http://app.example.com',
      COOKIE_DOMAIN: '.example.com',
    });
    // The leading dot is historical syntax; the stored value is the bare hostname.
    expect(config.cookieDomain).toBe('example.com');

    const cookie = serializeSessionCookie('tok', {
      name: config.cookieName,
      secure: false,
      maxAgeSeconds: 60,
      domain: config.cookieDomain,
    });
    expect(cookie).toMatch(/Domain=example\.com/);
    // Without the same Domain on the way out the browser would keep the wider cookie.
    expect(serializeClearedCookie(config.cookieName, false, config.cookieDomain)).toMatch(
      /Domain=example\.com/,
    );
  });

  it('refuses a COOKIE_DOMAIN that carries a scheme or a port', () => {
    expect(() =>
      authConfigFromEnv({ NODE_ENV: 'test', COOKIE_DOMAIN: 'https://example.com' }),
    ).toThrow(/COOKIE_DOMAIN/);
    expect(() =>
      authConfigFromEnv({ NODE_ENV: 'test', COOKIE_DOMAIN: 'example.com:44444' }),
    ).toThrow(/COOKIE_DOMAIN/);
  });
});
