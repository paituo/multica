/**
 * "3 days ago" for the timeline and the commit graph.
 *
 * `Intl.RelativeTimeFormat` is used instead of a hand-written table so the text
 * follows the app's locale and so singular/plural is never a bug of ours.
 * `locale` is the app locale, not the OS one: a zh workbench was otherwise
 * showing "2 hours ago" next to Chinese labels.
 *
 * An unparseable date returns an empty string rather than "Invalid Date",
 * because a missing date in a row is quieter than a broken one.
 */
export function relativeTime(iso: string, locale?: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";

  const deltaMs = then - now;
  const magnitude = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  // Ordered largest-first; the first unit that fits wins, so 25 hours reads as
  // "yesterday" rather than "25 hours ago".
  const units: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["week", 7 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];

  for (const [unit, sizeMs] of units) {
    if (magnitude >= sizeMs) return formatter.format(Math.round(deltaMs / sizeMs), unit);
  }
  return formatter.format(Math.round(deltaMs / 1000), "second");
}
