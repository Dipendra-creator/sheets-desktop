// Editing commands behind the ribbon, the dialogs and the keyboard.

import { Fragment, type Mark, type MarkType, type Node as PMNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { schema } from "../model/schema";
import type { StyleSheet } from "../model/styles";
import { fontName } from "../model/render";
import { num } from "../model/units";

type Attrs = Record<string, unknown>;
export type Dispatch = (tr: Transaction) => void;

/** Ranges the formatting applies to (several for a cell selection). */
export function selectionRanges(state: EditorState): { from: number; to: number }[] {
  return state.selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));
}

const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;

/** The word around an empty cursor (Word formats the whole word). */
export function wordAt(state: EditorState): { from: number; to: number } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parent.content.size, "\0", "\0");
  const off = $from.parentOffset;
  const before = text[off - 1];
  const after = text[off];
  if (!before || !after || !WORD_CHAR.test(before) || !WORD_CHAR.test(after)) return null;
  let a = off;
  let b = off;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  const start = $from.start();
  return { from: start + a, to: start + b };
}

/** Sets (attrs) or removes (null) a mark on the selection or the word at the cursor. */
export function setMark(state: EditorState, dispatch: Dispatch, type: string, attrs: Attrs | null, opts: { word?: boolean } = {}) {
  const markType = schema.marks[type];
  const tr = state.tr;
  const word = opts.word !== false ? wordAt(state) : null;
  if (state.selection.empty && !word) {
    let marks = state.storedMarks ?? state.selection.$from.marks();
    marks = markType.removeFromSet(marks);
    if (attrs) marks = markType.create(attrs).addToSet(marks);
    dispatch(tr.setStoredMarks(marks));
    return;
  }
  const ranges = word ? [word] : selectionRanges(state);
  for (const { from, to } of ranges) {
    tr.removeMark(from, to, markType);
    if (attrs) tr.addMark(from, to, markType.create(attrs));
  }
  dispatch(tr.scrollIntoView());
}

/** Applies a function to every mark of a type in the selection (grow font…). */
export function mapMarks(state: EditorState, dispatch: Dispatch, type: string, fn: (current: Attrs | null, node: PMNode, pos: number) => Attrs | null) {
  const markType = schema.marks[type];
  const word = wordAt(state);
  if (state.selection.empty && !word) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const cur = markType.isInSet(marks);
    const next = fn(cur ? (cur.attrs as Attrs) : null, state.selection.$from.parent, state.selection.from);
    let set = markType.removeFromSet(marks);
    if (next) set = markType.create(next).addToSet(set);
    dispatch(state.tr.setStoredMarks(set));
    return;
  }
  const tr = state.tr;
  const ranges = word ? [word] : selectionRanges(state);
  for (const { from, to } of ranges) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return true;
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      if (a >= b) return false;
      const cur = markType.isInSet(node.marks);
      const next = fn(cur ? (cur.attrs as Attrs) : null, node, pos);
      tr.removeMark(a, b, markType);
      if (next) tr.addMark(a, b, markType.create(next));
      return false;
    });
  }
  dispatch(tr.scrollIntoView());
}

/** Marks at the cursor or the start of the selection. */
export function marksAt(state: EditorState): readonly Mark[] {
  const { $from, empty } = state.selection;
  if (empty) return state.storedMarks ?? $from.marks();
  // The first character of the selection
  const after = state.doc.resolve(Math.min($from.pos + 1, state.doc.content.size));
  return $from.nodeAfter?.isText ? $from.nodeAfter.marks : after.marks();
}

/** Whether every text node of the selection has a mark of a type (with attrs test). */
export function allHave(state: EditorState, type: MarkType, test: (m: Mark | undefined) => boolean): boolean {
  if (state.selection.empty) return test(type.isInSet(marksAt(state)) ?? undefined);
  let all = true;
  let any = false;
  for (const { from, to } of selectionRanges(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText) {
        any = true;
        if (!test(type.isInSet(node.marks) ?? undefined)) all = false;
      }
      return all;
    });
  }
  return any && all;
}

/** Paragraphs touched by the selection, with positions. */
export function selectedParagraphs(state: EditorState): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const seen = new Set<number>();
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    sel.forEachCell((cell, cellPos) => {
      cell.descendants((node, pos) => {
        if (node.type.name === "paragraph" && !seen.has(cellPos + 1 + pos)) {
          seen.add(cellPos + 1 + pos);
          out.push({ node, pos: cellPos + 1 + pos });
        }
        return node.type.name !== "paragraph";
      });
    });
    return out;
  }
  const { from, to } = sel;
  state.doc.nodesBetween(from, Math.max(to, from), (node, pos) => {
    if (node.type.name === "paragraph") {
      if (!seen.has(pos)) {
        seen.add(pos);
        out.push({ node, pos });
      }
      return false;
    }
    return true;
  });
  if (!out.length && sel.$from.parent.type.name === "paragraph") out.push({ node: sel.$from.parent, pos: sel.$from.before() });
  return out;
}

