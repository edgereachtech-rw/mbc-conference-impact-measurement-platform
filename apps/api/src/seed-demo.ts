/**
 * Development seed: one complete demo event to explore and keep modifying the platform against.
 *
 * It refuses to run when NODE_ENV is "production" and is idempotent on the event slug: the first
 * run creates everything, later runs only add what is missing. It never touches other events.
 *
 *   pnpm --filter @mbc/api db:seed:demo
 *
 * What it creates (counts only are logged; no personal data):
 *   - an active hybrid event two weeks from today with two dates, a long venue address, both
 *     participation categories and a two-day programme of sessions, feedback enabled on talks;
 *   - the pre-conference assessment open now, the end-of-conference evaluation scheduled for the
 *     last afternoon, follow-up waves 1 to 3 scheduled from their due dates and the longer-term
 *     wave drafted, every stage with its ITTEC question set (pilot content reused as demo data);
 *   - the Transfer Planning reference questions and the two daily reflections as drafts (publish
 *     them from the admin on the day, as the pilot will);
 *   - 24 active delegates, 2 pending, 1 cancelled and 4 test delegates, each active and test
 *     delegate with a sign-in identity so they can sign in with their address (mail goes to the
 *     local Mailpit in development);
 *   - with the API running, ten delegates' pre-conference answers submitted through the real API
 *     (eight submitted, two left as drafts), so reports and the paired results have data.
 *
 * Responses go through the API rather than straight into the tables so every answer is validated
 * and scored exactly as a delegate's would be. API_URL names the API (default
 * http://127.0.0.1:44444); set SKIP_RESPONSES=true to leave answers out.
 */
import 'dotenv/config';

import {
  assessmentStages,
  DEFAULT_FEEDBACK_QUESTIONS,
  DEFAULT_FOLLOW_UP_WAVES,
  defaultWaveOpensAt,
  followUpWaveOf,
  FOLLOW_UP_OPEN_DAYS,
  FOLLOW_UP_REMINDER_AFTER_DAYS,
  FOLLOW_UP_REMINDER_LIMIT,
  LONGER_TERM_WAVE,
  type DelegateQuestionView,
  type MyAssessment,
} from '@mbc/shared';
import { randomBytes } from 'node:crypto';

import { seedReferenceQuestions } from './assessments/ittec-references.js';
import {
  ITTEC_END_OF_CONFERENCE,
  ITTEC_FOLLOW_UPS,
  ITTEC_PRE_CONFERENCE,
  loadTemplateInto,
} from './assessments/templates.js';
import { authConfigFromEnv } from './auth/config.js';
import { generateToken, hashToken } from './auth/tokens.js';
import { getPrisma, type PrismaClient } from './db.js';
import { audit } from './lib/audit.js';
import { ITTEC_DAILY_REFLECTIONS, seedDailyReflections } from './reflections/ittec-daily.js';

export const DEMO_SLUG = 'demo-conference-2026';
const DAY_MS = 86_400_000;

const log = (message: string) => console.log(`seed-demo: ${message}`);

/** A calendar date (UTC midnight, as event_date stores it) some days from today. */
function dateOnly(daysFromToday: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + daysFromToday * DAY_MS);
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** A clock time on an event date, given in Lagos time (UTC+1, no daylight saving). */
const lagosTime = (date: Date, hour: number, minute = 0) =>
  new Date(date.getTime() + (hour - 1) * 3_600_000 + minute * 60_000);

// ---------------------------------------------------------------- people (fictional)
const PEOPLE: ReadonlyArray<
  [name: string, organisation: string, jobTitle: string, country: string]
