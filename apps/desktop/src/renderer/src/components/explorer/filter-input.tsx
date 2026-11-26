import { Filter, X } from "@multica/ui/icons";

/**
 * The one-line filter box the file and change lists share.
 *
 * Deliberately not a search field with a submit button: both lists filter as
 * you type, so the count has to be live and the only affordances are "clear"
 * and "escape".
 */
export function FilterInput({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name — the placeholder alone is not one. */
  label: string;
  placeholder: string;
  clearLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative flex items-center px-2 pb-1">
      <Filter
        className="pointer-events-none absolute left-3.5 size-3 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        className="h-6 w-full rounded-md border border-border/70 bg-background pl-6 pr-6 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
          aria-label={clearLabel}
          title={clearLabel}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
