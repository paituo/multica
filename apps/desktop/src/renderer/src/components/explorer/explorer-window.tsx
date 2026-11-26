import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  FileText,
  GitBranch,
  ListEnd,
  ListX,
  RefreshCw,
  X,
} from "@multica/ui/icons";
import { useAuthStore } from "@multica/core/auth";
import { Button } from "@multica/ui/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import type {
  ExplorerFileEntry,
  ExplorerFilePair,
  ExplorerRootInfo,
  ExplorerTarget,
} from "../../../../shared/explorer-api";
import type { ExplorerWindowContext } from "../../../../shared/explorer-window";
import {
  TASK_TAB_ID,
  explorerTabId,
  loadExplorerTabs,
  saveExplorerTabs,
  useExplorerTabs,
  type ExplorerTab,
} from "@/stores/explorer-tabs";
import { ChangeList } from "./change-list";
import { DiffView } from "./diff-view";
import { FileTree } from "./file-tree";
import { FileViewer } from "./file-viewer";
import { useExplorerStrings, type ExplorerStrings } from "./strings";
import { IssueWindow } from "../issue-window";
import { TRAFFIC_LIGHT_CLEARANCE } from "../window-toolbar";

/**
 * The task explorer window.
 *
 * Layout mirrors the main window's shell structurally (56px rail, 40px drag/tab
 * bar, inset rounded canvas) without reusing `DesktopShell` — that component is
 * welded to `tab-store`'s workspace groups, the app rail, global shortcuts and
 * the search command, none of which belong in a single-task workbench.
 */

type PanelMode = "files" | "changes";

/**
 * Id of the content region the tab strip controls. `aria-controls` needs a
 * stable target, and there is exactly one panel per window, so a constant is
 * enough; the tabs themselves are numbered by position.
 */
const TABPANEL_ID = "explorer-tabpanel";

/** Tab element id, by position in the strip. */
function tabElementId(index: number): string {
  return `explorer-tab-${index}`;
}

export function ExplorerWindow({ context }: { context: ExplorerWindowContext }) {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const strings = useExplorerStrings();

  if (isLoading) {
    return (
      <ExplorerFrame strings={strings}>
        <div className="flex h-full items-center justify-center">
          <MulticaIcon mode="think" size={40} />
        </div>
      </ExplorerFrame>
    );
  }

  if (!user) {
    return (
      <ExplorerFrame strings={strings}>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-body text-muted-foreground">{strings.signInRequired}</p>
          <Button variant="outline" onClick={() => window.desktopAPI.closeWindow()}>
            {strings.closeWindow}
          </Button>
        </div>
      </ExplorerFrame>
    );
  }

  return <ExplorerBody context={context} strings={strings} />;
}

