'use client';

import { useState } from 'react';

import { DelegateTable } from './delegate-table';
import { MessagesHistory } from './messages-history';

interface Props {
  eventId: string;
  eventName: string;
}

/** The event page's working area: the delegate table and the messages sent to those delegates. */
export function EventWorkspace({ eventId, eventName }: Props) {
  const [messagesVersion, setMessagesVersion] = useState(0);
  return (
    <>
      <section aria-labelledby="event-delegates-title" className="space-y-3">
        <h2 id="event-delegates-title" className="font-corporate text-h3 text-corp-ink">
          Delegates
        </h2>
        <DelegateTable
          eventId={eventId}
          eventName={eventName}
          onMessageSent={() => setMessagesVersion((n) => n + 1)}
        />
      </section>
      <section aria-labelledby="event-messages-title" className="space-y-3">
        <h2 id="event-messages-title" className="font-corporate text-h3 text-corp-ink">
          Messages
        </h2>
        <MessagesHistory eventId={eventId} refreshKey={messagesVersion} />
      </section>
    </>
  );
}
