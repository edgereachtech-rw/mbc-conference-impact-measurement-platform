import { z } from 'zod';

/**
 * Sending the onboarding pack (task of 2026-11-03).
 *
 * The pack is the welcome, the schedule, the delegate's attendance codes and their card. An admin
 * sends it — nothing goes out on an import, because a bad file would then reach real inboxes — and
 * the platform records who has had one so a second send can skip them.
 */

/**
 * Who a send reaches (2026-11-23): those with no pack yet, those who have not signed in even once
 * (whether or not they had a pack), or a named list. "Everyone" was removed: a pack again to
 * delegates already using the platform only cluttered their inbox.
 */
export const onboardingScopes = ['not_yet_sent', 'not_signed_in', 'selected'] as const;
export type OnboardingScope = (typeof onboardingScopes)[number];

export const onboardingSendRequestSchema = z
  .object({
    scope: z.enum(onboardingScopes).default('not_yet_sent'),
    /** One batch's delegates only, on an event in batches (2026-11-23); absent for every batch. */
    batch: z.uuid().optional(),
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
  /** Eligible delegates who have not signed in even once (2026-11-23). */
  notSignedIn: z.number().int(),
  lastSentAt: z.string().nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const onboardingSendResultSchema = onboardingStateSchema.extend({
  justSent: z.number().int(),
  justFailed: z.number().int(),
});
export type OnboardingSendResult = z.infer<typeof onboardingSendResultSchema>;