function ExplorerFrame({
  children,
  strings,
}: {
  children: ReactNode;
  strings: ExplorerStrings;
}) {
  return (
    <div
      data-explorer-window="true"
      className="flex h-screen min-h-0 flex-col bg-app-shell text-foreground"
    >
      {/* The rail sits under the traffic lights, so only the top bar is draggable
          here; the native controls are centred on it by the window options. */}
      <header className="flex h-10 shrink-0 items-center">
        <div
          className="h-full shrink-0"
          style={{ width: TRAFFIC_LIGHT_CLEARANCE, WebkitAppRegion: "drag" } as CSSProperties}
        />
        <div className="min-w-0 flex-1 truncate px-2 text-caption text-muted-foreground">
          {strings.taskDetail}
        </div>
        <div
          className="h-full flex-1"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        />
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ExplorerBody({
  context,
  strings,
}: {
  context: ExplorerWindowContext;
  strings: ExplorerStrings;
}) {
  const [panel, setPanel] = useState<PanelMode>("files");
  const [rootInfo, setRootInfo] = useState<ExplorerRootInfo | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const initialized = useRef(false);

  const tabs = useExplorerTabs((state) => state.tabs);
  const activeId = useExplorerTabs((state) => state.activeId);
  const openTab = useExplorerTabs((state) => state.open);
  const closeTab = useExplorerTabs((state) => state.close);
  const closeOtherTabs = useExplorerTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useExplorerTabs((state) => state.closeTabsToRight);
  const activate = useExplorerTabs((state) => state.activate);

  // Restore once, then persist on every change. Scoped to this issue, and kept
  // out of `multica_tabs` so the main window's tab list is never touched.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const saved = loadExplorerTabs(context.issueId);
    const taskTab: ExplorerTab = { id: TASK_TAB_ID, kind: "task", title: strings.taskDetail };
    const restored = saved?.tabs.filter((tab) => tab.id !== TASK_TAB_ID) ?? [];
    useExplorerTabs.getState().reset([taskTab, ...restored], saved?.activeId ?? TASK_TAB_ID);
  }, [context.issueId, strings.taskDetail]);

  useEffect(() => {
    return useExplorerTabs.subscribe((state) => {
      saveExplorerTabs(context.issueId, state.tabs, state.activeId);
    });
  }, [context.issueId]);

  // D13: an agent may rewrite files while this window is in the background, so
  // regaining focus re-reads the root info and the active surface.
  useEffect(() => {
    const onFocus = () => setRefreshToken((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.desktopAPI.explorer.rootInfo().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setRootError(strings.loadFailed);
        return;
      }
      setRootError(null);
      setRootInfo(result);
      if (!result.worktree && result.project) setPanel("changes");
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, strings]);

  const target: ExplorerTarget = rootInfo?.defaultTarget ?? "worktree";

  const openFile = useCallback(
    (path: string) => {
      openTab({ id: explorerTabId("file", path), kind: "file", title: path, path });
    },
    [openTab],
  );

  const openDiff = useCallback(
    (entry: ExplorerFileEntry, base: string | null) => {
      openTab({
        id: explorerTabId("diff", entry.path),
        kind: "diff",
        title: entry.path,
        path: base ? `${entry.path}\u0000${base}` : entry.path,
      });
    },
    [openTab],
  );

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab?.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplorerTabBar
        tabs={tabs}
        activeId={activeTab?.id ?? TASK_TAB_ID}
        onActivate={activate}
        onClose={closeTab}
        onCloseOthers={closeOtherTabs}
        onCloseRight={closeTabsToRight}
        onRefresh={() => setRefreshToken((value) => value + 1)}
        strings={strings}
      />
      <div className="flex min-h-0 flex-1">
        <ExplorerRail panel={panel} onChange={setPanel} strings={strings} />
        <div className="mr-2 mb-2 flex min-h-0 flex-1 overflow-hidden rounded-page bg-page-canvas shadow-[var(--page-shadow,var(--surface-shadow))] ring-1 ring-page-border">
          <aside className="flex w-[280px] shrink-0 flex-col border-r border-border">
            {rootInfo?.worktreeGone && (
              <p className="border-b border-border bg-muted/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
                {strings.worktreeGone}
              </p>
            )}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {panel === "files" ? strings.files : strings.changes}
              </span>
              <span className="truncate pl-2 text-[11px] text-muted-foreground/70" title={rootInfo?.label}>
                {rootInfo?.label ?? ""}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {rootError ? (
                <p className="px-3 py-4 text-body text-muted-foreground">{rootError}</p>
              ) : panel === "files" ? (
                <ExplorerFileList target={target} refreshToken={refreshToken} onOpen={openFile} strings={strings} />
              ) : (
                <ChangeList
                  target={target}
                  refreshToken={refreshToken}
                  onOpenDiff={openDiff}
                  strings={strings}
                />
              )}
            </div>
          </aside>
          <section
            role="tabpanel"
            id={TABPANEL_ID}
            aria-labelledby={tabElementId(activeIndex)}
            className="flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            {activeTab?.kind === "task" || !activeTab ? (
              <TaskPane context={context} />
            ) : activeTab.kind === "file" ? (
              <FileViewer
                target={target}
                path={activeTab.path ?? ""}
                refreshToken={refreshToken}
                strings={strings}
              />
            ) : (
              <DiffPane
                target={target}
                path={activeTab.path ?? ""}
                refreshToken={refreshToken}
                strings={strings}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The task tab reuses the dedicated issue window wholesale: it already wires the
 * workspace slug provider, the single-route router, navigation adapter and the
 * modal registry. The wrapper overrides `h-screen` so it fills the pane instead
 * of the viewport.
 */
function TaskPane({ context }: { context: ExplorerWindowContext }) {
  return (
    <div className="h-full min-h-0 overflow-hidden [&>div]:h-full">
      <IssueWindow
        context={{
          kind: "issue",
          path: context.path,
          title: context.title,
          workspaceSlug: context.workspaceSlug,
          issueId: context.issueId,
        }}
      />
    </div>
  );
}

function ExplorerFileList({
  target,
  refreshToken,
  onOpen,
  strings,
}: {
  target: ExplorerTarget;
  refreshToken: number;
  onOpen: (path: string) => void;
  strings: ExplorerStrings;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void window.desktopAPI.explorer.listFiles(target).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        setFiles([]);
        return;
      }
      setFiles(result.files);
      setTruncated(result.truncated);
    });
    return () => {
      cancelled = true;
    };
  }, [target, refreshToken]);

  if (failed) return <p className="px-3 py-4 text-body text-muted-foreground">{strings.loadFailed}</p>;
  if (files === null) return <p className="px-3 py-4 text-body text-muted-foreground">{strings.loading}</p>;
  // The IPC caps the listing; saying so beats a tree that silently stops.
  return (
    <>
      <FileTree files={files} selectedPath={null} onOpen={onOpen} strings={strings} />
      {truncated && (
        <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {strings.truncated}
        </p>
      )}
    </>
  );
}

