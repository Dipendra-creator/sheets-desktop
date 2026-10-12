// The open document of a Docs window: the ProseMirror editor plus
// everything the ribbon, dialogs, status bar and backstage need.

import { baseKeymap } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Fragment, Slice, type Mark, type Node as PMNode } from "prosemirror-model";
import { AllSelection, EditorState, NodeSelection, Plugin, TextSelection, type Transaction } from "prosemirror-state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  selectedRect,
  splitCell,
  tableEditing,
  TableMap,
} from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { docsApi, type DocInfo, type DocPayload, type DocSnapshot } from "../api";
import { setRenderContext } from "../model/render";
import { docFromJSON, FORMAT_MARKS, schema } from "../model/schema";
import { StyleSheet } from "../model/styles";
import { EMU_PER_PX, num, twips } from "../model/units";
import {
  applyCase,
  formatState,
  mapMarks,
  marksAt,
  mergeMap,
  nextCase,
  selectedParagraphs,
  setMark,
  sortParagraphs,
  updateParagraphs,
  type CaseKind,
  type FormatState,
} from "./commands";
import { findKey, findPlugin, gotoMatch, replaceAll, replaceOne, setSearch, DEFAULT_FIND, type FindOptions } from "./find";
import { formattingKey, formattingPlugin } from "./formatting";
import { ImageView } from "./imageview";
import { autoFormatRules, wordKeymap } from "./keymap";
import { BULLET_FORMATS, findFormat, Lists, NUMBER_FORMATS, type ListFormat } from "./lists";
import { NOTE_KINDS, newNote, noteReference, noteText, referencedNotes, renderNote, type NoteKind } from "./notes";
import { geometryOf, NO_NOTES, paginationPlugin, paginators, type HfType, type NoteLayout, type PageInfo } from "./pagination";
import { addStoryRef, pageFacts, resolveStory, sectionsOf, type PageFacts, type SectionInfo, type StoryKind } from "./sections";
import { storyWatermark, watermarkNode, withoutWatermark, type Watermark } from "./watermark";
import { DocTableView } from "./tableview";
import { TabView, tabLayouts, tabsPlugin } from "./tabs";
import { nextChange, resolveChanges, trackedDelete, trackedPaste, trackedTextInput, type Reviewer } from "./track";
import { countWords, type WordStats } from "./wordcount";
import { prepareHtml, prepareSlice, uploadPendingImages } from "./clipboard";
import { clipboardSerializer } from "./serializer";
import { generateToc, updateFields } from "./fields";

type Attrs = Record<string, unknown>;

export type ViewMode = "print" | "web" | "draft" | "read";
export type Markup = "all" | "simple" | "none" | "original";

export interface DialogRequest {
  kind: string;
  props?: Record<string, unknown>;
}

/** What the window around the editor provides. */
export interface DocHost {
  author: () => string;
  ask: (title: string, message: string, buttons: { label: string; value: string; primary?: boolean }[], icon?: string) => Promise<string>;
  error: (message: string) => void;
  /** Asks for a file name and saves (returns false when cancelled). */
  saveAs: (ctl: DocController) => Promise<boolean>;
  onInfo: (info: DocInfo) => void;
}

