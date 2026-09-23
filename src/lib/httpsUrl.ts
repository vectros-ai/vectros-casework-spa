// ---------------------------------------------------------------------------
// httpsUrl — decide whether a URL that came back from the API may be used as a link
// or opened in a new tab.
//
// A link value the server returns is text, not markup, but an `href` or a
// `window.open` is a place where text becomes behaviour: a `javascript:` URL runs
// script in this origin. The check uses the URL parser a browser uses, so it cannot
// disagree with the browser about the scheme (a leading space, a tab inside the
// scheme, or mixed case is normalised the same way in both), and it returns the
// parsed form so the value that was checked is the value the caller uses.
//
// The host is not restricted: the URLs this guards point at whatever site or storage
// host the server chose. What this refuses is any scheme other than https.
// ---------------------------------------------------------------------------

/**
 * The normalised form of `value` when it is an absolute https URL, otherwise
 * `null` (another scheme, a relative or protocol-relative URL, an unparseable
 * string, or a non-string).
 */
export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' ? parsed.href : null;
}
