// Typed wrappers over the Docs commands (src-tauri/src/commands/document.rs).

import { invoke } from "@tauri-apps/api/core";
import type { RecoveryItem, TemplateMeta } from "../api";

// Mutating commands run one after another, in call order.
let chain: Promise<unknown> = Promise.resolve();
function mut<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const p = chain.then(() => invoke<T>(cmd, args));
  chain = p.catch(() => undefined);
  return p;
}

export interface DocInfo {
  id: string;
  title: string;
  path: string | null;
  format: string | null;
  dirty: boolean;
  untouched: boolean;
  /** The file it came from when saving can't overwrite it (.docm, .dotx…). */
  sourcePath: string | null;
}

export interface DocOpenResult {
  info: DocInfo;
  alreadyOpen: boolean;
  warning?: string;
}

/** ProseMirror JSON of a document (see src-tauri/src/docx/read.rs). */
export interface DocJSON {
  type: "doc";
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

export interface StyleDef {
  id: string;
  type: "paragraph" | "character" | "table" | "numbering";
  name: string;
  basedOn: string | null;
  next: string | null;
  link: string | null;
  uiPriority: number | null;
  qFormat: boolean;
  hidden: boolean;
  semiHidden: boolean;
  default: boolean;
  custom: boolean;
  builtin?: boolean;
  pPr?: Record<string, unknown>;
  rPr?: MarkJSON[];
  tblPr?: Record<string, unknown>;
  tcPr?: Record<string, unknown>;
  conditional?: Record<string, { pPr?: Record<string, unknown>; rPr?: MarkJSON[]; tblPr?: Record<string, unknown>; trPr?: Record<string, unknown>; tcPr?: Record<string, unknown> }>;
}

export interface MarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface NumLevel {
  ilvl: number;
  start: number | null;
  numFmt: string | null;
  lvlText: string | null;
  lvlJc: string | null;
  suff: string | null;
  lvlRestart: number | null;
  isLgl: boolean;
  pStyle: string | null;
  pPr?: Record<string, unknown>;
  rPr?: MarkJSON[];
}

export interface Numbering {
  abstracts: Record<string, { levels: NumLevel[]; multi: string | null; numStyleLink: string | null; styleLink: string | null }>;
  nums: Record<string, { abstract: string; overrides: Record<string, { start: number | null; level: NumLevel | null }> }>;
}

export interface Theme {
  fonts?: { major?: string | null; minor?: string | null };
  colors?: Record<string, string>;
}

export interface DocPayload {
  doc: DocJSON;
  headers: Record<string, DocJSON>;
  footers: Record<string, DocJSON>;
  styles: { defaults: { rPr?: MarkJSON[]; pPr?: Record<string, unknown> }; styles: StyleDef[] };
  numbering: Numbering;
  theme: Theme;
  settings: { defaultTabStop?: number; evenAndOddHeaders?: boolean; mirrorMargins?: boolean; compatibilityMode?: number | null };
  footnotes: Record<string, string>;
  endnotes: Record<string, string>;
  comments: Record<string, { author: string | null; initials: string | null; date: string | null; text: string }>;
  core: Record<string, string>;
}

export interface DocSnapshot {
  doc: unknown;
  headers: Record<string, unknown | null>;
  footers: Record<string, unknown | null>;
  stats: { pages: number; words: number; chars: number; charsWithSpaces: number; paragraphs: number; lines: number };
  core?: Record<string, string>;
  /** Comments added or edited (null: deleted) since the last save. */
  comments?: Record<string, { author: string; initials: string; date: string; text: string } | null>;
}

/** Attributes of a picture added to the document. */
export interface AddedImage {
  target: string;
  cx: number;
  cy: number;
  name: string;
}

export interface DocWindow {
  label: string;
  doc: string;
  title: string;
  dirty: boolean;
}

export interface TemplateContent {
  doc: DocJSON;
  styles: DocPayload["styles"];
  numbering: Numbering;
}

export const docsApi = {
  windowKind: () => invoke<"sheets" | "docs">("window_kind"),
  windowDoc: () => invoke<string | null>("window_doc"),
  openDocWindow: (doc: string, title: string) => mut<void>("open_doc_window", { doc, title }),
  openAppWindow: (kind: "sheets" | "docs", file: string | null = null) => mut<void>("open_app_window", { kind, file }),
  openInApp: (path: string) => mut<void>("open_in_app", { path }),
  docWindows: () => invoke<DocWindow[]>("list_doc_windows"),

  create: (template?: string) => mut<DocInfo>("document_new", { template: template ?? null }),
  open: (path: string) => mut<DocOpenResult>("document_open", { path }),
  info: (doc: string) => invoke<DocInfo>("document_info", { doc }),
  payload: (doc: string) => invoke<DocPayload>("document_payload", { doc }),
  update: (doc: string, snapshot: DocSnapshot, changed: boolean) => mut<DocInfo>("document_update", { doc, snapshot, changed }),
  save: (doc: string, snapshot: DocSnapshot | null) => mut<DocInfo>("document_save", { doc, snapshot }),
  saveAs: (doc: string, path: string, snapshot: DocSnapshot | null) => mut<DocInfo>("document_save_as", { doc, path, snapshot }),
  exportCopy: (doc: string, path: string, snapshot: DocSnapshot | null) => mut<void>("document_export", { doc, path, snapshot }),
  writeHtml: (path: string, html: string) => mut<void>("document_write_html", { path, html }),
  close: (doc: string) => mut<void>("document_close", { doc }),
  formatIsLossy: (path: string) => invoke<boolean>("document_format_lossy", { path }),
  addImage: (doc: string, path: string) => mut<AddedImage>("document_add_image", { doc, path }),
  addImageData: (doc: string, data: string, name: string) => mut<AddedImage>("document_add_image_data", { doc, data, name }),
  templates: () => invoke<TemplateMeta[]>("document_templates"),
  templatePreview: (id: string) => invoke<TemplateContent | null>("document_template_preview", { id }),
  recoveryOpen: (file: string) => mut<DocInfo>("document_recovery_open", { file }),
  versionOpen: (file: string, title: string) => mut<DocInfo>("document_version_open", { file, title }),
};

export type { RecoveryItem };

/** File types Docs opens. */
export const DOC_EXTENSIONS = ["docx", "docm", "dotx", "dotm", "txt", "md", "markdown"];

export function isDocPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["docx", "docm", "dotx", "dotm", "doc", "dot", "md", "markdown", "rtf", "odt"].includes(ext);
}

/** URL of a picture of an open document (served by the docmedia protocol). */
export function mediaUrl(doc: string, part: string): string {
  const path = `${encodeURIComponent(doc)}/${part.split("/").map(encodeURIComponent).join("/")}`;
  return /Windows/i.test(navigator.userAgent) ? `http://docmedia.localhost/${path}` : `docmedia://localhost/${path}`;
}
