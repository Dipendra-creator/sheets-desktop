// Print Layout: the document flows over pages.
//
// The editor is one continuous column placed over a stack of page
// backgrounds. After every layout this plugin measures the blocks, works
// out where each page ends (lines of a paragraph, rows of a table), and
// inserts "gap" widgets that push the rest of the content to the top of
// the next page: the page's bottom margin, the space between pages and
// the next page's top margin. Word's rules apply: page breaks, "page break
// before", "keep with next", "keep lines together" and widow/orphan control.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { StyleSheet } from "../model/styles";
import { twips } from "../model/units";
import { NOTE_SEPARATOR, referencedNotes, type NoteKind } from "./notes";

type Attrs = Record<string, unknown>;

export interface PageGeometry {
  /** Unzoomed CSS pixels. */
  pageW: number;
  pageH: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
  gutter: number;
  /** Space between pages on screen. */
  gap: number;
}

export interface PageInfo {
  index: number;
  /** Document position where the page's content starts. */
  from: number;
  /** The section the page starts in (0-based). */
  section?: number;
}

/** Where a footnote or endnote is drawn. */
export interface NotePlace {
  kind: NoteKind;
  id: string;
  page: number;
  /** From the top edge of the page (unzoomed px). */
  top: number;
}

export interface NoteLayout {
  notes: NotePlace[];
  /** The short lines above each page's footnotes and above the endnotes. */
  separators: { kind: NoteKind; page: number; top: number }[];
}

export const NO_NOTES: NoteLayout = { notes: [], separators: [] };

export interface PaginationState {
  decos: DecorationSet;
  pages: PageInfo[];
  notes: NoteLayout;
  /** Signature of the gaps and notes (to skip identical layouts). */
  sig: string;
}

export const paginationKey = new PluginKey<PaginationState>("pagination");

export const PAGE_GAP = 20;

export type HfType = "default" | "first" | "even";

/** Which header/footer a page shows (0-based page). */
export function hfTypeFor(page: number, titlePg: boolean, evenOdd: boolean): HfType {
  if (page === 0 && titlePg) return "first";
  if (evenOdd && (page + 1) % 2 === 0) return "even";
  return "default";
}

/** Layout settings shared by every editor (printing removes the gaps). */
export const layoutOptions = { gap: PAGE_GAP };

/** Page size and margins of the document (Letter, 1" margins by default). */
export function geometryOf(doc: PMNode): PageGeometry {
  const page = (doc.attrs.page as Attrs | null) ?? {};
  const sz = (page.pgSz as Attrs | null) ?? {};
  const mar = (page.pgMar as Attrs | null) ?? {};
  const px = (v: unknown, d: number) => (twips(v) ?? d) / 15;
  let pageW = px(sz.w, 12240);
  let pageH = px(sz.h, 15840);
  // Landscape pages store the orientation and swapped sizes; trust the sizes
  if (sz.orient === "landscape" && pageW < pageH) [pageW, pageH] = [pageH, pageW];
  return {
    pageW,
    pageH,
    top: Math.abs(px(mar.top, 1440)),
    bottom: Math.abs(px(mar.bottom, 1440)),
    left: px(mar.left, 1440),
    right: px(mar.right, 1440),
    header: px(mar.header, 720),
    footer: px(mar.footer, 720),
    gutter: px(mar.gutter, 0),
    gap: layoutOptions.gap,
  };
}

export interface PaginationEnv {
  sheet: StyleSheet;
  /** False in Web Layout and Draft (no pages). */
  enabled: () => boolean;
  /**
   * Top and bottom margins of a page's text (unzoomed px): the page
   * margins, or more where the page's header or footer is taller.
   */
  band?: (page: number, section: number, firstOfSection: boolean) => { top: number; bottom: number };
  /** Height of a footnote or endnote as drawn (unzoomed px). */
  noteHeight?: (kind: NoteKind, id: string) => number;
}

