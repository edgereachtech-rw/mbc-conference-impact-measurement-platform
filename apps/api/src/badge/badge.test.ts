import { afterEach, describe, expect, it, vi } from 'vitest';

import { logoDataUri } from './logo.js';
import { renderBadgeSvg } from './render.js';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const silent = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silent,
} as unknown as Parameters<typeof logoDataUri>[1];

const base = {
  eventName: 'ITTEC 2026',
  dateLine: 'NOVEMBER 12-13 2026',
  delegateName: 'Dee Legate',
  organiser: 'M.Bryan Consulting Group',
};

describe('the attending card', () => {
  it('carries the delegate, the event and who nominated them', () => {
    const svg = renderBadgeSvg({
      ...base,
      venueLine: 'Lagos Oriental Hotel',
      sponsor: 'IHS Towers',
    });
    expect(svg).toContain('Dee Legate');
    expect(svg).toContain('I WILL BE ATTENDING');
    expect(svg).toContain('ITTEC 2026');
    expect(svg).toContain('Lagos Oriental Hotel');
    expect(svg).toContain('SPONSORED BY');
    expect(svg).toContain('IHS Towers');
    expect(svg).toContain('M.Bryan Consulting Group');
    expect(svg.startsWith('<?xml')).toBe(true);
  });

  it('leaves out the sponsor and the venue when the registration has neither', () => {
    const svg = renderBadgeSvg(base);
    expect(svg).not.toContain('SPONSORED BY');
    expect(svg).not.toContain('Lagos');
    // Still a complete card: the delegate and the event are the point of it.
    expect(svg).toContain('Dee Legate');
    expect(svg).toContain('I WILL BE ATTENDING');
  });

  it('escapes every value it draws', () => {
    const svg = renderBadgeSvg({
      ...base,
      delegateName: 'Ada <script>alert(1)</script> & Co',
      sponsor: '"Quoted" & co',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;Quoted&quot;');
  });

  it('wraps a long name over two lines and shrinks it, and never runs to a third', () => {
    const svg = renderBadgeSvg({ ...base, delegateName: 'Oluwafemi Adebayo-Williams' });
    expect(svg).toContain('Oluwafemi');
    expect(svg).toContain('Adebayo-Williams');
    const veryLong = renderBadgeSvg({
      ...base,
      delegateName: 'Aaaaaaa Bbbbbbb Ccccccc Ddddddd Eeeeeee Fffffff',
    });
    // Two text lines for the name, whatever is given.
    expect(
      veryLong.match(/font-family="Georgia[^"]*" font-size="\d+" font-weight="700"/g),
    ).toHaveLength(2);
  });

  it('draws the logo when there is one, and types the event name when there is not', () => {
    const withLogo = renderBadgeSvg({ ...base, logoDataUri: 'data:image/png;base64,AAAA' });
    expect(withLogo).toContain('<image href="data:image/png;base64,AAAA"');
    expect(renderBadgeSvg(base)).not.toContain('<image');
  });
});

describe('fetching the event logo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lookup.mockReset();
  });

  const publicAddress = () => lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

  function respond(body: Buffer, type: string, status = 200) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': type, 'content-length': String(body.byteLength) }),
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      })),
    );
  }

  it('inlines an image from a public https address', async () => {
    publicAddress();
    respond(Buffer.from([1, 2, 3, 4]), 'image/png');
    const uri = await logoDataUri('https://example.com/logo.png', silent);
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`);
  });

  it('refuses anything but https', async () => {
    publicAddress();
    respond(Buffer.from([1]), 'image/png');
    expect(await logoDataUri('http://example.com/logo.png', silent)).toBeNull();
    expect(await logoDataUri('file:///etc/passwd', silent)).toBeNull();
    expect(await logoDataUri('not a url', silent)).toBeNull();
  });

  it('refuses an address on the server own network', async () => {
    respond(Buffer.from([1]), 'image/png');
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.4',
      '169.254.169.254',
      '172.16.0.9',
    ]) {
      lookup.mockResolvedValue([{ address, family: 4 }]);
      expect(await logoDataUri('https://internal.example/logo.png', silent), address).toBeNull();
    }
    // Given as a literal address rather than a name, and as a v4 address hidden inside a v6 one.
    expect(await logoDataUri('https://127.0.0.1/logo.png', silent)).toBeNull();
    expect(await logoDataUri('https://[::1]/logo.png', silent)).toBeNull();
    expect(await logoDataUri('https://[::ffff:169.254.169.254]/logo.png', silent)).toBeNull();
  });

  it('refuses what is not an image, and what is too big', async () => {
    publicAddress();
    respond(Buffer.from('<html>'), 'text/html');
    expect(await logoDataUri('https://example.com/page', silent)).toBeNull();

    respond(Buffer.alloc(2_000_001), 'image/png');
    expect(await logoDataUri('https://example.com/huge.png', silent)).toBeNull();
  });

  it('yields nothing rather than throwing when the host fails', async () => {
    publicAddress();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await logoDataUri('https://example.com/logo.png', silent)).toBeNull();
  });
});