/** Changes the attributes of every selected paragraph. */
export function updateParagraphs(state: EditorState, dispatch: Dispatch, fn: (attrs: Attrs, node: PMNode) => Attrs | null) {
  const tr = state.tr;
  let changed = false;
  for (const { node, pos } of selectedParagraphs(state)) {
    const next = fn({ ...node.attrs }, node);
    if (!next) continue;
    tr.setNodeMarkup(pos, undefined, next, node.marks);
    changed = true;
  }
  if (changed) dispatch(tr);
}

/** Merges a map attribute (spacing, ind…): null values remove keys. */
export function mergeMap(base: unknown, patch: Attrs): Attrs | null {
  const out: Attrs = { ...((base as Attrs) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ----------------------------------------------------------------------
// Effective formatting at the cursor (for the ribbon)
// ----------------------------------------------------------------------

export interface FormatState {
  font: string;
  size: number | null;
  bold: boolean;
  italic: boolean;
  underline: string | null;
  strike: boolean;
  dstrike: boolean;
  sub: boolean;
  sup: boolean;
  caps: boolean;
  smallCaps: boolean;
  color: string | null;
  highlight: string | null;
  style: string;
  styleName: string;
  charStyle: string | null;
  align: string;
  list: "bullet" | "number" | null;
  lineSpacing: number | null;
  spaceBefore: number;
  spaceAfter: number;
  indentLeft: number;
  indentRight: number;
  inTable: boolean;
  link: string | null;
  hasSelection: boolean;
}

type MarkMap = Record<string, Attrs>;

/** Run properties in effect at the cursor: defaults, styles, direct marks. */
export function effectiveRun(state: EditorState, sheet: StyleSheet): MarkMap {
  const $from = state.selection.$from;
  const para = $from.parent;
  const resolved = sheet.paragraph((para.attrs.style as string) ?? null);
  let rPr: MarkMap = { ...resolved.rPr };
  const marks = marksAt(state);
  const cstyle = marks.find((m) => m.type.name === "cstyle");
  if (cstyle) rPr = { ...rPr, ...sheet.character(cstyle.attrs.id as string) };
  for (const m of marks) rPr[m.type.name] = { ...(rPr[m.type.name] ?? {}), ...(m.attrs as Attrs) };
  return rPr;
}

function on(m: Attrs | undefined): boolean {
  return !!m && m.on !== false;
}

export function formatState(state: EditorState, sheet: StyleSheet, numberingKind: (numId: number, ilvl: number) => "bullet" | "number" | null): FormatState {
  const run = effectiveRun(state, sheet);
  const $from = state.selection.$from;
  const para = $from.parent;
  const pa = para.attrs as Attrs;
  const style = (pa.style as string) ?? sheet.defaultParagraph ?? "Normal";
  const resolved = sheet.paragraph(style, pa);
  const p = resolved.pPr;
  const sizeHalf = num(run.size?.val);
  const font = fontName(run.font) ?? "Times New Roman";
  // Mixed fonts/sizes in the selection show as blank, like Word
  let mixedFont = false;
  let mixedSize = false;
  if (!state.selection.empty) {
    const fonts = new Set<string>();
    const sizes = new Set<string>();
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
      if (node.isText) {
        const f = node.marks.find((m) => m.type.name === "font");
        const s = node.marks.find((m) => m.type.name === "size");
        fonts.add(f ? (fontName(f.attrs as Attrs) ?? "") : "");
        sizes.add(s ? String(s.attrs.val) : "");
      }
      return fonts.size < 2 || sizes.size < 2;
    });
    mixedFont = fonts.size > 1;
    mixedSize = sizes.size > 1;
  }
  const jc = (p.jc as string) ?? "left";
  const sp = (p.spacing as Attrs) ?? {};
  const line = num(sp.line);
  const rule = (sp.lineRule as string) ?? "auto";
  const ind = (p.ind as Attrs) ?? {};
  const numPr = sheet.numPr(style, pa.numPr as Attrs);
  const link = marksAt(state).find((m) => m.type.name === "link");
  let inTable = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "table_cell") inTable = true;
  const cstyle = marksAt(state).find((m) => m.type.name === "cstyle");
  return {
    font: mixedFont ? "" : font,
    size: mixedSize ? null : sizeHalf != null ? sizeHalf / 2 : 10,
    bold: on(run.bold),
    italic: on(run.italic),
    underline: run.underline && run.underline.val !== "none" ? String(run.underline.val ?? "single") : null,
    strike: on(run.strike),
    dstrike: on(run.dstrike),
    sub: run.vert?.val === "subscript",
    sup: run.vert?.val === "superscript",
    caps: on(run.caps),
    smallCaps: on(run.smallCaps),
    color: (run.color?.val as string) ?? null,
    highlight: (run.highlight?.val as string) ?? null,
    style,
    styleName: sheet.name(style),
    charStyle: cstyle ? String(cstyle.attrs.id) : null,
    align: jc === "both" || jc === "distribute" ? "justify" : jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left",
    list: numPr ? numberingKind(numPr.numId, numPr.ilvl) : null,
    lineSpacing: line != null && rule === "auto" ? line / 240 : null,
    spaceBefore: (num(sp.before) ?? 0) / 20,
    spaceAfter: (num(sp.after) ?? 0) / 20,
    indentLeft: num(ind.left ?? ind.start) ?? 0,
    indentRight: num(ind.right ?? ind.end) ?? 0,
    inTable,
    link: link ? ((link.attrs.href as string) ?? (link.attrs.anchor ? `#${link.attrs.anchor}` : null)) : null,
    hasSelection: !state.selection.empty,
  };
}

