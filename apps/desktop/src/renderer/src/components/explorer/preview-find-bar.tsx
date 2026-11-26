import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "@multica/ui/icons";
import type { ExplorerStrings } from "./strings";

/**
 * Find bar for the markdown preview.
 *
 * Sits over the pane instead of pushing it down, so opening find does not reflow
 * the document being searched — the same reason VS Code's editor find widget
 * floats.
 */
export function PreviewFindBar({
  strings,
  query,
  onChange,
  total,
  index,
  onPrev,
  onNext,
  onClose,
}: {
  strings: ExplorerStrings;
  query: string;
  onChange: (value: string) => void;
  /** Match count; 0 with a non-empty query means "no results". */
  total: number;
  /** Zero-based index of the active match. */
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus and select on open so typing replaces a stale query, as in find bars
  // everywhere.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const empty = query.trim().length === 0;

  return (
    <div
      className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md border border-border bg-popover/95 px-1.5 py-1 shadow-md backdrop-blur"
      role="search"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={strings.findPlaceholder}
        aria-label={strings.findInPreview}
        spellCheck={false}
        className="w-36 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <span
        className={[
          "min-w-[42px] shrink-0 text-right text-[11px] tabular-nums",
          !empty && total === 0 ? "text-destructive" : "text-muted-foreground",
        ].join(" ")}
      >
        {empty ? "" : total === 0 ? strings.findNoResults : `${index + 1}/${total}`}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={total === 0}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label={strings.findPrev}
        title={strings.findPrev}
      >
        <ChevronUp className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={total === 0}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label={strings.findNext}
        title={strings.findNext}
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent"
        aria-label={strings.close}
        title={strings.close}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
