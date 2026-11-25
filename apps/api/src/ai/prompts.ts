import type { AiWordingRequest, StageSummary } from '@mbc/shared';
import { z } from 'zod';

import { HttpError } from '../lib/errors.js';
import type { AiClient } from './client.js';

// ------------------------------------------------------------------ redaction

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Seven or more digits, with the spaces, dots, dashes and brackets phone numbers are written with.
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;

/**
 * Takes email addresses and phone numbers out of text before it leaves the platform
 * (2026-11-25), in case an admin pasted one into a configuration field. They come back in place
 * afterwards, so the suggestion the admin accepts still has them.
 */
export function redact(text: string): { text: string; restore: (s: string) => string } {
  const found: string[] = [];
  const keep = (match: string) => {
    found.push(match);
    return `[[KEEP${found.length}]]`;
  };
  const phone = (match: string) => {
    // A year range or a date is not a phone number.
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(match.trim())) return match;
    if (match.replace(/\D/g, '').length < 7) return match;
    return keep(match);
  };
  const out = text.replace(EMAIL, keep).replace(PHONE, phone);
  return {
    text: out,
    restore: (s) => s.replace(/\[\[KEEP(\d+)\]\]/g, (m, n: string) => found[Number(n) - 1] ?? m),
  };
}

// ------------------------------------------------------------------ wording

const MODE_INSTRUCTION: Record<AiWordingRequest['mode'], string> = {
  improve:
    'Correct the spelling, grammar and punctuation and make it clearer and more natural, keeping the length about the same.',
  shorter: 'Make it shorter and more direct while keeping every point it makes.',
  formal: 'Make it more formal and professional.',
  friendlier: 'Make it warmer and friendlier while staying professional.',
};

const WORDING_SYSTEM = `You edit wording for the admin console of a professional conference and training impact platform (pre-event assessments, feedback, transfer plans, follow-up surveys, and emails to delegates).
Rules:
- Return only the edited text. No quotes around it, no explanation, no heading, no options.
- Keep the meaning and every fact, date, number, name and link exactly as given. Never invent details.
- Use British English spelling (organisation, programme, colour).
- Keep the same language as the original if it is not English.
- Keep any placeholder exactly as written, for example {{name}}, {name}, [[KEEP1]] or %s.
- Keep line breaks, lists and Markdown formatting (**bold**, links) where the original has them.
- A survey question stays a neutral, unbiased question that a delegate can answer; do not lead the answer.`;

export async function suggestWording(ai: AiClient, input: AiWordingRequest): Promise<string> {
  const { text, restore } = redact(input.text);
  const field = input.field ? `The field is labelled "${input.field}".\n` : '';
  const shape = input.singleLine
    ? 'It is a single-line field: return one line with no line breaks.\n'
    : '';
  const reply = await ai.complete({
    system: WORDING_SYSTEM,
    user: `${field}${shape}Task: ${MODE_INSTRUCTION[input.mode]}\n\nText:\n${text}`,
  });
  let out = stripWrapping(reply);
  if (input.singleLine) out = out.replace(/\s*\n+\s*/g, ' ');
  return restore(out);
}

/** Models sometimes wrap the answer in quotes or a code fence despite the instructions. */
function stripWrapping(s: string): string {
  let out = s.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(out);
  if (fence) out = fence[1]!.trim();
  if (/^".*"$/s.test(out) && !out.slice(1, -1).includes('"')) out = out.slice(1, -1);
  return out;
}

// ------------------------------------------------------------------ summaries

const SUMMARY_SYSTEM = `You write short, factual summaries of survey results for the organisers of a professional conference or training programme. You receive only aggregate figures as JSON: counts, response rate, average knowledge score, average ratings and the share of answers for each option. There are no individual answers.
Rules:
- Use only the figures given. Never invent numbers, causes, quotes or delegate comments.
- Round as the figures are given. Say "of those who answered" where a share is of a subset.
- If fewer than 10 responses were submitted, say the figures are early and may change.
- Point out what stands out: the strongest and weakest areas, clear majorities, and anything the organisers may want to act on.
- British English, plain and neutral. No headings, no Markdown.
Return JSON: {"overview": "<two to four sentences>", "findings": ["<one sentence each, three to six items>"]}`;

const summaryReplySchema = z.object({
  overview: z.string().min(1).max(3000),
  findings: z.array(z.string().min(1).max(600)).max(10).default([]),
});

/**
 * The figures a summary is written from, and nothing else: the identifiers are dropped and every
 * value is a count, an average, a percentage or admin-written wording (a prompt, an option label,
 * a section title).
 */
export function figuresForSummary(title: string, summary: StageSummary, batch: string | null) {
  return {
    assessment: title,
    batch,
    invited: summary.invited,
    started: summary.started,
    submitted: summary.submitted,
    responseRatePercent: summary.responseRate,
    knowledge: summary.knowledge,
    ratingStatements: summary.statements.map((s) => ({
      statement: s.prompt,
      answers: s.responses,
      average: s.average,
    })),
    choiceQuestions: summary.distributions
      .filter((d) => d.responses > 0)
      .map((d) => ({
        question: d.prompt,
        section: d.sectionTitle,
        askedOf:
          d.visibleWhen === 'always'
            ? 'everyone'
            : d.visibleWhen === 'reference_answered'
              ? 'only delegates with an earlier answer'
              : 'only delegates with no earlier answer',
        answers: d.responses,
        options: d.options.map((o) => ({ option: o.label, count: o.count, percent: o.percent })),
      })),
  };
}

export async function writeSummary(
  ai: AiClient,
  figures: ReturnType<typeof figuresForSummary>,
): Promise<{ overview: string; findings: string[] }> {
  const reply = await ai.complete({
    system: SUMMARY_SYSTEM,
    user: JSON.stringify(figures),
    json: true,
    maxTokens: 6000,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    parsed = null;
  }
  const result = summaryReplySchema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(
      503,
      'ai_unavailable',
      'The writing assistant gave an answer that could not be read. Please try again.',
    );
  }
  return {
    overview: result.data.overview.trim(),
    findings: result.data.findings.map((f) => f.trim()),
  };
}