> = [
  ['Adaeze Okonkwo', 'First City Monument Bank', 'Learning and Development Manager', 'Nigeria'],
  ['Babatunde Adeyemi', 'Lagos State Ministry of Health', 'Director of Training', 'Nigeria'],
  ['Chidinma Eze', 'Dangote Industries', 'HR Business Partner', 'Nigeria'],
  ['Damilola Ogunleye', 'MTN Nigeria', 'Talent Development Lead', 'Nigeria'],
  ['Efua Mensah', 'Ghana Revenue Authority', 'Capacity Building Officer', 'Ghana'],
  ['Folake Adebayo', 'Access Bank', 'Head of Learning', 'Nigeria'],
  ['Gbenga Oyelaran', 'Nigerian Ports Authority', 'Training Coordinator', 'Nigeria'],
  ['Halima Abubakar', 'Federal Ministry of Education', 'Programme Officer', 'Nigeria'],
  ['Ifeoma Nwosu', 'Zenith Bank', 'Learning Experience Designer', 'Nigeria'],
  ['Jide Bakare', 'Flutterwave', 'People Operations Manager', 'Nigeria'],
  ['Kofi Boateng', 'Standard Chartered Ghana', 'HR Manager', 'Ghana'],
  ['Lola Akintola', 'Shell Nigeria', 'Competency Development Advisor', 'Nigeria'],
  ['Musa Garba', 'Kaduna State Civil Service', 'Training Officer', 'Nigeria'],
  ['Ngozi Okafor', 'Guaranty Trust Bank', 'Organisational Development Lead', 'Nigeria'],
  ['Olumide Fashola', 'Interswitch', 'Engineering Manager', 'Nigeria'],
  ['Patience Osei', 'Ecobank Ghana', 'Learning Partner', 'Ghana'],
  ['Rotimi Alade', 'NNPC Limited', 'Senior HR Officer', 'Nigeria'],
  ['Sade Williams', 'Unilever Nigeria', 'Talent Manager', 'Nigeria'],
  ['Tunde Bello', 'Sterling Bank', 'Branch Operations Manager', 'Nigeria'],
  ['Uche Okoro', 'Nestlé Nigeria', 'Supply Chain Trainer', 'Nigeria'],
  ['Yemi Adeniran', 'Lagos Business School', 'Faculty Development Coordinator', 'Nigeria'],
  ['Zainab Yusuf', 'Jaiz Bank', 'HR Analyst', 'Nigeria'],
  ['Amara Diallo', 'African Development Bank', 'Learning Specialist', 'Côte d’Ivoire'],
  ['Emeka Obi', 'Seplat Energy', 'HSE Training Lead', 'Nigeria'],
];
const PENDING: ReadonlyArray<[string, string]> = [
  ['Bisi Oladipo', 'Wema Bank'],
  ['Chuks Anyanwu', 'Konga'],
];
const CANCELLED: [string, string] = ['Dele Momoh', 'Polaris Bank'];
const TEST_DELEGATES = 4;

const slugOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');

// ---------------------------------------------------------------- programme
type SessionSeed = {
  day: 0 | 1;
  title: string;
  type:
    | 'keynote'
    | 'plenary'
    | 'panel'
    | 'workshop'
    | 'breakout'
    | 'transfer_planning'
    | 'networking'
    | 'other';
  start: string;
  end: string;
  speaker?: string;
  venue?: string;
  feedback: boolean;
};
const PROGRAMME: readonly SessionSeed[] = [
  {
    day: 0,
    title: 'Registration and welcome',
    type: 'other',
    start: '08:30',
    end: '09:30',
    venue: 'Main foyer',
    feedback: false,
  },
  {
    day: 0,
    title: 'Opening keynote: Why training rarely changes practice',
    type: 'keynote',
    start: '09:30',
    end: '10:30',
    speaker: 'Prof. Amina Bello',
    venue: 'Grand ballroom',
    feedback: true,
  },
  {
    day: 0,
    title: 'Panel: What stops learning from transferring to work',
    type: 'panel',
    start: '11:00',
    end: '12:30',
    venue: 'Grand ballroom',
    feedback: true,
  },
  {
    day: 0,
    title: 'Lunch and networking',
    type: 'networking',
    start: '12:30',
    end: '13:30',
    venue: 'Terrace',
    feedback: false,
  },
  {
    day: 0,
    title: 'Workshop: Designing transfer-ready training',
    type: 'workshop',
    start: '13:30',
    end: '15:30',
    speaker: 'Dr. Kwame Asante',
    venue: 'Breakout room A',
    feedback: true,
  },
  {
    day: 0,
    title: 'Breakout: Measuring behaviour change on the job',
    type: 'breakout',
    start: '15:45',
    end: '16:45',
    speaker: 'Ngozi Udo',
    venue: 'Breakout room B',
    feedback: true,
  },
  {
    day: 1,
    title: 'Keynote: From completion rates to performance evidence',
    type: 'keynote',
    start: '09:00',
    end: '10:00',
    speaker: 'Seyi Adebanjo',
    venue: 'Grand ballroom',
    feedback: true,
  },
  {
    day: 1,
    title: 'Breakout: Managers as transfer partners',
    type: 'breakout',
    start: '10:30',
    end: '12:00',
    speaker: 'Funmi Okoye',
    venue: 'Breakout room A',
    feedback: true,
  },
  {
    day: 1,
    title: 'Lunch and networking',
    type: 'networking',
    start: '12:00',
    end: '13:00',
    venue: 'Terrace',
    feedback: false,
  },
  {
    day: 1,
    title: 'Transfer Planning session',
    type: 'transfer_planning',
    start: '13:00',
    end: '15:00',
    venue: 'Grand ballroom',
    feedback: true,
  },
  {
    day: 1,
    title: 'Closing plenary and commitments',
    type: 'plenary',
    start: '15:30',
    end: '16:30',
    venue: 'Grand ballroom',
    feedback: true,
  },
];

