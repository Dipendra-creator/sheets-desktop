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
import { num, twips } from "../model/units";

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
}

export interface PaginationState {
  decos: DecorationSet;
  pages: PageInfo[];
  /** Signature of the gaps (to skip identical layouts). */
  sig: string;
}

export const paginationKey = new PluginKey<PaginationState>("pagination");

export const PAGE_GAP = 20;

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
}

function gapDom(kind: "block" | "inline" | "row", h: number, cols: number): HTMLElement {
  const height = `calc(${Math.max(0, Math.round(h * 100) / 100)}px * var(--z))`;
  if (kind === "row") {
    const tr = document.createElement("tr");
    tr.className = "pg-gap pg-gap-row";
    const td = document.createElement("td");
    td.colSpan = Math.max(1, cols);
    td.style.height = height;
    tr.appendChild(td);
    tr.contentEditable = "false";
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
}

/** Works out where pages break. Reads the layout; writes nothing. */
export function computePages(view: EditorView, geo: PageGeometry, sheet: StyleSheet): { gaps: Gap[]; pages: PageInfo[] } {
  const doc = view.state.doc;
  const z = zoomOf(view.dom);
  const contentH = Math.max(48, geo.pageH - geo.top - geo.bottom);
  const pitch = geo.pageH + geo.gap;
  const pageTop = (i: number) => i * pitch;
  const pageBottom = (i: number) => i * pitch + contentH;
  const gaps: Gap[] = [];
  const pages: PageInfo[] = [{ index: 0, from: 0 }];
  let page = 0;
  let y = 0;

  const breakAt = (pos: number, kind: Gap["kind"], at: number, cols = 1) => {
    gaps.push({ pos, kind, h: pageTop(page + 1) - at, cols });
    page += 1;
    pages.push({ index: page, from: pos });
    return pageTop(page);
  };

  // Snapshots to go back for "keep with next"
  interface Snap {
    y: number;
    page: number;
    gaps: number;
    pages: number;
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
    snaps[k] = { y, page, gaps: gaps.length, pages: pages.length };
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

    if (end > pageBottom(page) + 0.5) {
      const startsPage = firstOnPage.get(page) === k && y <= pageTop(page) + 0.5;
      if (isPara) {
        const lines = measureLines(el, z);
        const keepLines = pPr.keepLines === true;
        const widow = pPr.widowControl !== false;
        let moved = false;
        // Split the paragraph over as many pages as it needs
        let first = 0;
        let lineOffset = 0;
        let pageStart = start;
        while (lines.length && pageStart + (lines[lines.length - 1].bottom - lineOffset) > pageBottom(page) + 0.5) {
          const avail = pageBottom(page) - pageStart;
          let fit = 0;
          for (let i = first; i < lines.length; i++) {
            if (lines[i].bottom - lineOffset <= avail + 0.5) fit = i - first + 1;
            else break;
          }
          const remaining = lines.length - first;
          if (widow && fit === 1 && remaining > 1) fit = 0;
          if (widow && remaining - fit === 1 && fit > 1) fit -= 1;
          if (keepLines && first === 0 && remaining * 1 > 0 && lines[lines.length - 1].bottom <= contentH) fit = 0;
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
            forceBefore = j;
            k = j;
            continue;
          }
          y = breakAt(pos, "block", y);
          firstOnPage.set(page, k);
          start = y + mt;
          end = start + h;
          // Still taller than the page: split it on this page
          if (end > pageBottom(page) + 0.5) {
            forceBefore = -1;
            const s = snaps[k];
            snaps[k] = { ...s, y, page, gaps: gaps.length, pages: pages.length };
            // Retry with the paragraph starting this page (splits instead of moving)
            continue;
          }
        } else {
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
        for (const r of rows) {
          const rr = r.getBoundingClientRect();
          // gaps we inserted before this row
          let prev = r.previousElementSibling;
          while (prev && prev.classList.contains("pg-gap")) {
            gapAbove += prev.getBoundingClientRect().height;
            prev = prev.previousElementSibling;
          }
          const top = (rr.top - tableTop - gapAbove) / z;
          const bottom = (rr.bottom - tableTop - gapAbove) / z;
          if (pageStart + (bottom - rowOffset) > pageBottom(page) + 0.5) {
            const firstRowOfPage = top <= rowOffset + 0.5;
            if (ri === 0 && !startsPage) {
              // Not even the first row fits: move the whole table
              y = breakAt(pos, "block", y);
              firstOnPage.set(page, k);
              pageStart = y + mt;
              rowOffset = 0;
            } else if (!firstRowOfPage && rowPos[ri] != null) {
              breakAt(rowPos[ri], "row", pageStart + (top - rowOffset), colCount);
              pageStart = pageTop(page);
              rowOffset = top;
            }
          }
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
    }

    y = end + mb;
    if (forceBefore === k) forceBefore = -1;
    k++;
  }
  void num;
  return { gaps, pages };
}

function signature(gaps: Gap[]): string {
  return gaps.map((g) => `${g.pos}:${g.kind}:${Math.round(g.h * 2)}`).join("|");
}

function decorationsFor(doc: PMNode, gaps: Gap[]): DecorationSet {
  const decos = gaps.map((g) =>
    Decoration.widget(g.pos, () => gapDom(g.kind, g.h, g.cols), {
      side: g.kind === "inline" ? -1 : -1,
      ignoreSelection: true,
      key: `gap:${g.kind}:${Math.round(g.h * 2)}:${g.cols}`,
    }),
  );
  return DecorationSet.create(doc, decos);
}

export function paginationPlugin(env: PaginationEnv, onPages: (pages: PageInfo[]) => void): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, pages: [{ index: 0, from: 0 }], sig: "" }),
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
    private onPages: (pages: PageInfo[]) => void,
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
        view.dispatch(view.state.tr.setMeta(paginationKey, { decos: DecorationSet.empty, pages: [{ index: 0, from: 0 }], sig: "off" }).setMeta("addToHistory", false));
        this.onPages([{ index: 0, from: 0 }]);
      }
      return;
    }
    const geo = geometryOf(view.state.doc);
    const { gaps, pages } = computePages(view, geo, this.env.sheet);
    const sig = signature(gaps);
    if (state && sig === state.sig) {
      this.streak = 0;
      this.onPages(state.pages);
      return;
    }
    const decos = decorationsFor(view.state.doc, gaps);
    view.dispatch(view.state.tr.setMeta(paginationKey, { decos, pages, sig }).setMeta("addToHistory", false));
    this.onPages(pages);
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
