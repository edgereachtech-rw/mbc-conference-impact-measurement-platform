import QRCode from 'qrcode';

/**
 * A QR code as two PNG data URLs: the bare code for the page, where a caption sits under it, and
 * the same code with its name printed underneath for the file an admin downloads (2026-11-07),
 * so a saved or printed square still says what it is for.
 *
 * The labelled version needs a canvas. Where none is available (server rendering, a browser that
 * refuses it) the download falls back to the bare code rather than failing.
 */
export interface QrImages {
  plain: string;
  labelled: string;
}

export async function qrImages(text: string, title: string, size = 360): Promise<QrImages> {
  const plain = await QRCode.toDataURL(text, { margin: 1, width: size });
  let labelled = plain;
  if (typeof document !== 'undefined') {
    try {
      labelled = await drawLabelled(text, title, size);
    } catch {
      // The bare code is still a usable file.
    }
  }
  return { plain, labelled };
}

async function drawLabelled(text: string, title: string, size: number): Promise<string> {
  const code = document.createElement('canvas');
  await QRCode.toCanvas(code, text, { margin: 1, width: size });

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  const pad = Math.round(size * 0.05);
  const fontSize = Math.max(14, Math.round(size * 0.065));
  const font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.font = font;
  const lines = wrapText(ctx, title.trim(), size - pad * 2);
  const lineHeight = Math.round(fontSize * 1.3);

  out.width = size;
  out.height = size + lines.length * lineHeight + pad;
  // Resizing resets the context, so the text style is set again below.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(code, 0, 0, size, size);
  ctx.font = font;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, size / 2, size + i * lineHeight));
  return out.toDataURL('image/png');
}

/** Greedy word wrap on the measured width; a single word longer than a line stays whole. */
export function wrapText(
  ctx: { measureText(text: string): { width: number } },
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}
