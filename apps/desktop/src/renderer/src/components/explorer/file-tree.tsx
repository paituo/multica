import {
  Fragment,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen } from "@multica/ui/icons";
import { statusColorClass, statusLetter, type FileStatusDecoration } from "./status-badge";
import type { ExplorerStrings } from "./strings";

type TreeNode = { name: string; path: string; dir: boolean; children: TreeNode[] };

const INDENT_PX = 12;

/**
 * Build a nested tree from the flat path list `git ls-files` returns. Paths use
 * POSIX separators on every platform, so splitting on `/` is correct on Windows
 * too.
 */
export function buildFileTree(files: readonly string[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  for (const file of files) {
    if (!file) continue;
    const parts = file.split("/");
    let bucket = roots;
    let current = "";

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      if (!name) continue;
      current = current ? `${current}/${name}` : name;
      const isLeaf = index === parts.length - 1;

      let node = byPath.get(current);
      if (!node) {
        node = { name, path: current, dir: !isLeaf, children: [] };
        byPath.set(current, node);
        bucket.push(node);
      }
      if (isLeaf) node.dir = false;
      bucket = node.children;
    }
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.dir !== right.dir) return left.dir ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const node of nodes) if (node.children.length > 0) sort(node.children);
  };
  sort(roots);
  return roots;
}

export function FileTree({
  files,
  selectedPath,
  filter,
  expanded,
  onToggle,
  decorations,
  onOpen,
  strings,
}: {
  files: readonly string[];
  selectedPath: string | null;
  /** Space-separated terms; every term must appear in the path. */
  filter: string;
  /**
   * Expanded directories. Controlled by the caller so the panel's
   * collapse-all / expand-all buttons work on a tree that also keeps its own
   * per-directory state across refreshes.
   */
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  /** Git status per path; changed files get a coloured letter, as in VS Code. */
  decorations?: ReadonlyMap<string, FileStatusDecoration>;
  onOpen: (path: string) => void;
  strings: ExplorerStrings;
}) {
  const filtered = useMemo(() => filterFilePaths(files, filter), [files, filter]);
  const tree = useMemo(() => buildFileTree(filtered), [filtered]);

  // Directories that contain a change, so a collapsed folder still hints at
  // where the work is (VS Code tints the folder name instead of adding a letter).
  const changedDirs = useMemo(() => parentDirectories(decorations?.keys() ?? []), [decorations]);

  /**
   * Arrow-key navigation over the rendered rows.
   *
   * The row order is read out of the DOM rather than from a flattened copy of
   * the tree: the recursive renderer already emits exactly the visible rows in
   * display order, so `querySelectorAll` *is* the ordering and the tree keeps
   * its shape. The alternative — flattening in the model — would have to be
   * kept in sync with `forceOpen` and the per-directory collapse set.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const rows = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>("button[data-tree-row]"),
      );
      if (rows.length === 0) return;

      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const index = focused ? rows.indexOf(focused) : -1;

      const focusRow = (target: number) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, target))];
        row?.focus();
        // Optional call: jsdom (which the component tests run in) does not
        // implement `scrollIntoView`, and a missing scroll is not worth an
        // exception in a test that is only checking focus.
        row?.scrollIntoView?.({ block: "nearest" });
      };

      const focusedRow = index >= 0 ? rows[index] : undefined;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(index < 0 ? 0 : index + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          focusRow(index < 0 ? rows.length - 1 : index - 1);
          return;
        case "Home":
          event.preventDefault();
          focusRow(0);
          return;
        case "End":
          event.preventDefault();
          focusRow(rows.length - 1);
          return;
        case "ArrowRight": {
          if (!focusedRow || focusedRow.dataset.dir !== "1") return;
          event.preventDefault();
          // Collapsed opens; already open steps into the first child.
          if (focusedRow.dataset.open === "1") focusRow(index + 1);
          else onToggle(focusedRow.dataset.path ?? "");
          return;
        }
        case "ArrowLeft": {
          if (!focusedRow) return;
          event.preventDefault();
          if (focusedRow.dataset.dir === "1" && focusedRow.dataset.open === "1") {
            onToggle(focusedRow.dataset.path ?? "");
            return;
          }
          // Otherwise go to the enclosing directory: the nearest preceding row
          // with a smaller indent.
          const depth = Number(focusedRow.dataset.depth ?? "0");
          for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            const candidate = rows[cursor];
            if (candidate && Number(candidate.dataset.depth ?? "0") < depth) {
              focusRow(cursor);
              return;
            }
          }
          return;
        }
        default:
          return;
      }
    },
    [onToggle],
  );

  if (tree.length === 0) {
    return (
      <p className="px-3 py-4 text-body text-muted-foreground">
        {filter.trim() ? strings.filterNoMatch : strings.emptyTree}
      </p>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-auto py-1"
      onKeyDown={onKeyDown}
      // The tree is one tab stop, then the arrow keys walk the rows — VS Code's
      // behaviour, and the only workable one here: a 5 000-file repo would
      // otherwise put 5 000 tab stops between the filter box and the viewer.
      tabIndex={0}
      role="group"
      aria-label={strings.files}
    >
      <TreeRows
        nodes={tree}
        depth={0}
        expanded={expanded}
        // A filtered tree only contains matching branches, so leaving them
        // collapsed would hide the very rows the reader asked for.
        forceOpen={filter.trim().length > 0}
        selectedPath={selectedPath}
        decorations={decorations}
        changedDirs={changedDirs}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    </div>
  );
}

/**
 * Every directory implied by a list of POSIX paths — `src/a/b.ts` yields `src`
 * and `src/a`.
 *
 * Used twice: "expand all" needs exactly the ids the tree builds for its
 * directories, and the changed-directory tint needs the ancestors of every
 * decorated file. Both would otherwise re-implement the prefix walk.
 */
export function parentDirectories(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    let current = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      dirs.add(current);
    }
  }
  return dirs;
}

