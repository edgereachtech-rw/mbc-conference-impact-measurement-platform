import {
  placeholderValuesFor,
  type DelegateMessageRecipientStatus,
  type DelegateMessageStatus,
  type MessagePlaceholderValues,
} from '@mbc/shared';

export type {
  DelegateMessageDetail,
  DelegateMessageRecipients,
  DelegateMessageSendResult,
  DelegateMessageSummary,
} from '@mbc/shared';

/** A delegate the preview is rendered for; the first selected row on screen, or a stand-in. */
export interface PreviewSample {
  name: string;
  email: string;
  organisation: string | null;
}

export const messageStatusLabels: Record<DelegateMessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  partially_failed: 'Partly failed',
  failed: 'Failed',
};

export const recipientStatusLabels: Record<DelegateMessageRecipientStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
};

/** Values the preview fills placeholders with. */
export function previewValues(
  sample: PreviewSample | undefined,
  eventName: string,
): MessagePlaceholderValues {
  return placeholderValuesFor({
    name: sample?.name ?? 'Amina Example',
    email: sample?.email ?? 'amina@example.com',
    organisation: sample?.organisation ?? 'Example Organisation',
    eventName,
  });
}

/** What the admin may type; shown under the editor. */
export const formattingHint =
  '**bold**, *italic*, # heading, - bullet, 1. numbered, [link text](https://…). Placeholders such as {{firstName}} are filled per delegate.';
