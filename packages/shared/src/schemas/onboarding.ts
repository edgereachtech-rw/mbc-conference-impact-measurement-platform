import { z } from 'zod';

/**
 * Sending the onboarding pack (task of 2026-11-03).
 *
 * The pack is the welcome, the schedule, the delegate's attendance codes and their card. An admin
 * sends it — nothing goes out on an import, because a bad file would then reach real inboxes — and
 * the platform records who has had one so a second send can skip them.
 */

export const onboardingScopes = ['not_yet_sent', 'all', 'selected'] as const;
export type OnboardingScope = (typeof onboardingScopes)[number];

export const onboardingSendRequestSchema = z
  .object({
    /** Who to send to: those with no pack yet, everyone eligible, or a named list. */
    scope: z.enum(onboardingScopes).default('not_yet_sent'),
    delegateIds: z.array(z.uuid()).max(2_000).optional(),
  })
  .refine((v) => v.scope !== 'selected' || (v.delegateIds?.length ?? 0) > 0, {
    error: 'Choose at least one delegate',
    path: ['delegateIds'],
  });
export type OnboardingSendRequest = z.infer<typeof onboardingSendRequestSchema>;

export const onboardingStateSchema = z.object({
  /** Eligible delegates of the event: the denominator. */
  eligible: z.number().int(),
  /** How many have had a pack that was sent successfully. */
  sent: z.number().int(),
  /** How many are still waiting for one. */
  pending: z.number().int(),
  /** Attempts that failed and have not since succeeded. */
  failed: z.number().int(),
  lastSentAt: z.string().nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const onboardingSendResultSchema = onboardingStateSchema.extend({
  justSent: z.number().int(),
  justFailed: z.number().int(),
});
export type OnboardingSendResult = z.infer<typeof onboardingSendResultSchema>;
