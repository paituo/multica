import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, List, ListTree } from "@multica/ui/icons";
import type {
  ExplorerChangeSet,
  ExplorerFileEntry,
  ExplorerTarget,
} from "../../../../shared/explorer-api";
import { useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import { FilterInput } from "./filter-input";
import { statusBadgeClass, statusLetter } from "./status-badge";
import type { ExplorerStrings } from "./strings";

type ListState =
  | { status: "loading" }
  | { status: "ready"; changes: ExplorerChangeSet }
  | { status: "error"; message: string };

const INDENT_PX = 12;

// --- tree model -----------------------------------------------------------

export type ChangeTreeNode = {
  name: string;
  path: string;
  dir: boolean;
  /** Present on leaf nodes only. */
  entry: ExplorerFileEntry | null;
  children: ChangeTreeNode[];
  /** Aggregated over the subtree, so a folder can show `+12 −3`. */
  additions: number;
  deletions: number;
  files: number;
};

/**
 * Builds the directory tree the change list uses in tree mode.
 *
 * Same shape as `buildFileTree` in file-tree.tsx, but the nodes carry their
 * entry and roll the +/- counts up to the folder, which is what makes tree mode
 * worth having on a 40-file change set: the collapsed folder already tells you
 * where the work happened.
 */
export function buildChangeTree(entries: readonly ExplorerFileEntry[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = [];
  const byPath = new Map<string, ChangeTreeNode>();

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let bucket = roots;
    let current = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      current = current ? `${current}/${name}` : name;
      const isLeaf = index === parts.length - 1;

      let node = byPath.get(current);
      if (!node) {
        node = {
          name,
          path: current,
          dir: !isLeaf,
          entry: null,
          children: [],
          additions: 0,
          deletions: 0,
          files: 0,
        };
        byPath.set(current, node);
        bucket.push(node);
      }
      if (isLeaf) {
        node.dir = false;
        node.entry = entry;
      }
      bucket = node.children;
    }
  }

  const aggregate = (nodes: ChangeTreeNode[]): void => {
    for (const node of nodes) {
      if (node.dir) {
        aggregate(node.children);
        node.additions = node.children.reduce((sum, child) => sum + child.additions, 0);
        node.deletions = node.children.reduce((sum, child) => sum + child.deletions, 0);
        node.files = node.children.reduce((sum, child) => sum + child.files, 0);
      } else {
        node.additions = node.entry?.additions ?? 0;
        node.deletions = node.entry?.deletions ?? 0;
        node.files = 1;
      }
    }
  };

  const sort = (nodes: ChangeTreeNode[]): void => {
    nodes.sort((left, right) => {
      if (left.dir !== right.dir) return left.dir ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const node of nodes) if (node.children.length > 0) sort(node.children);
  };

  aggregate(roots);
  sort(roots);
  return roots;
}

// --- staged / unstaged split ----------------------------------------------

export type ChangeGroupId = "staged" | "unstaged";

export type ChangeGroup = { id: ChangeGroupId; entries: ExplorerFileEntry[] };

/** X column: something is staged (as opposed to blank, or `?` for untracked). */
function inIndex(column: string | null | undefined): boolean {
  return column != null && column !== "" && column !== " " && column !== "?";
}

/** Y column: something changed in the worktree (`?` is an untracked file). */
function inWorktree(column: string | null | undefined): boolean {
  return column == null || (column !== "" && column !== " ");
}

/**
 * Splits the change set into VS Code's two groups.
 *
 * A file edited on both sides of the index (`MM`) deliberately lands in both:
 * that is exactly what the reader sees in VS Code, and collapsing it into one
 * group would hide either the staged or the unstaged half of the work.
 *
 * Entries without porcelain columns (a branch diff, a commit's file list) have
 * no index to be staged in, so they all fall into the single "Changes" group.
 */
export function splitChangeGroups(entries: readonly ExplorerFileEntry[]): ChangeGroup[] {
  const staged: ExplorerFileEntry[] = [];
  const unstaged: ExplorerFileEntry[] = [];
  for (const entry of entries) {
    if (inIndex(entry.indexStatus)) staged.push(entry);
    if (inWorktree(entry.worktreeStatus)) unstaged.push(entry);
  }
  const groups: ChangeGroup[] = [];
  if (staged.length > 0) groups.push({ id: "staged", entries: staged });
  if (unstaged.length > 0) groups.push({ id: "unstaged", entries: unstaged });
  return groups;
}

// --- rows -----------------------------------------------------------------

/**
 * Keeps the *end* of a directory path and elides the beginning.
 *
 * The row layout puts the file name first and the directory after it, because
 * the name is what the reader is looking for. `truncate` on the directory then
 * cuts from the right — the end that distinguishes one row from the next — so
 * every row in `apps/desktop/src/...` read identically: measured in the
 * harness, twelve rows all showed `apps/desktop/src/...` with nothing to tell
 * them apart.
 *
 * VS Code's description field elides the same way (from the left). Segments are
 * dropped from the front until the remainder fits `maxLength`, because a fixed
 * segment count still overflowed the 320 px sidebar and got truncated a second
 * time (`…/components/expl…`), which loses the tail this function exists to
 * keep. The budget is 14 characters of path — `…/src/main/` and
 * `…/explorer/` both fit the measurement above, `desktop/src/main` does not.
 */
export function shortenDirectory(directory: string, maxLength = 14): string {
  if (!directory) return "";
  const trailingSlash = directory.endsWith("/");
  const parts = directory.split("/").filter(Boolean);
  if (parts.length === 0) return directory;
  if (parts.join("/").length <= maxLength) return directory;

  const kept: string[] = [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part === undefined) continue;
    // Always keep at least one segment, even if that one alone is too long —
    // an empty description would be worse than a clipped one.
    if (kept.length > 0 && [part, ...kept].join("/").length > maxLength) break;
    kept.unshift(part);
  }
  return `…/${kept.join("/")}${trailingSlash ? "/" : ""}`;
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="shrink-0 tabular-nums text-[11px]">
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && <span className="text-red-600 dark:text-red-400">−{deletions}</span>}
    </span>
  );
}

