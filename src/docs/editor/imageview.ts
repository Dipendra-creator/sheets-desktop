// Pictures: inline or floating (anchored), with resize handles.

import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { imageSrc, isDrawableImage } from "../model/schema";
import { EMU_PER_PX, num } from "../model/units";

export interface AnchorLayout {
  mode: "inline" | "left" | "right" | "block" | "absolute";
  /** Offsets in unzoomed px (absolute mode). */
  x: number;
  y: number;
  behind: boolean;
  align: "left" | "center" | "right";
}

/** How a floating picture sits in the text, from its drawing XML. */
export function anchorLayout(raw: string | null, anchored: boolean): AnchorLayout {
  const out: AnchorLayout = { mode: "inline", x: 0, y: 0, behind: false, align: "left" };
  if (!anchored || !raw) return out;
  const posH = /<wp:positionH[^>]*relativeFrom="([^"]+)"[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(raw);
  const posV = /<wp:positionV[^>]*relativeFrom="([^"]+)"[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(raw);
  const alignH = posH ? /<wp:align>(\w+)<\/wp:align>/.exec(posH[2])?.[1] : undefined;
  const offH = posH ? Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posH[2])?.[1] ?? "NaN") : NaN;
  const offV = posV ? Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posV[2])?.[1] ?? "NaN") : NaN;
  out.align = alignH === "right" || alignH === "outside" ? "right" : alignH === "center" ? "center" : "left";
  out.behind = /behindDoc="(1|true)"/.test(raw);
  if (/<wp:wrapTopAndBottom/.test(raw)) {
    out.mode = "block";
  } else if (/<wp:wrap(Square|Tight|Through)/.test(raw)) {
    if (alignH) out.mode = out.align === "right" ? "right" : out.align === "center" ? "block" : "left";
    else out.mode = Number.isFinite(offH) && offH / EMU_PER_PX > 250 ? "right" : "left";
  } else {
    out.mode = "absolute";
    out.x = Number.isFinite(offH) ? offH / EMU_PER_PX : 0;
    out.y = Number.isFinite(offV) ? offV / EMU_PER_PX : 0;
    if (alignH === "center") out.x = NaN;
    if (posV && posV[1] !== "paragraph" && posV[1] !== "line") out.y = Number.isFinite(offV) ? Math.max(0, offV / EMU_PER_PX) : 0;
  }
  return out;
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export class ImageView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement | null = null;
  private box: HTMLElement;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("span");
    this.dom.className = "img-wrap";
    this.dom.contentEditable = "false";
    this.box = document.createElement("span");
    this.box.className = "img-box";
    this.dom.appendChild(this.box);
    for (const h of HANDLES) {
      const el = document.createElement("span");
      el.className = `img-handle h-${h}`;
      el.dataset.handle = h;
      el.addEventListener("pointerdown", (e) => this.startResize(e, h));
      this.dom.appendChild(el);
    }
    this.render();
  }

  private size() {
    return { w: (num(this.node.attrs.cx) ?? 914400) / EMU_PER_PX, h: (num(this.node.attrs.cy) ?? 914400) / EMU_PER_PX };
  }

  private render() {
    const a = this.node.attrs;
    const { w, h } = this.size();
    const src = imageSrc(a);
    const target = String(a.target ?? "");
    this.box.style.width = `calc(${w}px * var(--z))`;
    this.box.style.height = `calc(${h}px * var(--z))`;
    if (src && isDrawableImage(target)) {
      if (!this.img) {
        this.box.textContent = "";
        this.img = document.createElement("img");
        this.img.draggable = false;
        this.box.appendChild(this.img);
      }
      if (this.img.getAttribute("src") !== src) this.img.src = src;
      this.img.alt = String(a.alt ?? "");
    } else {
      this.img = null;
      this.box.textContent = "";
      const ph = document.createElement("span");
      ph.className = "img-missing";
      ph.textContent = a.external ? "Linked picture" : /\.(emf|wmf)$/i.test(target) ? "Picture (EMF/WMF)" : String(a.alt || "Picture");
      this.box.appendChild(ph);
    }
    const layout = anchorLayout(a.raw as string | null, a.anchor === true);
    this.dom.className = `img-wrap img-${layout.mode}${layout.behind ? " img-behind" : ""}`;
    this.dom.style.left = "";
    this.dom.style.top = "";
    if (layout.mode === "absolute") {
      if (Number.isFinite(layout.x)) this.dom.style.left = `calc(${layout.x}px * var(--z))`;
      else this.dom.style.left = `calc(50% - ${w / 2}px * var(--z))`;
      this.dom.style.top = `calc(${layout.y}px * var(--z))`;
    }
    this.dom.title = String(a.alt || a.name || "");
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("selected");
  }

  deselectNode() {
    this.dom.classList.remove("selected");
  }

  ignoreMutation() {
    return true;
  }

  stopEvent(e: Event) {
    return e.target instanceof HTMLElement && !!e.target.dataset.handle;
  }

  private startResize(e: PointerEvent, handle: string) {
    e.preventDefault();
    e.stopPropagation();
    const z = parseFloat(getComputedStyle(this.dom).getPropertyValue("--z")) || 1;
    const start = { x: e.clientX, y: e.clientY, ...this.size() };
    const ratio = start.w / Math.max(1, start.h);
    const corner = handle.length === 2;
    let w = start.w;
    let h = start.h;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / z;
      const dy = (ev.clientY - start.y) / z;
      if (handle.includes("e")) w = start.w + dx;
      if (handle.includes("w")) w = start.w - dx;
      if (handle.includes("s")) h = start.h + dy;
      if (handle.includes("n")) h = start.h - dy;
      w = Math.max(8, w);
      h = Math.max(8, h);
      // Corners keep the proportions (Shift frees them)
      if (corner && !ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) h = w / ratio;
        else w = h * ratio;
      }
      this.box.style.width = `calc(${w}px * var(--z))`;
      this.box.style.height = `calc(${h}px * var(--z))`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const pos = this.getPos();
      if (pos == null) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        cx: Math.round(w * EMU_PER_PX),
        cy: Math.round(h * EMU_PER_PX),
      });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      this.view.dispatch(tr);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}
