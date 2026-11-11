import type { Prisma } from '../generated/prisma/client.js';

/**
 * A delegate's organisation as the organisers see it (decision 2026-11-12): the registration's
 * own organisation, or, when the registration carries none, the nominating organisation. The
 * record itself is not changed; the fallback is applied when the delegate is listed or searched.
 */
export function displayOrganisation(d: {
  organisation: string | null;
  nominatingOrganisation: string | null;
}): string | null {
  const own = d.organisation?.trim();
  if (own) return own;
  const nominating = d.nominatingOrganisation?.trim();
  return nominating || null;
}

/**
 * The organisers' delegate search (name, email, organisation, registration id). The nominating
 * organisation matches only for a delegate who has no organisation of their own, so a search
 * finds exactly the delegates whose displayed organisation matches.
 */
export function delegateSearchFilter(q: string): Prisma.DelegateWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { name: contains },
      { email: contains },
      { organisation: contains },
      { externalRegistrationId: contains },
      {
        AND: [
          { OR: [{ organisation: null }, { organisation: '' }] },
          { nominatingOrganisation: contains },
        ],
      },
    ],
  };
}