function gapDom(kind: "block" | "inline" | "row", h: number, cols: number, repeat?: Gap["repeat"]): HTMLElement {
  const height = `calc(${Math.max(0, Math.round(h * 100) / 100)}px * var(--z))`;
  if (kind === "row") {
    const tr = document.createElement("tr");
    tr.className = "pg-gap pg-gap-row";
    const td = document.createElement("td");
    td.colSpan = Math.max(1, cols);
    tr.appendChild(td);
    tr.contentEditable = "false";
    if (repeat) {
      // The header rows again at the top of the next page
      td.className = "pg-repeat-cell";
      const spacer = document.createElement("div");
      spacer.style.height = height;
      const table = document.createElement("table");
      table.className = `${repeat.tableClass} pg-repeat`;
      table.innerHTML = `${repeat.colgroup}<tbody>${repeat.rows}</tbody>`;
      td.append(spacer, table);
    } else {
      td.style.height = height;
    }
    return tr;
  }
  const el = document.createElement(kind === "inline" ? "span" : "div");
  el.className = kind === "inline" ? "pg-gap pg-gap-inline" : "pg-gap";
  el.style.height = height;
  el.contentEditable = "false";
  return el;
}

function zoomOf(el: HTMLElement): number {
  const z = parseFloat(getComputedStyle(el).getPropertyValue("--z"));
  return Number.isFinite(z) && z > 0 ? z : 1;
}

interface Line {
  top: number;
  bottom: number;
  left: number;
  /** Client coordinates of the line (to find its start position). */
  cy: number;
  cx: number;
}

/** Line boxes of a paragraph, relative to its border box, without our gaps. */
function measureLines(el: HTMLElement, z: number): Line[] {
  const pRect = el.getBoundingClientRect();
  const gaps = Array.from(el.querySelectorAll<HTMLElement>(":scope .pg-gap-inline")).map((g) => g.getBoundingClientRect());
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0 && !gaps.some((g) => Math.abs(g.top - r.top) < 0.5 && Math.abs(g.height - r.height) < 0.5));
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last) {
      const overlap = Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top);
      if (overlap > Math.min(r.height, last.bottom - last.top) * 0.5) {
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
        if (r.left < last.left) {
          last.left = r.left;
          last.cx = r.left;
        }
        continue;
      }
    }
    lines.push({ top: r.top, bottom: r.bottom, left: r.left, cx: r.left, cy: (r.top + r.bottom) / 2 });
  }
  // Natural positions: remove the height of gaps above each line
  return lines.map((l) => {
    let shift = 0;
    for (const g of gaps) if (g.bottom <= l.top + 1) shift += g.height;
    return { ...l, top: (l.top - shift - pRect.top) / z, bottom: (l.bottom - shift - pRect.top) / z };
  });
}

function sectionBreakType(sect: unknown): string | null {
  if (typeof sect !== "string" || !sect) return null;
  return /<w:type\s+w:val="([^"]+)"/.exec(sect)?.[1] ?? "nextPage";
}

interface Gap {
  pos: number;
  kind: "block" | "inline" | "row";
  h: number;
  cols: number;
  /** Table header rows repeated after the gap (HTML of the rows, their table's class and columns). */
  repeat?: { rows: string; tableClass: string; colgroup: string };
}

/** Footnote references in a block, with their natural position in it. */
function noteRefs(el: HTMLElement, z: number): { id: string; mid: number }[] {
  const refs = Array.from(el.querySelectorAll<HTMLElement>(".opq-footnote[data-note]"));
  if (!refs.length) return [];
  const top = el.getBoundingClientRect().top;
  const gaps = Array.from(el.querySelectorAll<HTMLElement>(".pg-gap")).map((g) => g.getBoundingClientRect());
  return refs.map((r) => {
    const rr = r.getBoundingClientRect();
    let shift = 0;
    for (const g of gaps) if (g.bottom <= rr.top + 1) shift += g.height;
    return { id: r.dataset.note ?? "", mid: (rr.top + rr.height / 2 - shift - top) / z };
  });
}

