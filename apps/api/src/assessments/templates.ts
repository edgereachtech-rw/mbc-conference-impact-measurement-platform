import type { AssessmentStage } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';
import type { AssessmentTemplate } from './ittec-pre-conference.js';

export { ITTEC_PRE_CONFERENCE, type AssessmentTemplate } from './ittec-pre-conference.js';

/**
 * Appends a content set's sections and questions to a stage as that event's own, editable data
 * (used by `db:seed` for the ITTEC pilot). Nothing already in the stage is touched; orders
 * continue after the existing rows.
 */
export async function loadTemplateInto(
  tx: Prisma.TransactionClient,
  stage: { id: string; eventId: string; stage: AssessmentStage },
  template: AssessmentTemplate,
): Promise<{ sections: number; questions: number }> {
  if (template.stage !== stage.stage) {
    throw new Error(`Template ${template.id} is for the ${template.stage} stage.`);
  }
  const lastSection = await tx.assessmentSection.aggregate({
    where: { stageConfigId: stage.id },
    _max: { order: true },
  });
  const lastQuestion = await tx.assessmentQuestion.aggregate({
    where: { stageConfigId: stage.id, retiredAt: null },
    _max: { order: true },
  });
  let sectionOrder = lastSection._max.order ?? 0;
  let questionOrder = lastQuestion._max.order ?? 0;
  let questions = 0;
  for (const section of template.sections) {
    sectionOrder += 1;
    const created = await tx.assessmentSection.create({
      data: {
        stageConfigId: stage.id,
        eventId: stage.eventId,
        title: section.title,
        description: section.description,
        marking: section.marking ?? 'none',
        order: sectionOrder,
      },
      select: { id: true },
    });
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
  return { sections: template.sections.length, questions };
}
