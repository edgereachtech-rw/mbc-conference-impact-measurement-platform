import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeReport } from './report-fixture';
import { ReportView } from './report-view';

const view = (report = makeReport()) =>
  render(<ReportView report={report} timezone="Africa/Lagos" />);

describe('ReportView', () => {
  it('shows the event, the reporting date, the population and the limitations', () => {
    view();
    const cover = screen.getByText('What this report covers').closest('div')!;
    expect(cover.textContent).toMatch(/Summit \(summit\)/);
    expect(cover.textContent).toMatch(/12 Nov 2026 to 13 Nov 2026/);
    expect(cover.textContent).toMatch(/Everything recorded to the reporting date/);
    expect(cover.textContent).toMatch(
      /4 delegates\. Registered delegates whose registration is active/,
    );
    expect(cover.textContent).toMatch(/neither label means independently verified/);
    expect(cover.textContent).toMatch(/Missing answers are never counted as zero/);
  });

  it('gives every participation figure its count, its denominator and its definition', () => {
    view();
    const figures = screen.getByLabelText('Participation figures');
    expect(figures.textContent).toMatch(/Registered delegates.*4 of 4 \(100%\)/);
    expect(figures.textContent).toMatch(/With a platform account.*2 of 4 \(50%\)/);
    expect(figures.textContent).toMatch(
      /Registered delegates with a platform account, of registered/,
    );
    expect(figures.textContent).toMatch(/Attended at least one date.*2 of 4 \(50%\)/);
    // Registration, account and attendance are three different figures.
    expect(figures.textContent).toMatch(/Signed in at least once/);
    expect(screen.getByText('An active registration for the event.')).toBeTruthy();
  });

  it('separates physical from virtual, and reports each date without calling an open date absent', () => {
    view();
    const byFormat = screen.getByText('By attendance format').closest('div')!;
    expect(within(byFormat).getByRole('table').textContent).toMatch(/In person21150%/);
    expect(within(byFormat).getByRole('table').textContent).toMatch(/Online21150%/);
    const dates = screen.getByText('Attendance by event date').closest('div')!;
    expect(dates.textContent).toMatch(/12 Nov 2026closed/);
    expect(dates.textContent).toMatch(/13 Nov 2026open · Not yet available/);
  });

  it('reports an unconfigured stage as a state, never as a zero rate', () => {
    view();
    const stages = screen.getByLabelText('Assessment completion');
    expect(stages.textContent).toMatch(/Pre-conference assessment2 of 4 submitted \(50%\)/);
    expect(stages.textContent).toMatch(/During-conference assessmentNot configured for this event/);
    expect(stages.textContent).not.toMatch(/During-conference assessment0 of 0/);
  });

  it('labels confidence as self-reported and excludes "Not applicable" from the average', () => {
    view();
    const statements = screen
      .getByText('Baseline self-reported confidence and current practices')
      .closest('div')!;
    expect(statements.textContent).toMatch(/Self-reported/);
    expect(statements.textContent).toMatch(/“Not applicable” and blanks are excluded/);
    expect(within(statements).getByRole('table').textContent).toMatch(/I can identify a measure11/);
  });

  it('shows the paired comparison as the same delegates before and after', () => {
    view();
    const paired = screen.getByText(/Paired comparison · Knowledge check/).closest('div')!;
    expect(paired.textContent).toMatch(/Only delegates who submitted both stages/);
    expect(paired.textContent).toMatch(
      /2 paired delegates: 75% before, 100% after, change 25 percentage points/,
    );
  });

  it('keeps expectations recorded after the event apart from pre-event ones', () => {
    view();
    expect(screen.getByText('Pre-event expectations, as assessed at the end')).toBeTruthy();
    const post = screen.getByText('Expectations recorded after the event').closest('div')!;
    expect(post.textContent).toMatch(/Reported separately from pre-event expectations/);
  });

  it('distinguishes a started plan from a submitted one and from one acted upon', () => {
    view();
    const plans = screen.getByLabelText('Transfer plan figures');
    expect(plans.textContent).toMatch(/Plans started.*2 of 4 \(50%\)/);
    expect(plans.textContent).toMatch(/Plans submitted.*1 of 4 \(25%\)/);
    expect(plans.textContent).toMatch(/Applied actions.*1 of 3 \(33.3%\)/);
    expect(
      screen.getByText(/a submitted plan does not show that its actions happened/),
    ).toBeTruthy();
  });

  it('counts delegates who have not answered apart from those reporting no progress', () => {
    view();
    const follow = screen.getByText('Follow-up').closest('div')!;
    expect(follow.textContent).toMatch(/Responded and report progress1/);
    expect(follow.textContent).toMatch(/Responded, no progress reported1/);
    expect(follow.textContent).toMatch(/Not yet responded2/);
  });

  it('reads a measure in its own direction and never claims verification', () => {
    view();
    const measures = screen.getByText('Reported measures').closest('div')!;
    expect(within(measures).getByRole('table').textContent).toMatch(
      /Dee LegateBaseline the error rateError rateLower is better12 %—9 %Supported by another source/,
    );
    // A blank target must not render as a bare unit.
    expect(within(measures).getByRole('table').textContent).not.toMatch(/12 %%/);
    const outcomes = screen.getByText('Measures with a result').closest('div')!;
    expect(outcomes.textContent).toMatch(/Improved1/);
    expect(screen.getByText(/an increase is never\s+assumed to be positive/)).toBeTruthy();
    expect(screen.getByText(/No business result is attributed to the event/)).toBeTruthy();
  });

  it('shows an external report as a draft until it is approved, and its approval once it is', () => {
    const { unmount } = view(
      makeReport({
        kind: 'organisation',
        audience: 'external',
        approval: { required: true, current: null, covers: false },
      }),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Draft: not approved for sharing/);
    expect(screen.getByRole('alert').textContent).toMatch(
      /never sends a report anywhere by itself/,
    );
    unmount();
    view(
      makeReport({
        kind: 'organisation',
        audience: 'external',
        approval: {
          required: true,
          covers: true,
          current: {
            id: 'a1',
            sections: ['participation', 'transfer'],
            note: 'Agreed with Acme',
            approvedAt: '2026-12-01T09:00:00.000Z',
            approvedBy: 'admin@example.com',
          },
        },
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Agreed with Acme/).textContent).toMatch(/by admin@example.com/);
  });

  it('shows what was withheld for an external audience as a state, keeping the count', () => {
    const base = makeReport();
    view(
      makeReport({
        results: {
          ...base.results!,
          measures: { ...base.results!.measures, rows: [], rowsState: 'withheld' },
          evidence: { ...base.results!.evidence, examples: [], examplesState: 'withheld' },
        },
        transfer: {
          ...base.transfer!,
          actions: { ...base.transfer!.actions, priority: [], priorityState: 'withheld' },
        },
      }),
    );
    expect(screen.getByText(/Reported measures: Not included for this audience/)).toBeTruthy();
    expect(
      screen.getByText(/Examples of application: Not included for this audience/),
    ).toBeTruthy();
    expect(screen.getByText(/^Not included for this audience\.$/)).toBeTruthy();
  });

  it('leaves out a section the report does not carry', () => {
    view(
      makeReport({
        sections: ['participation'],
        expectations: null,
        experience: null,
        expectationsEnd: null,
        transfer: null,
        results: null,
      }),
    );
    expect(screen.getByRole('region', { name: 'Delegate participation' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Transfer Planning and application' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Expectations and results' })).toBeNull();
  });
});
