import { describe, expect, it } from "vitest";
import { fileSurfaceFor, hasSourceMode, isMediaSurface, isTextSurface } from "./file-kind";

/**
 * The dispatch table the explorer tab uses.
 *
 * These cases are not a second copy of `getPreviewKind`'s own tests — they pin
 * the *explorer's* reading of that table, where `text` and the "unknown" answer
 * both land on Monaco. That mapping is what decides whether a tab goes through
 * `readFile` (2 MB text ceiling, binary refusal) or `readFileBytes`, so getting
 * it wrong shows up as a file that renders as "Binary — cannot preview".
 */
describe("fileSurfaceFor", () => {
  it("keeps plain text and code on the Monaco surface", () => {
    expect(fileSurfaceFor("src/app.ts")).toBe("code");
    expect(fileSurfaceFor("README.txt")).toBe("code");
    expect(fileSurfaceFor("service.log")).toBe("code");
    expect(fileSurfaceFor("Makefile")).toBe("code");
  });

  it("gives markdown its own surface, because it has a rendered face", () => {
    expect(fileSurfaceFor("docs/guide.md")).toBe("markdown");
    expect(fileSurfaceFor("docs/guide.markdown")).toBe("markdown");
  });

  it("recognises the media kinds, which never go through readFile", () => {
    expect(fileSurfaceFor("assets/logo.PNG")).toBe("image");
    expect(fileSurfaceFor("assets/icon.svg")).toBe("image");
    expect(fileSurfaceFor("docs/spec.pdf")).toBe("pdf");
    expect(fileSurfaceFor("clips/demo.mp4")).toBe("video");
    expect(fileSurfaceFor("clips/voice.m4a")).toBe("audio");
  });

  it("recognises the text-backed rendered kinds", () => {
    expect(fileSurfaceFor("exports/rows.csv")).toBe("table");
    expect(fileSurfaceFor("exports/rows.tsv")).toBe("table");
    expect(fileSurfaceFor("config/settings.json")).toBe("structured");
    expect(fileSurfaceFor("config/values.yaml")).toBe("structured");
    expect(fileSurfaceFor("build/index.html")).toBe("html");
  });

  it("falls back to Monaco for an extension nobody claims", () => {
    // `getPreviewKind` answers null here; the tab must still open, and Monaco
    // then reports the file as binary — the same behaviour as before this
    // dispatch existed.
    expect(fileSurfaceFor("build/artifact.bin")).toBe("code");
    expect(fileSurfaceFor("LICENSE")).toBe("code");
  });
});

describe("surface predicates", () => {
  it("splits media from text", () => {
    for (const surface of ["image", "pdf", "video", "audio"] as const) {
      expect(isMediaSurface(surface)).toBe(true);
      expect(isTextSurface(surface)).toBe(false);
    }
    for (const surface of ["code", "markdown", "table", "structured", "html"] as const) {
      expect(isTextSurface(surface)).toBe(true);
      expect(isMediaSurface(surface)).toBe(false);
    }
  });

  it("offers a source toggle only where the source is text", () => {
    expect(hasSourceMode("markdown")).toBe(true);
    expect(hasSourceMode("table")).toBe(true);
    expect(hasSourceMode("structured")).toBe(true);
    expect(hasSourceMode("html")).toBe(true);
    expect(hasSourceMode("code")).toBe(false);
    expect(hasSourceMode("image")).toBe(false);
    expect(hasSourceMode("pdf")).toBe(false);
    expect(hasSourceMode("video")).toBe(false);
    expect(hasSourceMode("audio")).toBe(false);
  });
});
