// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existingDirectory, resolveInside } from "./explorer-paths";

// The renderer runs with `webSecurity: false`, so containment in the main
// process is the only thing standing between a task explorer window and the
// rest of the filesystem. These cases are the acceptance criteria for that.

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "explorer-root-"));
  outside = mkdtempSync(join(tmpdir(), "explorer-outside-"));
  writeFileSync(join(root, "readme.md"), "# ok\n");
  writeFileSync(join(outside, "secret.txt"), "nope\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("resolves a relative path inside the root", async () => {
    const resolved = await resolveInside(root, "readme.md");
    expect(resolved).toBe(join(root, "readme.md"));
  });

  it("rejects a parent traversal", async () => {
    const result = await resolveInside(root, "../../etc/passwd");
    expect(result).toEqual({ ok: false, reason: "outside-root" });
  });

  it("rejects a traversal that merely starts inside the root", async () => {
    const result = await resolveInside(root, `nested/${sep}../../${sep}escape.txt`);
    expect(result).toEqual({ ok: false, reason: "outside-root" });
  });

  it("rejects an absolute posix path", async () => {
    expect(await resolveInside(root, "/etc/passwd")).toEqual({ ok: false, reason: "outside-root" });
  });

  it("rejects an absolute windows path", async () => {
    expect(await resolveInside(root, "C:\\Windows\\win.ini")).toEqual({
      ok: false,
      reason: "outside-root",
    });
  });

  it("rejects a sibling directory that shares the root prefix", async () => {
    const sibling = `${root}-evil`;
    const result = await resolveInside(root, join("..", `${sibling}${sep}x.txt`));
    expect(result).toEqual({ ok: false, reason: "outside-root" });
  });

  it("rejects an embedded NUL and non-strings", async () => {
    expect(await resolveInside(root, "a\0b")).toEqual({ ok: false, reason: "outside-root" });
    expect(await resolveInside(root, 42)).toEqual({ ok: false, reason: "outside-root" });
    expect(await resolveInside(root, "")).toEqual({ ok: false, reason: "outside-root" });
  });

  it("rejects a symlink that points outside the root", async () => {
    const link = join(root, "escape");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      return; // Symlink creation needs privileges on Windows; skip when denied.
    }
    const result = await resolveInside(root, "escape/secret.txt");
    expect(result).toEqual({ ok: false, reason: "outside-root" });
  });

  it("still returns a path for a deleted file so its diff can be shown", async () => {
    const resolved = await resolveInside(root, "deleted-but-diffable.ts");
    expect(resolved).toBe(join(resolve(root), "deleted-but-diffable.ts"));
  });
});

describe("existingDirectory", () => {
  it("returns null for a missing directory", async () => {
    expect(await existingDirectory(join(outside, "gone"))).toBeNull();
  });

  it("returns null for a file", async () => {
    expect(await existingDirectory(join(root, "readme.md"))).toBeNull();
  });

  it("returns the path for a real directory", async () => {
    mkdirSync(join(root, "sub"));
    expect(await existingDirectory(join(root, "sub"))).toBe(join(root, "sub"));
  });
});
