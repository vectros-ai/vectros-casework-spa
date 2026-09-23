// ---------------------------------------------------------------------------
// The response headers this app is deployed with (`vercel.json`).
//
// The app keeps a long-lived Auth0 refresh token in the browser's local storage, so a
// script that ever ran in this origin could read it. The headers are the second line
// after not letting one run at all. They live in a static file and nothing else
// exercises them, so a stray edit could drop one silently; these tests fail if a
// directive that matters goes missing or is loosened.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import vercelJson from '../vercel.json?raw';

interface HeaderRule {
  readonly source: string;
  readonly headers: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

const config = JSON.parse(vercelJson) as { headers?: HeaderRule[]; rewrites?: unknown[] };

const rule = config.headers?.find((entry) => entry.source === '/(.*)');

// Every header in every rule, so a second rule that repeats a key cannot slip past a test that
// only reads the first.
const everyHeader = (config.headers ?? []).flatMap((entry) =>
  entry.headers.map((item) => ({ source: entry.source, key: item.key.toLowerCase(), value: item.value })),
);
const header = (name: string): string | undefined =>
  rule?.headers.find((entry) => entry.key.toLowerCase() === name.toLowerCase())?.value;

function directive(policy: string, name: string): string[] | undefined {
  const found = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find((tokens) => tokens[0] === name);
  return found?.slice(1);
}

describe('vercel.json response headers', () => {
  it('applies one header set to every path', () => {
    expect(rule).toBeDefined();
  });

  it('has exactly one rule, defining each header once, so no later rule can override another', () => {
    expect((config.headers ?? []).map((entry) => entry.source)).toEqual(['/(.*)']);
    const repeated = everyHeader
      .map((item) => item.key)
      .filter((key, index, keys) => keys.indexOf(key) !== index);
    expect(repeated).toEqual([]);
  });

  it('keeps the single-page-app rewrite', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  describe('Content-Security-Policy', () => {
    const policy = header('Content-Security-Policy') ?? '';

    it('is present', () => {
      expect(policy).not.toBe('');
    });

    it('denies everything by default', () => {
      expect(directive(policy, 'default-src')).toEqual(["'none'"]);
    });

    it("lets scripts come only from this origin: no inline, no eval, no other host", () => {
      expect(directive(policy, 'script-src')).toEqual(["'self'"]);
    });

    it('forbids plugins, framing, and base/form retargeting', () => {
      expect(directive(policy, 'object-src')).toEqual(["'none'"]);
      expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
      expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
      expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    });

    it('allows styles, images and fonts only from this origin (plus inline styles and data: for images and fonts)', () => {
      expect(directive(policy, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
      expect(directive(policy, 'img-src')).toEqual(["'self'", 'data:']);
      expect(directive(policy, 'font-src')).toEqual(["'self'", 'data:']);
    });

    it('names no frame, worker, child or media source, so the default of none applies to them', () => {
      for (const name of ['frame-src', 'child-src', 'worker-src', 'media-src', 'manifest-src', 'prefetch-src']) {
        expect(directive(policy, name), name).toBeUndefined();
      }
    });

    it('only connects out over https, never plain http', () => {
      const connect = directive(policy, 'connect-src') ?? [];
      expect(connect).toContain("'self'");
      expect(connect).toContain('https:');
      expect(connect.some((source) => source.startsWith('http:'))).toBe(false);
      expect(connect).not.toContain('*');
    });

    it('never loosens script execution anywhere in the policy', () => {
      expect(policy).not.toContain("'unsafe-eval'");
      expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    });
  });

  it('sends the remaining headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-XSS-Protection')).toBe('0');
  });

  it('turns off the browser capabilities the app does not use', () => {
    const policy = header('Permissions-Policy') ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(policy, feature).toContain(`${feature}=()`);
    }
  });

  describe('Strict-Transport-Security', () => {
    const value = header('Strict-Transport-Security') ?? '';

    it('lasts at least a year', () => {
      const maxAge = /(?:^|;\s*)max-age=(\d+)/.exec(value)?.[1];
      expect(Number(maxAge)).toBeGreaterThanOrEqual(31_536_000);
    });

    // Left out on purpose: this file is a template that people deploy under their own domain, and
    // `includeSubDomains` or `preload` would bind every subdomain of it, and (for preload) a browser
    // list that is slow to undo. A deployment that owns its domain can add them.
    it('does not claim the whole domain or ask to be preloaded', () => {
      expect(value).not.toMatch(/includeSubDomains/i);
      expect(value).not.toMatch(/preload/i);
    });
  });
});
