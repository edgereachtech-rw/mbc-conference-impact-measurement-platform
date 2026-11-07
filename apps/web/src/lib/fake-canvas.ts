import { vi } from 'vitest';

/**
 * Test double for the canvas, which jsdom does not implement. Measures text at eight pixels a
 * character, records every line of text drawn, and encodes nothing: `toDataURL` answers a fixed
 * marker so a test can tell a labelled image from the bare QR code.
 */
export function fakeCanvas() {
  const drawn: string[] = [];
  const context = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn((text: string) => drawn.push(text)),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    () => 'data:image/png;base64,labelled',
  );
  return { context, drawn };
}
