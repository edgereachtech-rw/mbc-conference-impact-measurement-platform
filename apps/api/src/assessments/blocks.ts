import { builtinBlocks, type BuiltinBlockKind } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
interface StageRef {
  id: string;
  eventId: string;
}

async function nextOrders(tx: Tx, stageConfigId: string) {
  const [section, question] = await Promise.all([
    tx.assessmentSection.aggregate({ where: { stageConfigId }, _max: { order: true } }),
    tx.assessmentQuestion.aggregate({
      where: { stageConfigId, retiredAt: null },
      _max: { order: true },
    }),
  ]);
  return {
    sectionOrder: (section._max.order ?? 0) + 1,
    questionOrder: question._max.order ?? 0,
  };
}

/**
 * Repeats a section of another stage of the same event into `stage`: same title (unless
 * overridden), description, marking and audience; every active question copied with the same
 * wording, options and scale and a `sourceQuestionKey` pointing at the original, so the two
 * stages' answers pair per delegate (backlog E11-4 to E11-7). Null when the source is not a
 * section of this event.
 */
export async function mirrorSectionInto(
  tx: Tx,
  stage: StageRef,
  sourceSectionId: string,
  overrides: { title?: string } = {},
) {
  const source = await tx.assessmentSection.findFirst({
    where: { id: sourceSectionId, eventId: stage.eventId },
    include: {
      questions: {
        where: { retiredAt: null },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!source) return null;
  const { sectionOrder, questionOrder } = await nextOrders(tx, stage.id);
  const section = await tx.assessmentSection.create({
    data: {
      stageConfigId: stage.id,
      eventId: stage.eventId,
      title: overrides.title ?? source.title,
      description: source.description,
      marking: source.marking,
      audience: source.audience,
      sourceSectionId: source.id,
      order: sectionOrder,
    },
  });
  let order = questionOrder;
  for (const q of source.questions) {
    order += 1;
    await tx.assessmentQuestion.create({
      data: {
        stageConfigId: stage.id,
        eventId: stage.eventId,
        sectionId: section.id,
        order,
        prompt: q.prompt,
        helpText: q.helpText,
        type: q.type,
        required: q.required,
        area: q.area,
        options: q.options === null ? undefined : (q.options as Prisma.InputJsonValue),
        scale: q.scale === null ? undefined : (q.scale as Prisma.InputJsonValue),
        sourceQuestionKey: q.questionKey,
      },
    });
  }
  return { section, questions: source.questions.length, sourceStageConfigId: source.stageConfigId };
}

/** Adds a built-in block (expectations, readiness) as a section of locked questions. */
export async function createBuiltinBlock(tx: Tx, stage: StageRef, kind: BuiltinBlockKind) {
  const block = builtinBlocks[kind];
  const { sectionOrder, questionOrder } = await nextOrders(tx, stage.id);
  const section = await tx.assessmentSection.create({
    data: {
      stageConfigId: stage.id,
      eventId: stage.eventId,
      title: block.title,
      description: block.description,
      order: sectionOrder,
    },
  });
  let order = questionOrder;
  for (const q of block.questions) {
    order += 1;
    await tx.assessmentQuestion.create({
      data: {
        stageConfigId: stage.id,
        eventId: stage.eventId,
        sectionId: section.id,
        order,
        prompt: q.prompt,
        helpText: q.helpText ?? null,
        type: q.type,
        required: q.required,
        area: q.area ?? null,
        options: q.options ? (q.options as Prisma.InputJsonValue) : undefined,
        builtin: q.builtin,
      },
    });
  }
  return { section, questions: block.questions.length };
}

/** The built-in kind already present in a stage, by its questions' markers. */
export async function builtinKindsIn(tx: Tx, stageConfigId: string): Promise<BuiltinBlockKind[]> {
  const rows = await tx.assessmentQuestion.findMany({
    where: { stageConfigId, retiredAt: null, builtin: { not: null } },
    select: { builtin: true },
  });
  const markers = new Set(rows.map((r) => r.builtin));
  return (Object.keys(builtinBlocks) as BuiltinBlockKind[]).filter((kind) =>
    builtinBlocks[kind].questions.some((q) => markers.has(q.builtin)),
  );
}
