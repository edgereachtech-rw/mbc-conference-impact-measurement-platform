'use client';

import { stageTitleOf, type AssessmentStage, type EventDetail } from '@mbc/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DownloadBatchProvider } from '@/components/admin/download-batch';

import { ConfirmationEditor } from './confirmation-editor';
import { PairedResults } from './paired-results';
import { QuestionBuilder } from './question-builder';
import { StageSubmissions } from './stage-submissions';

type Tab = 'questions' | 'confirmation' | 'submissions' | 'paired';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'questions', label: 'Questions' },
  { id: 'confirmation', label: 'Confirmation' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'paired', label: 'Paired results' },
];

interface StageWorkspaceProps {
  event: EventDetail;
  stage: AssessmentStage;
  wave?: number;
}

/**
 * One assessment stage's own page: the question builder and the submissions, as two tabs. A
 * change to the questions refreshes the server-rendered header so its question count follows.
 */
export function StageWorkspace({ event, stage, wave = 1 }: StageWorkspaceProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('questions');
  const readOnly = event.status === 'archived';
  const selectedWave = event.assessmentStages.find(
    (item) => item.stage === stage && item.wave === wave,
  );
  return (
    <DownloadBatchProvider eventId={event.id}>
      <section aria-label="Stage workspace" className="space-y-4">
        <div
          role="tablist"
          aria-label="Stage sections"
          className="flex gap-1 overflow-x-auto border-b border-corp-line"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? '-mb-px shrink-0 border-b-2 border-corp-accent px-3 py-3 text-sm font-semibold whitespace-nowrap text-corp-ink'
                  : 'shrink-0 border-b-2 border-transparent px-3 py-3 text-sm font-medium whitespace-nowrap text-corp-muted hover:text-corp-ink'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {readOnly ? (
          <p
            role="note"
            className="rounded-none border border-corp-line bg-corp-accent-soft px-4 py-3 text-sm text-corp-ink"
          >
            This event is archived and read-only.
          </p>
        ) : null}
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'questions' ? (
            <QuestionBuilder
              eventId={event.id}
              stage={stage}
              wave={wave}
              waveLabel={selectedWave?.title?.trim() || selectedWave?.waveLabel}
              rounds={event.assessmentStages.map((s) => ({
                stage: s.stage,
                wave: s.wave,
                label: stageTitleOf(s, event.eventType),
              }))}
              eventType={event.eventType}
              readOnly={readOnly}
              onChanged={() => router.refresh()}
            />
          ) : tab === 'confirmation' ? (
            <ConfirmationEditor
              key={`${stage}:${wave}:${selectedWave?.updatedAt ?? ''}`}
              event={event}
              stage={stage}
              wave={wave}
              readOnly={readOnly}
              onSaved={() => router.refresh()}
            />
          ) : tab === 'paired' ? (
            <PairedResults
              eventId={event.id}
              stage={stage}
              wave={wave}
              eventType={event.eventType}
            />
          ) : (
            <StageSubmissions
              eventId={event.id}
              eventName={event.name}
              stage={stage}
              wave={wave}
              timezone={event.timezone}
              readOnly={readOnly}
            />
          )}
        </div>
      </section>
    </DownloadBatchProvider>
  );
}
