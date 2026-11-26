import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen } from "@multica/ui/icons";
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
  onOpen,
  strings,
}: {
  files: readonly string[];
  selectedPath: string | null;
  onOpen: (path: string) => void;
  strings: ExplorerStrings;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  // Collapsed by default: a 5,000-entry repo would otherwise mount 5,000 rows.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (tree.length === 0) {
    return (
      <p className="px-3 py-4 text-body text-muted-foreground">{strings.emptyTree}</p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <TreeRows
        nodes={tree}
        depth={0}
        expanded={expanded}
        selectedPath={selectedPath}
        onToggle={toggle}
        onOpen={onOpen}
      />
    </div>
  );
}

function TreeRows({
  nodes,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        const isSelected = selectedPath === node.path;
        return (
          <Fragment key={node.path}>
            <button
              type="button"
              onClick={() => (node.dir ? onToggle(node.path) : onOpen(node.path))}
              className={[
                "flex w-full items-center gap-1 rounded-sm py-[3px] pr-2 text-left text-[12px] leading-5",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/90 hover:bg-accent/60",
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
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
            {node.dir && isOpen && node.children.length > 0 && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selectedPath={selectedPath}
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
