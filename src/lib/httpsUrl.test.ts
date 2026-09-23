// @vitest-environment node
// (Node's native URL parser is the WHATWG one a browser runs, and is much faster than
// jsdom's JS copy, which matters for the code-point sweep below.)

import { describe, expect, it } from 'vitest';

import { httpsUrlOrNull } from './httpsUrl';

const NBSP = String.fromCharCode(0xa0);
const SOH = String.fromCharCode(1);

describe('httpsUrlOrNull', () => {
  it.each([
    ['a plain https URL', 'https://admin.example/accept?t=abc'],
    ['an upper-case scheme', 'HTTPS://admin.example/accept'],
    ['surrounding whitespace', '  https://admin.example/accept \n'],
    ['a tab inside the URL', 'https://admin.example/acc\tept'],
  ])('accepts %s and returns the browser-normalised href', (_name, url) => {
    expect(httpsUrlOrNull(url)).toBe(new URL(url).href);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['a mixed-case script scheme', 'JaVaScRiPt:alert(1)'],
    ['a tab inside the scheme', 'java\tscript:alert(1)'],
    ['a newline inside the scheme', 'java\nscript:alert(1)'],
    ['a leading space before javascript:', ' javascript:alert(1)'],
    ['a leading NBSP before javascript:', `${NBSP}javascript:alert(1)`],
    ['a leading C0 control before javascript:', `${SOH}javascript:alert(1)`],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['blob:', 'blob:https://admin.example/uuid'],
    ['plain http', 'http://admin.example/accept'],
    ['protocol-relative', '//admin.example/accept'],
    ['a rooted path', '/accept'],
    ['a relative path', 'accept'],
    ['a fragment', '#x'],
    ['the empty string', ''],
    ['whitespace only', '   '],
    ['https with no host', 'https://'],
  ])('rejects %s', (_name, url) => {
    expect(httpsUrlOrNull(url)).toBeNull();
  });

  it.each([
    [undefined],
    [null],
    [42],
    [{}],
    [['https://a.example']],
    [{ toString: () => 'https://a.example' }],
  ])('rejects a non-string: %o', (value) => {
    expect(httpsUrlOrNull(value)).toBeNull();
  });

  it('returns a value that parses to https again, unchanged (the checked value is the used value)', () => {
    for (const url of [
      'HTTPS://Admin.Example/x',
      ' https://admin.example/x\t',
      'https:admin.example/x',
    ]) {
      const out = httpsUrlOrNull(url);
      expect(out).not.toBeNull();
      expect(new URL(out as string).protocol).toBe('https:');
      expect(httpsUrlOrNull(out)).toBe(out);
    }
  });

  // Every BMP code point before or inside a scheme. The helper is defined by the WHATWG URL
  // parser (Node's implementation of the algorithm a browser runs), so this pins it to that parser
  // on every code point; it does not run a browser. Positive control: the check a person writes
  // first, `startsWith('https:')`, disagrees with the parser on this same set, so a sweep that
  // could not tell them apart would prove nothing.
  it('accepts exactly what the URL parser reads as https, for any code point before or inside a scheme', () => {
    const naive = (u: string): boolean => u.startsWith('https:');
    const isHttps = (u: string): boolean => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    };
    const violations: string[] = [];
    let accepted = 0;
    let naiveWrong = 0;
    for (let cp = 0; cp <= 0xffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      for (const input of [
        `${ch}https://a.example/`,
        `${ch}javascript:alert(1)`,
        `java${ch}script:alert(1)`,
      ]) {
        const out = httpsUrlOrNull(input);
        const browserSaysHttps = isHttps(input);
        if (out !== null) accepted += 1;
        if ((out !== null) !== browserSaysHttps)
          violations.push(`U+${cp.toString(16)} ${JSON.stringify(input)}`);
        if (naive(input) !== browserSaysHttps) naiveWrong += 1;
      }
    }
    expect(violations).toEqual([]);
    expect(accepted).toBeGreaterThan(0);
    expect(naiveWrong).toBeGreaterThan(0);
  }, 120_000);
});
