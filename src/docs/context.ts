import { createContext, useContext } from "react";
import type { TemplateMeta } from "../api";
import type { DocInfo } from "./api";

/** What the Docs start page and File menu need from the window. */
export interface DocsAppApi {
  templates: TemplateMeta[];
  /** The document shown in this window, if any. */
  current: DocInfo | null;
  newDocument: (template?: string) => Promise<void>;
  /** Shows a document created by the backend (recovered file, old version). */
  showDoc: (info: DocInfo) => Promise<void>;
}

export const DocsContext = createContext<DocsAppApi | null>(null);

export function useDocsApp(): DocsAppApi {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error("DocsContext missing");
  return ctx;
}