/** Works out where pages break and where notes go. Reads the layout; writes nothing. */
export function computePages(view: EditorView, geo: PageGeometry, sheet: StyleSheet, env: Partial<PaginationEnv> = {}): { gaps: Gap[]; pages: PageInfo[]; notes: NoteLayout } {
  const doc = view.state.doc;
  const z = zoomOf(view.dom);
  const pitch = geo.pageH + geo.gap;
  // The section each page starts in (its header and footer depend on it)
  const sectionOfPage: number[] = [0];
  const band = (i: number) => {
    const sec = sectionOfPage[i] ?? sectionOfPage[sectionOfPage.length - 1] ?? 0;
    return env.band?.(i, sec, i === 0 || sec !== (sectionOfPage[i - 1] ?? 0)) ?? { top: geo.top, bottom: geo.bottom };
  };
  const noteH = (id: string) => env.noteHeight?.("footnote", id) ?? 0;
  // y = 0 is where the editor starts: the first page's top margin
  const pageEdge = (i: number) => i * pitch - geo.top;
  const pageTop = (i: number) => pageEdge(i) + band(i).top;

  // Footnotes placed so far, and the space they take on each page
  const placed: { id: string; page: number }[] = [];
  const footH: number[] = [];
  const recountNotes = () => {
    footH.length = 0;
    for (const n of placed) footH[n.page] = (footH[n.page] ?? NOTE_SEPARATOR) + noteH(n.id);
  };
  /** Extra space the given notes need on a page (the separator comes with the first). */
  const notesNeed = (ids: string[], page: number) => {
    if (!ids.length) return 0;
    let h = footH[page] ? 0 : NOTE_SEPARATOR;
    for (const id of ids) h += noteH(id);
    return h;
  };
  const place = (ids: string[], page: number) => {
    for (const id of ids) {
      placed.push({ id, page });
      footH[page] = (footH[page] ?? NOTE_SEPARATOR) + noteH(id);
    }
  };
  const pageBottom = (i: number) => Math.max(pageTop(i) + 48, pageEdge(i) + geo.pageH - band(i).bottom - (footH[i] ?? 0));

  const gaps: Gap[] = [];
  const pages: PageInfo[] = [{ index: 0, from: 0, section: 0 }];
  let page = 0;
  let y = 0;
  let section = 0;
  // A header taller than the top margin pushes the first page's text down
  if (pageTop(0) > 0.5) {
    gaps.push({ pos: 0, kind: "block", h: pageTop(0), cols: 1 });
    y = pageTop(0);
  }

  const breakAt = (pos: number, kind: Gap["kind"], at: number, cols = 1) => {
    sectionOfPage[page + 1] = section;
    gaps.push({ pos, kind, h: pageTop(page + 1) - at, cols });
    page += 1;
    pages.push({ index: page, from: pos, section });
    return pageTop(page);
  };

  // Snapshots to go back for "keep with next"
  interface Snap {
    y: number;
    page: number;
    gaps: number;
    pages: number;
    placed: number;
    section: number;
  }
  const snaps: Snap[] = [];
  const firstOnPage = new Map<number, number>();
  let forceBefore = -1;
  let pendingBreak = false;

  const blocks: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, offset) => blocks.push({ node, pos: offset }));

  const resolvedP = (node: PMNode) => sheet.paragraph(node.attrs.style as string | null, node.attrs as Attrs).pPr;

  let k = 0;
  let guard = 0;
  while (k < blocks.length && guard++ < blocks.length * 4 + 100) {
    const { node, pos } = blocks[k];
    snaps[k] = { y, page, gaps: gaps.length, pages: pages.length, placed: placed.length, section };
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) {
      k++;
      continue;
    }
    const cs = getComputedStyle(el);
    const mt = (parseFloat(cs.marginTop) || 0) / z;
    const mb = (parseFloat(cs.marginBottom) || 0) / z;
    const rect = el.getBoundingClientRect();
    let gapInside = 0;
    el.querySelectorAll<HTMLElement>(".pg-gap").forEach((g) => (gapInside += g.getBoundingClientRect().height));
    const h = Math.max(0, (rect.height - gapInside) / z);
    const isPara = node.type.name === "paragraph";
    const pPr = isPara ? resolvedP(node) : {};

    // Forced breaks: a page break that ended the previous paragraph, "page break before"
    const atTop = y <= pageTop(page) + 0.5;
    if (!atTop && (pendingBreak || forceBefore === k || (isPara && pPr.pageBreakBefore === true))) {
      y = breakAt(pos, "block", y);
    }
    pendingBreak = false;
    if (!firstOnPage.has(page)) firstOnPage.set(page, k);

    let start = y + mt;
    // The space before pushed it into the bottom margin: next page
    if (start >= pageBottom(page) - 1 && y > pageTop(page) + 0.5) {
      y = breakAt(pos, "block", y);
      firstOnPage.set(page, k);
      start = y + mt;
    }
    let end = start + h;
    const refs = isPara ? noteRefs(el, z) : [];
    const refIds = isPara ? refs.map((r) => r.id) : Array.from(el.querySelectorAll<HTMLElement>(".opq-footnote[data-note]")).map((e) => e.dataset.note ?? "");

    if (end > pageBottom(page) - notesNeed(refIds, page) + 0.5) {
      const startsPage = firstOnPage.get(page) === k && y <= pageTop(page) + 0.5;
      if (isPara) {
        const lines = measureLines(el, z);
        // The line each footnote reference is on
        const refLine = refs.map((r) => {
          const i = lines.findIndex((l) => r.mid < l.bottom + 0.5);
          return i < 0 ? lines.length - 1 : i;
        });
        const idsOn = (from: number, to: number) => refs.filter((_, i) => refLine[i] >= from && refLine[i] < to).map((r) => r.id);
        const keepLines = pPr.keepLines === true;
        const widow = pPr.widowControl !== false;
        let moved = false;
        // Split the paragraph over as many pages as it needs
        let first = 0;
        let lineOffset = 0;
        let pageStart = start;
        while (lines.length && pageStart + (lines[lines.length - 1].bottom - lineOffset) > pageBottom(page) - notesNeed(idsOn(first, lines.length), page) + 0.5) {
          let fit = 0;
          for (let i = first; i < lines.length; i++) {
            const avail = pageBottom(page) - notesNeed(idsOn(first, i + 1), page) - pageStart;
            if (lines[i].bottom - lineOffset <= avail + 0.5) fit = i - first + 1;
            else break;
          }
          const remaining = lines.length - first;
          if (widow && fit === 1 && remaining > 1) fit = 0;
          if (widow && remaining - fit === 1 && fit > 1) fit -= 1;
          if (keepLines && first === 0 && lines[lines.length - 1].bottom <= pageBottom(page) - pageTop(page)) fit = 0;
          if (fit === 0) {
            if (first === 0 && !(startsPage && pageStart <= pageTop(page) + mt + 0.5)) {
              moved = true;
              break;
            }
            // Taller than a page at the top of one: break after the first line that fits
            fit = Math.max(1, fit);
          }
          const breakLine = lines[first + fit];
          if (!breakLine) break;
          const posAt = view.posAtCoords({ left: breakLine.cx + 1, top: breakLine.cy });
          if (!posAt) break;
          place(idsOn(first, first + fit), page);
          const lineTopAbs = pageStart + (breakLine.top - lineOffset);
          breakAt(posAt.pos, "inline", lineTopAbs);
          pageStart = pageTop(page);
          lineOffset = breakLine.top;
          first = first + fit;
        }
        if (moved) {
          // Keep with next: take the previous paragraphs along
          let j = k;
          while (j - 1 > (firstOnPage.get(page) ?? 0) && blocks[j - 1].node.type.name === "paragraph" && resolvedP(blocks[j - 1].node).keepNext === true) j--;
          if (j < k && snaps[j]) {
            const s = snaps[j];
            y = s.y;
            page = s.page;
            gaps.length = s.gaps;
            pages.length = s.pages;
            placed.length = s.placed;
            section = s.section;
            recountNotes();
            forceBefore = j;
            k = j;
            continue;
          }
          y = breakAt(pos, "block", y);
          firstOnPage.set(page, k);
          start = y + mt;
          end = start + h;
          // Still taller than the page: split it on this page
          if (end > pageBottom(page) - notesNeed(refIds, page) + 0.5) {
            forceBefore = -1;
            const s = snaps[k];
            snaps[k] = { ...s, y, page, gaps: gaps.length, pages: pages.length, placed: placed.length, section };
            // Retry with the paragraph starting this page (splits instead of moving)
            continue;
          }
          place(refIds, page);
        } else {
          place(idsOn(first, lines.length), page);
          end = pageStart + (lines.length ? lines[lines.length - 1].bottom - lineOffset : h);
        }
      } else if (node.type.name === "table") {
        // Break between rows
        const rows = Array.from((el.querySelector("tbody") ?? el).children).filter((r) => r instanceof HTMLTableRowElement && !r.classList.contains("pg-gap")) as HTMLTableRowElement[];
        const tableTop = rect.top;
        let rowOffset = 0; // natural offset of the current page's first row
        let pageStart = start;
        let ri = 0;
        let colCount = 1;
        node.firstChild?.forEach((c) => (colCount += (c.attrs.colspan as number) || 1));
        let gapAbove = 0;
        const rowPos: number[] = [];
        node.forEach((_row, off) => rowPos.push(pos + 1 + off));
        // Rows marked "Repeat Header Rows" come again at the top of each page
        let headerRows = 0;
        while (headerRows < node.childCount && node.child(headerRows).attrs.header && headerRows < rows.length - 1) headerRows++;
        let repeat: Gap["repeat"] | undefined;
        let headerH = 0;
        if (headerRows) {
          const firstTop = rows[0].getBoundingClientRect().top;
          headerH = (rows[headerRows - 1].getBoundingClientRect().bottom - firstTop) / z;
          const clean = (html: string) => html.replace(/\s(contenteditable|draggable)="[^"]*"/g, "").replace(/ProseMirror-selectednode/g, "");
          repeat = {
            rows: clean(rows.slice(0, headerRows).map((r) => r.outerHTML).join("")),
            tableClass: (el.querySelector("table") ?? el).className.replace(/\bProseMirror-selectednode\b/g, ""),
            colgroup: el.querySelector("colgroup")?.outerHTML ?? "",
          };
          // A header taller than half a page isn't repeated (Word draws it once)
          if (headerH > (pageBottom(page) - pageTop(page)) / 2) repeat = undefined;
        }
        for (const r of rows) {
          const rr = r.getBoundingClientRect();
          // gaps we inserted before this row
          let prev = r.previousElementSibling;
          while (prev && prev.classList.contains("pg-gap")) {
            gapAbove += prev.getBoundingClientRect().height;
            prev = prev.previousElementSibling;
          }
          const rowIds = Array.from(r.querySelectorAll<HTMLElement>(".opq-footnote[data-note]")).map((e) => e.dataset.note ?? "");
          const top = (rr.top - tableTop - gapAbove) / z;
          const bottom = (rr.bottom - tableTop - gapAbove) / z;
          if (pageStart + (bottom - rowOffset) > pageBottom(page) - notesNeed(rowIds, page) + 0.5) {
            const firstRowOfPage = top <= rowOffset + 0.5;
            if (ri === 0 && !startsPage) {
              // Not even the first row fits: move the whole table
              y = breakAt(pos, "block", y);
              firstOnPage.set(page, k);
              pageStart = y + mt;
              rowOffset = 0;
            } else if (!firstRowOfPage && rowPos[ri] != null) {
              const rep = ri >= headerRows ? repeat : undefined;
              breakAt(rowPos[ri], "row", pageStart + (top - rowOffset), colCount);
              if (rep) gaps[gaps.length - 1].repeat = rep;
              pageStart = pageTop(page) + (rep ? headerH : 0);
              rowOffset = top;
            }
          }
          place(rowIds, page);
          end = pageStart + (bottom - rowOffset);
          ri++;
        }
        if (!rows.length) end = start + h;
      } else if (!startsPage) {
        y = breakAt(pos, "block", y);
        firstOnPage.set(page, k);
        start = y + mt;
        end = start + h;
      }
    } else {
      // It fits, with its footnotes
      place(refIds, page);
    }

    // Page breaks inside the paragraph, and section breaks after it
    if (isPara) {
      let after = false;
      node.forEach((child, off) => {
        if (child.type.name === "hard_break" && child.attrs.type === "page") {
          const p = pos + 1 + off + child.nodeSize;
          if (off + child.nodeSize >= node.content.size) after = true;
          else {
            // Content after the break starts the next page
            const dom = view.nodeDOM(pos + 1 + off) as HTMLElement | null;
            const r = dom?.getBoundingClientRect();
            const at = r ? y + mt + (r.bottom - rect.top) / z : end;
            breakAt(p, "inline", at);
            end = pageTop(page) + Math.max(0, end - at);
          }
        }
      });
      if (after) pendingBreak = true;
      const sect = sectionBreakType(node.attrs.sect);
      if (sect && sect !== "continuous") pendingBreak = true;
      if (sect) section += 1;
    }

    y = end + mb;
    if (forceBefore === k) forceBefore = -1;
    k++;
  }

  // Footnotes: at the bottom of their page, above the bottom margin
  const layout: NoteLayout = { notes: [], separators: [] };
  const byPage = new Map<number, string[]>();
  for (const n of placed) byPage.set(n.page, [...(byPage.get(n.page) ?? []), n.id]);
  for (const [p, ids] of byPage) {
    let top = geo.pageH - band(p).bottom - (footH[p] ?? 0);
    layout.separators.push({ kind: "footnote", page: p, top });
    top += NOTE_SEPARATOR;
    for (const id of ids) {
      layout.notes.push({ kind: "footnote", id, page: p, top });
      top += noteH(id);
    }
  }

  // Endnotes: after the last paragraph, flowing onto new pages as needed
  const endIds = referencedNotes(doc).endnote.filter((id) => (env.noteHeight?.("endnote", id) ?? 0) > 0);
  if (endIds.length) {
    let ey = y;
    const fits = (h: number) => ey + h <= pageBottom(page) + 0.5 || ey <= pageTop(page) + 0.5;
    const nextPage = () => {
      sectionOfPage[page + 1] = section;
      page += 1;
      pages.push({ index: page, from: doc.content.size, section });
      ey = pageTop(page);
    };
    if (!fits(NOTE_SEPARATOR + (env.noteHeight?.("endnote", endIds[0]) ?? 0))) nextPage();
    layout.separators.push({ kind: "endnote", page, top: ey - pageEdge(page) });
    ey += NOTE_SEPARATOR;
    for (const id of endIds) {
      const h = env.noteHeight?.("endnote", id) ?? 0;
      if (!fits(h)) nextPage();
      layout.notes.push({ kind: "endnote", id, page, top: ey - pageEdge(page) });
      ey += h;
    }
  }
  return { gaps, pages, notes: layout };
}

