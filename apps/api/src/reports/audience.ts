import { reportKindMeta, type ReportKind, type TextAnswers } from '@mbc/shared';

import type { BuiltReport } from './build.js';

/** The smallest group an external aggregate may describe before individuals become guessable. */
export const SMALL_GROUP = 5;

const withhold = (t: TextAnswers): TextAnswers => ({ ...t, answers: [], state: 'withheld' });

/**
 * What leaves the building for an external audience (task §4.3 to §4.5, backlog E16-4, E16-5):
 * aggregates only. Every delegate reference, every written answer, every individual plan
 * action, measure row and evidence example is withheld, with its count kept so the reader
 * knows what exists. Internal kinds pass through untouched. The organisation report is already
 * scoped to the organisation's nominees by the builder; this makes it aggregate as well, so a
 * nominee's own answers never reach their employer by default.
 */
export function redactForAudience(report: BuiltReport, kind: ReportKind): BuiltReport {
  if (reportKindMeta[kind].audience === 'internal') return report;
  const out: BuiltReport = structuredClone(report);
  if (out.expectations) out.expectations.texts = out.expectations.texts.map(withhold);
  if (out.experience) {
    out.experience.written = out.experience.written.map(withhold);
    for (const r of out.experience.reflections) r.questions = r.questions.map(withhold);
    for (const f of out.experience.feedback) f.written = f.written.map(withhold);
  }
  if (out.expectationsEnd)
    out.expectationsEnd.explanations = out.expectationsEnd.explanations.map(withhold);
  if (out.transfer) {
    out.transfer.actions.priority = [];
    out.transfer.actions.priorityState = 'withheld';
    const app = out.transfer.application;
    app.supportNeeds = app.supportNeeds.map(withhold);
    app.barriers = app.barriers.map(withhold);
    app.changes = app.changes.map(withhold);
    if (app.followUp) app.followUp.texts = app.followUp.texts.map(withhold);
  }
  if (out.results) {
    out.results.measures.rows = [];
    out.results.measures.rowsState = 'withheld';
    out.results.evidence.examples = [];
    out.results.evidence.examplesState = 'withheld';
    out.results.influences = [];
  }
  out.limitations.push(
    'Prepared for an external audience: aggregates only. No delegate-level information, written answer, individual plan, measure or evidence record is included, and nothing in it has been independently verified by M.Bryan.',
  );
  if (out.population.registered > 0 && out.population.registered < SMALL_GROUP) {
    out.limitations.push(
      `This report describes ${out.population.registered} delegate${out.population.registered === 1 ? '' : 's'}; aggregates of so few people can identify individuals. Review before sharing.`,
    );
  }
  return out;
}
