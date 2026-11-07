'use client';

import {
  overallAttendanceLabels,
  type AssessmentStage,
  type MyAssessment,
  type MyEvent,
  type MyReflection,
} from '@mbc/shared';

import { StatusPill } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { TabStrip, useTabState } from '@/components/console/tabs';
import { stageLabels, stageWhen } from '@/lib/events';
import {
  attendanceFormatLabel,
  capacityLabel,
  formatDay,
  formatEventDates,
  formatLabel,
} from '@/lib/my-events';

import { AssessmentsPanel, assessmentTabId, useMyAssessments } from './assessments-panel';
import { AttendanceCodes } from './attendance-codes';
import { AttendingBadge } from './attending-badge';
import { JourneyStrip } from './journey-strip';
import { ReflectionsPanel, reflectionTabId, useMyReflections } from './reflections-panel';
import { SessionFeedbackList } from './session-feedback-list';
import {
  defaultPlan,
  TransferPlansTabs,
  transferPlanTabId,
  useMyTransferPlans,
} from './transfer-plan-panel';

type StaticTab = 'overview' | 'attendance' | 'feedback' | 'transfer-plan';
type AssessmentTab = ReturnType<typeof assessmentTabId>;
type ReflectionTab = ReturnType<typeof reflectionTabId>;
type PlanTab = ReturnType<typeof transferPlanTabId>;
/**
 * `assessments` and `reflections` are aliases older links carry: each resolves to the one to
 * act on (the open assessment; today's reflection).
 */
type Tab = StaticTab | AssessmentTab | ReflectionTab | PlanTab | 'assessments' | 'reflections';
type TabItem = { id: Tab; label: string; hint: string };

const STATIC: Record<StaticTab, TabItem> = {
  overview: { id: 'overview', label: 'Overview', hint: 'The event and your registration' },
  attendance: { id: 'attendance', label: 'Attendance', hint: 'Your check-in codes and record' },
  feedback: {
    id: 'feedback',
    label: 'Session feedback',
    hint: 'Feedback on sessions you attended',
  },
  'transfer-plan': {
    id: 'transfer-plan',
    label: 'Transfer plans',
    hint: 'What you will do differently, one plan per tab',
  },
};

/**
 * The tabs in the order the delegate meets them (2026-11-06): each assessment is a tab of its
 * own, placed where it falls in the journey. Before the event the pre-conference assessment; at
 * the event attendance, anything asked during the conference, reflections, session feedback and
 * the Transfer Plan; at the close the evaluation; after it each follow-up wave in turn.
 */
function journeyTabs(
  forms: readonly MyAssessment[],
  reflections: readonly MyReflection[],
): TabItem[] {
  const of = (stage: AssessmentStage): TabItem[] =>
    forms
      .filter((a) => a.stage === stage)
      .sort((a, b) => a.wave - b.wave)
      .map((a) => ({
        id: assessmentTabId(a),
        label: a.waveLabel || stageLabels[a.stage],
        hint: stageWhen[a.stage],
      }));
  return [
    STATIC.overview,
    ...of('pre_conference'),
    STATIC.attendance,
    ...of('during_conference'),
    // One tab per conference day's reflection (2026-11-07), each with its own QR code.
    ...[...reflections]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map<TabItem>((r) => ({
        id: reflectionTabId(r),
        label: r.title,
        hint: `Reflection for ${formatDay(r.date)}`,
      })),
    STATIC.feedback,
    // One Transfer plans tab (2026-11-07); the plans are tabs inside it.
    STATIC['transfer-plan'],
    ...of('end_of_conference'),
    ...of('follow_up'),
  ];
}

/**
 * One event as the API serves it to the delegate, arranged in tabs: the overview (event facts,
 * registration, journey) first, then one tab per record the delegate owns, each assessment among
 * them in journey order. Links such as the reminder email's `#transfer-plan` open that tab
 * directly, and `#assessments` lands on the assessment to act on; choosing a tab updates the
 * address so a reload keeps it. The attendance line only ever comes from an attendance record.
 */
