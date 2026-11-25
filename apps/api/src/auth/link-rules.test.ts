import { describe, expect, it } from 'vitest';

import { defaultLinkRules, effectiveLink, linkRulesFor } from './link-rules.js';

const MIN = 60_000;
const platform = 15 * MIN;
const plain = { signInLinkTtlMinutes: null, signInLinkReusable: false };

describe('linkRulesFor (2026-11-25)', () => {
  it('keeps the platform setting when no event changes it', () => {
    expect(linkRulesFor(platform, [])).toEqual({ ttlMs: platform, reusable: false });
    expect(linkRulesFor(platform, [plain])).toEqual({ ttlMs: platform, reusable: false });
  });

  it('takes the most lenient of the delegate’s events, never shorter than the platform', () => {
    expect(
      linkRulesFor(platform, [plain, { signInLinkTtlMinutes: 1440, signInLinkReusable: false }]),
    ).toEqual({ ttlMs: 1440 * MIN, reusable: false });
    expect(
      linkRulesFor(platform, [{ signInLinkTtlMinutes: 5, signInLinkReusable: false }]).ttlMs,
    ).toBe(platform);
    expect(
      linkRulesFor(platform, [
        { signInLinkTtlMinutes: 1440, signInLinkReusable: false },
        { signInLinkTtlMinutes: 0, signInLinkReusable: true },
      ]),
    ).toEqual({ ttlMs: null, reusable: true });
  });

  it('gives staff the platform rules', () => {
    expect(defaultLinkRules(platform)).toEqual({ ttlMs: platform, reusable: false });
  });
});

describe('effectiveLink', () => {
  const createdAt = new Date('2026-11-25T08:00:00Z');
  const longLink = {
    createdAt,
    expiresAt: new Date('2126-11-25T08:00:00Z'),
    reusable: true,
  };

  it('keeps a link as sent while the rules still allow it', () => {
    expect(effectiveLink(longLink, { ttlMs: null, reusable: true })).toEqual({
      expiresAt: longLink.expiresAt,
      reusable: true,
    });
  });

  it('cuts a link short once the event goes back to the platform setting', () => {
    expect(effectiveLink(longLink, { ttlMs: platform, reusable: false })).toEqual({
      expiresAt: new Date(createdAt.getTime() + platform),
      reusable: false,
    });
  });

  it('never lengthens a link sent under stricter rules', () => {
    const short = {
      createdAt,
      expiresAt: new Date(createdAt.getTime() + platform),
      reusable: false,
    };
    expect(effectiveLink(short, { ttlMs: null, reusable: true })).toEqual({
      expiresAt: short.expiresAt,
      reusable: false,
    });
  });
});