export interface HeaderFooterEdit {
  kind: "header" | "footer";
  type: "default" | "first" | "even";
  page: number;
  /** The story being edited ("final:default", a section's relationship id, or null for a new one). */
  ref: string | null;
  /** The section that owns it (or gets the new one). */
  section: number;
}

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export class DocController {
  info: DocInfo;
  payload: DocPayload;
  sheet: StyleSheet;
  lists: Lists;
  view: EditorView | null = null;
  state: EditorState;
  headers: Record<string, PMNode | null> = {};
  footers: Record<string, PMNode | null> = {};
  /** Headers/footers changed since opening (sent with every save). */
  hfChanged = new Set<string>();
  coreEdits: Record<string, string> = {};

  // UI state
  zoom = 1;
  viewMode: ViewMode = "print";
  showMarks = false;
  ruler = true;
  navPane = false;
  ribbonCollapsed = false;
  keyTips: "off" | "tabs" | "controls" = "off";
  trackChanges = false;
  markup: Markup = "all";
  dialog: DialogRequest | null = null;
  backstage: string | null = null;
  headerEdit: HeaderFooterEdit | null = null;
  pages: PageInfo[] = [{ index: 0, from: 0 }];
  format: FormatState;
  stats: WordStats = { words: 0, chars: 0, charsWithSpaces: 0, paragraphs: 0, lines: 0 };
  selectionWords: number | null = null;
  /** Format Painter: the formatting to paint, and whether it stays on. */
  painter: { marks: readonly Mark[]; para: Attrs; sticky: boolean } | null = null;
  status = "";
  saving = false;
  /** Laid out for printing (100%, no space between pages). */
  printMode = false;
  readonly dirtyAtOpen: boolean;
  /** Comments pane (Review > Show Comments). */
  commentsPane = false;
  /** Comments added, edited or deleted (null) since opening. */
  commentEdits: Record<string, { author: string; initials: string; date: string; text: string } | null> = {};
  /** The comment being edited in the pane. */
  editingComment: string | null = null;
  /** Footnotes and endnotes by id. */
  notes: Record<NoteKind, Record<string, PMNode>> = { footnote: {}, endnote: {} };
  /** Notes changed since opening ("footnote:3"), sent with every save. */
  notesChanged = new Set<string>();
  /** The note being edited at the bottom of its page. */
  noteEdit: { kind: NoteKind; id: string } | null = null;
  /** Where the pages' footnotes and the endnotes are drawn. */
  noteLayout: NoteLayout = NO_NOTES;
  /** Heights of headers and footers as drawn ("header:first"), unzoomed px. */
  hfHeights: Record<string, number> = {};
  /** Headers and footers of the other sections, by relationship id. */
  stories: Record<string, PMNode> = {};
  storyKinds: Record<string, StoryKind> = {};
  /** Section stories changed since opening, sent with every save. */
  storiesChanged = new Set<string>();
  private sectionsCache: { doc: PMNode; tick: number; list: SectionInfo[] } | null = null;
  /** Bumped whenever a header or footer changes (redraws the pages). */
  hfTick = 0;
  /** Hidden box the page area gives for measuring notes (text width, 100%). */
  measureHost: HTMLElement | null = null;
  private noteHeights = new WeakMap<PMNode, number>();
  private measuredWidth = 0;

  private listeners = new Set<() => void>();
  private updateTimer = 0;
  private statsTimer = 0;
  private changedSinceUpdate = false;
  private destroyed = false;
  readonly reviewer: Reviewer;

  constructor(
    info: DocInfo,
    payload: DocPayload,
    readonly host: DocHost,
  ) {
    this.info = info;
    this.payload = payload;
    this.dirtyAtOpen = info.dirty;
    setRenderContext(info.id, payload.theme ?? {});
    this.sheet = new StyleSheet(payload.styles ?? { defaults: {}, styles: [] });
    payload.numbering ??= { abstracts: {}, nums: {} };
    payload.numbering.abstracts ??= {};
    payload.numbering.nums ??= {};
    // Lists created in an earlier session of this document (AutoRecover)
    for (const d of ((payload.doc.attrs?.numAdded as Attrs[] | undefined) ?? [])) {
      if (d.kind === "abstract") payload.numbering.abstracts[String(d.id)] = { levels: d.levels as never, multi: null, numStyleLink: null, styleLink: null };
      else if (d.kind === "num") payload.numbering.nums[String(d.id)] = { abstract: String(d.abstract), overrides: (d.overrides as never) ?? {} };
    }
    this.lists = new Lists(payload.numbering, this.sheet);
    this.reviewer = { enabled: () => this.trackChanges, author: () => this.host.author() || "Author" };
    for (const [k, v] of Object.entries(payload.headers ?? {})) this.headers[k] = v ? docFromJSON(v) : null;
    for (const [k, v] of Object.entries(payload.footers ?? {})) this.footers[k] = v ? docFromJSON(v) : null;
    for (const kind of NOTE_KINDS) {
      for (const [id, v] of Object.entries((kind === "footnote" ? payload.footnotes : payload.endnotes) ?? {})) if (v) this.notes[kind][id] = docFromJSON(v);
    }
    for (const [rid, v] of Object.entries(payload.stories ?? {})) {
      if (!v) continue;
      this.stories[rid] = docFromJSON({ type: "doc", content: v.content });
      this.storyKinds[rid] = v.kind;
    }
    this.state = EditorState.create({ doc: docFromJSON(payload.doc), plugins: this.plugins() });
    this.format = this.computeFormat(this.state);
    try {
      const saved = JSON.parse(localStorage.getItem("docs.view") ?? "null");
      if (saved) {
        this.zoom = saved.zoom ?? 1;
        this.ruler = saved.ruler ?? true;
        this.navPane = saved.navPane ?? false;
        this.showMarks = saved.showMarks ?? false;
      }
    } catch {
      /* ignore */
    }
    this.recount();
  }

  // ------------------------------------------------------------------
  // Subscription
  // ------------------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  get id() {
    return this.info.id;
  }

  get title() {
    return this.info.title;
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------

  private plugins(): Plugin[] {
    const sheet = this.sheet;
    const settings = this.payload.settings ?? {};
    return [
      // A key pressed right after the caret moved (Ctrl+End, then Enter)
      // can arrive before the browser reports the move: read it first
      new Plugin({
        props: {
          handleKeyDown: (view, event) => {
            if (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete" || event.key === "Tab") {
              (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
            }
            return false;
          },
        },
      }),
      autoFormatRules(this),
      keymap(wordKeymap(this)),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Mod-Shift-z": redo,
      }),
      keymap(baseKeymap),
      history({ depth: 200, newGroupDelay: 600 }),
      columnResizing({ View: DocTableView as never, cellMinWidth: 24, defaultCellMinWidth: 64 }),
      tableEditing({ allowTableNodeSelection: true }),
      dropCursor({ color: "#2b579a", width: 2 }),
      gapCursor(),
      formattingPlugin({ sheet, numbering: this.payload.numbering, noteText: (kind, id) => noteText(this.notes[kind][id]) }),
      tabsPlugin({ sheet, defaultTab: Number(settings.defaultTabStop ?? 720) || 720 }),
      paginationPlugin(
        {
          sheet,
          enabled: () => this.viewMode === "print" || this.viewMode === "read",
          band: (page, section, first) => this.pageBand(page, section, first),
          noteHeight: (kind, id) => this.noteHeight(kind, id),
        },
        (pages, notes) => this.setPages(pages, notes),
      ),
      findPlugin(),
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => trackedTextInput(view, from, to, text, this.reviewer),
          handleKeyDown: (view, event) => {
            if (!this.trackChanges) return false;
            if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey) return trackedDelete(view.state, view.dispatch, -1, this.reviewer);
            if (event.key === "Delete" && !event.ctrlKey && !event.metaKey) return trackedDelete(view.state, view.dispatch, 1, this.reviewer);
            return false;
          },
          handlePaste: (view, event, slice) => this.handlePaste(view, event, slice),
          handleDrop: (view, event) => this.handleDrop(view, event),
          handleClick: (view, pos, event) => this.handleClick(view, pos, event),
          handleDoubleClickOn: (_view, _pos, node) => {
            // Double-clicking a footnote mark goes to the note, like Word
            const kind = node.attrs.kind as string;
            if (node.type.name !== "opaque_inline" || (kind !== "footnote" && kind !== "endnote")) return false;
            this.openNote(kind, String(node.attrs.noteId));
            return true;
          },
          handleDOMEvents: {
            mouseup: () => {
              if (this.painter) this.paint();
              return false;
            },
          },
          transformPastedHTML: (html) => prepareHtml(html),
          attributes: () => ({ spellcheck: "true", class: "pm-doc", "aria-label": "Document" }),
        },
      }),
    ];
  }

  mount(el: HTMLElement) {
    this.view?.destroy();
    this.view = new EditorView(el, {
      state: this.state,
      dispatchTransaction: (tr) => this.dispatch(tr),
      nodeViews: {
        tab: (node) => new TabView(node),
        image: (node, view, getPos) => new ImageView(node, view, getPos as () => number | undefined),
      },
      clipboardSerializer,
      clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, "\n\n", (leaf) => (leaf.type.name === "tab" ? "\t" : leaf.type.name === "hard_break" ? "\n" : "")),
    });
  }

  dispatch(tr: Transaction) {
    if (!this.view || this.destroyed) return;
    const state = this.view.state.apply(tr);
    this.view.updateState(state);
    this.state = state;
    if (tr.docChanged) {
      this.onDocChanged(tr);
    }
    if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) {
      this.format = this.computeFormat(state);
      this.updateSelectionWords();
    }
    this.emit();
  }

  private computeFormat(state: EditorState): FormatState {
    return formatState(state, this.sheet, (numId, ilvl) => this.lists.kind(numId, ilvl));
  }

  /** Runs a ProseMirror command on the editor. */
  run(cmd: (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean): boolean {
    if (!this.view) return false;
    const ok = cmd(this.view.state, (tr) => this.dispatch(tr), this.view);
    this.focus();
    return ok;
  }

  focus() {
    if (this.headerEditor) this.headerEditor.focus();
    else this.view?.focus();
  }

  /** The editor that has the focus: the body or a header/footer being edited. */
  headerEditor: EditorView | null = null;

  get active(): EditorView | null {
    return this.headerEditor ?? this.view;
  }

  /** Dispatches to whichever editor is active. */
  apply(fn: (state: EditorState, dispatch: (tr: Transaction) => void) => void) {
    const v = this.active;
    if (!v) return;
    fn(v.state, (tr) => v.dispatch(tr));
    v.focus();
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.updateTimer);
    window.clearTimeout(this.statsTimer);
    this.view?.destroy();
    this.view = null;
  }

  // ------------------------------------------------------------------
  // Changes, AutoRecover and saving
  // ------------------------------------------------------------------

  private onDocChanged(tr: Transaction) {
    void tr;
    this.changedSinceUpdate = true;
    if (!this.info.dirty) {
      this.info = { ...this.info, dirty: true, untouched: false };
      this.host.onInfo(this.info);
    }
    window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => this.pushUpdate(), 1500);
    window.clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => {
      this.recount();
      this.emit();
    }, 400);
  }

  /** Something outside the text changed (document properties…). */
  markChanged() {
    this.onDocChanged(this.state.tr);
    this.emit();
  }

  /** A header or footer changed. */
  headerChanged(kind: "header" | "footer", type: string, doc: PMNode | null) {
    (kind === "header" ? this.headers : this.footers)[type] = doc;
    this.hfChanged.add(`${kind}:${type}`);
    this.hfTick++;
    this.onDocChanged(this.state.tr);
    paginators.get(this.view!)?.invalidate();
    this.emit();
  }

  recount() {
    this.stats = countWords(this.state.doc);
    this.stats.lines = Math.max(this.stats.lines, this.stats.paragraphs);
  }

  private updateSelectionWords() {
    const sel = this.state.selection;
    if (sel.empty) {
      this.selectionWords = null;
      return;
    }
    const text = this.state.doc.textBetween(sel.from, sel.to, " ", " ");
    this.selectionWords = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }

  snapshot(): DocSnapshot {
    const headers: Record<string, unknown> = {};
    const footers: Record<string, unknown> = {};
    for (const key of this.hfChanged) {
      const [kind, type] = key.split(":");
      const doc = kind === "header" ? this.headers[type] : this.footers[type];
      (kind === "header" ? headers : footers)[type] = doc ? doc.toJSON() : null;
    }
    this.recount();
    const s = this.stats;
    return {
      doc: this.state.doc.toJSON(),
      headers,
      footers,
      stats: { pages: this.pages.length, words: s.words, chars: s.chars, charsWithSpaces: s.charsWithSpaces, paragraphs: s.paragraphs, lines: s.lines },
      core: Object.keys(this.coreEdits).length ? this.coreEdits : undefined,
      comments: Object.keys(this.commentEdits).length ? this.commentEdits : undefined,
      ...this.noteEdits(),
      stories: this.storiesChanged.size
        ? Object.fromEntries([...this.storiesChanged].map((rid) => [rid, { kind: this.storyKinds[rid] ?? "header", content: this.stories[rid]?.toJSON().content ?? [] }]))
        : undefined,
    };
  }

  /** Notes added or edited, and notes whose reference was deleted (null). */
  private noteEdits(): { footnotes?: Record<string, unknown>; endnotes?: Record<string, unknown> } {
    const referenced = referencedNotes(this.state.doc);
    const out: Record<NoteKind, Record<string, unknown>> = { footnote: {}, endnote: {} };
    for (const kind of NOTE_KINDS) {
      const refs = new Set(referenced[kind]);
      for (const key of this.notesChanged) {
        const [k, id] = key.split(":");
        if (k !== kind) continue;
        const doc = this.notes[kind][id];
        out[kind][id] = doc && refs.has(id) ? doc.toJSON() : null;
      }
      const opened = (kind === "footnote" ? this.payload.footnotes : this.payload.endnotes) ?? {};
      for (const id of Object.keys(opened)) if (!refs.has(id) && opened[id]) out[kind][id] = null;
    }
    return {
      footnotes: Object.keys(out.footnote).length ? out.footnote : undefined,
      endnotes: Object.keys(out.endnote).length ? out.endnote : undefined,
    };
  }

  private async pushUpdate() {
    if (!this.changedSinceUpdate || this.destroyed) return;
    this.changedSinceUpdate = false;
    try {
      const info = await docsApi.update(this.id, this.snapshot(), true);
      this.setInfo(info);
    } catch (e) {
      console.warn("AutoRecover update failed", e);
    }
  }

  setInfo(info: DocInfo) {
    this.info = info;
    this.host.onInfo(info);
    this.emit();
  }

  /** Save (Ctrl+S). Asks for a file name the first time. */
  async save(): Promise<boolean> {
    if (!this.info.path) return this.host.saveAs(this);
    // Formats that keep only the text: Word asks first
    if (this.info.format && this.info.format !== "docx" && this.hasFormatting()) {
      const answer = await this.host.ask(
        "Docs",
        `${this.info.title}.${this.info.format} may contain features that are not compatible with ${this.info.format === "md" ? "Markdown" : "Plain Text"}. Do you want to keep using this format?`,
        [
          { label: "Keep Current Format", value: "keep", primary: true },
          { label: "Save as Word Document…", value: "docx" },
          { label: "Cancel", value: "cancel" },
        ],
        "warning",
      );
      if (answer === "cancel") return false;
      if (answer === "docx") return this.host.saveAs(this);
    }
    this.saving = true;
    this.status = "Saving…";
    this.emit();
    try {
      window.clearTimeout(this.updateTimer);
      this.changedSinceUpdate = false;
      // Edits stay listed: every save applies them to the file as opened
      const info = await docsApi.save(this.id, this.snapshot());
      this.setInfo(info);
      this.status = "Saved";
      return true;
    } catch (e) {
      this.host.error(String(e));
      return false;
    } finally {
      this.saving = false;
      this.emit();
      window.setTimeout(() => {
        if (this.status === "Saved") {
          this.status = "";
          this.emit();
        }
      }, 2500);
    }
  }

  async saveTo(path: string): Promise<boolean> {
    try {
      window.clearTimeout(this.updateTimer);
      this.changedSinceUpdate = false;
      const info = await docsApi.saveAs(this.id, path, this.snapshot());
      this.setInfo(info);
      return true;
    } catch (e) {
      this.host.error(String(e));
      return false;
    }
  }

  async exportTo(path: string): Promise<void> {
    await docsApi.exportCopy(this.id, path, this.snapshot());
  }

  /** Whether the document uses anything plain text can't keep. */
  hasFormatting(): boolean {
    let found = false;
    this.state.doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === "table" || node.type.name === "image") found = true;
      else if (node.isText && node.marks.length) found = true;
      else if (node.type.name === "paragraph" && (node.attrs.style || node.attrs.numPr || node.attrs.jc)) found = true;
      return !found;
    });
    return found;
  }

  // ------------------------------------------------------------------
  // View state
  // ------------------------------------------------------------------

  setPages(pages: PageInfo[], notes: NoteLayout = NO_NOTES) {
    const same = pages.length === this.pages.length && pages.every((p, i) => p.from === this.pages[i].from);
    const sameNotes = notes === this.noteLayout || JSON.stringify(notes) === JSON.stringify(this.noteLayout);
    if (same && sameNotes) return;
    this.pages = pages;
    this.noteLayout = notes;
    this.emit();
  }

  // ------------------------------------------------------------------
  // Page bands: headers, footers and notes
  // ------------------------------------------------------------------

  /** Top and bottom margins of a page's text: a taller header or footer pushes it, like Word. */
  pageBand(page: number, section: number, firstOfSection: boolean): { top: number; bottom: number } {
    const g = geometryOf(this.state.doc);
    const sections = this.sections();
    const sec = sections[Math.min(section, sections.length - 1)];
    const type: HfType = firstOfSection && sec?.titlePg ? "first" : this.state.doc.attrs.evenOdd === true && (page + 1) % 2 === 0 ? "even" : "default";
    const header = this.hfHeights[`header:${resolveStory(sections, section, "header", type).ref}`] ?? 0;
    const footer = this.hfHeights[`footer:${resolveStory(sections, section, "footer", type).ref}`] ?? 0;
    return { top: Math.max(g.top, g.header + header), bottom: Math.max(g.bottom, g.footer + footer) };
  }

  /** The document's sections (headers, footers, numbering of each). */
  sections(): SectionInfo[] {
    const c = this.sectionsCache;
    if (c && c.doc === this.state.doc && c.tick === this.hfTick) return c.list;
    const list = sectionsOf(this.state.doc, this.headers, this.footers);
    this.sectionsCache = { doc: this.state.doc, tick: this.hfTick, list };
    return list;
  }

  /** A header or footer by its reference ("final:first" or a section's relationship id). */
  storyDoc(kind: StoryKind, ref: string | null): PMNode | null {
    if (!ref) return null;
    if (ref.startsWith("final:")) return (kind === "header" ? this.headers : this.footers)[ref.slice(6)] ?? null;
    return this.stories[ref] ?? null;
  }

  /** A header or footer edited in place; a section without one gets its own. */
  storyChanged(edit: HeaderFooterEdit, doc: PMNode) {
    if (edit.ref?.startsWith("final:")) {
      this.headerChanged(edit.kind, edit.ref.slice(6), doc);
      return;
    }
    const sections = this.sections();
    if (!edit.ref && edit.section >= sections.length - 1) {
      // The last section's own new header or footer
      edit.ref = `final:${edit.type}`;
      this.headerChanged(edit.kind, edit.type, doc);
      return;
    }
    if (!edit.ref) {
      // A new one for this section: referenced from its section break
      const sec = sections[edit.section];
      const node = sec?.pos != null ? this.state.doc.nodeAt(sec.pos) : null;
      if (!node || !this.view) return;
      let n = 1;
      while (this.stories[`rIdDocs${edit.kind === "header" ? "H" : "F"}${n}`]) n++;
      const rid = `rIdDocs${edit.kind === "header" ? "H" : "F"}${n}`;
      this.storyKinds[rid] = edit.kind;
      this.stories[rid] = doc;
      edit.ref = rid;
      this.dispatch(this.state.tr.setNodeMarkup(sec.pos!, undefined, { ...node.attrs, sect: addStoryRef(String(node.attrs.sect), edit.kind, edit.type, rid) }));
    }
    this.stories[edit.ref] = doc;
    this.storyKinds[edit.ref] ??= edit.kind;
    this.storiesChanged.add(edit.ref);
    this.hfTick++;
    this.onDocChanged(this.state.tr);
    if (this.view) paginators.get(this.view)?.invalidate();
    this.emit();
  }

  /** Heights of the headers and footers as drawn; a change lays the pages out again. */
  setHfHeights(heights: Record<string, number>) {
    const keys = new Set([...Object.keys(heights), ...Object.keys(this.hfHeights)]);
    let changed = false;
    for (const k of keys) if (Math.abs((heights[k] ?? 0) - (this.hfHeights[k] ?? 0)) > 0.5) changed = true;
    if (!changed) return;
    this.hfHeights = { ...heights };
    if (this.view) paginators.get(this.view)?.invalidate();
  }

  /** Height of a note as drawn at the bottom of a page (unzoomed px). */
  noteHeight(kind: NoteKind, id: string): number {
    const doc = this.notes[kind][id];
    const host = this.measureHost;
    if (!doc || !host || !host.isConnected) return 0;
    // A new page width (or text styles) changes every height
    if (host.clientWidth !== this.measuredWidth) {
      this.noteHeights = new WeakMap();
      this.measuredWidth = host.clientWidth;
    }
    const cached = this.noteHeights.get(doc);
    if (cached != null) return cached;
    const el = document.createElement("div");
    el.className = "pm-doc note-body";
    host.appendChild(el);
    renderNote(el, doc, "8", this.sheet, Number(this.payload.settings?.defaultTabStop ?? 720) || 720);
    const h = el.getBoundingClientRect().height;
    el.remove();
    this.noteHeights.set(doc, h);
    return h;
  }

  /** The number of a note as shown (1, 2… / i, ii…), from its reference in the text. */
  noteNumber(kind: NoteKind, id: string): number | null {
    return formattingKey.getState(this.state)?.notes.get(`${kind}:${id}`) ?? null;
  }

  /** A note changed in its editor. */
  noteChanged(kind: NoteKind, id: string, doc: PMNode) {
    this.notes[kind][id] = doc;
    this.notesChanged.add(`${kind}:${id}`);
    this.onDocChanged(this.state.tr);
    if (this.view) paginators.get(this.view)?.invalidate();
    this.emit();
  }

  /** References > Insert Footnote / Insert Endnote: a numbered note, with the cursor in it. */
  insertNote(kind: NoteKind) {
    const view = this.view;
    if (!view) return;
    this.headerEdit = null;
    this.noteEdit = null;
    const used = new Set<number>();
    for (const id of [...Object.keys(this.notes[kind]), ...Object.keys((kind === "footnote" ? this.payload.footnotes : this.payload.endnotes) ?? {}), ...referencedNotes(this.state.doc)[kind]]) {
      const n = Number(id);
      if (Number.isFinite(n)) used.add(n);
    }
    const id = String(Math.max(0, ...used) + 1);
    this.notes[kind][id] = newNote(kind, this.sheet);
    this.notesChanged.add(`${kind}:${id}`);
    const at = view.state.selection.to;
    this.dispatch(view.state.tr.insert(at, noteReference(kind, id)).scrollIntoView());
    this.noteEdit = { kind, id };
    this.emit();
  }

  /** Edits a note in place (double-clicking its reference, Show Notes). */
  openNote(kind: NoteKind, id: string) {
    if (!this.notes[kind][id]) return;
    this.headerEdit = null;
    this.noteEdit = { kind, id };
    this.emit();
  }

  closeNote() {
    if (!this.noteEdit) return;
    this.noteEdit = null;
    // Reference tooltips show the note's new text
    if (this.view) this.view.dispatch(this.view.state.tr.setMeta(formattingKey, true).setMeta("addToHistory", false));
    this.emit();
    this.view?.focus();
  }

  /** References > Next Footnote: moves to the next (or previous) reference mark. */
  nextNote(kind: NoteKind, dir: 1 | -1) {
    const view = this.view;
    if (!view) return;
    this.closeNote();
    const marks: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "opaque_inline" && node.attrs.kind === kind) marks.push(pos);
      return !node.isTextblock || node.childCount > 0;
    });
    const head = view.state.selection.head;
    const target = dir > 0 ? marks.find((p) => p >= head) : [...marks].reverse().find((p) => p + 1 < head);
    if (target == null) {
      this.status = `No more ${kind}s`;
      this.emit();
      return;
    }
    this.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target + 1)).scrollIntoView());
    view.focus();
  }

  /** References > Show Notes: the notes of the reference at (or after) the cursor. */
  showNotes() {
    const referenced = referencedNotes(this.state.doc);
    const head = this.state.selection.head;
    let found: { kind: NoteKind; id: string } | null = null;
    this.state.doc.nodesBetween(head, this.state.doc.content.size, (node) => {
      if (found) return false;
      if (node.type.name === "opaque_inline" && (node.attrs.kind === "footnote" || node.attrs.kind === "endnote")) found = { kind: node.attrs.kind, id: String(node.attrs.noteId) };
      return true;
    });
    const pick = found ?? (referenced.footnote.length ? { kind: "footnote" as NoteKind, id: referenced.footnote[0] } : referenced.endnote.length ? { kind: "endnote" as NoteKind, id: referenced.endnote[0] } : null);
    if (!pick) {
      this.status = "This document has no footnotes or endnotes";
      this.emit();
      return;
    }
    this.openNote(pick.kind, pick.id);
  }

  /** The page (0-based) the cursor is on. */
  get currentPage(): number {
    const head = this.state.selection.head;
    let page = 0;
    for (const p of this.pages) if (p.from <= head) page = p.index;
    return page;
  }

  saveViewPrefs() {
    try {
      localStorage.setItem("docs.view", JSON.stringify({ zoom: this.zoom, ruler: this.ruler, navPane: this.navPane, showMarks: this.showMarks }));
    } catch {
      /* ignore */
    }
  }

  setZoom(z: number) {
    this.zoom = Math.max(0.1, Math.min(5, Math.round(z * 100) / 100));
    this.saveViewPrefs();
    this.emit();
    requestAnimationFrame(() => this.relayout());
  }

  setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.emit();
    requestAnimationFrame(() => this.relayout());
  }

  toggle(flag: "showMarks" | "ruler" | "navPane" | "ribbonCollapsed") {
    this[flag] = !this[flag];
    this.saveViewPrefs();
    this.emit();
    if (flag === "showMarks") requestAnimationFrame(() => this.relayout());
  }

  relayout() {
    if (!this.view) return;
    paginators.get(this.view)?.invalidate();
    tabLayouts.get(this.view)?.relayout();
  }

  openDialog(kind: string, props?: Record<string, unknown>) {
    this.dialog = { kind, props };
    this.emit();
  }

  closeDialog() {
    this.dialog = null;
    this.emit();
    this.focus();
  }

  // ------------------------------------------------------------------
  // Undo
  // ------------------------------------------------------------------

  get canUndo() {
    return this.view ? undoDepth(this.view.state) > 0 : false;
  }

  get canRedo() {
    return this.view ? redoDepth(this.view.state) > 0 : false;
  }

  undo() {
    if (this.headerEditor) undo(this.headerEditor.state, this.headerEditor.dispatch);
    else this.run(undo);
  }

  redo() {
    if (this.headerEditor) redo(this.headerEditor.state, this.headerEditor.dispatch);
    else this.run(redo);
  }

  // ------------------------------------------------------------------
  // Font
  // ------------------------------------------------------------------

  /** Toggles bold, italic, strikethrough, caps… against what is in effect. */
  toggleOn(type: "bold" | "italic" | "strike" | "dstrike" | "caps" | "smallCaps" | "hidden") {
    const current = this.format[type as keyof FormatState] as boolean;
    this.apply((state, dispatch) => {
      const fromStyle = this.styleProvides(state, type);
      const target = !current;
      setMark(state, dispatch, type, target === fromStyle ? null : { on: target });
    });
  }

  /** Whether the paragraph style alone makes the text bold (italic…). */
  private styleProvides(state: EditorState, type: string): boolean {
    const para = state.selection.$from.parent;
    const r = this.sheet.paragraph((para.attrs.style as string) ?? null).rPr[type];
    return !!r && r.on !== false;
  }

  setFont(name: string) {
    const n = name.trim();
    if (!n) return;
    this.apply((state, dispatch) => setMark(state, dispatch, "font", { ascii: n, hAnsi: n, cs: n, eastAsia: n }));
  }

  setSize(pt: number) {
    if (!Number.isFinite(pt) || pt < 1 || pt > 1638) return;
    const half = String(Math.round(pt * 2));
    this.apply((state, dispatch) => setMark(state, dispatch, "size", { val: half, cs: half }));
  }

  /** Grow Font / Shrink Font: the next standard size (step 1pt with Ctrl+]/[). */
  growFont(dir: 1 | -1, step: "list" | "point" = "list") {
    const base = (this.format.size ?? 11) * 2;
    this.apply((state, dispatch) =>
      mapMarks(state, dispatch, "size", (cur) => {
        const pt = (num(cur?.val) ?? base) / 2;
        let next: number;
        if (step === "point") next = pt + dir;
        else if (dir > 0) next = SIZES.find((s) => s > pt) ?? Math.ceil((pt + 10) / 10) * 10;
        else next = [...SIZES].reverse().find((s) => s < pt) ?? Math.max(1, pt - 1);
        next = Math.max(1, Math.min(1638, next));
        const half = String(Math.round(next * 2));
        return { val: half, cs: half };
      }),
    );
  }

  setUnderline(val: string | null) {
    this.apply((state, dispatch) => setMark(state, dispatch, "underline", val ? { val } : null));
  }

  toggleUnderline() {
    this.setUnderline(this.format.underline ? null : "single");
  }

  setColor(hex: string | null) {
    this.apply((state, dispatch) => setMark(state, dispatch, "color", hex ? { val: hex.replace("#", "").toUpperCase() } : null));
  }

  setHighlight(name: string | null) {
    this.apply((state, dispatch) => setMark(state, dispatch, "highlight", name ? { val: name } : null));
  }

  setShading(hex: string | null) {
    this.apply((state, dispatch) => setMark(state, dispatch, "shading", hex ? { val: "clear", color: "auto", fill: hex.replace("#", "").toUpperCase() } : null));
  }

  setVert(val: "superscript" | "subscript") {
    const on = val === "superscript" ? this.format.sup : this.format.sub;
    this.apply((state, dispatch) => setMark(state, dispatch, "vert", on ? null : { val }));
  }

  setCharSpacing(pt: number | null) {
    this.apply((state, dispatch) => setMark(state, dispatch, "charSpacing", pt ? { val: String(Math.round(pt * 20)) } : null));
  }

  clearFormatting() {
    this.apply((state, dispatch) => {
      const tr = state.tr;
      for (const r of state.selection.ranges) {
        for (const t of FORMAT_MARKS) tr.removeMark(r.$from.pos, r.$to.pos, schema.marks[t]);
      }
      tr.setStoredMarks([]);
      for (const { node, pos } of selectedParagraphs(state)) {
        const a = { ...node.attrs } as Attrs;
        const keep = { numPr: a.numPr, sect: a.sect, sdt: a.sdt, extra: a.extra };
        const fresh: Attrs = {};
        for (const k of Object.keys(a)) fresh[k] = null;
        tr.setNodeMarkup(pos, undefined, { ...fresh, ...keep }, node.marks);
      }
      dispatch(tr);
    });
  }

  changeCase(kind: CaseKind | "cycle") {
    this.apply((state, dispatch) => {
      let k = kind;
      if (k === "cycle") {
        const text = state.selection.empty ? "" : state.doc.textBetween(state.selection.from, state.selection.to);
        k = nextCase(text || "a");
      }
      applyCase(state, dispatch, k as CaseKind);
    });
  }

  // ------------------------------------------------------------------
  // Paragraph
  // ------------------------------------------------------------------

  setStyle(id: string) {
    const def = this.sheet.get(id);
    if (!def) return;
    if (def.type === "character") {
      this.apply((state, dispatch) => setMark(state, dispatch, "cstyle", id === this.sheet.defaultCharacter ? null : { id }));
      return;
    }
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a) => {
        a.style = id === this.sheet.defaultParagraph ? null : id;
        // Headings and titles don't keep a list from the previous style
        if (/^Heading|^Title|^Subtitle/.test(id) && a.numPr && !this.sheet.paragraph(id).pPr.numPr) a.numPr = null;
        return a;
      }),
    );
  }

  setAlign(jc: "left" | "center" | "right" | "both") {
    this.apply((state, dispatch) => updateParagraphs(state, dispatch, (a) => ({ ...a, jc: jc === "left" ? null : jc })));
  }

  /** Line spacing as a multiple ("1.15") or exact / at least in points. */
  setLineSpacing(multiple: number | null, rule: "auto" | "exact" | "atLeast" = "auto", pt?: number) {
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a) => {
        const line = multiple != null ? String(Math.round(multiple * 240)) : pt != null ? String(Math.round(pt * 20)) : null;
        a.spacing = mergeMap(a.spacing, { line, lineRule: line ? rule : null });
        return a;
      }),
    );
  }

  /** Space before/after in points (null removes the direct value). */
  setSpacing(before: number | null | undefined, after: number | null | undefined) {
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a) => {
        const patch: Attrs = {};
        if (before !== undefined) {
          patch.before = before == null ? null : String(Math.round(before * 20));
          patch.beforeAutospacing = null;
        }
        if (after !== undefined) {
          patch.after = after == null ? null : String(Math.round(after * 20));
          patch.afterAutospacing = null;
        }
        a.spacing = mergeMap(a.spacing, patch);
        return a;
      }),
    );
  }

  /** "Add/Remove Space Before/After Paragraph" (12pt), like Word. */
  toggleSpace(which: "before" | "after") {
    const has = which === "before" ? this.format.spaceBefore > 0 : this.format.spaceAfter > 0;
    if (which === "before") this.setSpacing(has ? 0 : 12, undefined);
    else this.setSpacing(undefined, has ? 0 : 12);
  }

  /** Indent in twips: left, right, first line (negative = hanging). */
  setIndent(patch: { left?: number | null; right?: number | null; first?: number | null }) {
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a) => {
        const p: Attrs = {};
        if (patch.left !== undefined) {
          p.left = patch.left == null ? null : String(Math.round(patch.left));
          p.start = null;
        }
        if (patch.right !== undefined) {
          p.right = patch.right == null ? null : String(Math.round(patch.right));
          p.end = null;
        }
        if (patch.first !== undefined) {
          if (patch.first == null) {
            p.firstLine = null;
            p.hanging = null;
          } else if (patch.first < 0) {
            p.hanging = String(Math.round(-patch.first));
            p.firstLine = null;
          } else {
            p.firstLine = String(Math.round(patch.first));
            p.hanging = null;
          }
        }
        a.ind = mergeMap(a.ind, p);
        return a;
      }),
    );
  }

  /** Increase / Decrease Indent: list level for lists, else 0.5". */
  indent(dir: 1 | -1) {
    const v = this.active;
    if (!v) return;
    if (this.format.list && this.lists.shiftLevel(v.state, (tr) => v.dispatch(tr), dir)) return;
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a, node) => {
        const r = this.sheet.paragraph((node.attrs.style as string) ?? null, a).pPr.ind as Attrs | undefined;
        const left = twips(r?.left ?? r?.start) ?? 0;
        const next = Math.max(0, Math.round((left + dir * 720) / 720) * 720);
        a.ind = mergeMap(a.ind, { left: String(next), start: null });
        return a;
      }),
    );
  }

  setShadingPara(hex: string | null) {
    this.apply((state, dispatch) => updateParagraphs(state, dispatch, (a) => ({ ...a, shd: hex ? { val: "clear", color: "auto", fill: hex.replace("#", "").toUpperCase() } : null })));
  }

  /** Paragraph borders: "bottom", "top", "left", "right", "all", "outside", "none". */
  setBorders(which: string, line: { val: string; sz: number; color: string } = { val: "single", sz: 4, color: "auto" }) {
    const b = { val: line.val, sz: String(line.sz), space: "1", color: line.color };
    this.apply((state, dispatch) =>
      updateParagraphs(state, dispatch, (a) => {
        const cur = { ...((a.pBdr as Attrs) ?? {}) };
        switch (which) {
          case "none":
            return { ...a, pBdr: null };
          case "all":
            return { ...a, pBdr: { top: b, left: b, bottom: b, right: b, between: b } };
          case "outside":
            return { ...a, pBdr: { top: b, left: b, bottom: b, right: b } };
          case "inside":
            cur.between = b;
            return { ...a, pBdr: cur };
          default:
            if (cur[which]) delete cur[which];
            else cur[which] = b;
            return { ...a, pBdr: Object.keys(cur).length ? cur : null };
        }
      }),
    );
  }

  setParagraphFlag(flag: "keepNext" | "keepLines" | "pageBreakBefore" | "widowControl" | "contextualSpacing", on: boolean | null) {
    this.apply((state, dispatch) => updateParagraphs(state, dispatch, (a) => ({ ...a, [flag]: on })));
  }

  setParagraphAttrs(patch: Attrs) {
    this.apply((state, dispatch) => updateParagraphs(state, dispatch, (a) => ({ ...a, ...patch })));
  }

  setTabs(tabs: Attrs[] | null) {
    this.apply((state, dispatch) => updateParagraphs(state, dispatch, (a) => ({ ...a, tabs: tabs && tabs.length ? tabs : null })));
  }

  sortParagraphs(descending: boolean, numeric: boolean) {
    this.apply((state, dispatch) => sortParagraphs(state, dispatch, descending, numeric));
  }

  // ------------------------------------------------------------------
  // Lists
  // ------------------------------------------------------------------

  toggleList(format: ListFormat | string, force = false) {
    const f = typeof format === "string" ? findFormat(format) : format;
    if (!f) return;
    const v = this.active;
    if (!v) return;
    this.lists.toggle(v.state, (tr) => v.dispatch(tr.setMeta(formattingKey, true)), f, force);
    v.focus();
  }

  bullets() {
    this.toggleList(BULLET_FORMATS[0]);
  }

  numbering() {
    this.toggleList(NUMBER_FORMATS[0]);
  }

  restartNumbering() {
    const v = this.active;
    if (!v) return;
    this.lists.restart(v.state, (tr) => v.dispatch(tr.setMeta(formattingKey, true)));
  }

  // ------------------------------------------------------------------
  // Format Painter
  // ------------------------------------------------------------------

  startPainter(sticky: boolean) {
    if (this.painter) {
      this.painter = null;
      this.emit();
      return;
    }
    const state = this.state;
    const para = state.selection.$from.parent;
    this.painter = { marks: marksAt(state).filter((m) => FORMAT_MARKS.includes(m.type.name)), para: { ...para.attrs }, sticky };
    this.emit();
  }

  private paint() {
    const p = this.painter;
    if (!p || !this.view) return;
    const state = this.view.state;
    if (state.selection.empty) return;
    const tr = state.tr;
    for (const r of state.selection.ranges) {
      for (const t of FORMAT_MARKS) tr.removeMark(r.$from.pos, r.$to.pos, schema.marks[t]);
      for (const m of p.marks) tr.addMark(r.$from.pos, r.$to.pos, m);
    }
    // A whole paragraph selected: its paragraph formatting too
    for (const { node, pos } of selectedParagraphs(state)) {
      const from = pos + 1;
      const to = pos + node.nodeSize - 1;
      if (state.selection.from <= from && state.selection.to >= to) {
        const { numPr, sect, sdt, extra, ...rest } = p.para;
        void numPr;
        void sect;
        void sdt;
        void extra;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...rest }, node.marks);
      }
    }
    this.dispatch(tr);
    if (!p.sticky) this.painter = null;
    this.emit();
  }

  // ------------------------------------------------------------------
  // Insert
  // ------------------------------------------------------------------

  insertText(text: string) {
    this.apply((state, dispatch) => {
      if (this.trackChanges && this.view) {
        trackedTextInput(this.active!, state.selection.from, state.selection.to, text, this.reviewer);
        return;
      }
      const marks = state.storedMarks ?? state.selection.$from.marks();
      dispatch(state.tr.replaceSelectionWith(schema.text(text, marks), true).scrollIntoView());
    });
  }

  insertNode(node: PMNode) {
    this.apply((state, dispatch) => dispatch(state.tr.replaceSelectionWith(node, true).scrollIntoView()));
  }

  /** Ctrl+Enter: ends the page here. */
  pageBreak() {
    this.apply((state, dispatch) => {
      const tr = state.tr;
      if (!state.selection.empty) tr.deleteSelection();
      const pos = tr.selection.from;
      const $pos = tr.doc.resolve(pos);
      if (!$pos.parent.isTextblock) return;
      tr.split(pos);
      tr.insert(pos, schema.nodes.hard_break.create({ type: "page" }));
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pos, 1) + 2));
      dispatch(tr.scrollIntoView());
    });
  }

  /** Insert > Cover Page: a designed first page (title, subtitle, author, date) before the document. */
  insertCoverPage(design: "banded" | "simple" | "bold") {
    const view = this.view;
    if (!view) return;
    this.headerEdit = null;
    this.noteEdit = null;
    const title = this.coreEdits.title || this.payload.core?.title || (this.info.path ? this.info.title : "[Document title]");
    const author = this.host.author() || "Author";
    const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const style = (id: string) => (this.sheet.get(id) ? id : null);
    const P = (attrs: Attrs, text: string, marks: Mark[] = []) => schema.nodes.paragraph.create(attrs, text ? schema.text(text, marks) : undefined);
    const m = (type: string, attrs: Attrs = {}) => schema.marks[type].create(attrs);
    const accent = "1F3864";
    const white = m("color", { val: "FFFFFF" });
    const sp = (before: number, after = 0) => ({ before: String(before), after: String(after) });
    let nodes: PMNode[];
    if (design === "banded") {
      nodes = [
        P({ spacing: sp(2400, 0), shd: { val: "clear", color: "auto", fill: accent }, ind: { left: "-360", right: "-360" } }, title, [m("size", { val: "64", cs: "64" }), m("bold"), white]),
        P({ spacing: sp(0, 2400), shd: { val: "clear", color: "auto", fill: accent }, ind: { left: "-360", right: "-360" } }, "[Document subtitle]", [m("size", { val: "32", cs: "32" }), white]),
        P({ spacing: sp(0, 60) }, author, [m("size", { val: "28", cs: "28" }), m("color", { val: accent })]),
        P({ spacing: sp(0, 60) }, date, [m("size", { val: "24", cs: "24" })]),
      ];
    } else if (design === "bold") {
      nodes = [
        P({ spacing: sp(1800, 0), pBdr: { left: { val: "single", sz: "48", space: "12", color: accent } }, ind: { left: "360" } }, title, [m("size", { val: "80", cs: "80" }), m("bold"), m("color", { val: accent })]),
        P({ spacing: sp(120, 2400), pBdr: { left: { val: "single", sz: "48", space: "12", color: accent } }, ind: { left: "360" } }, "[Document subtitle]", [m("size", { val: "32", cs: "32" })]),
        P({ spacing: sp(0, 60), jc: "right" }, author, [m("size", { val: "24", cs: "24" }), m("bold")]),
        P({ spacing: sp(0, 60), jc: "right" }, date, [m("size", { val: "24", cs: "24" })]),
      ];
    } else {
      nodes = [
        P({ style: style("Title"), jc: "center", spacing: sp(3600, 240) }, title),
        P({ style: style("Subtitle"), jc: "center" }, "[Document subtitle]"),
        P({ jc: "center", spacing: sp(2400, 60) }, author, [m("size", { val: "28", cs: "28" })]),
        P({ jc: "center" }, date),
      ];
    }
    nodes.push(schema.nodes.paragraph.create(null, schema.nodes.hard_break.create({ type: "page" })));
    const tr = view.state.tr.insert(0, nodes);
    tr.setSelection(TextSelection.create(tr.doc, 1));
    this.dispatch(tr.scrollIntoView());
    view.focus();
  }

  lineBreak() {
    this.apply((state, dispatch) => dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create({ type: "line" })).scrollIntoView()));
  }

  columnBreak() {
    this.apply((state, dispatch) => dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create({ type: "column" })).scrollIntoView()));
  }

  /** Section break: the paragraph at the cursor ends a section. */
  sectionBreak(type: "nextPage" | "continuous" | "evenPage" | "oddPage") {
    const page = (this.state.doc.attrs.page as Attrs | null) ?? {};
    const sz = (page.pgSz as Attrs | null) ?? { w: "12240", h: "15840" };
    const mar = (page.pgMar as Attrs | null) ?? {};
    const attrsXml = (o: Attrs) =>
      Object.entries(o)
        .filter(([, v]) => v != null)
        .map(([k, v]) => ` w:${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join("");
    const sect = `<w:sectPr>${type !== "nextPage" ? `<w:type w:val="${type}"/>` : ""}<w:pgSz${attrsXml(sz)}/><w:pgMar${attrsXml(mar)}/><w:cols w:space="720"/></w:sectPr>`;
    this.apply((state, dispatch) => {
      const tr = state.tr;
      const pos = state.selection.from;
      const $pos = state.doc.resolve(pos);
      if (!$pos.parent.isTextblock) return;
      tr.split(pos);
      const paraPos = $pos.before();
      const para = tr.doc.nodeAt(paraPos);
      if (para) tr.setNodeMarkup(paraPos, undefined, { ...para.attrs, sect }, para.marks);
      dispatch(tr.scrollIntoView());
    });
  }

  insertTable(rows: number, cols: number, style = "TableGrid") {
    const textWidth = this.textWidthTw();
    const colTw = Math.floor(textWidth / cols);
    const cell = () =>
      schema.nodes.table_cell.create({ colwidth: [Math.round((colTw / 15) * 1000) / 1000], tcW: { w: String(colTw), type: "dxa" } }, schema.nodes.paragraph.create({ spacing: null }));
    const rowsArr = Array.from({ length: rows }, () => schema.nodes.table_row.create(null, Array.from({ length: cols }, cell)));
    const table = schema.nodes.table.create(
      {
        style,
        tblW: { w: "0", type: "auto" },
        tblLook: { val: "04A0", firstRow: "1", lastRow: "0", firstColumn: "1", lastColumn: "0", noHBand: "0", noVBand: "1" },
        grid: Array.from({ length: cols }, () => colTw),
      },
      rowsArr,
    );
    this.apply((state, dispatch) => {
      const tr = state.tr;
      const $from = state.selection.$from;
      // Insert after the paragraph (or replace it when empty)
      let at: number;
      if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
        at = $from.before();
        tr.replaceWith(at, at + $from.parent.nodeSize, [table, schema.nodes.paragraph.create()]);
      } else {
        at = $from.after();
        tr.insert(at, [table, schema.nodes.paragraph.create()]);
      }
      tr.setSelection(TextSelection.create(tr.doc, at + 4));
      dispatch(tr.scrollIntoView());
    });
    this.ensureStyle(style);
  }

  /** The width of the text column in twips. */
  textWidthTw(): number {
    const g = geometryOf(this.state.doc);
    return Math.round((g.pageW - g.left - g.right) * 15);
  }

  /** Built-in styles used for the first time are added when saving. */
  ensureStyle(id: string) {
    void id;
  }

  tableCommand(name: "rowBefore" | "rowAfter" | "colBefore" | "colAfter" | "deleteRow" | "deleteCol" | "deleteTable" | "merge" | "split" | "selectTable" | "selectRow" | "selectCol" | "selectCell") {
    const map = {
      rowBefore: addRowBefore,
      rowAfter: addRowAfter,
      colBefore: addColumnBefore,
      colAfter: addColumnAfter,
      deleteRow,
      deleteCol: deleteColumn,
      deleteTable,
      merge: mergeCells,
      split: splitCell,
    } as const;
    if (name in map) {
      this.run(map[name as keyof typeof map]);
      return;
    }
    this.run((state, dispatch) => {
      try {
        const rect = selectedRect(state);
        const tmap: TableMap = rect.map;
        const start = rect.tableStart;
        let anchor: number;
        let head: number;
        if (name === "selectTable") {
          anchor = start + tmap.map[0];
          head = start + tmap.map[tmap.map.length - 1];
        } else if (name === "selectRow") {
          anchor = start + tmap.map[rect.top * tmap.width];
          head = start + tmap.map[rect.top * tmap.width + tmap.width - 1];
        } else if (name === "selectCol") {
          anchor = start + tmap.map[rect.left];
          head = start + tmap.map[(tmap.height - 1) * tmap.width + rect.left];
        } else {
          anchor = head = start + tmap.map[rect.top * tmap.width + rect.left];
        }
        dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, anchor, head)));
        return true;
      } catch {
        return false;
      }
    });
  }

  setTableStyle(id: string) {
    this.run((state, dispatch) => {
      const $from = state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "table") {
          dispatch?.(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, style: id }).setMeta(formattingKey, true));
          return true;
        }
      }
      return false;
    });
  }

  setCellShading(hex: string | null) {
    this.run((state, dispatch) => {
      const tr = state.tr;
      const sel = state.selection;
      const apply = (pos: number, node: PMNode) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, shd: hex ? { val: "clear", color: "auto", fill: hex.replace("#", "").toUpperCase() } : null });
      if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => apply(pos, cell));
      else {
        const $from = sel.$from;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "table_cell") {
            apply($from.before(d), $from.node(d));
            break;
          }
        }
      }
      if (!tr.docChanged) return false;
      dispatch?.(tr);
      return true;
    });
  }

  async insertPictureFile(path: string) {
    try {
      const added = await docsApi.addImage(this.id, path);
      this.insertImage(added);
    } catch (e) {
      this.host.error(String(e));
    }
  }

  /** Picture files dropped on the window: inserted where they were dropped. */
  async dropPictures(paths: string[], left: number, top: number) {
    const view = this.view;
    const at = view?.posAtCoords({ left, top });
    if (view && at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
    for (const p of paths) await this.insertPictureFile(p);
  }

  insertImage(added: { target: string; cx: number; cy: number; name: string }) {
    // Pictures wider than the text column are scaled down to fit
    const maxEmu = (this.textWidthTw() / 15) * EMU_PER_PX;
    let { cx, cy } = added;
    if (cx > maxEmu) {
      cy = Math.round((cy * maxEmu) / cx);
      cx = Math.round(maxEmu);
    }
    const node = schema.nodes.image.create({ target: added.target, cx, cy, name: added.name, alt: "", anchor: false, external: false });
    this.insertNode(node);
  }

  setLink(href: string | null, text?: string) {
    this.apply((state, dispatch) => {
      const tr = state.tr;
      let { from, to } = state.selection;
      const linkType = schema.marks.link;
      // Editing an existing link: its whole range
      if (state.selection.empty) {
        const $pos = state.selection.$from;
        const link = $pos.marks().find((m) => m.type === linkType);
        if (link) {
          let a = $pos.pos;
          let b = $pos.pos;
          while (a > $pos.start() && state.doc.rangeHasMark(a - 1, a, linkType)) a--;
          while (b < $pos.end() && state.doc.rangeHasMark(b, b + 1, linkType)) b++;
          from = a;
          to = b;
        }
      }
      if (text != null && text !== state.doc.textBetween(from, to)) {
        const marks = state.doc.resolve(from).marks().filter((m) => m.type !== linkType);
        tr.replaceWith(from, to, schema.text(text || href || "", marks));
        to = from + (text || href || "").length;
      }
      tr.removeMark(from, to, linkType);
      if (href) {
        const attrs = href.startsWith("#") ? { anchor: href.slice(1), history: "1" } : { href, history: "1" };
        tr.addMark(from, to, linkType.create(attrs));
        if (this.sheet.get("Hyperlink")) tr.addMark(from, to, schema.marks.cstyle.create({ id: "Hyperlink" }));
      } else {
        const cs = schema.marks.cstyle;
        tr.doc.nodesBetween(from, to, (node, pos) => {
          const m = cs.isInSet(node.marks);
          if (m && m.attrs.id === "Hyperlink") tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), cs);
        });
      }
      dispatch(tr);
    });
  }

  insertField(instr: string, result: string) {
    this.apply((state, dispatch) => {
      const marks = state.storedMarks ?? state.selection.$from.marks();
      const nodes = [schema.nodes.field_start.create({ instr, xml: "" }, null, marks), ...(result ? [schema.text(result, marks)] : []), schema.nodes.field_end.create({ xml: "" }, null, marks)];
      dispatch(state.tr.replaceWith(state.selection.from, state.selection.to, Fragment.from(nodes)).scrollIntoView());
    });
  }

  insertDate(format: Intl.DateTimeFormatOptions, asField: boolean) {
    const text = new Date().toLocaleDateString(undefined, format);
    if (asField) this.insertField(`DATE \\@ "${format.month === "long" ? "MMMM d, yyyy" : "M/d/yyyy"}"`, text);
    else this.insertText(text);
  }

  /** References > Table of Contents (or update the existing one). */
  insertToc() {
    this.run((state, dispatch) => {
      const tr = generateToc(state, this.sheet, this.pages, true);
      if (!tr) return false;
      dispatch?.(tr.scrollIntoView());
      return true;
    });
  }

  updateToc() {
    this.run((state, dispatch) => {
      const tr = generateToc(state, this.sheet, this.pages, false);
      if (!tr) {
        this.host.ask("Docs", "There's no table of contents in this document. Use References > Table of Contents to add one.", [{ label: "OK", value: "ok", primary: true }], "infoCircle");
        return false;
      }
      dispatch?.(tr);
      return true;
    });
  }

  /** F9: updates the fields in the selection (dates, page numbers, tables of contents). */
  updateFieldsInSelection() {
    this.run((state, dispatch) => {
      const tr = updateFields(state, this.sheet, this.pages);
      if (!tr) return false;
      dispatch?.(tr);
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Page setup
  // ------------------------------------------------------------------

  setPage(patch: { pgSz?: Attrs; pgMar?: Attrs; cols?: Attrs }) {
    this.run((state, dispatch) => {
      const page = { ...((state.doc.attrs.page as Attrs) ?? {}) };
      if (patch.pgSz) page.pgSz = { ...((page.pgSz as Attrs) ?? {}), ...patch.pgSz };
      if (patch.pgMar) page.pgMar = { ...((page.pgMar as Attrs) ?? {}), ...patch.pgMar };
      if (patch.cols) page.cols = { ...((page.cols as Attrs) ?? {}), ...patch.cols };
      for (const k of ["pgSz", "pgMar", "cols"]) {
        const o = page[k] as Attrs | undefined;
        if (o) for (const [kk, vv] of Object.entries(o)) if (vv == null) delete o[kk];
      }
      dispatch?.(state.tr.setDocAttribute("page", page));
      return true;
    });
    requestAnimationFrame(() => this.relayout());
  }

  // ------------------------------------------------------------------
  // Design: page color, watermark, page borders
  // ------------------------------------------------------------------

  /** Design > Page Color (null: no color). */
  setPageColor(color: string | null) {
    this.run((state, dispatch) => {
      dispatch?.(state.tr.setDocAttribute("background", color ? color.replace(/^#/, "").toUpperCase() : null));
      return true;
    });
  }

  /** The watermark on the page with the cursor. */
  currentWatermark(): Watermark | null {
    return storyWatermark(this.storyDoc("header", this.storyTarget("header", this.currentPage).ref));
  }

  /** Design > Watermark: puts it in every header of the document (null removes it). */
  setWatermark(w: Watermark | null) {
    this.headerEdit = null;
    let n = Math.floor(Math.random() * 50000);
    const style = this.storyStyle("header");
    const targets: { ref: string; doc: PMNode | null }[] = [
      ...Object.entries(this.headers).map(([t, d]) => ({ ref: `final:${t}`, doc: d })),
      ...Object.entries(this.stories).filter(([rid]) => this.storyKinds[rid] === "header").map(([rid, d]) => ({ ref: rid, doc: d })),
    ].filter((t) => t.doc);
    if (!targets.length) {
      if (!w) return;
      targets.push({ ref: "final:default", doc: null });
    }
    for (const t of targets) {
      let doc = t.doc ? (withoutWatermark(t.doc) ?? t.doc) : schema.nodes.doc.create(null, schema.nodes.paragraph.create({ style }));
      if (w) {
        const mark = watermarkNode(w, n++);
        const first = doc.firstChild;
        const rest: PMNode[] = [];
        doc.forEach((c, _o, i) => i > 0 && rest.push(c));
        doc =
          first?.type.name === "paragraph"
            ? schema.nodes.doc.create(doc.attrs, [first.type.create(first.attrs, Fragment.from(mark).append(first.content), first.marks), ...rest])
            : schema.nodes.doc.create(doc.attrs, [schema.nodes.paragraph.create({ style }, mark), ...(first ? [first] : []), ...rest]);
      }
      if (t.ref.startsWith("final:")) this.headerChanged("header", t.ref.slice(6), doc);
      else this.storyChanged({ kind: "header", type: "default", page: 0, ref: t.ref, section: 0 }, doc);
    }
  }

  /** Design > Page Borders (null: none). */
  setPageBorders(borders: Attrs | null) {
    this.run((state, dispatch) => {
      const page = { ...((state.doc.attrs.page as Attrs) ?? {}), pgBorders: borders };
      dispatch?.(state.tr.setDocAttribute("page", page));
      return true;
    });
  }

  setOrientation(landscape: boolean) {
    const sz = (((this.state.doc.attrs.page as Attrs) ?? {}).pgSz as Attrs) ?? { w: "12240", h: "15840" };
    const w = num(sz.w) ?? 12240;
    const h = num(sz.h) ?? 15840;
    const isLandscape = w > h;
    if (isLandscape === landscape) return;
    this.setPage({ pgSz: { w: String(h), h: String(w), orient: landscape ? "landscape" : null } });
  }

  setPageAttr(key: "titlePg" | "evenOdd", value: boolean) {
    this.run((state, dispatch) => {
      dispatch?.(state.tr.setDocAttribute(key, value));
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Find and replace, navigation
  // ------------------------------------------------------------------

  findOptions: FindOptions = DEFAULT_FIND;

  search(query: string, options?: FindOptions) {
    if (!this.view) return;
    if (options) this.findOptions = options;
    setSearch(this.view, query, this.findOptions);
  }

  get findState() {
    return findKey.getState(this.state);
  }

  findNext(dir: 1 | -1 = 1): boolean {
    return this.view ? gotoMatch(this.view, dir) : false;
  }

  replace(replacement: string): boolean {
    return this.view ? replaceOne(this.view, replacement) : false;
  }

  replaceAll(replacement: string): number {
    return this.view ? replaceAll(this.view, replacement) : 0;
  }

  /** Moves the cursor to a position and scrolls it into view. */
  goTo(pos: number) {
    if (!this.view) return;
    const doc = this.view.state.doc;
    const p = Math.max(0, Math.min(pos, doc.content.size));
    const sel = TextSelection.near(doc.resolve(p));
    this.view.dispatch(this.view.state.tr.setSelection(sel).scrollIntoView());
    this.view.focus();
    // Put the target near the top of the window, like Word's navigation
    requestAnimationFrame(() => {
      const coords = this.view?.coordsAtPos(sel.from);
      const scroller = this.view?.dom.closest(".doc-scroll") as HTMLElement | null;
      if (coords && scroller) {
        const r = scroller.getBoundingClientRect();
        scroller.scrollTop += coords.top - r.top - 80;
      }
    });
  }

  goToPage(index: number) {
    const page = this.pages[Math.max(0, Math.min(index, this.pages.length - 1))];
    if (page) this.goTo(page.from + (page.from === 0 ? 1 : 0));
  }

  selectAll() {
    this.run((state, dispatch) => {
      dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Review
  // ------------------------------------------------------------------

  setTracking(on: boolean) {
    this.trackChanges = on;
    this.emit();
  }

  setMarkup(m: Markup) {
    this.markup = m;
    this.emit();
    requestAnimationFrame(() => this.relayout());
  }

  acceptReject(accept: boolean, all: boolean) {
    this.run((state, dispatch) => {
      let from = 0;
      let to = state.doc.content.size;
      if (!all) {
        if (state.selection.empty) {
          const c = nextChange(state, 1);
          if (!c) return false;
          from = c.from;
          to = c.to;
        } else {
          from = state.selection.from;
          to = state.selection.to;
        }
      }
      dispatch?.(resolveChanges(state, from, to, accept));
      if (!all) this.nextChange(1);
      return true;
    });
  }

  nextChange(dir: 1 | -1) {
    const c = nextChange(this.state, dir);
    if (!c || !this.view) return;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, c.from, c.to)).scrollIntoView());
    this.view.focus();
  }

  // ------------------------------------------------------------------
  // Clipboard
  // ------------------------------------------------------------------

  private handlePaste(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    const html = event.clipboardData?.getData("text/html") ?? "";
    if (files.length && !html.includes("<table")) {
      for (const f of files) void this.insertImageFile(f);
      return true;
    }
    const prepared = prepareSlice(slice, this, view.state);
    if (this.trackChanges) return trackedPaste(view, prepared.slice, this.reviewer);
    // Word: a copied paragraph mark brings its paragraph's formatting along,
    // so the first pasted paragraph keeps its style where it lands
    const content = prepared.slice.content;
    const first = prepared.slice.openStart > 0 && content.childCount > 1 && content.firstChild?.type.name === "paragraph" ? content.firstChild : null;
    if (prepared.changed || prepared.tr || first) {
      const tr = prepared.tr ?? view.state.tr;
      const from = tr.selection.from;
      tr.replaceSelection(prepared.slice);
      if (first) {
        const $at = tr.doc.resolve(tr.mapping.map(from, -1));
        for (let d = $at.depth; d > 0; d--) {
          if ($at.node(d).type.name !== "paragraph") continue;
          tr.setNodeMarkup($at.before(d), undefined, { ...first.attrs, sect: $at.node(d).attrs.sect });
          break;
        }
      }
      view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
      void uploadPendingImages(this);
      return true;
    }
    window.setTimeout(() => void uploadPendingImages(this), 0);
    return false;
  }

  private handleDrop(view: EditorView, event: DragEvent): boolean {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return false;
    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.pos)));
    for (const f of files) void this.insertImageFile(f);
    event.preventDefault();
    return true;
  }

  async insertImageFile(file: File) {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    try {
      const added = await docsApi.addImageData(this.id, data, file.name || "image.png");
      this.insertImage(added);
    } catch (e) {
      this.host.error(String(e));
    }
  }

  private handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
    // Ctrl+Click follows a link, like Word
    if (!(event.ctrlKey || event.metaKey)) return false;
    const $pos = view.state.doc.resolve(pos);
    const link = $pos.marks().find((m) => m.type.name === "link") ?? view.state.doc.nodeAt(pos)?.marks.find((m) => m.type.name === "link");
    if (!link) return false;
    const href = link.attrs.href as string | null;
    const anchor = link.attrs.anchor as string | null;
    if (href && /^(https?|mailto):/i.test(href)) {
      import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => {});
      return true;
    }
    if (anchor) {
      const target = this.findBookmark(anchor);
      if (target != null) this.goTo(target);
      return true;
    }
    return false;
  }

  /** The position of a bookmark (bookmarkStart markers carry the name). */
  findBookmark(name: string): number | null {
    let found: number | null = null;
    this.state.doc.descendants((node, pos) => {
      if (found != null) return false;
      if (node.type.name === "opaque_inline" && node.attrs.label === "bookmarkStart" && String(node.attrs.xml).includes(`w:name="${name}"`)) found = pos;
      return true;
    });
    return found;
  }

  /** Selected image node, if any. */
  get selectedImage(): { node: PMNode; pos: number } | null {
    const sel = this.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === "image") return { node: sel.node, pos: sel.from };
    return null;
  }

  setImageAttrs(patch: Attrs) {
    const img = this.selectedImage;
    if (!img) return;
    this.run((state, dispatch) => {
      dispatch?.(state.tr.setNodeMarkup(img.pos, undefined, { ...img.node.attrs, ...patch }));
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Headers and footers
  // ------------------------------------------------------------------

  private factsCache: { pages: PageInfo[]; sections: SectionInfo[]; evenOdd: boolean; list: PageFacts[] } | null = null;

  /** Each page's section, header/footer type and page number. */
  pageFacts(): PageFacts[] {
    const sections = this.sections();
    const evenOdd = this.state.doc.attrs.evenOdd === true;
    const c = this.factsCache;
    if (c && c.pages === this.pages && c.sections === sections && c.evenOdd === evenOdd) return c.list;
    const list = pageFacts(this.pages, sections, evenOdd);
    this.factsCache = { pages: this.pages, sections, evenOdd, list };
    return list;
  }

  /** Which header/footer a page uses. */
  storyType(page: number): "default" | "first" | "even" {
    return this.pageFacts()[page]?.type ?? "default";
  }

  /** The header or footer a page shows, as something to edit. */
  storyTarget(kind: "header" | "footer", page: number): HeaderFooterEdit {
    const facts = this.pageFacts()[page] ?? { section: this.sections().length - 1, type: "default" as HfType };
    const r = resolveStory(this.sections(), facts.section, kind, facts.type);
    return { kind, type: facts.type, page, ref: r.ref, section: r.ref ? r.section : facts.section };
  }

  editStory(kind: "header" | "footer") {
    this.noteEdit = null;
    this.headerEdit = this.storyTarget(kind, this.currentPage);
    this.emit();
  }

  private storyStyle(kind: "header" | "footer"): string | null {
    const id = kind === "header" ? "Header" : "Footer";
    return this.sheet.get(id) ? id : null;
  }

  private fieldNodes(instr: string, result: string): PMNode[] {
    return [schema.nodes.field_start.create({ instr, xml: "" }), schema.text(result), schema.nodes.field_end.create({ xml: "" })];
  }

  /** Header/Footer gallery: Blank, Three Columns, Title, Page Number or Remove. */
  setStory(kind: "header" | "footer", design: "blank" | "three" | "title" | "page" | "remove") {
    const style = this.storyStyle(kind);
    const p = (attrs: Attrs, content: PMNode[] = []) => schema.nodes.paragraph.create({ style, ...attrs }, content);
    let doc: PMNode | null = null;
    switch (design) {
      case "blank":
        doc = schema.nodes.doc.create(null, p({}));
        break;
      case "three":
        doc = schema.nodes.doc.create(null, p({}, [schema.text("[Type here]"), schema.nodes.tab.create(), schema.text("[Type here]"), schema.nodes.tab.create(), schema.text("[Type here]")]));
        break;
      case "title":
        doc = schema.nodes.doc.create(null, p({ jc: "center" }, [schema.text(this.payload.core?.title || this.info.title)]));
        break;
      case "page":
        doc = schema.nodes.doc.create(null, p({ jc: "center" }, this.fieldNodes("PAGE", "1")));
        break;
    }
    const target = this.storyTarget(kind, this.currentPage);
    this.headerEdit = null;
    if (doc) this.storyChanged(target, doc);
    else if (target.ref?.startsWith("final:")) this.headerChanged(kind, target.ref.slice(6), null);
    // Removing another section's header leaves it empty
    else if (target.ref) this.storyChanged(target, schema.nodes.doc.create(null, schema.nodes.paragraph.create({ style: this.storyStyle(kind) })));
    if (doc) this.editStory(kind);
  }

  insertPageNumber(kind: "header" | "footer", align: "left" | "center" | "right", ofTotal = false) {
    const style = this.storyStyle(kind);
    const content = ofTotal
      ? [schema.text("Page "), ...this.fieldNodes("PAGE", "1"), schema.text(" of "), ...this.fieldNodes("NUMPAGES", String(this.pages.length))]
      : this.fieldNodes("PAGE", "1");
    const para = schema.nodes.paragraph.create({ style, jc: align === "left" ? null : align }, content);
    const target = this.storyTarget(kind, this.currentPage);
    const existing = this.storyDoc(kind, target.ref);
    // Keep the story's other paragraphs; replace an earlier page number
    const kept: PMNode[] = [];
    existing?.forEach((n) => {
      let hasPage = false;
      n.descendants((c) => {
        if (c.type.name === "field_start" && /^\s*(PAGE|NUMPAGES)\b/i.test(String(c.attrs.instr))) hasPage = true;
        return !hasPage;
      });
      if (!hasPage && (n.textContent.trim() || n.type.name !== "paragraph")) kept.push(n);
    });
    const doc = schema.nodes.doc.create(null, kind === "header" ? [para, ...kept] : [...kept, para]);
    this.storyChanged(target, doc);
  }

  removePageNumbers() {
    for (const kind of ["header", "footer"] as const) {
      const stories = kind === "header" ? this.headers : this.footers;
      const all: [string, PMNode | null][] = [
        ...Object.entries(stories).map(([t, d]): [string, PMNode | null] => [`final:${t}`, d]),
        ...Object.entries(this.stories).filter(([rid]) => this.storyKinds[rid] === kind),
      ];
      for (const [ref, doc] of all) {
        if (!doc) continue;
        const kept: PMNode[] = [];
        let changed = false;
        doc.forEach((n) => {
          let hasPage = false;
          n.descendants((c) => {
            if (c.type.name === "field_start" && /^\s*(PAGE|NUMPAGES)\b/i.test(String(c.attrs.instr))) hasPage = true;
            return !hasPage;
          });
          if (hasPage) changed = true;
          else kept.push(n);
        });
        if (!changed) continue;
        const rest = kept.length ? schema.nodes.doc.create(null, kept) : null;
        if (ref.startsWith("final:")) this.headerChanged(kind, ref.slice(6), rest);
        else this.storyChanged({ kind, type: "default", page: 0, ref, section: 0 }, rest ?? schema.nodes.doc.create(null, schema.nodes.paragraph.create({ style: this.storyStyle(kind) })));
      }
    }
  }

  insertFieldInStory(instr: string) {
    const v = this.headerEditor;
    if (!v) {
      this.insertField(instr, String(this.currentPage + 1));
      return;
    }
    const nodes = this.fieldNodes(instr, this.pageFacts()[this.headerEdit?.page ?? 0]?.label ?? "1");
    v.dispatch(v.state.tr.replaceWith(v.state.selection.from, v.state.selection.to, Fragment.from(nodes)));
    v.focus();
  }

  /** Insert > Blank Page: a page break, an empty page, a page break. */
  blankPage() {
    this.apply((state, dispatch) => {
      const tr = state.tr;
      const pos = state.selection.from;
      if (!state.doc.resolve(pos).parent.isTextblock) return;
      const br = () => schema.nodes.paragraph.create(null, schema.nodes.hard_break.create({ type: "page" }));
      tr.split(pos);
      const at = tr.mapping.map(pos, 1);
      tr.insert(at - 1, [br(), br()]);
      dispatch(tr.scrollIntoView());
    });
  }

  removeToc() {
    this.run((state, dispatch) => {
      let start = -1;
      let end = -1;
      state.doc.descendants((node, pos) => {
        if (start < 0 && node.type.name === "field_start" && /^\s*TOC\b/i.test(String(node.attrs.instr))) start = pos;
        else if (start >= 0 && end < 0 && node.type.name === "field_end") end = pos;
        return true;
      });
      if (start < 0 || end < 0) return false;
      let from = state.doc.resolve(start).before(1);
      const to = state.doc.resolve(end).after(1);
      // The "Contents" heading above it
      const $from = state.doc.resolve(from);
      const before = $from.index(0) > 0 ? state.doc.child($from.index(0) - 1) : null;
      if (before && before.attrs.style === "TOCHeading") from -= before.nodeSize;
      dispatch?.(state.tr.delete(from, to));
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Tables
  // ------------------------------------------------------------------

  setCellAttrs(patch: Attrs) {
    this.run((state, dispatch) => {
      const tr = state.tr;
      const sel = state.selection;
      const apply = (pos: number, node: PMNode) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
      if (sel instanceof CellSelection) sel.forEachCell((cell, pos) => apply(pos, cell));
      else {
        const $from = sel.$from;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "table_cell") {
            apply($from.before(d), $from.node(d));
            break;
          }
        }
      }
      if (!tr.docChanged) return false;
      dispatch?.(tr);
      return true;
    });
  }

  /** Repeat the first row of the table at the top of each page. */
  toggleHeaderRow() {
    this.run((state, dispatch) => {
      const $from = state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "table_row") {
          const row = $from.node(d);
          dispatch?.(state.tr.setNodeMarkup($from.before(d), undefined, { ...row.attrs, header: row.attrs.header ? null : true }));
          return true;
        }
      }
      return false;
    });
  }

  // ------------------------------------------------------------------
  // Comments
  // ------------------------------------------------------------------

  toggleComments() {
    this.commentsPane = !this.commentsPane;
    this.emit();
  }

  /** Comment ids in document order with the text they're about. */
  commentList(): { id: string; from: number; to: number; ref: number; quote: string }[] {
    const starts = new Map<string, number>();
    const ends = new Map<string, number>();
    const refs: { id: string; pos: number }[] = [];
    this.state.doc.descendants((node, pos) => {
      if (node.type.name !== "opaque_inline") return true;
      const id = /w:id="([^"]+)"/.exec(String(node.attrs.xml))?.[1] ?? (node.attrs.noteId as string | null) ?? null;
      if (!id) return false;
      if (node.attrs.label === "commentRangeStart") starts.set(id, pos + node.nodeSize);
      else if (node.attrs.label === "commentRangeEnd") ends.set(id, pos);
      else if (node.attrs.kind === "comment") refs.push({ id: String(node.attrs.noteId ?? id), pos });
      return false;
    });
    return refs
      .filter((r) => this.commentEdits[r.id] !== null)
      .map((r) => {
        const from = starts.get(r.id) ?? r.pos;
        const to = ends.get(r.id) ?? r.pos;
        return { id: r.id, from, to, ref: r.pos, quote: this.state.doc.textBetween(Math.min(from, to), Math.max(from, to), " ", " ").slice(0, 120) };
      });
  }

  commentData(id: string): { author: string; initials: string; date: string; text: string } {
    const edit = this.commentEdits[id];
    if (edit) return edit;
    const c = this.payload.comments?.[id];
    return { author: c?.author ?? "", initials: c?.initials ?? "", date: c?.date ?? "", text: c?.text ?? "" };
  }

  newComment() {
    this.apply((state, dispatch) => {
      let { from, to } = state.selection;
      if (from === to) {
        const $p = state.selection.$from;
        const text = $p.parent.textContent;
        let a = $p.parentOffset;
        let b = $p.parentOffset;
        while (a > 0 && /\S/.test(text[a - 1])) a--;
        while (b < text.length && /\S/.test(text[b])) b++;
        from = $p.start() + a;
        to = $p.start() + b;
      }
      const ids = [...Object.keys(this.payload.comments ?? {}), ...Object.keys(this.commentEdits)].map(Number).filter(Number.isFinite);
      let id = (ids.length ? Math.max(...ids) : -1) + 1;
      while (this.findCommentNode(String(id))) id++;
      const sid = String(id);
      const marker = (label: string) => schema.nodes.opaque_inline.create({ xml: `<w:${label} w:id="${sid}"/>`, kind: "marker", label, text: "", hidden: true });
      const ref = schema.nodes.opaque_inline.create({
        xml: `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${sid}"/></w:r>`,
        kind: "comment",
        label: "Comment",
        text: "",
        hidden: false,
        noteId: sid,
      });
      const tr = state.tr;
      tr.insert(to, [marker("commentRangeEnd"), ref]);
      tr.insert(from, marker("commentRangeStart"));
      const author = this.host.author() || "Author";
      const initials = author
        .split(/\s+/)
        .map((w) => w[0] ?? "")
        .join("")
        .slice(0, 3)
        .toUpperCase();
      this.commentEdits[sid] = { author, initials, date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), text: "" };
      this.commentsPane = true;
      this.editingComment = sid;
      dispatch(tr);
    });
  }

  private findCommentNode(id: string): boolean {
    let found = false;
    this.state.doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === "opaque_inline" && (node.attrs.noteId === id || String(node.attrs.xml).includes(`w:id="${id}"`)) && /comment/i.test(String(node.attrs.label) + node.attrs.kind)) found = true;
      return true;
    });
    return found;
  }

  updateComment(id: string, text: string) {
    const cur = this.commentData(id);
    this.commentEdits[id] = { ...cur, text };
    this.editingComment = null;
    this.onDocChanged(this.state.tr);
    this.emit();
  }

  /** Deletes a comment (the one at the cursor when no id is given). */
  deleteComment(id?: string) {
    const list = this.commentList();
    const head = this.state.selection.head;
    const target = id ?? list.find((c) => head >= Math.min(c.from, c.ref) && head <= Math.max(c.to, c.ref) + 1)?.id ?? null;
    if (!target) return;
    this.run((state, dispatch) => {
      const tr = state.tr;
      const remove: [number, number][] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "opaque_inline") return true;
        const nid = (node.attrs.noteId as string | null) ?? /w:id="([^"]+)"/.exec(String(node.attrs.xml))?.[1];
        if (nid === target && (node.attrs.kind === "comment" || /^commentRange/.test(String(node.attrs.label)))) remove.push([pos, pos + node.nodeSize]);
        return false;
      });
      for (let i = remove.length - 1; i >= 0; i--) tr.delete(remove[i][0], remove[i][1]);
      if (!tr.docChanged) return false;
      this.commentEdits[target] = null;
      dispatch?.(tr);
      return true;
    });
  }

  nextComment(dir: 1 | -1) {
    const list = this.commentList();
    if (!list.length) return;
    const head = this.state.selection.head;
    const c = dir > 0 ? (list.find((x) => x.from > head) ?? list[0]) : ([...list].reverse().find((x) => x.to < head) ?? list[list.length - 1]);
    this.commentsPane = true;
    this.goTo(c.from);
    if (this.view && c.to > c.from) this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, c.from, c.to)));
    this.emit();
  }

  // ------------------------------------------------------------------
  // Bookmarks and captions
  // ------------------------------------------------------------------

  private nextBookmarkId(doc: PMNode): number {
    let max = 0;
    doc.descendants((n) => {
      if (n.type.name === "opaque_inline" && /^bookmark/.test(String(n.attrs.label))) {
        const id = Number(/w:id="(\d+)"/.exec(String(n.attrs.xml))?.[1] ?? 0);
        if (id > max) max = id;
      }
      return true;
    });
    return max + 1;
  }

  private bookmarkMarkers(id: number, name: string): [PMNode, PMNode] {
    const esc = name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return [
      schema.nodes.opaque_inline.create({ xml: `<w:bookmarkStart w:id="${id}" w:name="${esc}"/>`, kind: "marker", label: "bookmarkStart", text: "", hidden: true }),
      schema.nodes.opaque_inline.create({ xml: `<w:bookmarkEnd w:id="${id}"/>`, kind: "marker", label: "bookmarkEnd", text: "", hidden: true }),
    ];
  }

  /** Bookmarks the selection (Insert > Bookmark). */
  addBookmark(name: string) {
    if (this.findBookmark(name) != null) this.removeBookmark(name);
    this.run((state, dispatch) => {
      const [start, end] = this.bookmarkMarkers(this.nextBookmarkId(state.doc), name);
      const tr = state.tr;
      tr.insert(state.selection.to, end);
      tr.insert(state.selection.from, start);
      dispatch?.(tr);
      return true;
    });
  }

  removeBookmark(name: string) {
    this.run((state, dispatch) => {
      let id: string | null = null;
      state.doc.descendants((n) => {
        if (id == null && n.type.name === "opaque_inline" && n.attrs.label === "bookmarkStart" && String(n.attrs.xml).includes(`w:name="${name}"`)) id = /w:id="([^"]+)"/.exec(String(n.attrs.xml))?.[1] ?? null;
        return id == null;
      });
      if (id == null) return false;
      const ranges: [number, number][] = [];
      state.doc.descendants((n, pos) => {
        if (n.type.name === "opaque_inline" && /^bookmark(Start|End)$/.test(String(n.attrs.label)) && String(n.attrs.xml).includes(`w:id="${id}"`)) ranges.push([pos, pos + n.nodeSize]);
        return true;
      });
      const tr = state.tr;
      for (let i = ranges.length - 1; i >= 0; i--) tr.delete(ranges[i][0], ranges[i][1]);
      dispatch?.(tr);
      return true;
    });
  }

  /** A bookmark around the heading at `pos` (for links to headings); returns its name. */
  ensureBookmarkAt(pos: number): string {
    const node = this.state.doc.nodeAt(pos);
    let existing: string | null = null;
    node?.forEach((c) => {
      if (!existing && c.type.name === "opaque_inline" && c.attrs.label === "bookmarkStart") existing = /w:name="([^"]+)"/.exec(String(c.attrs.xml))?.[1] ?? null;
    });
    if (existing) return existing;
    const id = this.nextBookmarkId(this.state.doc);
    const name = `_Ref${String(100000000 + id * 7919).slice(-9)}`;
    this.run((state, dispatch) => {
      const n = state.doc.nodeAt(pos);
      if (!n) return false;
      const [start, end] = this.bookmarkMarkers(id, name);
      const tr = state.tr;
      tr.insert(pos + n.nodeSize - 1, end);
      tr.insert(pos + 1, start);
      dispatch?.(tr);
      return true;
    });
    return name;
  }

  /** References > Insert Caption: "Figure 1: text" with a SEQ field. */
  insertCaption(label: string, n: number, text: string, below: boolean) {
    this.run((state, dispatch) => {
      const style = this.sheet.get("Caption") ? "Caption" : null;
      const content: PMNode[] = [schema.text(`${label} `), ...this.fieldNodes(`SEQ ${label} \\* ARABIC`, String(n))];
      if (text) content.push(schema.text(`: ${text}`));
      const para = schema.nodes.paragraph.create({ style }, content);
      const $from = state.selection.$from;
      const depth = Math.max(1, $from.depth > 0 ? 1 : 0);
      const at = below ? $from.after(depth) : $from.before(depth);
      dispatch?.(state.tr.insert(at, para).scrollIntoView());
      return true;
    });
  }
}
