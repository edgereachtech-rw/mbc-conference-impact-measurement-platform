'use client';

import type { AiStatus } from '@mbc/shared';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';

let pending: Promise<boolean> | null = null;

/** Asked once per page load: the server's answer does not change while the console is open. */
function aiEnabled(): Promise<boolean> {
  pending ??= apiFetch<AiStatus>('/ai/status').then(
    (s) => s.enabled === true,
    () => false,
  );
  return pending;
}

/** For tests: forget the cached answer. */
export function resetAiStatus() {
  pending = null;
}

/** Whether the writing assistant is on for this server (2026-11-25); false until known. */
export function useAiEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void aiEnabled().then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