/**
 * Paths matching a filter, as a browser-style "every word must appear"
 * search rather than a glob: `src go` finds `apps/go/src/main.go`.
 *
 * Filtering the flat list (instead of pruning the built tree) keeps the tree
 * builder untouched and means a match inside a directory brings its siblings'
 * ancestors along for free, since the path is still whole.
 */
export function filterFilePaths(files: readonly string[], filter: string): readonly string[] {
  const terms = filter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return files;
  return files.filter((file) => {
    const lower = file.toLowerCase();
    return terms.every((term) => lower.includes(term));
  });
}

function TreeRows({
  nodes,
  depth,
  expanded,
  forceOpen,
  selectedPath,
  decorations,
  changedDirs,
  onToggle,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  /** Filtered trees are expanded wholesale — see the caller. */
  forceOpen: boolean;
  selectedPath: string | null;
  decorations?: ReadonlyMap<string, FileStatusDecoration>;
  changedDirs: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = forceOpen || expanded.has(node.path);
        const isSelected = selectedPath === node.path;
        const decoration = node.dir ? undefined : decorations?.get(node.path);
        const letter = decoration ? statusLetter(decoration.status, decoration.untracked) : null;
        return (
          <Fragment key={node.path}>
            <button
              type="button"
              onClick={() => (node.dir ? onToggle(node.path) : onOpen(node.path))}
              // Roving tabindex: the tree container is the single tab stop, the
              // arrow keys move between rows (see `onKeyDown`). A row stays
              // focusable — `tabIndex={-1}` only removes it from tab order.
              tabIndex={-1}
              aria-expanded={node.dir ? isOpen : undefined}
              data-tree-row="true"
              data-path={node.path}
              data-depth={depth}
              data-dir={node.dir ? "1" : "0"}
              data-open={node.dir ? (isOpen ? "1" : "0") : undefined}
              className={[
                "flex w-full items-center gap-1 rounded-sm py-[3px] pr-2 text-left text-[12px] leading-5 outline-none",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/90 hover:bg-accent/60 focus-visible:bg-accent/60",
              ].join(" ")}
              style={{ paddingLeft: depth * INDENT_PX + 6 }}
              title={node.path}
            >
              {node.dir ? (
                isOpen ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden="true" />
              )}
              {node.dir ? (
                <FolderOpen
                  className={[
                    "size-3.5 shrink-0",
                    changedDirs.has(node.path) ? "text-foreground/70" : "text-muted-foreground",
                  ].join(" ")}
                  aria-hidden="true"
                />
              ) : (
                <FileText
                  className={["size-3.5 shrink-0", statusColorClass(decoration?.status, decoration?.untracked)].join(" ")}
                  aria-hidden="true"
                />
              )}
              <span
                className={[
                  "min-w-0 flex-1 truncate",
                  letter ? statusColorClass(decoration?.status, decoration?.untracked) : "",
                ].join(" ")}
              >
                {node.name}
              </span>
              {letter && (
                <span
                  className={[
                    "shrink-0 text-[10px] font-medium tabular-nums",
                    statusColorClass(decoration?.status, decoration?.untracked),
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {letter}
                </span>
              )}
            </button>
            {node.dir && isOpen && node.children.length > 0 && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                forceOpen={forceOpen}
                selectedPath={selectedPath}
                decorations={decorations}
                changedDirs={changedDirs}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}