// ---------------------------------------------------------------- answers
const SHORT_ANSWERS = [
  'Apply the transfer planning method in our next leadership programme.',
  'Better follow-up with line managers after training.',
  'A measurable link between training and performance reviews.',
  'Practical tools for evaluating behaviour change.',
  'Ways to keep momentum after the classroom.',
];
const LONG_ANSWERS = [
  'Our biggest gap is that training ends when the course ends. I want a simple structure the team can use to follow through in the weeks after, with the manager involved.',
  'We run many programmes but can rarely show what changed at work. I am looking for practical measures we can adopt without a large evaluation budget.',
  'I would like to leave with a transfer plan I can actually use, and a way to review it with my manager at 30 and 90 days.',
];

/** A plausible answer for one question, varied by delegate so distributions are not flat. */
function answerFor(q: DelegateQuestionView, seed: number): unknown {
  const n = seed + q.order;
  switch (q.type) {
    case 'short_text':
      return SHORT_ANSWERS[n % SHORT_ANSWERS.length];
    case 'long_text':
      return LONG_ANSWERS[n % LONG_ANSWERS.length];
    case 'single_choice': {
      const options = q.options ?? [];
      return options.length ? options[n % options.length]!.value : null;
    }
    case 'multiple_choice': {
      const options = (q.options ?? []).filter((o) => !o.exclusive && !o.other);
      if (options.length === 0) return null;
      const count = 1 + (n % Math.min(2, options.length));
      const start = n % options.length;
      return Array.from({ length: count }, (_, i) => options[(start + i) % options.length]!.value);
    }
    case 'rating': {
      const scale = q.scale ?? { min: 1, max: 5 };
      return scale.min + (n % (scale.max - scale.min + 1));
    }
    case 'yes_no':
      return n % 3 !== 0;
    case 'number':
      return 1 + (n % 12);
    case 'date':
      return isoDate(new Date());
    default:
      return null;
  }
}