function signature(gaps: Gap[], notes: NoteLayout, pages: number): string {
  return [
    gaps.map((g) => `${g.pos}:${g.kind}:${Math.round(g.h * 2)}${g.repeat ? `:${hash(g.repeat.rows)}` : ""}`).join("|"),
    notes.notes.map((n) => `${n.kind}${n.id}@${n.page}:${Math.round(n.top * 2)}`).join("|"),
    notes.separators.map((n) => `${n.kind}@${n.page}:${Math.round(n.top * 2)}`).join("|"),
    pages,
  ].join("#");
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function decorationsFor(doc: PMNode, gaps: Gap[]): DecorationSet {
  const decos = gaps.map((g) =>
    Decoration.widget(g.pos, () => gapDom(g.kind, g.h, g.cols, g.repeat), {
      side: g.kind === "inline" ? -1 : -1,
      ignoreSelection: true,
      key: `gap:${g.kind}:${Math.round(g.h * 2)}:${g.cols}:${g.repeat ? hash(g.repeat.rows + g.repeat.colgroup) : ""}`,
    }),
  );
  return DecorationSet.create(doc, decos);
}

export function paginationPlugin(env: PaginationEnv, onPages: (pages: PageInfo[], notes: NoteLayout) => void): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, pages: [{ index: 0, from: 0 }], notes: NO_NOTES, sig: "" }),
      apply(tr: Transaction, old: PaginationState, _o, newState: EditorState) {
        const meta = tr.getMeta(paginationKey) as PaginationState | undefined;
        if (meta) return meta;
        if (tr.docChanged) {
          return { ...old, decos: old.decos.map(tr.mapping, newState.doc), pages: old.pages.map((p) => ({ ...p, from: tr.mapping.map(p.from) })) };
        }
        return old;
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decos,
    },
    view(view) {
      return new Paginator(view, env, onPages);
    },
  });
}