function FileRow({
  entry,
  depth,
  showDirectory,
  selected,
  onOpen,
  strings,
}: {
  entry: ExplorerFileEntry;
  depth: number;
  showDirectory: boolean;
  /** True when this file's diff is the tab on screen. */
  selected: boolean;
  onOpen: () => void;
  strings: ExplorerStrings;
}) {
  const slash = entry.path.lastIndexOf("/");
  const directory = showDirectory && slash >= 0 ? shortenDirectory(entry.path.slice(0, slash + 1)) : "";
  const name = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
  // `U` for untracked, as in VS Code; the word lives in the accessible name so
  // a 10 px badge never has to fit three Chinese characters.
  const letter = statusLetter(entry.status, entry.untracked) ?? "?";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={[
        "flex w-full items-center gap-2 rounded-sm py-[3px] pr-2 text-left text-[12px] leading-5",
        // VS Code keeps the open file's row highlighted in the change list, so
        // the reader can see which row the diff on the right belongs to.
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      ].join(" ")}
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      // The tooltip carries the word the badge abbreviates to one letter.
      title={entry.untracked ? `${entry.path} · ${strings.untracked}` : entry.path}
    >
      <span
        className={`shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tabular-nums ${statusBadgeClass(entry.status, entry.untracked)}`}
      >
        {letter}
      </span>
      {/*
       * Name first, directory second. The old order put the directory in front,
       * so truncation cut the file name — the one part of the row worth reading.
       */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-foreground/90">{name}</span>
        {directory && (
          <span className="max-w-[60%] shrink-0 truncate text-[11px] text-muted-foreground" aria-hidden="true">
            {directory}
          </span>
        )}
      </span>
      <DiffStat additions={entry.additions ?? 0} deletions={entry.deletions ?? 0} />
    </button>
  );
}

function DirectoryRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: ChangeTreeNode;
  depth: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded-sm py-[3px] pr-2 text-left text-[12px] leading-5 text-foreground/90 hover:bg-accent/60"
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      title={node.path}
    >
      {open ? (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {!open && <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{node.files}</span>}
      <DiffStat additions={node.additions} deletions={node.deletions} />
    </button>
  );
}

