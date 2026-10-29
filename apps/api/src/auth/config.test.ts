import { describe, expect, it } from 'vitest';

import { mailConfigFromEnv } from '../mail/config.js';
import { authConfigFromEnv } from './config.js';

const PRODUCTION = {
  NODE_ENV: 'production',
  APP_URL: 'https://impact.example.com',
  SESSION_SECRET: 'f1d3b5a7c9e1f3a5b7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7',
  TRUST_PROXY: 'uniquelocal',
};

describe('auth configuration', () => {
  it('reads durations and limits with safe defaults', () => {
    const c = authConfigFromEnv({ NODE_ENV: 'test' });
    expect(c.sessionTtlMs).toBe(14 * 86_400_000);
    expect(c.sessionIdleMs).toBe(7 * 86_400_000);
    expect(c.magicLinkTtlMs).toBe(15 * 60_000);
    expect(c.rateLimitPerEmail).toBe(3);
    expect(c.rateLimitPerIp).toBe(10);
    expect(c.verifyLimitPerIp).toBe(20);
    expect(c.cookieName).toBe('mbc_session');
    expect(c.cookieSecure).toBe(false);
    expect(c.trustProxy).toBe(false);
    expect(c.production).toBe(false);
    expect(c.allowedOrigins).toEqual(['http://localhost:3000']);
    expect(authConfigFromEnv({ SESSION_TTL_DAYS: '3', APP_URL: 'https://x.example/' }).appUrl).toBe(
      'https://x.example',
    );
    expect(() => authConfigFromEnv({ SESSION_TTL_DAYS: 'soon' })).toThrow(/SESSION_TTL_DAYS/);
  });

  it('accepts a complete production configuration', () => {
    const c = authConfigFromEnv({
      ...PRODUCTION,
      AUTH_ALLOWED_ORIGINS: 'https://admin.example.com/',
    });
    expect(c.production).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.trustProxy).toBe('uniquelocal');
    expect(c.hashSecret).toBe(PRODUCTION.SESSION_SECRET);
    expect(c.allowedOrigins).toEqual(['https://impact.example.com', 'https://admin.example.com']);
  });

  it('refuses insecure cookies outside a local environment', () => {
    expect(() => authConfigFromEnv({ ...PRODUCTION, COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE=false/,
    );
    // No NODE_ENV at all is not a local environment either.
    expect(() => authConfigFromEnv({ COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false/);
    expect(
      authConfigFromEnv({ NODE_ENV: 'development', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(false);
    expect(authConfigFromEnv({ NODE_ENV: 'development' }).cookieSecure).toBe(false);
    expect(authConfigFromEnv({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }).cookieSecure).toBe(
      true,
    );
    // Unknown environments default to Secure.
    expect(authConfigFromEnv({ NODE_ENV: 'staging', SESSION_SECRET: 'x' }).cookieSecure).toBe(true);
  });

  it('requires https origins in production and rejects origins with paths', () => {
    expect(() =>
      authConfigFromEnv({ ...PRODUCTION, APP_URL: 'http://impact.example.com' }),
    ).toThrow(/APP_URL must use https/);
    expect(() =>
      authConfigFromEnv({ ...PRODUCTION, AUTH_ALLOWED_ORIGINS: 'http://other.example.com' }),
    ).toThrow(/AUTH_ALLOWED_ORIGINS entries must use https/);
    expect(() =>
      authConfigFromEnv({ ...PRODUCTION, AUTH_ALLOWED_ORIGINS: 'https://other.example.com/app' }),
    ).toThrow(/bare origin/);
    expect(() => authConfigFromEnv({ ...PRODUCTION, AUTH_ALLOWED_ORIGINS: 'not a url' })).toThrow(
      /not a valid URL/,
    );
    expect(() => authConfigFromEnv({ NODE_ENV: 'test', APP_URL: 'ftp://x.example' })).toThrow(
      /http or https/,
    );
  });

  it('requires a real secret for keyed hashes in production and a development key otherwise', () => {
    expect(() => authConfigFromEnv({ ...PRODUCTION, SESSION_SECRET: undefined })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => authConfigFromEnv({ ...PRODUCTION, SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() =>
      authConfigFromEnv({
        ...PRODUCTION,
        SESSION_SECRET: 'change-me-session-secret-change-me-now',
      }),
    ).toThrow(/placeholder/);
    expect(authConfigFromEnv({ NODE_ENV: 'development' }).hashSecret).toMatch(/development-only/);
    expect(authConfigFromEnv({ NODE_ENV: 'development', SESSION_SECRET: 'local' }).hashSecret).toBe(
      'local',
    );
  });

  it('requires an explicit proxy-trust decision in production and never trusts everyone', () => {
    expect(() => authConfigFromEnv({ ...PRODUCTION, TRUST_PROXY: undefined })).toThrow(
      /TRUST_PROXY/,
    );
    expect(() => authConfigFromEnv({ ...PRODUCTION, TRUST_PROXY: 'true' })).toThrow(/every client/);
    expect(authConfigFromEnv({ ...PRODUCTION, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(authConfigFromEnv({ ...PRODUCTION, TRUST_PROXY: '172.18.0.0/16' }).trustProxy).toBe(
      '172.18.0.0/16',
    );
    expect(authConfigFromEnv({ NODE_ENV: 'development', TRUST_PROXY: '' }).trustProxy).toBe(false);
  });

  it('allows test registrations to sign in only through an explicit non-production setting (OQ-27)', () => {
    expect(authConfigFromEnv({ NODE_ENV: 'test' }).allowTestRegistrations).toBe(false);
    expect(
      authConfigFromEnv({ NODE_ENV: 'development', AUTH_ALLOW_TEST_REGISTRATIONS: 'true' })
        .allowTestRegistrations,
    ).toBe(true);
    expect(authConfigFromEnv(PRODUCTION).allowTestRegistrations).toBe(false);
    expect(() =>
      authConfigFromEnv({ ...PRODUCTION, AUTH_ALLOW_TEST_REGISTRATIONS: 'true' }),
    ).toThrow(/AUTH_ALLOW_TEST_REGISTRATIONS must not be set in production/);
  });

  it('reports every problem of a contradictory production environment at once', () => {
    expect(() =>
      authConfigFromEnv({
        NODE_ENV: 'production',
        APP_URL: 'http://x.example',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE=false.*APP_URL must use https.*SESSION_SECRET.*TRUST_PROXY/s);
  });
});

describe('mail configuration in production', () => {
  const base = { NODE_ENV: 'production', MAIL_FROM: 'ITTEC <no-reply@example.com>' };

  it('requires a real relay: test transports are rejected', () => {
    expect(() => mailConfigFromEnv({ ...base, MAIL_TRANSPORT: 'mailpit' })).toThrow(
      /MAIL_TRANSPORT=mailpit is not allowed in production/,
    );
    expect(() => mailConfigFromEnv({ ...base, MAIL_TRANSPORT: 'memory' })).toThrow(
      /not allowed in production/,
    );
    expect(() => mailConfigFromEnv({ ...base, MAIL_TRANSPORT: 'smtp', SMTP_HOST: '' })).toThrow(
      /SMTP_HOST is required/,
    );
    expect(
      mailConfigFromEnv({ ...base, MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com' }).smtp
        .host,
    ).toBe('smtp.example.com');
  });

  it('still allows the local inbox outside production and treats blank values as unset', () => {
    const c = mailConfigFromEnv({
      NODE_ENV: 'development',
      MAIL_TRANSPORT: 'mailpit',
      MAIL_FROM: 'x@example.com',
      SMTP_HOST: '',
      MAILPIT_HOST: '127.0.0.1',
    });
    expect(c.transport).toBe('mailpit');
    expect(c.smtp.host).toBe('127.0.0.1');
  });
});