// ---------------------------------------------------------------- seed
export async function seedDemo(prisma: PrismaClient) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo: refusing to run with NODE_ENV=production');
  }
  const now = new Date();
  const day1 = dateOnly(14);
  const day2 = dateOnly(15);

  // Event: created once; a later run keeps its dates and reuses it.
  let event = await prisma.event.findUnique({ where: { slug: DEMO_SLUG } });
  if (!event) {
    event = await prisma.event.create({
      data: {
        slug: DEMO_SLUG,
        name: 'Demo Conference 2026: Learning Transfer in Practice',
        theme: 'From training to measurable change at work',
        startsOn: day1,
        endsOn: day2,
        timezone: 'Africa/Lagos',
        location:
          'Eko Hotels and Suites, Plot 1415 Adetokunbo Ademola Street, Victoria Island, Lagos, Nigeria',
        format: 'hybrid',
        status: 'active',
        countTestDelegates: true,
        description:
          'A two-day demonstration event with every part of the delegate journey set up: pre-conference assessment, the programme, daily reflections, session feedback, Transfer Planning and the follow-up waves. All people and answers are fictional.',
        eventType: 'conference',
        organiser: 'M.Bryan Consulting Limited',
        website: 'https://www.mbryanconsultinggroup.com/',
        additionalInfo:
          'Demo data for development. Delegates sign in with their listed address; in development the sign-in email arrives in Mailpit.',
      },
    });
    log(`event created (${event.slug})`);
  } else {
    log(`event exists (${event.slug}); adding what is missing`);
  }
  const eventId = event.id;
  const first = event.startsOn;
  const last = event.endsOn;

  const dates = [] as { id: string; date: Date }[];
  for (const date of [first, last]) {
    dates.push(
      await prisma.eventDate.upsert({
        where: { eventId_date: { eventId, date } },
        create: { eventId, date },
        update: {},
        select: { id: true, date: true },
      }),
    );
  }

  for (const category of [
    { code: 'physical', name: 'In person (Lagos)' },
    { code: 'virtual', name: 'Virtual' },
  ] as const) {
    await prisma.participationCategory.upsert({
      where: { eventId_code: { eventId, code: category.code } },
      create: { eventId, ...category },
      update: {},
    });
  }

  // Programme, with the default feedback questions on every session that collects feedback.
  if ((await prisma.eventSession.count({ where: { eventId } })) === 0) {
    let withFeedback = 0;
    for (const s of PROGRAMME) {
      await prisma.eventSession.create({
        data: {
          eventId,
          eventDateId: dates[s.day]!.id,
          title: s.title,
          sessionType: s.type,
          startTime: s.start,
          endTime: s.end,
          speaker: s.speaker ?? null,
          venue: s.venue ?? null,
          feedbackEnabled: s.feedback,
          feedbackCode: s.feedback ? randomBytes(9).toString('base64url') : null,
        },
      });
      if (s.feedback) withFeedback += 1;
    }
    // The feedback questions are the event's, recorded once; every session's form follows them.
    await prisma.sessionFeedbackQuestion.createMany({
      data: DEFAULT_FEEDBACK_QUESTIONS.map((q, i) => ({
        eventId,
        order: i + 1,
        prompt: q.prompt,
        type: q.type,
        required: q.required,
      })),
    });
    log(`${PROGRAMME.length} sessions (${withFeedback} with feedback)`);
  }

  // Stages. The pre-conference one is open now; the evaluation opens on the last afternoon.
  for (const stage of assessmentStages) {
    await prisma.assessmentStageConfig.upsert({
      where: { eventId_stage_wave: { eventId, stage, wave: 1 } },
      create: { eventId, stage },
      update: {},
    });
  }
  const pre = await prisma.assessmentStageConfig.update({
    where: { eventId_stage_wave: { eventId, stage: 'pre_conference', wave: 1 } },
    data: {
      enabled: true,
      status: 'open',
      opensAt: new Date(now.getTime() - 7 * DAY_MS),
      closesAt: lagosTime(first, 8),
    },
    include: { _count: { select: { questions: true } } },
  });
  if (pre._count.questions === 0) {
    const loaded = await prisma.$transaction((tx) =>
      loadTemplateInto(tx, pre, ITTEC_PRE_CONFERENCE),
    );
    log(`pre-conference: ${loaded.sections} sections, ${loaded.questions} questions`);
  }
  const end = await prisma.assessmentStageConfig.update({
    where: { eventId_stage_wave: { eventId, stage: 'end_of_conference', wave: 1 } },
    data: {
      enabled: true,
      status: 'scheduled',
      opensAt: lagosTime(last, 15),
      closesAt: new Date(lagosTime(last, 23, 59).getTime() + 7 * DAY_MS),
    },
    include: { _count: { select: { questions: true } } },
  });
  if (end._count.questions === 0) {
    const loaded = await prisma.$transaction((tx) =>
      loadTemplateInto(tx, end, ITTEC_END_OF_CONFERENCE),
    );
    log(`end-of-conference: ${loaded.sections} sections, ${loaded.questions} questions`);
  }
  for (const wave of [...DEFAULT_FOLLOW_UP_WAVES, LONGER_TERM_WAVE]) {
    const definition = followUpWaveOf(wave)!;
    const opensAt = defaultWaveOpensAt(isoDate(last), definition.dueAfterDays, event.timezone);
    const scheduled = wave !== LONGER_TERM_WAVE;
    const row = await prisma.assessmentStageConfig.upsert({
      where: { eventId_stage_wave: { eventId, stage: 'follow_up', wave } },
      create: {
        eventId,
        stage: 'follow_up',
        wave,
        enabled: scheduled,
        status: scheduled ? 'scheduled' : 'draft',
        dueAfterDays: definition.dueAfterDays,
        opensAt,
        closesAt: new Date(opensAt.getTime() + FOLLOW_UP_OPEN_DAYS * DAY_MS),
        reminderAfterDays: FOLLOW_UP_REMINDER_AFTER_DAYS,
        reminderLimit: FOLLOW_UP_REMINDER_LIMIT,
      },
      update: {},
      include: { _count: { select: { questions: true } } },
    });
    const template = ITTEC_FOLLOW_UPS[wave];
    if (template && row._count.questions === 0) {
      const loaded = await prisma.$transaction((tx) => loadTemplateInto(tx, row, template));
      log(`${definition.label}: ${loaded.sections} section(s), ${loaded.questions} questions`);
    }
  }
  const references = await prisma.$transaction((tx) => seedReferenceQuestions(tx, eventId));
  if (references) log(`reference questions: ${references} set`);
  // The reflection content is written for the ITTEC dates; the demo's two days take it over.
  const reflectionContent = ITTEC_DAILY_REFLECTIONS.slice(0, dates.length).map((item, i) => ({
    ...item,
    date: isoDate(dates[i]!.date),
  }));
  const reflections = await prisma.$transaction((tx) =>
    seedDailyReflections(tx, eventId, reflectionContent),
  );
  if (reflections) log(`daily reflections: ${reflections} drafted`);

  // Delegates, each with the identity a committed import would give them.
  const existing = await prisma.delegate.count({ where: { eventId } });
  const delegateIds: string[] = [];
  if (existing === 0) {
    const register = async (
      name: string,
      email: string,
      data: {
        organisation: string;
        jobTitle?: string | null;
        country?: string | null;
        attendanceFormat: 'physical' | 'virtual';
        capacity?: 'individual' | 'nominee';
        nominatingOrganisation?: string | null;
        registrationStatus: 'active' | 'pending' | 'cancelled' | 'test';
      },
    ) => {
      const address = await prisma.identityEmail.findUnique({
        where: { emailNormalised: email },
        select: { identityId: true, kind: true },
      });
      let identityId = address?.kind === 'current' ? address.identityId : null;
      if (!identityId) {
        if (address) throw new Error(`seed-demo: ${email} is reserved by another identity`);
        const identity = await prisma.delegateIdentity.create({
          data: {
            displayName: name,
            emails: { create: { emailNormalised: email, kind: 'current', evidence: 'import' } },
          },
          select: { id: true },
        });
        identityId = identity.id;
      }
      const delegate = await prisma.delegate.create({
        data: {
          eventId,
          identityId,
          name,
          email,
          organisation: data.organisation,
          jobTitle: data.jobTitle ?? null,
          country: data.country ?? null,
          attendanceFormat: data.attendanceFormat,
          capacity: data.capacity ?? 'individual',
          nominatingOrganisation: data.nominatingOrganisation ?? null,
          registrationStatus: data.registrationStatus,
          registrationSource: 'demo-seed',
          importedAt: now,
        },
        select: { id: true },
      });
      return delegate.id;
    };

    for (const [i, [name, organisation, jobTitle, country]] of PEOPLE.entries()) {
      const nominee = i % 4 === 3;
      delegateIds.push(
        await register(name, `${slugOf(name)}@demo.example.com`, {
          organisation,
          jobTitle,
          country,
          attendanceFormat: i % 3 === 2 ? 'virtual' : 'physical',
          capacity: nominee ? 'nominee' : 'individual',
          nominatingOrganisation: nominee ? organisation : null,
          registrationStatus: 'active',
        }),
      );
    }
    for (const [name, organisation] of PENDING) {
      await register(name, `${slugOf(name)}@demo.example.com`, {
        organisation,
        attendanceFormat: 'physical',
        registrationStatus: 'pending',
      });
    }
    await register(CANCELLED[0], `${slugOf(CANCELLED[0])}@demo.example.com`, {
      organisation: CANCELLED[1],
      attendanceFormat: 'virtual',
      registrationStatus: 'cancelled',
    });
    for (let i = 1; i <= TEST_DELEGATES; i++) {
      const n = String(i).padStart(2, '0');
      await register(`Demo Tester ${n}`, `demo-tester-${n}@demo.example.com`, {
        organisation: 'M.Bryan Consulting Limited',
        jobTitle: 'Platform tester',
        country: 'Nigeria',
        attendanceFormat: i % 2 ? 'physical' : 'virtual',
        registrationStatus: 'test',
      });
    }
    log(
      `${PEOPLE.length} active, ${PENDING.length} pending, 1 cancelled and ${TEST_DELEGATES} test delegates`,
    );
  } else {
    log(`${existing} delegates already present; none added`);
  }

  await audit(prisma, {
    action: 'seed_demo.completed',
    entityType: 'event',
    entityId: eventId,
    eventId,
    newValue: { delegatesAdded: delegateIds.length },
  });

  return { eventId, dates, delegateIds };
}

