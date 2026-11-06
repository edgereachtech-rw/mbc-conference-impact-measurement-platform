'use client';

import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { consoleButton, Panel } from '@/components/console/page';
import { apiBase, apiUrl } from '@/lib/api';

/**
 * The delegate's "I will be attending" card (task of 2026-11-03).
 *
 * The API draws it as SVG — the event's logo, the dates and venue, the delegate's name and who
 * nominated them. The browser turns it into a PNG for download, because that is what a delegate
 * posts: a social network will not take an SVG, and doing the conversion here keeps an image
 * library out of the API's container.
 *
 * The SVG arrives self-contained (the logo is inlined by the server), so drawing it on a canvas
 * does not taint it and the export works.
 */
export function AttendingBadge({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const base = apiBase();
    fetch(apiUrl(`/me/events/${eventId}/badge.svg`), {
      credentials: base ? 'include' : 'same-origin',
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then(
        (text) => {
          if (!cancelled) setSvg(text);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  /** Draws the SVG at twice its size so the PNG is crisp where it is posted. */
  async function download() {
    if (!svg) return;
    setSaving(true);
    try {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('The card could not be drawn.'));
          image.src = url;
        });
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = (image.naturalWidth || 800) * scale;
        canvas.height = (image.naturalHeight || 1200) * scale;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No canvas');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = png;
        link.download = `${eventName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-i-am-attending.png`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Falling back to the SVG itself: still a file they can use, and no silent failure.
      const link = document.createElement('a');
      link.href = apiUrl(`/me/events/${eventId}/badge.svg`);
      link.download = 'i-am-attending.svg';
      link.click();
    } finally {
      setSaving(false);
    }
  }

  if (failed) return null;

  return (
    <Panel>
      <h3 className="font-corporate text-base font-semibold text-corp-ink">
        Tell people you are coming : I will Attend
      </h3>
      <p className="mt-1 text-sm text-corp-muted">
        If you are yetto download your i will attend card, kindly download it, post it on your
        social media and share it with your network to let people know you will be attending the
        event.
      </p>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div
          className="w-full max-w-[260px] shrink-0 border border-corp-line bg-white [&>svg]:h-auto [&>svg]:w-full"
          // The SVG comes from our own API, which escapes every value it draws.
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
          aria-hidden={svg ? undefined : true}
        >
          {svg ? undefined : (
            <p className="flex min-h-[200px] items-center justify-center text-sm text-corp-muted">
              <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" /> Preparing your
              card…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={!svg || saving}
          className={consoleButton({ variant: 'accent' })}
        >
          {saving ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          Download the card
        </button>
      </div>
    </Panel>
  );
}
