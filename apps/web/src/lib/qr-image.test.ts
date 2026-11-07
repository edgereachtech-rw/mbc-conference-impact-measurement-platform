import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeCanvas } from './fake-canvas';
import { qrImages, wrapText } from './qr-image';

afterEach(() => vi.restoreAllMocks());

describe('qrImages', () => {
  it('prints the name under the code in the file and keeps the bare code for the page', async () => {
    const { drawn, context } = fakeCanvas();
    const images = await qrImages('https://example.test/go/e1/transfer-plan', 'Transfer plan');
    expect(images.plain).toMatch(/^data:image\/png/);
    expect(images.labelled).toBe('data:image/png;base64,labelled');
    expect(images.labelled).not.toBe(images.plain);
    expect(drawn).toEqual(['Transfer plan']);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.textAlign).toBe('center');
  });

  it('falls back to the bare code when the browser gives no canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const images = await qrImages('https://example.test/feedback/abc', 'Keynote');
    expect(images.labelled).toBe(images.plain);
  });
});

describe('wrapText', () => {
  const ctx = { measureText: (text: string) => ({ width: text.length * 8 }) };

  it('wraps on words to the width and never splits a word', () => {
    expect(wrapText(ctx, 'End of conference evaluation', 120)).toEqual([
      'End of',
      'conference',
      'evaluation',
    ]);
    expect(wrapText(ctx, 'Supercalifragilistic', 40)).toEqual(['Supercalifragilistic']);
    expect(wrapText(ctx, '   ', 100)).toEqual(['']);
  });
});
