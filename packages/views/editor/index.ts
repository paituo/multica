export {
  ContentEditor,
  type ContentEditorProps,
  type ContentEditorRef,
} from "./content-editor";
export {
  TitleEditor,
  type TitleEditorProps,
  type TitleEditorRef,
} from "./title-editor";
export { ReadonlyContent } from "./readonly-content";
export { useFileDropZone } from "./use-file-drop-zone";
export { useUploadGate, type UploadGate } from "./use-upload-gate";
export {
  useComposerSubmit,
  type ComposerSubmit,
  type ComposerSubmitOptions,
  type ComposerAfterAccepted,
} from "./use-composer-submit";
export { useEditorUpload } from "./use-editor-upload";
export { FileDropOverlay } from "./file-drop-overlay";
export { useLazyEditor, type LazyEditorHandle, type LazyFocusTarget } from "./use-lazy-editor";
export { anchorFromPoint, type TextAnchor } from "./text-anchor";
export { useDownloadAttachment } from "./use-download-attachment";
export { AttachmentDownloadProvider } from "./attachment-download-context";
export { ImageThumbnailsProvider } from "./image-thumbnails-context";
export {
  AttachmentPreviewModal,
  useAttachmentPreview,
  isPreviewable,
} from "./attachment-preview-modal";
export type {
  AttachmentPreviewHandle,
  PreviewCopyLinkAction,
  PreviewLocateAction,
  PreviewSequence,
} from "./attachment-preview-modal";
export {
  PreviewSequenceProvider,
  collectPreviewSequence,
  usePreviewSequence,
} from "./preview-sequence-context";
export type {
  OpenAtOptions,
  PreviewItemDetails,
  PreviewSequenceControls,
} from "./preview-sequence-context";
export { AttachmentCard } from "./attachment-card";
export type { AttachmentCardProps } from "./attachment-card";
/*
 * Content-level renderers, exported so a second host can show the same file
 * kinds the attachment viewer does. The desktop task explorer is that host: it
 * reads from the local filesystem through its own IPC instead of from an
 * attachment record, so it needs the table / tree / kind decisions without the
 * viewer's chrome, sequence pager or download plumbing.
 */
export { TablePreview } from "./table-preview";
export { StructuredTree } from "./structured-tree";
export { parseStructured, type StructuredParse } from "./utils/parse-structured";
export {
  getPreviewKind,
  structuredFormat,
  tableDelimiter,
  type PreviewKind,
  type StructuredFormat,
} from "./utils/preview";
export { Attachment } from "./attachment";
export type { AttachmentInput, AttachmentProps } from "./attachment";
