/**
 * Which registrations count (decision of 2026-11-05).
 *
 * Two different questions used to share one answer, the AUTH_ALLOW_TEST_REGISTRATIONS flag:
 *
 * - May a registration with status `test` act as a delegate: sign in, answer, be invited? That
 *   stays an environment rule, because letting test accounts into production is a security
 *   decision, not a reporting one. Routes keep their own `eligible()` for it.
 * - Does a test registration count in the event's reports, dashboards and summaries? That is the
 *   event's own choice, `countTestDelegates`, off by default so a rehearsal never moves a figure.
 *
 * Figures use this helper; access and sending do not.
 */
export type FigureStatuses = readonly ('active' | 'test')[];

export function figureStatuses(event: { countTestDelegates: boolean }): FigureStatuses {
  return event.countTestDelegates ? (['active', 'test'] as const) : (['active'] as const);
}
