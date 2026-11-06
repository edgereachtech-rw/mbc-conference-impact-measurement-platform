import { assessmentStageNames, type AssessmentStage } from './events.js';
import type { Journey } from './reports.js';

/**
 * What a delegate still has to do, worked out from their journey (task of 2026-11-03).
 *
 * The dashboard used to show counts and cards only: everything a delegate owed was two taps away
 * inside an event, behind the right tab, and nothing on the way in said it was waiting. These are
 * the same records the journey already reports, read as a to-do list and in the order the journey
 * runs, so the first thing a delegate sees after signing in is the thing to do next.
 *
 * Only what the delegate can act on now appears: a stage that is not open yet, a reflection for a
 * day that has not happened and feedback on a session they did not attend are all left out.
 */

/** The tab of the event page that each step opens. */
export type DelegateTab =
  | `assessment-${AssessmentStage}-${number}`
  | 'attendance'
  | 'reflections'
  | 'feedback'
  | 'transfer-plan';

export interface NextStep {
  /** Stable key, for React and for tests. */
  key: string;
  label: string;
  hint: string;
  tab: DelegateTab;
  /** Started but unfinished, so the wording can say "finish" rather than "start". */
  started: boolean;
}

export function nextSteps(journey: Journey): NextStep[] {
  const steps: NextStep[] = [];

  for (const a of journey.assessments) {
    if (a.state !== 'open' && a.state !== 'draft') continue;
    // A wave has its own name, and its own place in the list: three open follow-ups must not
    // read as three copies of "your follow-up assessment".
    const name = a.waveLabel || `${assessmentStageNames[a.stage]} assessment`;
    steps.push({
      key: `assessment:${a.stage}:${a.wave}`,
      label: a.state === 'draft' ? `Finish your ${name}` : `Complete your ${name}`,
      // The pre-conference one is the delegate's first act on the platform and the baseline every
      // later result is measured against, so its hint says why it comes first.
      hint:
        a.state === 'draft'
          ? 'Saved but not submitted yet. Pick up where you left off.'
          : a.stage === 'pre_conference'
            ? 'Open now. It records where you start, so the conference can show what changed. Your answers are saved as you go.'
            : 'Open now. Your answers are saved as you go.',
      tab: `assessment-${a.stage}-${a.wave}`,
      started: a.state === 'draft',
    });
  }

  // A date open for check-in and nothing recorded yet: the one thing only the delegate can do.
  const openDate = journey.attendance.dates.find((d) => !d.closed && d.status === 'not_checked_in');
  if (openDate) {
    steps.push({
      key: `attendance:${openDate.date}`,
      label: 'Check in for today',
      hint: 'Use the code shown at the venue or in the virtual session.',
      tab: 'attendance',
      started: false,
    });
  }

  if (journey.reflections.available > journey.reflections.submitted) {
    const left = journey.reflections.available - journey.reflections.submitted;
    steps.push({
      key: 'reflections',
      label: left === 1 ? 'Add your daily reflection' : `Add ${left} daily reflections`,
      hint: 'A few lines on what stood out and what you will use.',
      tab: 'reflections',
      started: journey.reflections.submitted > 0,
    });
  }

  if (journey.feedback.sessions > journey.feedback.submitted) {
    const left = journey.feedback.sessions - journey.feedback.submitted;
    steps.push({
      key: 'feedback',
      label: left === 1 ? 'Give feedback on 1 session' : `Give feedback on ${left} sessions`,
      hint: 'About five minutes each, and it shapes the next conference.',
      tab: 'feedback',
      started: journey.feedback.submitted > 0,
    });
  }

  if (!journey.plan || journey.plan.status === 'draft') {
    const started = Boolean(journey.plan && journey.plan.actions > 0);
    steps.push({
      key: 'transfer-plan',
      label: started ? 'Finish your transfer plan' : 'Start your transfer plan',
      hint: started
        ? 'Saved as a draft. You submit it in the last Transfer Planning session.'
        : 'What you will do differently when you are back at work.',
      tab: 'transfer-plan',
      started,
    });
  }

  return steps;
}
