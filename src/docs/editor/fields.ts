// Fields: table of contents, dates and page numbers.
//
// A field is `field_start` (with its instruction), the result as ordinary
// content, and `field_end`. Updating a field replaces its result.

import { Fragment, type Mark, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { schema } from "../model/schema";
import type { StyleSheet } from "../model/styles";
import { formatNumber } from "../model/numbering";
import type { PageInfo } from "./pagination";

type Attrs = Record<string, unknown>;

interface FieldRange {
  /** Position of field_start. */
  start: number;
  /** Position of the matching field_end. */
  end: number;
  instr: string;
}

/** Every field of the document, in order (nested fields included). */
export function listFields(doc: PMNode): FieldRange[] {
  const out: FieldRange[] = [];
  const stack: { start: number; instr: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "field_start") stack.push({ start: pos, instr: String(node.attrs.instr ?? "") });
    else if (node.type.name === "field_end") {
      const s = stack.pop();
      if (s) out.push({ start: s.start, end: pos, instr: s.instr });
    }
    return true;
  });
  return out.sort((a, b) => a.start - b.start);
}

export function fieldName(instr: string): string {
  return instr.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function pageOf(pages: PageInfo[], pos: number): number {
  let p = 0;
  for (const page of pages) if (page.from <= pos) p = page.index;
  return p + 1;
}

// ----------------------------------------------------------------------
// Dates
// ----------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Formats a date with a Word date picture ("MMMM d, yyyy", "h:mm am/pm"…). */
export function formatDate(d: Date, picture: string): string {
  const tokens = /(yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|am\/pm|AM\/PM|'[^']*')/g;
  return picture.replace(tokens, (t) => {
    const h12 = d.getHours() % 12 || 12;
    switch (t) {
      case "yyyy":
        return String(d.getFullYear());
      case "yy":
        return String(d.getFullYear()).slice(-2);
      case "MMMM":
        return MONTHS[d.getMonth()];
      case "MMM":
        return MONTHS[d.getMonth()].slice(0, 3);
      case "MM":
        return String(d.getMonth() + 1).padStart(2, "0");
      case "M":
        return String(d.getMonth() + 1);
      case "dddd":
        return DAYS[d.getDay()];
      case "ddd":
        return DAYS[d.getDay()].slice(0, 3);
      case "dd":
        return String(d.getDate()).padStart(2, "0");
      case "d":
        return String(d.getDate());
      case "HH":
        return String(d.getHours()).padStart(2, "0");
      case "H":
        return String(d.getHours());
      case "hh":
        return String(h12).padStart(2, "0");
      case "h":
        return String(h12);
      case "mm":
        return String(d.getMinutes()).padStart(2, "0");
      case "m":
        return String(d.getMinutes());
      case "ss":
        return String(d.getSeconds()).padStart(2, "0");
      case "s":
        return String(d.getSeconds());
      case "am/pm":
        return d.getHours() < 12 ? "am" : "pm";
      case "AM/PM":
        return d.getHours() < 12 ? "AM" : "PM";
      default:
        return t.slice(1, -1);
    }
  });
}

/** The result a simple field shows now, or null when it can't be computed. */
/** Number formats of the \\* switch (PAGE \\* roman…). */
const FIELD_FORMATS: Record<string, string> = { roman: "lowerRoman", ROMAN: "upperRoman", alphabetic: "lowerLetter", ALPHABETIC: "upperLetter", arabic: "decimal", Arabic: "decimal" };

export function fieldResult(instr: string, page: number, pages: number, opts: { label?: string; sectionPages?: number } = {}): string | null {
  const name = fieldName(instr);
  const picture = /\\@\s+"([^"]+)"/.exec(instr)?.[1];
  const fmt = /\\\*\s+(\w+)/.exec(instr)?.[1];
  const number = (n: number, label?: string) => (fmt && FIELD_FORMATS[fmt] ? formatNumber(n, FIELD_FORMATS[fmt]) : (label ?? String(n)));
  switch (name) {
    case "PAGE":
      return number(page, opts.label);
    case "NUMPAGES":
      return number(pages);
    case "SECTIONPAGES":
      return number(opts.sectionPages ?? pages);
    case "DATE":
    case "CREATEDATE":
    case "SAVEDATE":
    case "PRINTDATE":
      return formatDate(new Date(), picture ?? "M/d/yyyy");
    case "TIME":
      return formatDate(new Date(), picture ?? "h:mm am/pm");
    default:
      return null;
  }
}

