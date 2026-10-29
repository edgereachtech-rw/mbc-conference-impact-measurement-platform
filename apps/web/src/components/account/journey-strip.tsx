import type { MyEvent } from '@mbc/shared';

import { journeyFor } from '@/lib/my-events';

/**
 * One event's journey as a stepper in the corporate identity: a horizontal strip on phones
 * (scrolls) and a row on larger screens. Every step is "Opens later" until its epic ships;
 * nothing here claims attendance.
 */
export function JourneyStrip({ event }: { event: Pick<MyEvent, 'startsOn' | 'endsOn'> }) {
  const steps = journeyFor(event);
  return (
    <section aria-labelledby="journey-title" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="journey-title" className="font-corporate text-h3 text-corp-ink">
          Your journey
        </h2>
        <span className="text-xs text-corp-muted">{steps.length} steps</span>
      </div>
      <ol className="-mx-gutter flex snap-x gap-3 overflow-x-auto px-gutter pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {steps.map((item, index) => (
          <li
            key={item.step}
            className="flex min-w-[14rem] snap-start flex-col gap-2 rounded-none border border-corp-line bg-white p-4 md:min-w-0"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-corp-ink text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                {item.step}
              </span>
            </div>
            <span className="text-sm font-semibold text-corp-ink">{item.title}</span>
            <span className="text-xs text-corp-muted">{item.note}</span>
            <span className="mt-auto inline-flex w-fit items-center rounded-none bg-corp-surface px-2 py-0.5 text-xs font-semibold text-corp-muted">
              Opens later
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