// ---------------------------------------------------------------- responses through the API
/**
 * Signs ten active delegates in (a session row each, as a verified sign-in would leave) and saves
 * their pre-conference answers through the delegate API: eight submitted, two as drafts.
 */
export async function seedResponses(prisma: PrismaClient, eventId: string) {
  const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:44444').replace(/\/+$/, '');
  const origin = authConfigFromEnv().appUrl;
  try {
    const health = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!health.ok) throw new Error(String(health.status));
  } catch {
    log(`API at ${apiUrl} not reachable; no responses recorded (start the API and re-run)`);
    return { submitted: 0, drafts: 0 };
  }

  const delegates = await prisma.delegate.findMany({
    where: { eventId, registrationStatus: 'active', identityId: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: 10,
    select: { id: true, email: true, name: true, identityId: true, userAccountId: true },
  });
  let submitted = 0;
  let drafts = 0;
  for (const [i, delegate] of delegates.entries()) {
    const draft = i >= 8;
    // One account per identity, linked exactly as the first verified sign-in links it.
    const account = await prisma.userAccount.upsert({
      where: { email: delegate.email },
      create: { email: delegate.email, role: 'delegate', status: 'active' },
      update: {},
      select: { id: true },
    });
    await prisma.delegateIdentity.updateMany({
      where: { id: delegate.identityId!, userAccountId: null },
      data: { userAccountId: account.id },
    });
    await prisma.delegate.update({
      where: { id: delegate.id },
      data: {
        userAccountId: account.id,
        signedUpAt: delegate.userAccountId ? undefined : new Date(),
      },
    });
    const token = generateToken();
    const session = await prisma.authSession.create({
      data: {
        userAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 600_000),
        userAgent: 'seed-demo',
      },
      select: { id: true },
    });
    const headers = {
      cookie: `mbc_session=${token}`,
      origin,
      'content-type': 'application/json',
      accept: 'application/json',
    };
    try {
      const listed = await fetch(`${apiUrl}/api/v1/me/events/${eventId}/assessments`, { headers });
      if (!listed.ok) throw new Error(`list ${listed.status}`);
      const { assessments } = (await listed.json()) as { assessments: MyAssessment[] };
      const pre = assessments.find((a) => a.stage === 'pre_conference' && a.wave === 1);
      if (!pre || pre.status !== 'open' || pre.response?.submittedAt) continue;
      if (pre.response && Object.keys(pre.response.answers).length > 0) continue;
      const questions = draft
        ? pre.questions.slice(0, Math.ceil(pre.questions.length * 0.4))
        : pre.questions;
      const answers: Record<string, unknown> = {};
      for (const q of questions) {
        const value = answerFor(q, i * 7);
        if (value !== null) answers[q.id] = value;
      }
      const saved = await fetch(
        `${apiUrl}/api/v1/me/events/${eventId}/assessments/pre_conference?wave=1`,
        { method: 'PUT', headers, body: JSON.stringify({ answers, submit: !draft }) },
      );
      if (!saved.ok) {
        const body = (await saved.json().catch(() => null)) as { error?: { code?: string } } | null;
        throw new Error(`save ${saved.status} ${body?.error?.code ?? ''}`);
      }
      if (draft) drafts += 1;
      else submitted += 1;
    } catch (error) {
      log(`delegate ${i + 1}: ${error instanceof Error ? error.message : 'failed'}`);
    } finally {
      await prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }
  }
  log(`pre-conference responses: ${submitted} submitted, ${drafts} drafts`);
  return { submitted, drafts };
}

const isDirectRun =
  process.argv[1] !== undefined && /[\\/]seed-demo\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  const prisma = getPrisma();
  seedDemo(prisma)
    .then(async ({ eventId }) => {
      if (process.env.SKIP_RESPONSES !== 'true') await seedResponses(prisma, eventId);
      log(`done (event ${eventId})`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error('seed-demo: failed', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
