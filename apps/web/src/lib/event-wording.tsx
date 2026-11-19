'use client';

import { eventNounOf, stageLabelsFor, type AssessmentStage, type EventType } from '@mbc/shared';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * The event's kind, so the delegate screens say "training" or "webinar" where they used to say
 * "conference" (decision 2026-11-19). The event page provides it once; any panel beneath reads
 * it. Nothing is provided on screens outside an event, which read as a conference, the default.
 */
const EventTypeContext = createContext<EventType>('conference');

export function EventWordingProvider({
  eventType,
  children,
}: {
  eventType: EventType | null | undefined;
  children: ReactNode;
}) {
  return (
    <EventTypeContext.Provider value={eventType ?? 'conference'}>
      {children}
    </EventTypeContext.Provider>
  );
}

/** The event's kind as provided by the page, else conference. */
export function useEventType(): EventType {
  return useContext(EventTypeContext);
}

/** The word for the event: "conference", "training", "webinar". */
export function useEventNoun(): string {
  return eventNounOf(useEventType());
}

/** The stage titles for the event: "Pre-training assessment". */
export function useStageLabels(): Record<AssessmentStage, string> {
  return stageLabelsFor(useEventType());
}
