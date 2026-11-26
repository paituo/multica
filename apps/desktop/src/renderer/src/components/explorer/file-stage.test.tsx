import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_STRINGS } from "./strings";
import { FileStage, formatBytes } from "./file-stage";

/**
 * `FileStage` is where the explorer stops being a text viewer.
 *
 * The two things worth pinning here are the ones that cost a bug when they
 * break: which element each kind lands on (so a PDF never ends up in an `<img>`,
 * which fails silently as a broken image), and that the Blob URL is revoked —
 * an object URL keeps its whole file alive, and a browsing session would
 * accumulate them.
 *
 * The table and tree renderers themselves are stubbed: they are the attachment
 * viewer's own components, covered by its tests, and pulling them in would drag
 * i18next and tanstack-table into a test about dispatch.
 */
vi.mock("@multica/views/editor", () => ({
  TablePreview: ({ text, delimiter }: { text: string; delimiter: string }) => (
    <div data-testid="table" data-delimiter={delimiter}>
      {text}
    </div>
  ),
  StructuredTree: ({ value }: { value: unknown }) => (
    <div data-testid="tree">{JSON.stringify(value)}</div>
  ),
  parseStructured: (text: string) => {
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : "bad" };
    }
  },
  structuredFormat: () => "json",
  tableDelimiter: (_contentType: string, path: string) => (path.endsWith(".tsv") ? "\t" : ","),
  getPreviewKind: () => null,
}));

const strings = EXPLORER_STRINGS.en;
const target = "worktree" as const;

const readFileBytes = vi.fn();
const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
const revokeObjectURL = vi.fn((_url: string) => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  readFileBytes.mockResolvedValue({
    ok: true,
    file: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", size: 3 },
  });
  vi.stubGlobal("desktopAPI", { explorer: { readFileBytes } });
  // jsdom has no object-URL implementation; the assertions are about the calls.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("media surfaces", () => {
  it("shows an image through an object URL built from the bytes", async () => {
    render(
      <FileStage target={target} path="assets/logo.png" surface="image" text={null} strings={strings} />,
    );

    const image = await screen.findByRole("img", { name: "assets/logo.png" });
    expect(image).toHaveAttribute("src", "blob:mock-url");
    expect(readFileBytes).toHaveBeenCalledWith(target, "assets/logo.png");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // The Blob carries the MIME the main process derived from the extension, so
    // the browser picks the decoder instead of guessing.
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("image/png");
  });

  it("puts a PDF in an iframe rather than an image element", async () => {
    readFileBytes.mockResolvedValue({
      ok: true,
      file: { bytes: new Uint8Array([1]), mimeType: "application/pdf", size: 9_400_000 },
    });
    render(
      <FileStage target={target} path="docs/spec.pdf" surface="pdf" text={null} strings={strings} />,
    );

    const frame = await screen.findByTitle("docs/spec.pdf");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("data-file-host", "pdf");
    // The caption tells the reader what they are looking at when PDFium shows a
    // blank page — a failure mode of the plugin, not of the file.
    expect(screen.getByText("9.0 MB")).toBeTruthy();
  });

  it("uses the native players for video and audio", async () => {
    const { unmount } = render(
      <FileStage target={target} path="clips/demo.mp4" surface="video" text={null} strings={strings} />,
    );
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    unmount();

    render(
      <FileStage target={target} path="clips/voice.mp3" surface="audio" text={null} strings={strings} />,
    );
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
  });

  it("reports a file beyond the IPC ceiling instead of showing a broken element", async () => {
    readFileBytes.mockResolvedValue({ ok: false, reason: "too-large" });
    render(
      <FileStage target={target} path="clips/raw.mkv" surface="video" text={null} strings={strings} />,
    );
    expect(await screen.findByText(strings.mediaTooLarge)).toBeTruthy();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("releases the object URL when the tab goes away", async () => {
    const { unmount } = render(
      <FileStage target={target} path="assets/logo.png" surface="image" text={null} strings={strings} />,
    );
    await screen.findByRole("img", { name: "assets/logo.png" });
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("text-backed surfaces", () => {
  it("hands a CSV to the shared table renderer with the delimiter its extension implies", () => {
    render(
      <FileStage target={target} path="exports/rows.tsv" surface="table" text={"a\tb\n1\t2"} strings={strings} />,
    );
    const table = screen.getByTestId("table");
    expect(table).toHaveAttribute("data-delimiter", "\t");
    expect(table.textContent).toContain("a\tb");
  });

  it("parses JSON into the shared tree", () => {
    render(
      <FileStage target={target} path="config/settings.json" surface="structured" text={'{"a":1}'} strings={strings} />,
    );
    expect(screen.getByTestId("tree").textContent).toBe('{"a":1}');
  });

  it("shows the parser's own message and the body when a structured file does not parse", () => {
    render(
      <FileStage target={target} path="config/settings.json" surface="structured" text={"{oops"} strings={strings} />,
    );
    expect(screen.queryByTestId("tree")).toBeNull();
    // The body stays on screen: the reader needs to see what the parser choked
    // on without switching to the source view.
    expect(screen.getByText("{oops")).toBeTruthy();
  });

  it("renders HTML in a sandboxed iframe with scripts but no same-origin", () => {
    render(
      <FileStage target={target} path="build/index.html" surface="html" text={"<p>hi</p>"} strings={strings} />,
    );
    const frame = screen.getByTitle("build/index.html");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toBe("<p>hi</p>");
  });

  it("waits rather than reading bytes for a text-backed surface", () => {
    render(<FileStage target={target} path="exports/rows.csv" surface="table" text={null} strings={strings} />);
    expect(screen.getByText(strings.loading)).toBeTruthy();
    expect(readFileBytes).not.toHaveBeenCalled();
  });
});

describe("formatBytes", () => {
  it("keeps bytes whole and rounds the larger units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(9_400_000)).toBe("9.0 MB");
    expect(formatBytes(64 * 1024 * 1024)).toBe("64 MB");
  });
});