/** Replaces the result of a field that sits in one paragraph. */
function replaceResult(tr: Transaction, f: FieldRange, text: string) {
  const from = tr.mapping.map(f.start) + 1;
  const to = tr.mapping.map(f.end);
  const $from = tr.doc.resolve(from);
  if (!$from.sameParent(tr.doc.resolve(to))) return;
  const first = tr.doc.nodeAt(from);
  const marks: readonly Mark[] = first?.isText ? first.marks : tr.doc.nodeAt(f.start)?.marks ?? [];
  if (from === to && !text) return;
  if (text) tr.replaceWith(from, to, schema.text(text, marks));
  else tr.delete(from, to);
}

/** F9: updates the fields in the selection (or all with everything selected). */
export function updateFields(state: EditorState, sheet: StyleSheet, pages: PageInfo[]): Transaction | null {
  const { from, to } = state.selection;
  const all = listFields(state.doc).filter((f) => (state.selection.empty ? f.start <= from && f.end >= from : f.end >= from && f.start <= to));
  if (!all.length) return null;
  let tr: Transaction | null = state.tr;
  let toc = false;
  for (const f of all) {
    if (fieldName(f.instr) === "TOC") {
      toc = true;
      continue;
    }
    const text = fieldResult(f.instr, pageOf(pages, f.start), pages.length);
    if (text != null) replaceResult(tr!, f, text);
  }
  if (toc) {
    const t = generateToc(tr!.docChanged ? state.apply(tr!) : state, sheet, pages, false);
    if (t) {
      if (tr!.docChanged) for (const step of t.steps) tr!.step(step);
      else tr = t;
    }
  }
  return tr && tr.docChanged ? tr : null;
}

// ----------------------------------------------------------------------
// Table of contents
// ----------------------------------------------------------------------

interface Heading {
  level: number;
  text: string;
  pos: number;
  node: PMNode;
  bookmark: string | null;
}

function levelsOf(instr: string): [number, number] {
  const m = /\\o\s+"(\d)-(\d)"/.exec(instr);
  return m ? [Number(m[1]), Number(m[2])] : [1, 3];
}

const BOOKMARK_RE = /w:name="(_Toc[^"]+)"/;

function headingsOf(doc: PMNode, sheet: StyleSheet, min: number, max: number, skipFrom: number, skipTo: number): Heading[] {
  const out: Heading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") return true;
    if (node.type.name !== "paragraph") return node.type.name === "table_row" || node.type.name === "table_cell";
    if (pos >= skipFrom && pos <= skipTo) return false;
    const level = sheet.outlineLevel(node.attrs.style as string | null, node.attrs.outlineLvl as number | null);
    if (level == null || level < min || level > max) return false;
    const style = sheet.get((node.attrs.style as string) ?? null);
    if (style && /^toc|^TOC Heading/i.test(style.name)) return false;
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (!text) return false;
    let bookmark: string | null = null;
    node.forEach((child) => {
      if (!bookmark && child.type.name === "opaque_inline" && child.attrs.label === "bookmarkStart") bookmark = BOOKMARK_RE.exec(String(child.attrs.xml))?.[1] ?? null;
    });
    out.push({ level, text, pos, node, bookmark });
    return false;
  });
  return out;
}

function maxBookmarkId(doc: PMNode): number {
  let max = 0;
  doc.descendants((node) => {
    if (node.type.name === "opaque_inline" && /^bookmark/.test(String(node.attrs.label))) {
      const id = Number(/w:id="(\d+)"/.exec(String(node.attrs.xml))?.[1] ?? 0);
      if (id > max) max = id;
    }
    return true;
  });
  return max;
}

/**
 * Builds (create) or refreshes the table of contents. Headings get hidden
 * bookmarks so the entries link to them, like Word's.
 */
