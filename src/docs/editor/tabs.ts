// Tab stops. A tab is drawn as an empty box whose width moves the text
// after it to the next stop: the paragraph's own stops (left, center,
// right, decimal; with leaders), the hanging indent on the first line, or
// the document's default stops. Widths are measured after layout and
// written unzoomed, so zooming doesn't need a new layout.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, type EditorState } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { tabData } from "../model/schema";
import type { StyleSheet } from "../model/styles";
import { twips } from "../model/units";

export interface TabEnv {
  sheet: StyleSheet;
  /** Default tab stop distance in twips (settings.xml, usually 720). */
  defaultTab: number;
}

/** Tabs in the editor: an empty inline box the layout pass sizes. */
export class TabView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode) {
    this.dom = document.createElement("span");
    this.dom.className = "pm-tab";
    this.set(node);
  }
  private set(node: PMNode) {
    for (const k of ["align", "rel", "ptabLeader"]) delete this.dom.dataset[k];
    for (const [k, v] of Object.entries(tabData(node))) this.dom.setAttribute(k, v);
  }
  update(node: PMNode) {
    if (node.type.name !== "tab") return false;
    this.set(node);
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

function zoomOf(el: HTMLElement): number {
  const z = parseFloat(getComputedStyle(el).getPropertyValue("--z"));
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Content box left edge of an element, in client pixels. */
function contentLeft(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
}

const LEADERS = new Set(["dot", "hyphen", "underscore", "heavy", "middleDot"]);

/** The tab layout of each editor, to ask for a new layout (page width changed). */
export const tabLayouts = new WeakMap<EditorView, { relayout(): void }>();

/**
 * Lays out the tabs of paragraphs. `items` pairs each paragraph element
 * with its node (for its style and tab stops).
 */
export function layoutTabs(items: { el: HTMLElement; node: PMNode }[], env: TabEnv) {
  if (!items.length) return;
  const z = zoomOf(items[0].el);
  // 1. Collapse every tab so positions are measured without them
  const groups = items.map(({ el, node }) => ({ el, node, tabs: Array.from(el.querySelectorAll<HTMLElement>("span.pm-tab")).filter((t) => t.closest(".p") === el) }));
  for (const g of groups) for (const t of g.tabs) t.style.width = "0px";

  // 2. Measure
  const measured = groups.map((g) => {
    const parent = g.el.parentElement ?? g.el;
    const origin = contentLeft(parent);
    const pRect = g.el.getBoundingClientRect();
    const indentLeft = (pRect.left + (parseFloat(getComputedStyle(g.el).borderLeftWidth) || 0) - origin) / z;
    const tabs = g.tabs.map((t) => {
      const r = t.getBoundingClientRect();
      return { el: t, x: (r.left - origin) / z, top: Math.round(r.top), right: r.left };
    });
    // Width of the text after each tab (to the next tab on the line, or the line end)
    const seg = tabs.map((t, i) => {
      const next = tabs[i + 1];
      if (next && Math.abs(next.top - t.top) < 2) return (next.right - t.right) / z;
      const range = document.createRange();
      range.setStartAfter(t.el);
      range.setEnd(g.el, g.el.childNodes.length);
      let right = t.right;
      for (const rect of Array.from(range.getClientRects())) {
        if (Math.abs(rect.top - t.top) < rect.height && rect.width > 0) right = Math.max(right, rect.right);
      }
      return (right - t.right) / z;
    });
    const firstTop = tabs.length ? Math.round(g.el.getBoundingClientRect().top) : 0;
    // The text area (alignment tabs align to its centre or right edge)
    const pcs = getComputedStyle(parent);
    const areaW = (parent.getBoundingClientRect().width - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0) - (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0)) / z;
    const indentRight = (origin + areaW * z - (pRect.right - (parseFloat(getComputedStyle(g.el).borderRightWidth) || 0))) / z;
    return { ...g, tabs, seg, indentLeft, indentRight, areaW, firstTop, pRect };
  });

  // 3. Compute widths line by line, then 4. write them
  const defaultPx = Math.max(env.defaultTab, 36) / 15;
  for (const m of measured) {
    const a = m.node.attrs as Record<string, unknown>;
    const stops = env.sheet.tabStops(a.style as string | null, a.tabs as Record<string, unknown>[] | null).map((s) => ({ ...s, px: s.pos / 15 }));
    const ind = (a.ind as Record<string, unknown> | null) ?? null;
    const hanging = ind ? twips(ind.hanging) : null;
    let lineTop = -1;
    let shift = 0;
    let firstLine = true;
    m.tabs.forEach((t, i) => {
      if (Math.abs(t.top - lineTop) > 2) {
        if (lineTop !== -1) firstLine = false;
        lineTop = t.top;
        shift = 0;
      }
      const x = t.x + shift;
      let width = 0;
      let leader = "none";
      const align = t.el.dataset.align;
      if (align) {
        // Alignment tab: to the left, centre or right of the margins or indents
        const byIndent = t.el.dataset.rel === "indent";
        const from = byIndent ? m.indentLeft : 0;
        const to = byIndent ? m.areaW - m.indentRight : m.areaW;
        const segW = m.seg[i];
        const target = align === "right" ? to - segW : align === "center" ? (from + to) / 2 - segW / 2 : from;
        width = Math.max(0, target - x);
        leader = t.el.dataset.ptabLeader ?? "none";
        shift += width;
        t.el.style.width = `calc(${Math.round(width * 100) / 100}px * var(--z))`;
        t.el.dataset.leader = LEADERS.has(leader) ? leader : "";
        return;
      }
      const stop = stops.find((s) => s.px > x + 0.5);
      const hangStop = firstLine && hanging && hanging > 0 && m.indentLeft > x + 0.5 ? m.indentLeft : null;
      if (stop && (hangStop == null || stop.px <= hangStop)) {
        leader = stop.leader;
        const segW = m.seg[i];
        if (stop.val === "right" || stop.val === "end" || stop.val === "decimal") width = stop.px - x - segW;
        else if (stop.val === "center") width = stop.px - x - segW / 2;
        else width = stop.px - x;
        if (width < 0) width = Math.max(0, Math.ceil((x + 0.5) / defaultPx) * defaultPx - x);
      } else if (hangStop != null) {
        width = hangStop - x;
      } else {
        width = Math.ceil((x + 0.5) / defaultPx) * defaultPx - x;
      }
      width = Math.max(0, width);
      shift += width;
      t.el.style.width = `calc(${Math.round(width * 100) / 100}px * var(--z))`;
      t.el.dataset.leader = LEADERS.has(leader) ? leader : "";
    });
  }
}

/** Keeps the editor's tabs laid out as the document changes. */
export function tabsPlugin(env: TabEnv): Plugin {
  return new Plugin({
    view(view) {
      return new TabLayout(view, env);
    },
  });
}

class TabLayout {
  private frame = 0;
  private laidOut = new WeakMap<HTMLElement, PMNode>();
  private force = true;

  constructor(
    private view: EditorView,
    private env: TabEnv,
  ) {
    tabLayouts.set(view, this);
    this.schedule();
    document.fonts?.ready.then(() => this.relayout()).catch(() => {});
  }

  /** Lays out every tab again (fonts loaded, page width changed). */
  relayout() {
    this.force = true;
    this.schedule();
  }

  update(view: EditorView, prev: EditorState) {
    if (view.state.doc !== prev.doc) this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.run();
    });
  }

  run() {
    const view = this.view;
    if (!view.dom.isConnected) return;
    const paras = new Set<HTMLElement>();
    view.dom.querySelectorAll<HTMLElement>("span.pm-tab").forEach((t) => {
      const p = t.closest<HTMLElement>(".p");
      if (p) paras.add(p);
    });
    const items: { el: HTMLElement; node: PMNode }[] = [];
    for (const el of paras) {
      let node: PMNode | null = null;
      try {
        const pos = view.posAtDOM(el, 0);
        const $pos = view.state.doc.resolve(pos);
        node = $pos.parent.type.name === "paragraph" ? $pos.parent : null;
      } catch {
        node = null;
      }
      if (!node) continue;
      if (!this.force && this.laidOut.get(el) === node) continue;
      this.laidOut.set(el, node);
      items.push({ el, node });
    }
    this.force = false;
    if (items.length) layoutTabs(items, this.env);
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
