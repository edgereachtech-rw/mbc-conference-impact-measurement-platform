import type { AssessmentStage } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';
import { createBuiltinBlock, mirrorSectionInto } from './blocks.js';
import type { AssessmentTemplate } from './ittec-pre-conference.js';

export { ITTEC_PRE_CONFERENCE, type AssessmentTemplate } from './ittec-pre-conference.js';
export { ITTEC_END_OF_CONFERENCE } from './ittec-end-of-conference.js';

/**
 * Appends a content set's sections and questions to a stage as that event's own, editable data
 * (used by `db:seed` for the ITTEC pilot). Nothing already in the stage is touched; orders
 * continue after the existing rows. A section marked `mirrorOf` repeats the named section of
 * another stage of the same event (skipped when that section does not exist); a section marked
 * `builtin` adds that built-in block.
 */
export async function loadTemplateInto(
  tx: Prisma.TransactionClient,
  stage: { id: string; eventId: string; stage: AssessmentStage },
  template: AssessmentTemplate,
): Promise<{ sections: number; questions: number }> {
  if (template.stage !== stage.stage) {
    throw new Error(`Template ${template.id} is for the ${template.stage} stage.`);
  }
  let sections = 0;
  let questions = 0;
  for (const section of template.sections) {
    if (section.mirrorOf) {
      const source = await tx.assessmentSection.findFirst({
        where: {
          eventId: stage.eventId,
          title: section.mirrorOf.title,
          stage: { stage: section.mirrorOf.stage },
        },
        select: { id: true },
      });
      if (!source) continue;
      const mirrored = await mirrorSectionInto(tx, stage, source.id, { title: section.title });
      if (!mirrored) continue;
      if (section.description) {
        await tx.assessmentSection.update({
          where: { id: mirrored.section.id },
          data: { description: section.description },
        });
      }
      sections += 1;
      questions += mirrored.questions;
      continue;
    }
    if (section.builtin) {
      const block = await createBuiltinBlock(tx, stage, section.builtin);
      sections += 1;
      questions += block.questions;
      continue;
    }
    const lastSection = await tx.assessmentSection.aggregate({
      where: { stageConfigId: stage.id },
      _max: { order: true },
    });
    const lastQuestion = await tx.assessmentQuestion.aggregate({
      where: { stageConfigId: stage.id, retiredAt: null },
      _max: { order: true },
    });
    let questionOrder = lastQuestion._max.order ?? 0;
    const created = await tx.assessmentSection.create({
      data: {
        stageConfigId: stage.id,
        eventId: stage.eventId,
        title: section.title,
        description: section.description,
        marking: section.marking ?? 'none',
        audience: section.audience ?? 'all',
        order: (lastSection._max.order ?? 0) + 1,
      },
      select: { id: true },
    });
    sections += 1;
    for (const q of section.questions) {
      questionOrder += 1;
      questions += 1;
      await tx.assessmentQuestion.create({
        data: {
          stageConfigId: stage.id,
          eventId: stage.eventId,
          sectionId: created.id,
          order: questionOrder,
          prompt: q.prompt,
          helpText: q.helpText ?? null,
          type: q.type,
          required: q.required,
          area: q.area ?? null,
          options: q.options ? (q.options as Prisma.InputJsonValue) : undefined,
          scale:
            q.type === 'rating'
              ? ((q.scale ?? { min: 1, max: 5 }) as Prisma.InputJsonValue)
              : undefined,
        },
      });
    }
  }
  return { sections, questions };
}
