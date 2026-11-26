import { useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerTarget } from "../../../../shared/explorer-api";
import {
  StructuredTree,
  TablePreview,
  parseStructured,
  structuredFormat,
  tableDelimiter,
} from "@multica/views/editor";
import type { ExplorerFileSurface } from "./file-kind";
import type { ExplorerStrings } from "./strings";

/**
 * The rendered side of a file tab: everything that is not Monaco.
 *
 * Two families live here and they load differently:
 *
 * - **Media** (image / PDF / video / audio) comes back as bytes over IPC and is
 *   handed to a Blob URL. The bytes travel through the main process rather than
 *   a `file://` URL so the containment rule stays intact — a tab can only reach
 *   files under the root the window was opened on.
 * - **Text-backed** (table / structured / HTML) is already in memory: the tab
 *   read it through `readFile` and this module only decides how to present it.
 *
 * Both reuse the components the attachment viewer uses, so a `.csv` or `.json`
 * looks the same wherever it is opened.
 */
export function FileStage({
  target,
  path,
  surface,
  text,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  surface: ExplorerFileSurface;
  /** UTF-8 body for the text-backed surfaces; null while the read is in flight. */
  text: string | null;
  strings: ExplorerStrings;
}) {
  if (surface === "image" || surface === "pdf" || surface === "video" || surface === "audio") {
    return <MediaStage target={target} path={path} surface={surface} strings={strings} />;
  }
  if (text === null) {
    return <StageNote>{strings.loading}</StageNote>;
  }
  if (surface === "table") {
    return (
      <div className="h-full min-h-0 overflow-auto" data-file-host="table">
        <TablePreview text={text} delimiter={tableDelimiter("", path)} />
      </div>
    );
  }
  if (surface === "structured") {
    return <StructuredStage path={path} text={text} />;
  }
  if (surface === "html") {
    return (
      // Same posture as the attachment viewer: scripts run, but the document
      // gets an opaque origin — no same-origin, no navigation, no popups.
      <iframe
        srcDoc={text}
        sandbox="allow-scripts"
        title={path}
        className="h-full w-full border-0 bg-white"
        data-file-host="html"
      />
    );
  }
  return null;
}

/**
 * JSON / JSON Lines / YAML as a collapsible tree.
 *
 * A parse failure is not an error page: the format is guessed from the
 * extension, and a `.json` holding comments (or a `.yaml` with a tab
 * indentation) is ordinary. The parser's own message names the line, and the
 * body is shown verbatim underneath so the reader can see what it choked on
 * without switching to the source view.
 */
function StructuredStage({ path, text }: { path: string; text: string }) {
  const parsed = useMemo(() => {
    const format = structuredFormat("", path);
    return format ? parseStructured(text, format) : null;
  }, [path, text]);

  if (parsed === null) return <StageNote>—</StageNote>;
  if (parsed.ok) {
    return (
      <div className="h-full min-h-0 overflow-auto p-3" data-file-host="structured">
        <StructuredTree value={parsed.value} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3" data-file-host="structured">
      <p className="text-body text-muted-foreground">{parsed.message}</p>
      <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-label leading-6">
        {text}
      </pre>
    </div>
  );
}

type MediaState =
  | { status: "loading" }
  | { status: "ready"; url: string; size: number }
  | { status: "error"; message: string };

/**
 * One image, PDF, audio or video file, loaded as bytes.
 *
 * The object URL is created once per read and revoked on unmount: a `Blob` held
 * by a URL keeps its whole buffer alive for the lifetime of the document, and
 * browsing twenty screenshots in one window would otherwise pin twenty files.
 */
function MediaStage({
  target,
  path,
  surface,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  surface: ExplorerFileSurface;
  strings: ExplorerStrings;
}) {
  const [state, setState] = useState<MediaState>({ status: "loading" });
  const revokeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const release = () => {
      if (revokeRef.current) {
        URL.revokeObjectURL(revokeRef.current);
        revokeRef.current = null;
      }
    };

    setState({ status: "loading" });
    void window.desktopAPI.explorer.readFileBytes(target, path).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          status: "error",
          message:
            result.reason === "too-large"
              ? strings.mediaTooLarge
              : result.reason === "outside-root"
                ? strings.outsideRoot
                : strings.loadFailed,
        });
        return;
      }
      release();
      // Copied into a fresh `ArrayBuffer` rather than handed over as a view:
      // `Uint8Array<ArrayBufferLike>` is not a `BlobPart` (the DOM types reject a
      // possibly-shared buffer), and the copy is cheap next to the IPC transfer
      // that just happened.
      const copy = new Uint8Array(result.file.bytes.byteLength);
      copy.set(result.file.bytes);
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: result.file.mimeType }));
      revokeRef.current = url;
      setState({ status: "ready", url, size: result.file.size });
    });

    return () => {
      cancelled = true;
      release();
    };
  }, [target, path, strings]);

  if (state.status === "loading") return <StageNote>{strings.loading}</StageNote>;
  if (state.status === "error") return <StageNote>{state.message}</StageNote>;

  const caption = (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-[11px] text-muted-foreground">
      <span className="truncate">{path}</span>
      <span className="ml-auto tabular-nums">{formatBytes(state.size)}</span>
    </div>
  );

  if (surface === "image") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {caption}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
          <img
            src={state.url}
            alt={path}
            className="max-h-full max-w-full object-contain"
            data-file-host="image"
          />
        </div>
      </div>
    );
  }

  if (surface === "pdf") {
    // Chromium's PDFium plugin renders this. It is enabled for every renderer
    // window (`plugins: true` in `createRendererWebPreferences`), which is what
    // makes `<iframe>` viable here instead of shipping a PDF library.
    return (
      <div className="flex h-full min-h-0 flex-col">
        {caption}
        <iframe
          src={state.url}
          title={path}
          className="min-h-0 flex-1 border-0 bg-background"
          data-file-host="pdf"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {caption}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {surface === "video" ? (
          <video src={state.url} controls className="max-h-full max-w-full" data-file-host="video" />
        ) : (
          <audio src={state.url} controls className="w-full max-w-lg" data-file-host="audio" />
        )}
      </div>
    </div>
  );
}

function StageNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-body text-muted-foreground">
      {children}
    </div>
  );
}

/** Human-readable size for the media caption. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