/** Instances by view, to ask for a new layout (zoom, fonts, pictures). */
export const paginators = new WeakMap<EditorView, Paginator>();

export class Paginator {
  private frame = 0;
  private dirty = true;
  /** Consecutive layouts that changed the gaps (stops oscillation). */
  private streak = 0;

  /** A layout is pending or still settling. */
  get busy(): boolean {
    return this.dirty || this.frame !== 0;
  }
  private observer: ResizeObserver | null = null;

  constructor(
    private view: EditorView,
    private env: PaginationEnv,
    private onPages: (pages: PageInfo[], notes: NoteLayout) => void,
  ) {
    paginators.set(view, this);
    this.schedule();
    document.fonts?.ready.then(() => this.invalidate()).catch(() => {});
    // Pictures finishing loading change heights
    view.dom.addEventListener("load", this.onLoad, true);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.invalidate());
      this.observer.observe(view.dom);
    }
  }

  private onLoad = () => this.invalidate();

  invalidate() {
    this.dirty = true;
    this.schedule();
  }

  update(view: EditorView, prev: EditorState) {
    if (view.state.doc !== prev.doc) {
      this.streak = 0;
      this.invalidate();
    }
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.dirty) this.run();
    });
  }

  run() {
    this.dirty = false;
    const view = this.view;
    if (!view.dom.isConnected) return;
    const state = paginationKey.getState(view.state);
    if (!this.env.enabled()) {
      if (state && state.sig !== "off") {
        view.dispatch(view.state.tr.setMeta(paginationKey, { decos: DecorationSet.empty, pages: [{ index: 0, from: 0 }], notes: NO_NOTES, sig: "off" }).setMeta("addToHistory", false));
        this.onPages([{ index: 0, from: 0 }], NO_NOTES);
      }
      return;
    }
    const geo = geometryOf(view.state.doc);
    const { gaps, pages, notes } = computePages(view, geo, this.env.sheet, this.env);
    const sig = signature(gaps, notes, pages.length);
    if (state && sig === state.sig) {
      this.streak = 0;
      this.onPages(state.pages, state.notes);
      return;
    }
    const decos = decorationsFor(view.state.doc, gaps);
    view.dispatch(view.state.tr.setMeta(paginationKey, { decos, pages, notes, sig }).setMeta("addToHistory", false));
    this.onPages(pages, notes);
    // Gaps change the layout below them; check again once it settled
    // (a layout that keeps flipping stops after a few rounds)
    if (++this.streak < 6) {
      this.dirty = true;
      this.schedule();
    }
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.view.dom.removeEventListener("load", this.onLoad, true);
    this.observer?.disconnect();
  }
}
