/**
 * Git status letters and their colours, shared by the change list and the file
 * tree.
 *
 * VS Code paints a changed file's label with the status colour and adds the
 * letter at the row's trailing edge; both surfaces here do the same, so the
 * mapping lives in one place instead of drifting between them.
 */

/** What the file tree needs to decorate a path. */
export type FileStatusDecoration = { status: string | null; untracked: boolean };

/** First letter of a porcelain status, upper-cased. `null` when unknown. */
export function statusLetter(status: string | null | undefined, untracked = false): string | null {
  // Untracked files are `??` in porcelain; VS Code shows a single `U`.
  if (untracked) return "U";
  if (!status) return null;
  const letter = status.trim().charAt(0).toUpperCase();
  return letter ? letter : null;
}

/** Text colour for a status letter or a decorated file name. */
export function statusColorClass(status: string | null | undefined, untracked = false): string {
  const letter = statusLetter(status, untracked);
  switch (letter) {
    case "A":
      // Git's "untracked" is a different thing from "added to the index", but
      // both read as new (green) in every git UI, VS Code included.
      return "text-emerald-600 dark:text-emerald-400";
    case "D":
      return "text-red-600 dark:text-red-400";
    case "M":
      return "text-amber-600 dark:text-amber-400";
    case "R":
    case "C":
      return "text-blue-600 dark:text-blue-400";
    case "U":
      return "text-emerald-600 dark:text-emerald-400";
    default:
      return "text-muted-foreground";
  }
}

/** Chip background for the change list's inline status badge. */
export function statusBadgeClass(status: string | null | undefined, untracked = false): string {
  const letter = statusLetter(status, untracked);
  switch (letter) {
    case "A":
    case "U":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "D":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "M":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "R":
    case "C":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}