function DiffPane({
  target,
  path,
  refreshToken,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  refreshToken: number;
  strings: ExplorerStrings;
}) {
  // `path` may carry the base commit after a NUL, so a branch diff stays pinned
  // to the base that was current when the tab was opened.
  const separator = path.indexOf("\u0000");
  const filePath = separator >= 0 ? path.slice(0, separator) : path;
  const base = separator >= 0 ? path.slice(separator + 1) : null;

  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; pair: ExplorerFilePair } | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    // Two documents, not a patch: the diff editor needs the full text of both
    // sides to collapse unchanged regions and to search inside the diff.
    void window.desktopAPI.explorer.filePair(target, filePath, { base }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", pair: result });
    });
    return () => {
      cancelled = true;
    };
  }, [target, filePath, base, refreshToken]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-body text-muted-foreground">
        {strings.loading}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center text-body text-muted-foreground">
        {strings.loadFailed}
      </div>
    );
  }
  return (
    <DiffView
      pair={state.pair}
      path={filePath}
      strings={strings}
    />
  );
}

/**
 * Multi-row tab strip.
 *
 * The main window's tab bar scrolls horizontally, which is right for a 56 px
 * tall app chrome. In a dedicated workbench the strip is the only navigation, so
 * a hidden tab is a tab the user forgets exists — wrapping onto a second row
 * keeps every open file visible. There is deliberately no `overflow-x-auto`
 * here: with `flex-wrap` it would never engage and would only clip the row.
 */
function ExplorerTabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onRefresh,
  strings,
}: {
  tabs: ExplorerTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onRefresh: () => void;
  strings: ExplorerStrings;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  /**
   * Roving tabindex across the strip, as the tab pattern expects: only the
   * selected tab is a tab stop, and the arrows walk the rest. Focus moves with
   * selection — this strip has no second focus model to keep in sync — and the
   * element is already in the DOM, so it can be focused without waiting for the
   * re-render that follows `onActivate`.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === activeId);
    if (current < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    const target = tabs[next];
    if (!target) return;
    event.preventDefault();
    onActivate(target.id);
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-index="${next}"]`)?.focus();
  };

  return (
    <header
      className="flex shrink-0 items-start gap-1 pb-1 pr-2 pt-1.5"
      // The strip itself is no-drag; the padding and the empty tail of the last
      // row are what make the window movable, which matters more now that the
      // row can wrap.
      style={{ paddingLeft: TRAFFIC_LIGHT_CLEARANCE, WebkitAppRegion: "drag" } as CSSProperties}
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label={strings.openTabs}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const closable = tab.id !== TASK_TAB_ID;
          const hasOthers = tabs.some((item) => item.id !== TASK_TAB_ID && item.id !== tab.id);
          const hasRight = tabs.some((item, position) => position > index && item.id !== TASK_TAB_ID);
          const surface = (
            <div
              role="tab"
              id={tabElementId(index)}
              aria-selected={active}
              aria-controls={TABPANEL_ID}
              // Read by the strip's arrow-key handler instead of a ref map: the
              // context-menu trigger composes its own ref onto this element.
              data-tab-index={index}
              // Roving tabindex — the selected tab is the strip's single stop.
              tabIndex={active ? 0 : -1}
              title={tab.path ?? tab.title}
              onClick={() => onActivate(tab.id)}
              // A div does not take focus on click the way a button does, and
              // the arrow keys above need the strip to already hold focus.
              onMouseDown={(event) => event.currentTarget.focus()}
              onAuxClick={(event) => {
                if (event.button === 1 && closable) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              className={[
                "group flex h-7 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px]",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-accent/60",
              ].join(" ")}
            >
              {tab.kind === "diff" ? (
                <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              ) : tab.kind === "file" ? (
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <FolderMark />
              )}
              <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
              {closable && (
                <button
                  type="button"
                  // Inside a tab it would otherwise become a second tab stop;
                  // VS Code keeps the close affordance out of the tab order too.
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={strings.close}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );

          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger render={surface} />
              <ContextMenuContent>
                <ContextMenuItem disabled={!closable} onClick={() => onClose(tab.id)}>
                  <X />
                  {strings.closeCurrent}
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasOthers} onClick={() => onCloseOthers(tab.id)}>
                  <ListX />
                  {strings.closeOthers}
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasRight} onClick={() => onCloseRight(tab.id)}>
                  <ListEnd />
                  {strings.closeRight}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-0.5 shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent"
        aria-label={strings.refresh}
        title={strings.refresh}
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
      </button>
    </header>
  );
}

function FolderMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-foreground/15 text-[9px] font-semibold leading-none"
    >
      T
    </span>
  );
}

function ExplorerRail({
  panel,
  onChange,
  strings,
}: {
  panel: PanelMode;
  onChange: (panel: PanelMode) => void;
  strings: ExplorerStrings;
}) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center pt-2">
      <RailButton
        active={panel === "files"}
        label={strings.files}
        onClick={() => onChange("files")}
      >
        <FileText className="size-4" aria-hidden="true" />
      </RailButton>
      <RailButton
        active={panel === "changes"}
        label={strings.git}
        onClick={() => onChange("changes")}
      >
        <GitBranch className="size-4" aria-hidden="true" />
      </RailButton>
    </nav>
  );
}

function RailButton({
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
        "relative flex size-9 items-center justify-center rounded-lg transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
