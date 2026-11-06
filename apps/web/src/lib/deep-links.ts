import { assessmentStages, type AssessmentStage } from '@mbc/shared';

/**
 * Deep links behind the QR codes (task of 2026-11-06): `/go/:eventId/:target` lands a delegate on
 * one section of their event page, signing them in first if need be, so nobody navigates the
 * platform to reach a reflection, an assessment or their transfer plan. Session feedback keeps
 * its own `/feedback/:code` link, which already behaves this way.
 */
export const FIXED_TARGETS = ['reflections', 'transfer-plan', 'attendance', 'feedback'] as const;
export type FixedTarget = (typeof FIXED_TARGETS)[number];

const ASSESSMENT = /^assessment-([a-z_]+)-(\d{1,2})$/;
/** One day's reflection, by its activity id: each day has its own tab and code (2026-11-07). */
const REFLECTION = /^reflection-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The event-page tab a target names, or null when the target is not one we issue. */
export function deepLinkTab(target: string): string | null {
  if ((FIXED_TARGETS as readonly string[]).includes(target)) return target;
  if (REFLECTION.test(target)) return target.toLowerCase();
  const m = ASSESSMENT.exec(target);
  if (!m) return null;
  if (!(assessmentStages as readonly string[]).includes(m[1]!)) return null;
  const wave = Number(m[2]);
  return wave >= 1 && wave <= 4 ? `assessment-${m[1]}-${wave}` : null;
}

/** The target for one assessment stage and wave. */
export const assessmentTarget = (stage: AssessmentStage, wave: number) =>
  `assessment-${stage}-${wave}`;

/** The target for one day's reflection. */
export const reflectionTarget = (activityId: string) => `reflection-${activityId}`;

/** The in-app path a QR code carries. */
export const deepLinkPath = (eventId: string, target: string) => `/go/${eventId}/${target}`;

/** Where a valid target lands once the delegate is signed in. */
export const deepLinkDestination = (eventId: string, tab: string) =>
  `/account/events/${eventId}#${tab}`;