export function EventDetail({ event, contactEmail }: { event: MyEvent; contactEmail: string }) {
  const assessments = useMyAssessments(event.id);
  const reflections = useMyReflections(event.id);
  const transferPlans = useMyTransferPlans(event.id);
  const forms = assessments.state.kind === 'ready' ? assessments.state.assessments : [];
  const days = reflections.state.kind === 'ready' ? reflections.state.reflections : [];
  const plans = transferPlans.state.kind === 'ready' ? transferPlans.state.plans : [];
  const tabs = journeyTabs(forms, days);
  // A plan's own id (`#transfer-plan-<id>`) is a known address: it opens the tab on that plan.
  const ids: Tab[] = [
    ...tabs.map((t) => t.id),
    ...plans.map((p) => transferPlanTabId(p)),
    'assessments',
    'reflections',
  ];
  const [chosen, choose] = useTabState<Tab>(ids, 'overview');
  // The alias: the first assessment still open to answer, else the first assessment there is.
  const actOn =
    forms.find((a) => a.status === 'open' && !a.response?.submittedAt) ?? forms[0] ?? null;
  // Today's reflection, else the first there is.
  const reflectOn = days.find((r) => r.status === 'open') ?? days[0] ?? null;
  const tab: Tab =
    chosen === 'assessments'
      ? actOn
        ? assessmentTabId(actOn)
        : 'overview'
      : chosen === 'reflections'
        ? reflectOn
          ? reflectionTabId(reflectOn)
          : 'overview'
        : chosen.startsWith('transfer-plan-')
          ? 'transfer-plan'
          : chosen;
  // The plan the tab shows: the one named in the address, else the one to act on.
  const selectedPlanId = chosen.startsWith('transfer-plan-')
    ? (plans.find((p) => transferPlanTabId(p) === chosen)?.id ?? defaultPlan(plans))
    : defaultPlan(plans);
  const current = tabs.find((t) => t.id === tab) ?? STATIC.overview;
  const form = tab.startsWith('assessment-') ? forms.find((a) => assessmentTabId(a) === tab) : null;
  const day = tab.startsWith('reflection-') ? days.find((r) => reflectionTabId(r) === tab) : null;

  return (
    <div className="space-y-5">
      <TabStrip
        label="Your records for this event"
        tabs={tabs}
        current={current.id}
        onChoose={choose}
        bleed
      />
      {assessments.state.kind === 'error' ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 border border-danger bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          Your assessments could not be loaded, so their tabs are missing.
          <button
            type="button"
            onClick={assessments.retry}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            Try again
          </button>
        </p>
      ) : null}
      <div
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        className="space-y-6"
      >
        {current.id !== 'overview' ? (
          <div>
            <h2 className="font-corporate text-h3 text-corp-ink">{current.label}</h2>
            <p className="text-sm text-corp-muted">{current.hint}</p>
          </div>
        ) : null}
        {current.id === 'overview' ? <Overview event={event} contactEmail={contactEmail} /> : null}
        {form ? (
          <AssessmentsPanel
            eventId={event.id}
            timezone={event.timezone}
            stage={form.stage}
            wave={form.wave}
            state={assessments.state}
            onUpdated={assessments.update}
            onRetry={assessments.retry}
          />
        ) : null}
        {tab === 'attendance' ? (
          <AttendanceCodes eventId={event.id} timezone={event.timezone} />
        ) : null}
        {day ? (
          <ReflectionsPanel
            eventId={event.id}
            timezone={event.timezone}
            activityId={day.id}
            state={reflections.state}
            onUpdated={reflections.update}
            onRetry={reflections.retry}
          />
        ) : null}
        {tab === 'feedback' ? <SessionFeedbackList eventId={event.id} /> : null}
        {tab === 'transfer-plan' ? (
          <TransferPlansTabs
            eventId={event.id}
            timezone={event.timezone}
            plans={transferPlans.state}
            selectedPlanId={selectedPlanId}
            onSelectPlan={(id) => choose(transferPlanTabId({ id }))}
            onPlansChanged={() => void transferPlans.refresh()}
            onRetry={transferPlans.retry}
          />
        ) : null}
      </div>
    </div>
  );
}

function Overview({ event, contactEmail }: { event: MyEvent; contactEmail: string }) {
  const r = event.registration;
  const attendanceTone =
    event.attendance.status === 'attended' || event.attendance.status === 'partial'
      ? 'positive'
      : event.attendance.status === 'absent'
        ? 'attention'
        : 'neutral';
  return (
    <>
      {/* Where the delegate is in the journey comes before the event facts: the open step (the
          pre-conference assessment, before the conference) is what they came to do. */}
      {event.period === 'upcoming' ? (
        <>
          <JourneyStrip event={event} />
          <AttendingBadge eventId={event.id} eventName={event.name} />
        </>
      ) : null}

      <section aria-labelledby="event-facts-title" className="space-y-3">
        <h2 id="event-facts-title" className="font-corporate text-h3 text-corp-ink">
          Event
        </h2>
        <dl className="grid gap-4 rounded-none border border-corp-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
          <Fact
            label="Dates"
            value={formatEventDates(event.startsOn, event.endsOn)}
            hint={event.timezone}
          />
          <Fact
            label={event.location ? 'Venue' : 'Where'}
            value={event.location ?? formatLabel[event.format]}
          />
          <Fact label="Format" value={formatLabel[event.format]} />
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Status
            </dt>
            <dd className="mt-1">
              <StatusPill tone={event.period === 'upcoming' ? 'positive' : 'neutral'}>
                {event.period === 'upcoming' ? 'Upcoming' : 'Past'}
              </StatusPill>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="event-registration-title" className="space-y-3">
        <h2 id="event-registration-title" className="font-corporate text-h3 text-corp-ink">
          Your registration
        </h2>
        <dl className="grid gap-4 rounded-none border border-corp-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Registration
            </dt>
            <dd className="mt-1">
              <StatusPill tone={r.status === 'active' ? 'positive' : 'attention'}>
                {r.status === 'active' ? 'Registered' : 'Test registration'}
              </StatusPill>
            </dd>
          </div>
          <Fact label="Taking part" value={attendanceFormatLabel[r.attendanceFormat]} />
          <Fact label="Organisation" value={r.organisation} />
          <Fact label="Job title" value={r.jobTitle} />
          <Fact label="Country" value={r.country} />
          <Fact label="Capacity" value={capacityLabel[r.capacity]} />
          <Fact label="First signed in" value={r.signedUpAt ? formatDay(r.signedUpAt) : null} />
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Attendance
            </dt>
            <dd className="mt-1">
              <StatusPill tone={attendanceTone}>
                {overallAttendanceLabels[event.attendance.status]}
              </StatusPill>
              <span className="mt-1 block text-xs text-corp-muted">
                Recorded by the organisers at the event. Your codes are under Attendance.
              </span>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-corp-text">
          Spotted a mistake? Write to{' '}
          <a
            href={`mailto:${contactEmail}`}
            className="font-semibold text-corp-green-text underline"
          >
            {contactEmail}
          </a>
          ; the organisers correct registrations and every change is recorded.
        </p>
      </section>
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-corp-ink">
        {value ?? <span className="text-corp-muted">Not provided</span>}
      </dd>
      {hint ? <dd className="text-xs text-corp-muted">{hint}</dd> : null}
    </div>
  );
}
