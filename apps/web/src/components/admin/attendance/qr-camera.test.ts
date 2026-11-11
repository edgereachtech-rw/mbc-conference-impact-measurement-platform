import { afterEach, describe, expect, it, vi } from 'vitest';

import { cameraAvailability, cameraProblemOf, createQrReader, startQrCamera } from './qr-camera';

const named = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
});

describe('cameraProblemOf', () => {
  it('tells a refusal, a missing camera and a busy camera apart', () => {
    expect(cameraProblemOf(named('NotAllowedError'))).toBe('blocked');
    expect(cameraProblemOf(named('SecurityError'))).toBe('blocked');
    expect(cameraProblemOf(named('NotFoundError'))).toBe('no_camera');
    expect(cameraProblemOf(named('OverconstrainedError'))).toBe('no_camera');
    expect(cameraProblemOf(named('NotReadableError'))).toBe('in_use');
    expect(cameraProblemOf(new Error('boom'))).toBe('failed');
    expect(cameraProblemOf('not an error')).toBe('failed');
  });
});

describe('cameraAvailability', () => {
  it('refuses before asking on a plain http address and where the browser has no camera API', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    expect(cameraAvailability()).toBe('insecure');
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    expect(cameraAvailability()).toBe('unsupported');
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: () => undefined } });
    expect(cameraAvailability()).toBeNull();
    if (descriptor) Object.defineProperty(window, 'isSecureContext', descriptor);
  });
});

describe('createQrReader', () => {
  it('uses the browser detector when there is one', async () => {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([{ rawValue: 'code-from-browser' }]);
      }
    };
    const read = createQrReader();
    expect(await read(document.createElement('video'))).toBe('code-from-browser');
  });

  it('falls back to decoding frames itself, and reads nothing from an empty frame', async () => {
    const read = createQrReader();
    // jsdom has no video frames and no canvas: the reader answers null instead of throwing.
    expect(await read(document.createElement('video'))).toBeNull();
  });
});

describe('startQrCamera', () => {
  it('reports a blocked camera as such and starts nothing', async () => {
    const onProblem = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: () => Promise.reject(named('NotAllowedError')) },
    });
    startQrCamera(document.createElement('video'), { onCode: vi.fn(), onProblem });
    await vi.waitFor(() => expect(onProblem).toHaveBeenCalledWith('blocked'));
  });

  it('hands over the first code read and releases the camera', async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
    });
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([{ rawValue: 'scanned-code' }]);
      }
    };
    const video = document.createElement('video');
    video.play = () => Promise.resolve();
    const onCode = vi.fn();
    startQrCamera(video, { onCode, onProblem: vi.fn(), intervalMs: 5 });
    await vi.waitFor(() => expect(onCode).toHaveBeenCalledWith('scanned-code'));
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops a camera that answers after the dialog closed', async () => {
    const track = { stop: vi.fn() };
    let resolve: (s: MediaStream) => void = () => undefined;
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((r) => {
            resolve = r;
          }),
      },
    });
    const stop = startQrCamera(document.createElement('video'), {
      onCode: vi.fn(),
      onProblem: vi.fn(),
    });
    stop();
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
  });
});
