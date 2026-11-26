import { useLocale } from "@multica/views/i18n";

/**
 * Local dictionary for the explorer window.
 *
 * Deliberate deviation from the project's i18n setup: `packages/views/locales`
 * ships a parity test that requires every namespace to exist in all 8 locales,
 * so adding an `explorer.json` namespace costs ~17 file edits. This window is a
 * developer-facing workbench and ships zh/en only; migrate it into a proper
 * namespace once the feature stabilises.
 */
const ZH = {
  files: "文件",
  changes: "变更",
  refresh: "刷新",
  close: "关闭",
  worktreeGone: "worktree 已被回收，当前显示的是项目目录",
  branchChanges: "分支变更",
  noChanges: "没有未提交的改动",
  untracked: "未跟踪",
  loading: "加载中…",
  emptyTree: "此目录下没有文件",
  truncated: "列表已截断",
  binary: "二进制文件，无法预览",
  tooLarge: "文件过大，无法预览",
  diffEmpty: "没有文本差异（可能是新增或删除的文件）",
  loadFailed: "读取失败",
  noGit: "未找到 git 可执行文件",
  outsideRoot: "路径超出该任务的目录范围",
  task: "任务",
  signInRequired: "请先登录后再打开任务",
  closeWindow: "关闭窗口",
  zoomIn: "放大（Ctrl+滚轮）",
  zoomOut: "缩小（Ctrl+滚轮）",
  zoomReset: "恢复默认字号",
  wordWrap: "自动换行",
  closeCurrent: "关闭当前",
  closeOthers: "关闭其他",
  closeRight: "关闭右侧",
  viewAsList: "列表视图",
  viewAsTree: "树形视图",
  previousChange: "上一个变更",
  nextChange: "下一个变更",
  sideBySide: "并排显示",
  inlineView: "内联显示",
  splitTooNarrow: "并排显示（窗口太窄，已改用内联）",
  copyPath: "复制文件路径",
  jumpToChange: "跳转到该变更",
  filesChanged: "个文件",
  collapseUnchanged: "折叠未修改区域",
  ignoreWhitespace: "忽略行尾空白差异",
  changesUnit: "处变更",
};

const EN: Record<keyof typeof ZH, string> = {
  files: "Files",
  changes: "Changes",
  refresh: "Refresh",
  close: "Close",
  worktreeGone: "Worktree has been reclaimed — showing the project directory",
  branchChanges: "Branch changes",
  noChanges: "No uncommitted changes",
  untracked: "untracked",
  loading: "Loading…",
  emptyTree: "No files in this directory",
  truncated: "List truncated",
  binary: "Binary file — cannot preview",
  tooLarge: "File too large to preview",
  diffEmpty: "No textual diff (file may be added or deleted)",
  loadFailed: "Failed to load",
  noGit: "git executable not found",
  outsideRoot: "Path is outside this task's directory",
  task: "Task",
  signInRequired: "Sign in to open this task",
  closeWindow: "Close window",
  zoomIn: "Zoom in (Ctrl + wheel)",
  zoomOut: "Zoom out (Ctrl + wheel)",
  zoomReset: "Reset font size",
  wordWrap: "Word wrap",
  closeCurrent: "Close",
  closeOthers: "Close others",
  closeRight: "Close to the right",
  viewAsList: "List view",
  viewAsTree: "Tree view",
  previousChange: "Previous change",
  nextChange: "Next change",
  sideBySide: "Side by side",
  inlineView: "Inline view",
  splitTooNarrow: "Side by side (window too narrow — showing inline)",
  copyPath: "Copy file path",
  jumpToChange: "Jump to this change",
  filesChanged: "files",
  collapseUnchanged: "Collapse unchanged regions",
  ignoreWhitespace: "Ignore trailing whitespace",
  changesUnit: "changes",
};

export type ExplorerStrings = Record<keyof typeof ZH, string>;

export function useExplorerStrings(): ExplorerStrings {
  const locale = useLocale();
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