function TreeRows({
  nodes,
  depth,
  collapsed,
  selectedPath,
  onToggle,
  onOpenDiff,
  strings,
}: {
  nodes: ChangeTreeNode[];
  depth: number;
  collapsed: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onOpenDiff: (entry: ExplorerFileEntry) => void;
  strings: ExplorerStrings;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (!node.dir) {
          return node.entry ? (
            <FileRow
              key={node.path}
              entry={node.entry}
              depth={depth}
              showDirectory={false}
              selected={selectedPath === node.path}
              strings={strings}
              onOpen={() => node.entry && onOpenDiff(node.entry)}
            />
          ) : null;
        }
        const open = !collapsed.has(node.path);
        return (
          <div key={node.path}>
            <DirectoryRow node={node} depth={depth} open={open} onToggle={() => onToggle(node.path)} />
            {open && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onOpenDiff={onOpenDiff}
                strings={strings}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// --- container ------------------------------------------------------------

export function ChangeList({
  target,
  refreshToken,
  selectedPath = null,
  onOpenDiff,
  strings,
}: {
  target: ExplorerTarget;
  refreshToken: number;
  /** Path whose diff is the active tab; that row stays highlighted. */
  selectedPath?: string | null;
  onOpenDiff: (entry: ExplorerFileEntry, base: string | null) => void;
  strings: ExplorerStrings;
}) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const view = useExplorerViewPrefs((pref) => pref.changesView);
  const setChangesView = useExplorerViewPrefs((pref) => pref.setChangesView);
  const showUntracked = useExplorerViewPrefs((pref) => pref.showUntracked);
  const toggleShowUntracked = useExplorerViewPrefs((pref) => pref.toggleShowUntracked);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void window.desktopAPI.explorer.gitStatus(target).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          status: "error",
          message: result.reason === "no-git" ? strings.noGit : strings.loadFailed,
        });
        return;
      }
      setState({ status: "ready", changes: result });
    });

    return () => {
      cancelled = true;
    };
  }, [target, refreshToken, strings]);

  const allEntries = useMemo(
    () => (state.status === "ready" ? state.changes.entries : []),
    [state],
  );

  /**
   * The tree, the counters and the footer all read this list, so the two
   * filters have to be applied once, here — filtering in the row renderer
   * instead would leave the "N files" total counting hidden rows.
   */
  const entries = useMemo(() => {
    const terms = filter
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return allEntries.filter((entry) => {
      if (!showUntracked && entry.untracked) return false;
      if (terms.length === 0) return true;
      const lower = entry.path.toLowerCase();
      return terms.every((term) => lower.includes(term));
    });
  }, [allEntries, showUntracked, filter]);

  const groups = useMemo(() => splitChangeGroups(entries), [entries]);
  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => ({
          additions: acc.additions + (entry.additions ?? 0),
          deletions: acc.deletions + (entry.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [entries],
  );

  if (state.status === "loading") {
    return <p className="px-3 py-4 text-body text-muted-foreground">{strings.loading}</p>;
  }

  if (state.status === "error") {
    return <p className="px-3 py-4 text-body text-muted-foreground">{state.message}</p>;
  }

  // Two distinct empty states: nothing changed at all, versus everything being
  // filtered out. Showing "no uncommitted changes" while a filter is active
  // would read as if the working tree were clean.
  if (allEntries.length === 0) {
    return (
      <>
        <ChangeToolbar
          count={0}
          totals={{ additions: 0, deletions: 0 }}
          strings={strings}
          view={view}
          onViewChange={setChangesView}
          showUntracked={showUntracked}
          onToggleUntracked={toggleShowUntracked}
        />
        <p className="px-3 py-4 text-body text-muted-foreground">{strings.noChanges}</p>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChangeToolbar
        count={entries.length}
        totals={totals}
        strings={strings}
        view={view}
        onViewChange={setChangesView}
        showUntracked={showUntracked}
        onToggleUntracked={toggleShowUntracked}
      />
      <FilterInput
        value={filter}
        onChange={setFilter}
        label={strings.filterChanges}
        placeholder={strings.filterChangesPlaceholder}
        clearLabel={strings.clearFilter}
      />
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-body text-muted-foreground">{strings.filterNoMatch}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {groups.map((group) => (
            <ChangeGroupSection
              key={group.id}
              group={group}
              view={view}
              base={state.changes.base}
              selectedPath={selectedPath}
              onOpenDiff={onOpenDiff}
              strings={strings}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One collapsible group of the change list — VS Code's "Staged Changes" and
 * "Changes".
 *
 * Collapse state is per group rather than shared, because the same path can
 * appear in both (a file staged and then edited again) and collapsing one
 * folder must not collapse the other's.
 */
function ChangeGroupSection({
  group,
  view,
  base,
  selectedPath,
  onOpenDiff,
  strings,
}: {
  group: ChangeGroup;
  view: "list" | "tree";
  base: string | null;
  selectedPath: string | null;
  onOpenDiff: (entry: ExplorerFileEntry, base: string | null) => void;
  strings: ExplorerStrings;
}) {
  const [open, setOpen] = useState(true);
  // Tree mode defaults to fully expanded; `collapsed` only tracks exceptions so
  // a refresh does not collapse what the user just opened.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildChangeTree(group.entries), [group.entries]);

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-sm px-2 py-[3px] text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent/40"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {group.id === "staged" ? strings.stagedChanges : strings.changes}
        </span>
        <span className="shrink-0 tabular-nums normal-case tracking-normal text-muted-foreground/70">
          {group.entries.length}
        </span>
      </button>
      {open &&
        (view === "list" ? (
          group.entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              depth={0}
              showDirectory
              selected={selectedPath === entry.path}
              strings={strings}
              onOpen={() => onOpenDiff(entry, base)}
            />
          ))
        ) : (
          <TreeRows
            nodes={tree}
            depth={0}
            collapsed={collapsed}
            selectedPath={selectedPath}
            onToggle={toggle}
            onOpenDiff={(entry) => onOpenDiff(entry, base)}
            strings={strings}
          />
        ))}
    </section>
  );
}

/**
 * The counters row above the change list: file count and diffstat on the left,
 * the untracked toggle and the list/tree switch on the right.
 *
 * Kept as its own component because the empty state needs it too — a reader
 * with untracked files hidden must still be able to find the switch that
 * brought them there.
 */
function ChangeToolbar({
  count,
  totals,
  strings,
  view,
  onViewChange,
  showUntracked,
  onToggleUntracked,
}: {
  count: number;
  totals: { additions: number; deletions: number };
  strings: ExplorerStrings;
  view: "list" | "tree";
  onViewChange: (view: "list" | "tree") => void;
  showUntracked: boolean;
  onToggleUntracked: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1 text-[11px] text-muted-foreground">
      <span className="tabular-nums">
        {count} {strings.filesChanged}
      </span>
      <DiffStat additions={totals.additions} deletions={totals.deletions} />
      <div className="ml-auto flex items-center gap-0.5">
        {/* VS Code hides this in the view's "…" menu; it is a first-class
            control here because untracked build output is what makes a change
            set unreadable. */}
        <button
          type="button"
          onClick={onToggleUntracked}
          aria-pressed={showUntracked}
          aria-label={strings.showUntracked}
          title={strings.showUntracked}
          className={[
            "rounded p-1 transition-colors",
            showUntracked
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {showUntracked ? (
            <Eye className="size-3" aria-hidden="true" />
          ) : (
            <EyeOff className="size-3" aria-hidden="true" />
          )}
        </button>
        <div className="flex items-center rounded-md bg-muted/50 p-0.5">
          <ViewModeButton
            active={view === "list"}
            label={strings.viewAsList}
            onClick={() => onViewChange("list")}
          >
            <List className="size-3" aria-hidden="true" />
          </ViewModeButton>
          <ViewModeButton
            active={view === "tree"}
            label={strings.viewAsTree}
            onClick={() => onViewChange("tree")}
          >
            <ListTree className="size-3" aria-hidden="true" />
          </ViewModeButton>
        </div>
      </div>
    </div>
  );
}

function ViewModeButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={[
        "rounded p-1 transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