// ----------------------------------------------------------------------
// Text changes
// ----------------------------------------------------------------------

export type CaseKind = "sentence" | "lower" | "upper" | "title" | "toggle";

function changeCase(text: string, kind: CaseKind, atSentenceStart: boolean): string {
  switch (kind) {
    case "lower":
      return text.toLowerCase();
    case "upper":
      return text.toUpperCase();
    case "toggle":
      return Array.from(text)
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join("");
    case "title":
      return text.toLowerCase().replace(/(^|[\s(“"'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    case "sentence": {
      let start = atSentenceStart;
      let out = "";
      for (const c of text.toLowerCase()) {
        if (start && /\p{L}/u.test(c)) {
          out += c.toUpperCase();
          start = false;
        } else {
          out += c;
          if (/[.!?]/.test(c)) start = true;
        }
      }
      return out;
    }
  }
}

/** Change Case (Shift+F3 cycles lower → UPPER → Capitalize). */
export function applyCase(state: EditorState, dispatch: Dispatch, kind: CaseKind) {
  const range = state.selection.empty ? wordAt(state) : { from: state.selection.from, to: state.selection.to };
  if (!range) return;
  const tr = state.tr;
  let first = true;
  state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(range.from, pos);
    const b = Math.min(range.to, pos + node.nodeSize);
    const text = node.text!.slice(a - pos, b - pos);
    const $a = state.doc.resolve(a);
    const before = $a.parent.textBetween(0, $a.parentOffset, " ", " ").trimEnd();
    const changed = changeCase(text, kind, first && (before === "" || /[.!?]$/.test(before)));
    first = false;
    if (changed !== text) tr.replaceWith(tr.mapping.map(a), tr.mapping.map(b), schema.text(changed, node.marks));
    return false;
  });
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(range.from), tr.mapping.map(range.to)));
  dispatch(tr);
}

/** The next case in Shift+F3's cycle for the selected text. */
export function nextCase(text: string): CaseKind {
  if (text === text.toLowerCase()) return "upper";
  if (text === text.toUpperCase()) return "title";
  return "lower";
}

/** Sorts the selected paragraphs by their text. */
export function sortParagraphs(state: EditorState, dispatch: Dispatch, descending: boolean, numeric: boolean) {
  const paras = selectedParagraphs(state);
  if (paras.length < 2) return;
  // Only paragraphs that are siblings in one container
  const parentDepth = state.doc.resolve(paras[0].pos).depth;
  if (paras.some((p) => state.doc.resolve(p.pos).depth !== parentDepth)) return;
  const from = paras[0].pos;
  const to = paras[paras.length - 1].pos + paras[paras.length - 1].node.nodeSize;
  const key = (n: PMNode) => n.textContent.trim();
  const sorted = [...paras.map((p) => p.node)].sort((a, b) => {
    let c: number;
    if (numeric) c = (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0);
    else c = key(a).localeCompare(key(b), undefined, { sensitivity: "base", numeric: true });
    return descending ? -c : c;
  });
  const tr = state.tr.replaceWith(from, to, Fragment.from(sorted));
  dispatch(tr);
}
