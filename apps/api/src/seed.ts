/**
 * Idempotent seed: creates the ITTEC 2026 event, its two participation categories, one admin
 * account (ADMIN_EMAIL) and, when SEED_TEST_DELEGATES=true and NODE_ENV is not production, ten
 * delegates with registration_status "test". Running it twice changes nothing.
 *
 *   pnpm --filter @mbc/api db:seed            (development, via tsx)
 *   node dist/seed.js                          (inside the api image on staging)
 */
import { ITTEC_PRE_CONFERENCE, loadTemplateInto } from './assessments/templates.js';
import { getPrisma, type PrismaClient } from './db.js';
import { audit } from './lib/audit.js';
import { normaliseEmail } from './lib/email.js';

export const ITTEC_2026 = {
  slug: 'ittec-2026',
  name: 'ITTEC 2026: International Training Transfer Effectiveness Conference',
  theme: 'Technology, Practice, and Impact',
  startsOn: new Date('2026-11-12T00:00:00.000Z'),
  endsOn: new Date('2026-11-13T00:00:00.000Z'),
  timezone: 'Africa/Lagos',
  location: 'Lagos Oriental Hotel, Victoria Island, Lagos, Nigeria',
  format: 'hybrid',
  status: 'active',
  description:
    'The International Training Transfer Effectiveness Conference: two days on turning training into measurable workplace impact, in Lagos and online.',
  eventType: 'conference',
  organiser: 'M.Bryan Consulting Limited',
  website: 'https://itteconference.mbryanconsultinggroup.com/',
} as const;

/** Selected event dates (E1 brief, section 4): the two conference days. */
export const ITTEC_2026_DATES = ['2026-11-12', '2026-11-13'] as const;

export const PARTICIPATION_CATEGORIES = [
  { code: 'physical', name: 'In-person (Lagos)' },
  { code: 'virtual', name: 'Virtual' },
] as const;

export const TEST_DELEGATE_COUNT = 10;

export interface SeedOptions {
  adminEmail?: string;
  /** Only honoured when NODE_ENV is not "production". */
  seedTestDelegates?: boolean;
  log?: (message: string) => void;
}

export interface SeedResult {
  eventId: string;
  adminUserId: string | null;
  testDelegates: number;
}

