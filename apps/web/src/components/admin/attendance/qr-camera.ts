import jsQR from 'jsqr';

/**
 * Camera QR scanning for the attendance check-in (attendance requirements, 2026-10-30; scanner
 * fallback and clear failure reasons 2026-11-12). The browser's own BarcodeDetector is used
 * where it exists (Chrome and Edge on Android and desktops); everywhere else (Safari on iPhone
 * and iPad, Firefox) each frame is drawn to a canvas and decoded by jsQR. Why the camera could
 * not run is told apart, because every reason needs a different thing from the admin.
 */

export type CameraProblem =
  'insecure' | 'unsupported' | 'blocked' | 'no_camera' | 'in_use' | 'failed';

export const cameraProblemText: Record<CameraProblem, string> = {
  insecure:
    'The camera is only available on a secure (https) address. Open the platform through its https address, or type the code instead.',
  unsupported: 'This browser cannot use the camera; type or paste the code instead.',
  blocked:
    'Camera access is blocked for this site. Allow it from the address bar (the lock or camera icon) or in the browser’s site settings, then press Use the camera again.',
  no_camera: 'No camera was found on this device; type or paste the code instead.',
  in_use:
    'The camera is being used by another app or tab. Close it, then press Use the camera again.',
  failed: 'The camera could not be started; type or paste the code instead.',
};

/** Why the camera cannot even be asked for, before any prompt; null when it can. */
export function cameraAvailability(): CameraProblem | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    return 'unsupported';
  }
  return null;
}

/** The reason behind a failed camera request, from the error the browser raised. */
export function cameraProblemOf(error: unknown): CameraProblem {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'blocked';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in_use';
    default:
      return 'failed';
  }
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/** Reads one frame: the browser's detector when it has one, jsQR on a canvas otherwise. */
export function createQrReader(): (video: HTMLVideoElement) => Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Ctor) {
    const detector = new Ctor({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  let canvas: HTMLCanvasElement | null = null;
  return async (video) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    canvas ??= document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    return jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

interface Handlers {
  /** The first code read; the camera is already stopped when this is called. */
  onCode: (value: string) => void;
  /** Why the camera did not start; nothing is running when this is called. */
  onProblem: (problem: CameraProblem) => void;
  intervalMs?: number;
}

/**
 * Starts the rear camera on `video` and reads frames until a code is found or the returned
 * function is called. Stopping releases the camera, which matters on phones where a held
 * camera blocks every other app.
 */
export function startQrCamera(video: HTMLVideoElement, handlers: Handlers): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const read = createQrReader();

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(
    (s) => {
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      const playing = video.play() as Promise<void> | undefined;
      if (playing && typeof playing.catch === 'function') playing.catch(() => undefined);
      timer = setInterval(async () => {
        if (stopped) return;
        try {
          const value = await read(video);
          if (value && !stopped) {
            stop();
            handlers.onCode(value);
          }
        } catch {
          // A frame that cannot be read is skipped; the next one is tried.
        }
      }, handlers.intervalMs ?? 500);
    },
    (error: unknown) => {
      if (!stopped) handlers.onProblem(cameraProblemOf(error));
    },
  );
  return stop;
}