export function generateToc(state: EditorState, sheet: StyleSheet, pages: PageInfo[], create: boolean): Transaction | null {
  const fields = listFields(state.doc).filter((f) => fieldName(f.instr) === "TOC");
  const existing = fields[0] ?? null;
  if (!existing && !create) return null;
  const instr = existing?.instr ?? 'TOC \\o "1-3" \\h \\z \\u';
  const [min, max] = levelsOf(instr);
  const tr = state.tr;
  const doc = state.doc;

  // Paragraphs of the current table (field start paragraph … field end paragraph)
  let replaceFrom: number;
  let replaceTo: number;
  if (existing) {
    replaceFrom = doc.resolve(existing.start).before();
    replaceTo = doc.resolve(existing.end).after();
  } else {
    const $from = state.selection.$from;
    replaceFrom = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 ? $from.before() : $from.after(1);
    replaceTo = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 ? $from.after() : replaceFrom;
  }

  const headings = headingsOf(doc, sheet, min, max, replaceFrom, replaceTo);
  // Bookmarks on headings that don't have one
  let nextId = maxBookmarkId(doc) + 1;
  const names = new Map<number, string>();
  const insertions: { pos: number; start: string; end: string }[] = [];
  for (const h of headings) {
    if (h.bookmark) {
      names.set(h.pos, h.bookmark);
      continue;
    }
    const id = nextId++;
    const name = `_Toc${String(100000000 + id * 7919).slice(-9)}`;
    names.set(h.pos, name);
    insertions.push({ pos: h.pos, start: `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`, end: `<w:bookmarkEnd w:id="${id}"/>` });
  }

  const textWidth = (() => {
    const page = (doc.attrs.page as Attrs | null) ?? {};
    const sz = (page.pgSz as Attrs | null) ?? {};
    const mar = (page.pgMar as Attrs | null) ?? {};
    return (Number(sz.w ?? 12240) || 12240) - (Number(mar.left ?? 1440) || 0) - (Number(mar.right ?? 1440) || 0);
  })();
  const tabs = [{ val: "right", leader: "dot", pos: String(textWidth - 10) }];
  const hyperlinked = /\\h/.test(instr);
  const entries: PMNode[] = headings.map((h, i) => {
    const content: PMNode[] = [];
    if (i === 0) content.push(schema.nodes.field_start.create({ instr, xml: "" }));
    const linkMarks = hyperlinked ? [schema.marks.link.create({ anchor: names.get(h.pos), history: "1" })] : [];
    content.push(schema.text(h.text, linkMarks));
    content.push(schema.nodes.tab.create(null, null, linkMarks));
    content.push(schema.text(String(pageOf(pages, h.pos)), linkMarks));
    if (i === headings.length - 1) content.push(schema.nodes.field_end.create({ xml: "" }));
    const style = sheet.get(`TOC${h.level}`) ? `TOC${h.level}` : null;
    return schema.nodes.paragraph.create({ style, tabs }, content);
  });
  if (!entries.length) {
    entries.push(
      schema.nodes.paragraph.create(null, [
        schema.nodes.field_start.create({ instr, xml: "" }),
        schema.text("No table of contents entries found."),
        schema.nodes.field_end.create({ xml: "" }),
      ]),
    );
  }
  const blocks: PMNode[] = [];
  if (!existing && sheet.get("TOCHeading")) blocks.push(schema.nodes.paragraph.create({ style: "TOCHeading" }, schema.text("Contents")));
  blocks.push(...entries);

  // Bookmarks after the table (positions after it shift), then the table itself
  const after = insertions.filter((b) => b.pos >= replaceTo).sort((a, b) => b.pos - a.pos);
  const before = insertions.filter((b) => b.pos < replaceFrom).sort((a, b) => b.pos - a.pos);
  const mark = (xml: string, label: string) => schema.nodes.opaque_inline.create({ xml, kind: "marker", label, text: "", hidden: true });
  for (const b of [...after]) {
    const node = doc.nodeAt(b.pos)!;
    tr.insert(b.pos + node.nodeSize - 1, mark(b.end, "bookmarkEnd"));
    tr.insert(b.pos + 1, mark(b.start, "bookmarkStart"));
  }
  tr.replaceWith(replaceFrom, replaceTo, Fragment.from(blocks));
  for (const b of before) {
    const node = doc.nodeAt(b.pos)!;
    tr.insert(b.pos + node.nodeSize - 1, mark(b.end, "bookmarkEnd"));
    tr.insert(b.pos + 1, mark(b.start, "bookmarkStart"));
  }
  return tr;
}
