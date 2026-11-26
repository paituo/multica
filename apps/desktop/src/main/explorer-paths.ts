import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { ExplorerFailure, ExplorerFailureReason } from "../shared/explorer-api";

/**
 * Path containment for the task explorer. Kept apart from `explorer-ipc.ts` so
 * it can be tested without an electron runtime: reaching outside the task
 * directory is the one thing this feature must never allow, and the renderer
 * runs with `webSecurity: false`, so this is the only guard.
 */

export function failure(reason: ExplorerFailureReason, message?: string): ExplorerFailure {
  return { ok: false, reason, ...(message ? { message } : {}) };
}

export async function existingDirectory(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const info = await stat(path);
    return info.isDirectory() ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a renderer-supplied relative path inside `root`. Rejects absolute
 * paths and `..` lexically, then again after `realpath` so a symlink cannot be
 * used to step outside.
 */
export async function resolveInside(
  root: string,
  relPath: unknown,
): Promise<string | ExplorerFailure> {
  if (typeof relPath !== "string") return failure("outside-root");
  if (relPath.length === 0 || relPath.includes("\0")) return failure("outside-root");
  if (isAbsolute(relPath)) return failure("outside-root");
  if (/^[A-Za-z]:[\\/]/.test(relPath)) return failure("outside-root");

  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, relPath);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    return failure("outside-root");
  }

  try {
    const [realTarget, realRoot] = await Promise.all([realpath(target), realpath(normalizedRoot)]);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return failure("outside-root");
    }
    return realTarget;
  } catch {
    // Missing files are legal for diff paths; the containment check above
    // already ran on the lexical form.
    return target;
  }
}
