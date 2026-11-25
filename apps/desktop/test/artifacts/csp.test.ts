import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DS = 'http://127.0.0.1:55435';
const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// The packaged renderer's CSP content string, as written in vite.config.ts.
const csp = source('../../vite.config.ts').match(/content:\s*"([^"]+)"/)?.[1] ?? '';
const directives = new Map(
  csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name, values] as const),
);

describe('OnlyOffice CSP and frame rule', () => {
  it('the packaged CSP allows scripts and frames from the DocumentServer origin only', () => {
    expect(csp).toContain(`script-src 'self' ${DS}`);
    expect(csp).toContain(`frame-src ${DS}`);
    expect(directives.get('script-src')).toEqual(["'self'", DS]);
    expect(directives.get('frame-src')).toEqual([DS]);
    expect(csp).toBe(
      `default-src 'self'; script-src 'self' ${DS}; frame-src ${DS}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*`,
    );
  });

  it('keeps every other directive as it was', () => {
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get('img-src')).toEqual(["'self'", 'blob:', 'data:']);
    expect(directives.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:*', 'ws://127.0.0.1:*']);
    expect([...directives.keys()].sort()).toEqual(['connect-src', 'default-src', 'frame-src', 'img-src', 'script-src', 'style-src']);
  });

  it('main.ts lets sub-frames navigate only to the DocumentServer origin or about:blank, after will-navigate', () => {
    const main = source('../../src/main/main.ts');
    const nav = main.indexOf("webContents.on('will-navigate'");
    const frame = main.indexOf("webContents.on('will-frame-navigate'");
    expect(nav).toBeGreaterThan(-1);
    expect(frame).toBeGreaterThan(nav);
    expect(main.split("'will-frame-navigate'").length).toBe(2);
    const handler = main.slice(frame, main.indexOf('});', frame));
    expect(handler).toContain('!e.isMainFrame');
    expect(handler).toContain(`e.url.startsWith('${DS}/')`);
    expect(handler).toContain("e.url === 'about:blank'");
    expect(handler).toContain('e.preventDefault()');
  });
});
