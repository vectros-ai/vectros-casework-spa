// ---------------------------------------------------------------------------
// formatBytes — human-readable byte sizes for document file sizes.
// ---------------------------------------------------------------------------

const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count as a human-readable size (e.g. 1536 → "1.5 KB"). Returns
 * an em-dash for `undefined` and plain bytes below 1 KiB. Uses binary (1024)
 * steps, matching how file sizes are conventionally displayed.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}