export async function seed(prisma: PrismaClient, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);

  const event = await prisma.event.upsert({
    where: { slug: ITTEC_2026.slug },
    create: ITTEC_2026,
    update: {
      name: ITTEC_2026.name,
      theme: ITTEC_2026.theme,
      startsOn: ITTEC_2026.startsOn,
      endsOn: ITTEC_2026.endsOn,
      timezone: ITTEC_2026.timezone,
      location: ITTEC_2026.location,
      format: ITTEC_2026.format,
      description: ITTEC_2026.description,
      eventType: ITTEC_2026.eventType,
      organiser: ITTEC_2026.organiser,
      website: ITTEC_2026.website,
    },
  });
  log(`event ${event.slug} (${event.id})`);

  for (const date of ITTEC_2026_DATES) {
    await prisma.eventDate.upsert({
      where: { eventId_date: { eventId: event.id, date: new Date(`${date}T00:00:00.000Z`) } },
      create: { eventId: event.id, date: new Date(`${date}T00:00:00.000Z`) },
      update: {},
    });
  }
  for (const stage of ['pre_conference', 'during_conference', 'follow_up'] as const) {
    await prisma.assessmentStageConfig.upsert({
      where: { eventId_stage: { eventId: event.id, stage } },
      create: { eventId: event.id, stage },
      update: {},
    });
  }
  // ITTEC's pre-conference questions are pilot content, seeded once as the event's own data.
  const preStage = await prisma.assessmentStageConfig.findUniqueOrThrow({
    where: { eventId_stage: { eventId: event.id, stage: 'pre_conference' } },
    include: { _count: { select: { questions: true } } },
  });
  if (preStage._count.questions === 0) {
    const loaded = await prisma.$transaction((tx) =>
      loadTemplateInto(tx, preStage, ITTEC_PRE_CONFERENCE),
    );
    log(`pre-conference assessment: ${loaded.sections} sections, ${loaded.questions} questions`);
  }

  for (const category of PARTICIPATION_CATEGORIES) {
    await prisma.participationCategory.upsert({
      where: { eventId_code: { eventId: event.id, code: category.code } },
      create: { eventId: event.id, ...category },
      update: { name: category.name },
    });
  }
  log(`${PARTICIPATION_CATEGORIES.length} participation categories`);

  let adminUserId: string | null = null;
  if (options.adminEmail) {
    const email = normaliseEmail(options.adminEmail);
    const existing = await prisma.userAccount.findUnique({ where: { email } });
    if (existing && existing.status !== 'active') {
      // Deactivation is a deliberate, audited act; the seed must not undo it on the next run.
      adminUserId = existing.id;
      log('admin account exists but is inactive; left inactive (reactivate it deliberately)');
    } else {
      const admin = await prisma.userAccount.upsert({
        where: { email },
        create: { email, role: 'admin', status: 'active' },
        update: { role: 'admin' },
      });
      adminUserId = admin.id;
      log('admin account ensured');
    }
  } else {
    log('ADMIN_EMAIL not set; no admin account created');
  }

  let testDelegates = 0;
  if (options.seedTestDelegates && process.env.NODE_ENV !== 'production') {
    for (let i = 1; i <= TEST_DELEGATE_COUNT; i++) {
      const n = String(i).padStart(2, '0');
      const email = `test-delegate-${n}@example.com`;
      const data = {
        name: `Test Delegate ${n}`,
        email,
        organisation: i % 2 === 0 ? 'Example Bank Plc' : 'Example Ministry of Health',
        jobTitle: i % 3 === 0 ? 'Learning and Development Manager' : 'HR Business Partner',
        country: i % 4 === 0 ? 'Ghana' : 'Nigeria',
        attendanceFormat: i % 3 === 0 ? ('virtual' as const) : ('physical' as const),
        capacity: i % 5 === 0 ? ('nominee' as const) : ('individual' as const),
        nominatingOrganisation: i % 5 === 0 ? 'Example Group' : null,
        registrationStatus: 'test' as const,
      };
      // No PSL-level unique on (event_id, email): the partial functional index lives in SQL only.
      const existing = await prisma.delegate.findFirst({
        where: { eventId: event.id, email, registrationStatus: 'test' },
        select: { id: true },
      });
      // Sign-in eligibility is identity-based (D8 item 1): each test delegate owns an identity whose
      // current address is the registration email, exactly as a committed import would create it.
      const address = await prisma.identityEmail.findUnique({
        where: { emailNormalised: email },
        select: { identityId: true, kind: true },
      });
      let identityId = address?.kind === 'current' ? address.identityId : null;
      if (!identityId) {
        if (address)
          throw new Error(`seed: ${email} is reserved by an identity as ${address.kind}`);
        const identity = await prisma.delegateIdentity.create({
          data: {
            displayName: data.name,
            emails: { create: { emailNormalised: email, kind: 'current', evidence: 'import' } },
          },
          select: { id: true },
        });
        identityId = identity.id;
      }
      if (existing) {
        await prisma.delegate.update({ where: { id: existing.id }, data: { ...data, identityId } });
      } else {
        await prisma.delegate.create({ data: { eventId: event.id, identityId, ...data } });
      }
      testDelegates++;
    }
    log(`${testDelegates} test delegates (registration_status = test)`);
  } else if (options.seedTestDelegates) {
    log('refusing to seed test delegates: NODE_ENV is production');
  }

  // Every seed run is recorded; the log is append-only, so re-runs add a row rather than editing one.
  await audit(prisma, {
    action: 'seed.completed',
    entityType: 'event',
    entityId: event.id,
    eventId: event.id,
    actorUserId: adminUserId,
    newValue: { testDelegates, adminAccount: adminUserId !== null },
  });

  return { eventId: event.id, adminUserId, testDelegates };
}

// Run directly: `tsx src/seed.ts` or `node dist/seed.js`.
const isDirectRun = process.argv[1] !== undefined && /[\\/]seed\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  const prisma = getPrisma();
  seed(prisma, {
    adminEmail: process.env.ADMIN_EMAIL,
    seedTestDelegates: process.env.SEED_TEST_DELEGATES === 'true',
    log: (message) => console.log(`seed: ${message}`),
  })
    .then(async (result) => {
      console.log(`seed: done (event ${result.eventId})`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error('seed: failed', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
