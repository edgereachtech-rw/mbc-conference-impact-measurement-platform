/**
 * Per-event sign-in link rules (2026-11-25). An event can let its delegates' sign-in links last
 * longer, not expire at all, or be used more than once: for delegates whose company mail server
 * holds emails for hours, or who share one device. Staff never get them.
 */

/** The event settings the rules come from. */
export interface EventLinkSettings {
  /** null: the platform's MAGIC_LINK_TTL_MINUTES; 0: does not expire. */
  signInLinkTtlMinutes: number | null;
  signInLinkReusable: boolean;
}

export interface LinkRules {
  /** How long a link lasts; null when it does not expire. */
  ttlMs: number | null;
  reusable: boolean;
}

/** Stored as the expiry of a link that does not expire (the column cannot be empty). */
export const NEVER_EXPIRES_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * The rules for a delegate registered for these events: the most lenient applies, and never
 * shorter than the platform's own lifetime.
 */
export function linkRulesFor(
  defaultTtlMs: number,
  events: readonly EventLinkSettings[],
): LinkRules {
  let ttlMs: number | null = defaultTtlMs;
  let reusable = false;
  for (const e of events) {
    if (e.signInLinkReusable) reusable = true;
    if (e.signInLinkTtlMinutes === null) continue;
    if (e.signInLinkTtlMinutes === 0) ttlMs = null;
    else if (ttlMs !== null) ttlMs = Math.max(ttlMs, e.signInLinkTtlMinutes * 60_000);
  }
  return { ttlMs, reusable };
}

/** The platform's rules: what staff always get. */
export const defaultLinkRules = (defaultTtlMs: number): LinkRules => ({
  ttlMs: defaultTtlMs,
  reusable: false,
});

/**
 * A link as the rules stand now. The rules are read again when the link is used, so an event
 * switched back to the platform setting cuts short the long or reusable links already sent:
 * a link lasts no longer than the current lifetime from when it was sent, and is reusable
 * only while the rule still says so.
 */
export function effectiveLink(
  token: { createdAt: Date; expiresAt: Date; reusable: boolean },
  rules: LinkRules,
): { expiresAt: Date; reusable: boolean } {
  const byRules =
    rules.ttlMs === null ? Number.POSITIVE_INFINITY : token.createdAt.getTime() + rules.ttlMs;
  return {
    expiresAt: new Date(Math.min(token.expiresAt.getTime(), byRules)),
    reusable: token.reusable && rules.reusable,
  };
}
