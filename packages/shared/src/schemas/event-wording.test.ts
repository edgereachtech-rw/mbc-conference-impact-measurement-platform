import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMAIL_STYLE,
  emailCustomisationSchema,
  emailLines,
  emailParagraphs,
  emailStyleIsDefault,
  emailStyleSchema,
  fillEmailPlaceholders,
  parseEmailStyle,
  unknownEmailPlaceholders,
} from './emails.js';
import { eventNounOf, stageLabelsFor, stageNamesFor } from './events.js';

describe('event wording by type', () => {
  it('names the stages after the kind of event, with "event" for the unnamed kind', () => {
    expect(stageLabelsFor('conference').pre_conference).toBe('Pre-conference assessment');
    expect(stageLabelsFor('training')).toEqual({
      pre_conference: 'Pre-training assessment',
      during_conference: 'During-training assessment',
      end_of_conference: 'End-of-training evaluation',
      follow_up: 'Post-training follow-up',
    });
    expect(stageLabelsFor('webinar').end_of_conference).toBe('End-of-webinar evaluation');
    expect(stageNamesFor('summit').pre_conference).toBe('pre-summit');
    expect(stageNamesFor(undefined).pre_conference).toBe('pre-conference');
    expect(eventNounOf('other')).toBe('event');
    expect(eventNounOf(null)).toBe('conference');
  });
});

describe('email wording helpers', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(
      fillEmailPlaceholders('Hi {{ firstName }}, {{eventName}} {{nope}}', {
        firstName: 'Ada',
        eventName: 'X',
      }),
    ).toBe('Hi Ada, X {{nope}}');
    expect(
      unknownEmailPlaceholders('{{firstName}} {{waveLabel}} {{waveLabel}}', ['firstName']),
    ).toEqual(['waveLabel']);
  });

  it('splits paragraphs on blank lines and notes on line breaks', () => {
    expect(emailParagraphs('One\nstill one\n\n\nTwo  \n')).toEqual(['One\nstill one', 'Two']);
    expect(emailLines('a\n\n b \nc')).toEqual(['a', 'b', 'c']);
  });

  it('reads a look and knows when it is the platform’s own', () => {
    expect(parseEmailStyle(null)).toBeNull();
    expect(parseEmailStyle({ align: 'left', fontSize: 'normal' })).toBeNull();
    expect(parseEmailStyle({ accentColor: '#1a7f5a' })).toMatchObject({ accentColor: '#1A7F5A' });
    expect(emailStyleSchema.safeParse({ accentColor: 'red' }).success).toBe(false);
    expect(emailStyleIsDefault({ ...DEFAULT_EMAIL_STYLE, align: 'center' })).toBe(false);
  });

  it('blanks empty wording to null and bounds the lengths', () => {
    expect(emailCustomisationSchema.parse({ subject: '  ', intro: 'x' })).toEqual({
      subject: null,
      title: null,
      intro: 'x',
      closing: null,
      buttonLabel: null,
      body: null,
    });
    expect(emailCustomisationSchema.safeParse({ buttonLabel: 'x'.repeat(81) }).success).toBe(false);
  });
});
