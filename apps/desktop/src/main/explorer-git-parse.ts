import type { ExplorerFileEntry } from "../shared/explorer-api";

/**
 * Parsers for the NUL-delimited git machine formats used by the task explorer.
 *
 * Every record shape here was observed on a real repository rather than taken
 * from the manual, because the two rename shapes disagree with each other:
 *
 *   git status --porcelain=v1 -z        R  NEW\0OLD\0        (target first)
 *   git diff --name-status -z           R084\0OLD\0NEW\0     (source first)
 *   git diff --numstat -z               2\t1\t\0OLD\0NEW\0   (empty path field)
 *
 * Getting one of these backwards silently shows the pre-rename path, so the
 * three cases are covered by `explorer-git-parse.test.ts`.
 */

export type StatusEntry = { status: string; path: string; origPath?: string };

export type NumstatTotals = Map<string, { additions: number | null; deletions: number | null }>;

/**
 * `--porcelain=v1 -z` emits `<XY> <path>` records. A rename or copy appends the
 * source path as the following record, so the loop consumes two.
 */
export function parsePorcelain(output: string): StatusEntry[] {
  const records = output.split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status[0] === "R" || status[0] === "C") {
      const origPath = records[index + 1] || undefined;
      index += 1;
      entries.push({ status, path, ...(origPath ? { origPath } : {}) });
    } else {
      entries.push({ status, path });
    }
  }
  return entries;
}

/** `--numstat -z` emits `<added>\t<deleted>\t<path>\0`; renames key on the target. */
export function parseNumstat(output: string): NumstatTotals {
  const totals: NumstatTotals = new Map();
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    if (firstTab < 0) continue;
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (secondTab < 0) continue;
    const additions = record.slice(0, firstTab);
    const deletions = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    if (!path) {
      // Rename: consume the old path, keep the new one.
      path = records[index + 2] ?? "";
      index += 2;
      if (!path) continue;
    }
    totals.set(path, {
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    });
  }
  return totals;
}

/**
 * `--name-status -z` emits `<status>\0<path>\0`; a rename or copy inserts the
 * source after the target (`R084\0OLD\0NEW\0`), so the target lives at +2 and
 * the trio is consumed together.
 */
export function parseNameStatus(output: string, totals: NumstatTotals): ExplorerFileEntry[] {
  const records = output.split("\0").filter(Boolean);
  const entries: ExplorerFileEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    const renamed = status.startsWith("R") || status.startsWith("C");
    const path = records[renamed ? index + 2 : index + 1];
    index += renamed ? 2 : 1;
    if (!path) continue;
    const total = totals.get(path);
    entries.push({
      path,
      status: status[0] ?? status,
      additions: total?.additions ?? null,
      deletions: total?.deletions ?? null,
    });
  }
  return entries;
}
