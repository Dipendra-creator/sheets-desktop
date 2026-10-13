// Pasting: HTML from Word and web pages, lists, and pictures.

import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { docsApi } from "../api";
import { schema } from "../model/schema";
import { EMU_PER_PX } from "../model/units";
import type { DocController } from "./controller";
import { BULLET_FORMATS, NUMBER_FORMATS } from "./lists";

type Attrs = Record<string, unknown>;

/** List placeholders used between the HTML cleanup and the paste. */
const BULLET = -1;
const NUMBER = -2;

/** Word's list paragraphs and HTML lists → paragraphs with list placeholders. */
export function prepareHtml(html: string): string {
  const cleaned = html
    .replace(/<!--\[if [^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!\[if !supportLists\]>/gi, "")
    .replace(/<!\[endif\]>/gi, "")
    .replace(/<\/?o:p[^>]*>/gi, "")
    .replace(/<\/?(v|w|m|o):[^>]*>/gi, "");
  let dom: Document;
  try {
    dom = new DOMParser().parseFromString(cleaned, "text/html");
  } catch {
    return cleaned;
  }
  const mark = (el: Element, kind: number, level: number) => {
    const style = el.tagName === "P" && /MsoListParagraph/.test(el.className) ? "ListParagraph" : "ListParagraph";
    el.setAttribute("data-pm", JSON.stringify({ style, numPr: { numId: kind, ilvl: Math.max(0, Math.min(8, level)) } }));
  };
  // Word: <p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>
  dom.querySelectorAll("p[style*='mso-list']").forEach((p) => {
    const style = p.getAttribute("style") ?? "";
    const level = Number(/level(\d+)/.exec(style)?.[1] ?? "1") - 1;
    const ignore = p.querySelector("span[style*='mso-list:Ignore'], span[style*='mso-list: Ignore']");
    const marker = (ignore?.textContent ?? "").replace(/ /g, " ").trim();
    ignore?.remove();
    mark(p, /^[\dA-Za-z]{1,4}[.)]$/.test(marker) ? NUMBER : BULLET, level);
  });
  // HTML lists: each item becomes a paragraph
  const lists = Array.from(dom.querySelectorAll("ul, ol")).filter((l) => !l.parentElement?.closest("ul, ol"));
  for (const list of lists) {
    const out: Element[] = [];
    const walk = (l: Element, level: number) => {
      const kind = l.tagName === "OL" ? NUMBER : BULLET;
      for (const li of Array.from(l.children)) {
        if (li.tagName !== "LI") continue;
        const p = dom.createElement("p");
        const nested: Element[] = [];
        for (const child of Array.from(li.childNodes)) {
          if (child instanceof Element && (child.tagName === "UL" || child.tagName === "OL")) nested.push(child);
          else if (child instanceof Element && child.tagName === "P") p.append(...Array.from(child.childNodes));
          else p.append(child);
        }
        mark(p, kind, level);
        out.push(p);
        for (const n of nested) walk(n, level + 1);
      }
    };
    walk(list, 0);
    list.replaceWith(...out);
  }
  return dom.body.innerHTML;
}

/** Replaces list placeholders with real lists (in `tr`). */
export function prepareSlice(slice: Slice, ctl: DocController, state: EditorState): { slice: Slice; changed: boolean; tr: Transaction | null } {
  let tr: Transaction | null = null;
  const ids = new Map<number, number>();
  let changed = false;
  const fix = (frag: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    frag.forEach((node) => {
      let n = node;
      if (node.type.name === "paragraph") {
        const np = node.attrs.numPr as Attrs | null;
        const id = np ? Number(np.numId) : 0;
        if (id === BULLET || id === NUMBER) {
          tr ??= state.tr;
          if (!ids.has(id)) ids.set(id, ctl.lists.instance(tr, id === BULLET ? BULLET_FORMATS[0] : NUMBER_FORMATS[0], null));
          n = node.type.create({ ...node.attrs, numPr: { numId: ids.get(id), ilvl: np!.ilvl ?? 0 } }, node.content, node.marks);
          changed = true;
        }
      } else if (node.content.size) {
        const content = fix(node.content);
        if (content !== node.content) n = node.copy(content);
      }
      nodes.push(n);
    });
    return changed ? Fragment.from(nodes) : frag;
  };
  const content = fix(slice.content);
  return { slice: changed ? new Slice(content, slice.openStart, slice.openEnd) : slice, changed, tr };
}

async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const DEFAULT_EMU = 96 * EMU_PER_PX;

/** Pictures pasted from other apps become pictures of the document. */
export async function uploadPendingImages(ctl: DocController) {
  const pending: { target: string; cx: number; cy: number; alt: string }[] = [];
  ctl.state.doc.descendants((node) => {
    if (node.type.name === "image") {
      const t = String(node.attrs.target ?? "");
      if (!node.attrs.external && /^(data:|https?:)/i.test(t)) pending.push({ target: t, cx: Number(node.attrs.cx), cy: Number(node.attrs.cy), alt: String(node.attrs.alt ?? "") });
    }
    return true;
  });
  for (const p of pending) {
    let attrs: Attrs | null = null;
    try {
      const data = await toDataUrl(p.target);
      const added = await docsApi.addImageData(ctl.id, data, "image.png");
      const useNatural = !p.cx || p.cx === DEFAULT_EMU;
      attrs = { target: added.target, cx: useNatural ? added.cx : p.cx, cy: useNatural ? added.cy : p.cy };
    } catch {
      // Couldn't download it: keep it as a linked picture
      attrs = /^https?:/i.test(p.target) ? { external: true } : null;
    }
    const view = ctl.view;
    if (!view) return;
    const tr = view.state.tr;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.target === p.target && !node.attrs.external) {
        if (attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        else tr.delete(pos, pos + node.nodeSize);
      }
      return true;
    });
    if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
  }
  void schema;
}
