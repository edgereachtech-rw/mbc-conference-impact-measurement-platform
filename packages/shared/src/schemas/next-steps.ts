import { assessmentStageNames, type AssessmentStage } from './events.js';
import type { Journey } from './reports.js';

/**
 * What a delegate still has to do, worked out from their journey (task of 2026-11-03).
 *
 * The dashboard used to show counts and cards only: everything a delegate owed was two taps away
 * inside an event, behind the right tab, and nothing on the way in said it was waiting. These are
 * the same records the journey already reports, read as a to-do list and in the order of the
 * event page's tabs (2026-11-07): pre-conference assessment, attendance day by day, the
 * during-conference assessment, reflections, session feedback, the transfer plan, the
 * end-of-conference evaluation, then the follow-up waves. So the first thing a delegate sees
 * after signing in is the thing to do next, and the rest reads like the journey.
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

  /** The open or half-done assessments of one stage, in wave order. */
  const assessments = (stage: AssessmentStage) => {
    for (const a of journey.assessments) {
      if (a.stage !== stage || (a.state !== 'open' && a.state !== 'draft')) continue;
      // A wave has its own name, and its own place in the list: three open follow-ups must not
      // read as three copies of "your follow-up assessment".
      const name =
        a.waveLabel ||
        (a.stage === 'end_of_conference'
          ? 'end-of-conference evaluation'
          : `${assessmentStageNames[a.stage]} assessment`);
      steps.push({
        key: `assessment:${a.stage}:${a.wave}`,
        label: a.state === 'draft' ? `Finish your ${name}` : `Complete your ${name}`,
        // The pre-conference one is the delegate's first act on the platform and the baseline
        // every later result is measured against, so its hint says why it comes first.
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
  };

  assessments('pre_conference');

  // Every date open for check-in with nothing recorded yet, one step each, in day order: the one
  // thing only the delegate can do. Named by its day of the event ("Day 1"), not "today", so the
  // list reads the same ahead of the day.
  const dates = [...journey.attendance.dates].sort((a, b) => a.date.localeCompare(b.date));
  dates.forEach((d, i) => {
    if (d.closed || d.status !== 'not_checked_in') return;
    steps.push({
      key: `attendance:${d.date}`,
      label: `Check in for Day ${i + 1}`,
      hint: 'Show your attendance QR code at the entrance. Joining online? The organisers record you.',
      tab: 'attendance',
      started: false,
    });
  });

  assessments('during_conference');

  if (journey.reflections.available > journey.reflections.submitted) {
    // One wording whatever the count (2026-11-07): the tab shows which days are still open.
    steps.push({
      key: 'reflections',
      label: 'Add your reflections',
      hint: 'A few lines on what stood out for you and what you could start doing.',
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

  assessments('end_of_conference');
  assessments('follow_up');

  return steps;
}
