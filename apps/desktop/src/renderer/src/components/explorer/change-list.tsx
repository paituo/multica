import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, List, ListTree } from "@multica/ui/icons";
import type {
  ExplorerChangeSet,
  ExplorerFileEntry,
  ExplorerTarget,
} from "../../../../shared/explorer-api";
import { useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import type { ExplorerStrings } from "./strings";

type ListState =
  | { status: "loading" }
  | { status: "ready"; changes: ExplorerChangeSet }
  | { status: "error"; message: string };

const INDENT_PX = 12;

function statusBadgeClass(status: string | null): string {
  if (!status) return "text-muted-foreground";
  const first = status.slice(0, 1).toUpperCase();
  switch (first) {
    case "A":
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

function statusLabel(entry: ExplorerFileEntry, strings: ExplorerStrings): string {
  if (entry.untracked) return strings.untracked;
  return entry.status ?? "?";
}

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

// --- rows -----------------------------------------------------------------

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
  onOpen,
  strings,
}: {
  entry: ExplorerFileEntry;
  depth: number;
  showDirectory: boolean;
  onOpen: () => void;
  strings: ExplorerStrings;
}) {
  const slash = entry.path.lastIndexOf("/");
  const directory = showDirectory && slash >= 0 ? entry.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-sm py-[3px] pr-2 text-left text-[12px] leading-5 hover:bg-accent/60"
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      title={entry.path}
    >
      <span
        className={`shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tabular-nums ${statusBadgeClass(entry.status)}`}
      >
        {statusLabel(entry, strings)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{directory}</span>
        <span className="text-foreground/90">{name}</span>
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
  onToggle,
  onOpenDiff,
  strings,
}: {
  nodes: ChangeTreeNode[];
  depth: number;
  collapsed: Set<string>;
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
  onOpenDiff,
  strings,
}: {
  target: ExplorerTarget;
  refreshToken: number;
  onOpenDiff: (entry: ExplorerFileEntry, base: string | null) => void;
  strings: ExplorerStrings;
}) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const view = useExplorerViewPrefs((pref) => pref.changesView);
  const setChangesView = useExplorerViewPrefs((pref) => pref.setChangesView);
  // Tree mode defaults to fully expanded; `collapsed` only tracks exceptions so
  // a refresh does not collapse what the user just opened.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

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

  const entries = useMemo(
    () => (state.status === "ready" ? state.changes.entries : []),
    [state],
  );
  const tree = useMemo(() => buildChangeTree(entries), [entries]);
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

  if (entries.length === 0) {
    return <p className="px-3 py-4 text-body text-muted-foreground">{strings.noChanges}</p>;
  }

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-2 pb-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {entries.length} {strings.filesChanged}
        </span>
        <DiffStat additions={totals.additions} deletions={totals.deletions} />
        {/* VS Code exposes the same switch as "View as List / Tree" in the SCM
            view's more-actions menu; here it is a one-click segmented control
            because the list is the panel's primary surface. */}
        <div className="ml-auto flex items-center rounded-md bg-muted/50 p-0.5">
          <ViewModeButton
            active={view === "list"}
            label={strings.viewAsList}
            onClick={() => setChangesView("list")}
          >
            <List className="size-3" aria-hidden="true" />
          </ViewModeButton>
          <ViewModeButton
            active={view === "tree"}
            label={strings.viewAsTree}
            onClick={() => setChangesView("tree")}
          >
            <ListTree className="size-3" aria-hidden="true" />
          </ViewModeButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {view === "list" ? (
          entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              depth={0}
              showDirectory
              strings={strings}
              onOpen={() => onOpenDiff(entry, state.changes.base)}
            />
          ))
        ) : (
          <TreeRows
            nodes={tree}
            depth={0}
            collapsed={collapsed}
            onToggle={toggle}
            onOpenDiff={(entry) => onOpenDiff(entry, state.changes.base)}
            strings={strings}
          />
        )}
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
