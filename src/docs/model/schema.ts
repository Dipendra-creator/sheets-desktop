// The editor's document model. Node, mark and attribute names match the
// JSON written by src-tauri/src/docx/read.rs exactly, so documents travel
// between the editor and the .docx writer without conversion.
//
// Attribute values keep their WordprocessingML form (strings of twips,
// half-points, hex colours, maps of XML attributes) so that what the editor
// doesn't change is written back as it was.

import { Schema, type DOMOutputSpec, type Mark, type MarkSpec, type Node as PMNode, type NodeSpec } from "prosemirror-model";
import { mediaUrl } from "../api";
import { anchorLayout } from "./anchor";
import { borderCss, cssColor, ctx, fontName, fontStack, HIGHLIGHTS, shadingColor } from "./render";
import { num, str, twips, zpt, ztw, EMU_PER_PX, zpx } from "./units";

type Attrs = Record<string, unknown>;

function attrsOf(names: string[]): Record<string, { default: unknown }> {
  const out: Record<string, { default: unknown }> = {};
  for (const n of names) out[n] = { default: null };
  return out;
}

/** CSS class for a style id (ids can contain any character). */
export function styleClass(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}

function css(parts: (string | null | false | undefined)[]): string {
  return parts.filter(Boolean).join(";");
}

// ----------------------------------------------------------------------
// Paragraph properties → CSS
// ----------------------------------------------------------------------

export const PARAGRAPH_ATTRS = [
  "style",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "widowControl",
  "contextualSpacing",
  "bidi",
  "numPr",
  "pBdr",
  "shd",
  "spacing",
  "ind",
  "tabs",
  "jc",
  "outlineLvl",
  "pm",
  "sect",
  "extra",
  "sdt",
];

/** Line height and spacing of a `w:spacing` map. */
export function spacingCss(sp: Attrs | null | undefined): string[] {
  if (!sp) return [];
  const out: string[] = [];
  const before = sp.beforeAutospacing === "1" || sp.beforeAutospacing === "true" ? 280 : twips(sp.before);
  const after = sp.afterAutospacing === "1" || sp.afterAutospacing === "true" ? 280 : twips(sp.after);
  if (before != null) out.push(`margin-top:${ztw(before)}`);
  if (after != null) out.push(`margin-bottom:${ztw(after)}`);
  const line = twips(sp.line);
  if (line != null && line > 0) {
    const rule = (sp.lineRule as string) ?? "auto";
    if (rule === "exact") out.push(`line-height:${ztw(line)}`, "--lh-exact:1");
    else if (rule === "atLeast") out.push(`line-height:max(${ztw(line)}, calc(var(--font-lh, 1.17) * 1em))`);
    else out.push(`--lh:${line / 240}`, "line-height:calc(var(--lh) * var(--font-lh, 1.17))");
  }
  return out;
}

/** Indents of a `w:ind` map. */
export function indentCss(ind: Attrs | null | undefined): string[] {
  if (!ind) return [];
  const out: string[] = [];
  const left = twips(ind.left ?? ind.start);
  const right = twips(ind.right ?? ind.end);
  const hanging = twips(ind.hanging);
  const first = twips(ind.firstLine);
  if (left != null) out.push(`margin-left:${ztw(left)}`);
  if (right != null) out.push(`margin-right:${ztw(right)}`);
  if (hanging != null) out.push(`text-indent:${ztw(-hanging)}`);
  else if (first != null) out.push(`text-indent:${ztw(first)}`);
  return out;
}

const SIDES: Record<string, string> = { top: "top", bottom: "bottom", left: "left", right: "right", start: "left", end: "right" };

/** Paragraph borders: the border and its distance from the text (`space`, points). */
export function paraBorderCss(b: Attrs | null | undefined): string[] {
  if (!b) return [];
  const out: string[] = [];
  for (const [side, value] of Object.entries(b)) {
    const css = SIDES[side];
    if (!css) continue;
    const v = value as Attrs;
    const line = borderCss(v);
    if (!line || line === "none") continue;
    out.push(`border-${css}:${line}`);
    const space = num(v.space) ?? 0;
    if (space) out.push(`padding-${css}:${zpt(space)}`);
  }
  return out;
}

const JC: Record<string, string> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
  mediumKashida: "justify",
  highKashida: "justify",
  lowKashida: "justify",
  thaiDistribute: "justify",
};

/** CSS for direct paragraph formatting. */
export function paragraphCss(a: Attrs): string {
  const parts: string[] = [];
  parts.push(...spacingCss(a.spacing as Attrs));
  parts.push(...indentCss(a.ind as Attrs));
  const jc = a.jc as string | null;
  if (jc && JC[jc]) {
    parts.push(`text-align:${JC[jc]}`);
    if (jc === "distribute") parts.push("text-align-last:justify");
  }
  parts.push(...paraBorderCss(a.pBdr as Attrs));
  const shd = shadingColor(a.shd as Attrs);
  if (shd) parts.push(`background-color:${shd}`);
  if (a.bidi === true) parts.push("direction:rtl");
  return css(parts);
}

// ----------------------------------------------------------------------
// Run properties → CSS
// ----------------------------------------------------------------------

/** CSS of a single run mark (also used for style definitions). */
export function markCss(type: string, a: Attrs): string | null {
  const on = a.on !== false;
  switch (type) {
    case "bold":
      return `font-weight:${on ? 700 : 400}`;
    case "italic":
      return `font-style:${on ? "italic" : "normal"}`;
    case "caps":
      return `text-transform:${on ? "uppercase" : "none"}`;
    case "smallCaps":
      return `font-variant:${on ? "small-caps" : "normal"}`;
    case "strike":
      return on ? "text-decoration-line:line-through" : null;
    case "dstrike":
      return on ? "text-decoration-line:line-through;text-decoration-style:double" : null;
    case "color": {
      const c = cssColor(a);
      return c ? `color:${c}` : a.val === "auto" ? "color:var(--auto-color, #000)" : null;
    }
    case "charSpacing": {
      const v = num(a.val);
      return v ? `letter-spacing:${zpt(v / 20)}` : null;
    }
    case "size": {
      const v = num(a.val);
      return v ? `font-size:${zpt(v / 2)}` : null;
    }
    case "highlight": {
      const c = HIGHLIGHTS[a.val as string];
      return c ? `background-color:${c}` : null;
    }
    case "underline": {
      const v = (a.val as string) ?? "single";
      if (v === "none") return null;
      const style =
        v === "double" ? "double" : v.startsWith("dotted") || v === "dotDash" ? "dotted" : v.startsWith("dash") ? "dashed" : v.startsWith("wav") ? "wavy" : "solid";
      const thick = v === "thick" || v.endsWith("Heavy") ? ";text-decoration-thickness:0.12em" : "";
      const color = cssColor(a, "color");
      return `text-decoration-line:underline;text-decoration-style:${style}${color ? `;text-decoration-color:${color}` : ""}${thick}`;
    }
    case "shading": {
      const c = shadingColor(a);
      return c ? `background-color:${c}` : null;
    }
    case "vert": {
      if (a.val === "superscript") return "vertical-align:super;font-size:65%";
      if (a.val === "subscript") return "vertical-align:sub;font-size:65%";
      return null;
    }
    case "font": {
      const f = fontStack(fontName(a));
      return f ? `font-family:${f}` : null;
    }
    case "hidden":
      return null;
    default:
      return null;
  }
}

// ----------------------------------------------------------------------
// Nodes
// ----------------------------------------------------------------------

function paragraphDOM(node: PMNode): DOMOutputSpec {
  const a = node.attrs;
  const cls = ["p"];
  if (a.style) cls.push(styleClass("ps", a.style as string));
  if (a.sect) cls.push("has-sect");
  const style = [paragraphCss(a)];
  // An empty paragraph is as tall as its paragraph mark's font
  if (node.content.size === 0 && Array.isArray(a.pm)) {
    for (const m of a.pm as { type: string; attrs?: Attrs }[]) {
      if (m.type === "size" || m.type === "font") {
        const c = markCss(m.type, m.attrs ?? {});
        if (c) style.push(c);
      }
    }
  }
  const attrs: Record<string, string> = { class: cls.join(" ") };
  const s = style.filter(Boolean).join(";");
  if (s) attrs.style = s;
  return ["p", attrs, 0];
}

const paragraph: NodeSpec = {
  attrs: attrsOf(PARAGRAPH_ATTRS),
  content: "inline*",
  group: "block",
  marks: "_",
  parseDOM: [
    { tag: "p[data-pm]", getAttrs: (dom) => parseData(dom as HTMLElement) },
    { tag: "p" },
    { tag: "h1", attrs: { style: "Heading1" } },
    { tag: "h2", attrs: { style: "Heading2" } },
    { tag: "h3", attrs: { style: "Heading3" } },
    { tag: "h4", attrs: { style: "Heading4" } },
    { tag: "h5", attrs: { style: "Heading5" } },
    { tag: "h6", attrs: { style: "Heading6" } },
    { tag: "blockquote", attrs: { style: "Quote" } },
    { tag: "pre", attrs: { style: "NoSpacing" }, preserveWhitespace: "full" },
    { tag: "div", priority: 10 },
  ],
  toDOM: paragraphDOM,
};

function parseData(dom: HTMLElement): Attrs | false {
  try {
    return JSON.parse(dom.dataset.pm ?? "null") ?? {};
  } catch {
    return {};
  }
}

const TABLE_ATTRS = ["style", "jc", "tblW", "tblInd", "shd", "tblLayout", "tblLook", "tblBorders", "tblCellMar", "extra", "grid", "sdt"];
const ROW_ATTRS = ["trHeight", "header", "cantSplit", "extra", "sdt", "ex"];
const CELL_ATTRS = ["tcW", "shd", "vAlign", "tcBorders", "tcMar", "extra", "sdt"];

/** Table width and placement. */
export function tableCss(a: Attrs, textWidthTw?: number): string {
  const parts: string[] = [];
  const w = a.tblW as Attrs | null;
  if (w) {
    const type = (w.type as string) ?? "dxa";
    const v = num(w.w);
    if (type === "dxa" && v) parts.push(`width:${ztw(v)}`);
    else if (type === "pct" && v) {
      const pct = String(w.w).endsWith("%") ? parseFloat(String(w.w)) : v / 50;
      parts.push(`width:${pct}%`);
    }
  }
  const jc = a.jc as string | null;
  if (jc === "center") parts.push("margin-left:auto", "margin-right:auto");
  else if (jc === "right" || jc === "end") parts.push("margin-left:auto");
  else {
    const ind = a.tblInd as Attrs | null;
    const v = ind && (ind.type ?? "dxa") === "dxa" ? num(ind.w) : null;
    if (v) parts.push(`margin-left:${ztw(v)}`);
  }
  const shd = shadingColor(a.shd as Attrs);
  if (shd) parts.push(`background-color:${shd}`);
  if ((a.tblLayout as Attrs | null)?.type === "fixed") parts.push("table-layout:fixed");
  void textWidthTw;
  return css(parts);
}

/** Cell margins (padding) of a `w:tcMar` / `w:tblCellMar` map. */
export function cellMarginCss(m: Attrs | null | undefined): string[] {
  if (!m) return [];
  const out: string[] = [];
  for (const [side, value] of Object.entries(m)) {
    const css = SIDES[side];
    if (!css) continue;
    const v = value as Attrs;
    if ((v.type ?? "dxa") !== "dxa") continue;
    const n = num(v.w);
    if (n != null) out.push(`padding-${css}:${ztw(n)}`);
  }
  return out;
}

export function cellCss(a: Attrs): string {
  const parts: string[] = [];
  const widths = a.colwidth as number[] | null;
  if (widths && widths.length) parts.push(`width:${zpx(widths.reduce((s, w) => s + (w || 0), 0))}`);
  const shd = shadingColor(a.shd as Attrs);
  if (shd) parts.push(`background-color:${shd}`);
  const v = a.vAlign as string | null;
  if (v === "center") parts.push("vertical-align:middle");
  else if (v === "bottom") parts.push("vertical-align:bottom");
  parts.push(...cellMarginCss(a.tcMar as Attrs));
  return css(parts);
}

const table: NodeSpec = {
  attrs: attrsOf(TABLE_ATTRS),
  content: "table_row+",
  tableRole: "table",
  isolating: true,
  group: "block",
  parseDOM: [{ tag: "table", getAttrs: (dom) => ((dom as HTMLElement).dataset.pm ? parseData(dom as HTMLElement) : {}) }],
  toDOM(node) {
    const a = node.attrs;
    const cls = ["tbl"];
    if (a.style) cls.push(styleClass("ts", a.style as string));
    return ["table", { class: cls.join(" "), style: tableCss(a) }, ["tbody", 0]];
  },
};

const table_row: NodeSpec = {
  attrs: attrsOf(ROW_ATTRS),
  content: "table_cell+",
  tableRole: "row",
  parseDOM: [{ tag: "tr", getAttrs: (dom) => ((dom as HTMLElement).dataset.pm ? parseData(dom as HTMLElement) : {}) }],
  toDOM(node) {
    const h = node.attrs.trHeight as Attrs | null;
    const v = h ? num(h.val) : null;
    const style = v ? (h!.hRule === "exact" ? `height:${ztw(v)}` : `height:${ztw(v)}`) : "";
    return ["tr", style ? { style } : {}, 0];
  },
};

function cellAttrsFromDOM(dom: HTMLElement): Attrs {
  if (dom.dataset.pm) {
    const a = parseData(dom) || {};
    return a;
  }
  const widthAttr = dom.getAttribute("data-colwidth");
  const widths = widthAttr && /^\d+(,\d+)*$/.test(widthAttr) ? widthAttr.split(",").map((s) => Number(s)) : null;
  const colspan = Number(dom.getAttribute("colspan") || 1);
  return {
    colspan,
    rowspan: Number(dom.getAttribute("rowspan") || 1),
    colwidth: widths && widths.length === colspan ? widths : null,
  };
}

/** The element holding a cell's paragraphs (our own wrapper when present). */
function cellContent(dom: Node): HTMLElement {
  const el = dom as HTMLElement;
  return el.querySelector<HTMLElement>(":scope > .td-flow") ?? el;
}

const table_cell: NodeSpec = {
  attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, ...attrsOf(CELL_ATTRS) },
  content: "block+",
  tableRole: "cell",
  isolating: true,
  parseDOM: [
    { tag: "td", getAttrs: (dom) => cellAttrsFromDOM(dom as HTMLElement), contentElement: cellContent },
    { tag: "th", getAttrs: (dom) => cellAttrsFromDOM(dom as HTMLElement), contentElement: cellContent },
  ],
  toDOM(node) {
    const a = node.attrs;
    const attrs: Record<string, string> = {};
    if (a.colspan !== 1) attrs.colspan = String(a.colspan);
    if (a.rowspan !== 1) attrs.rowspan = String(a.rowspan);
    if (a.colwidth) attrs["data-colwidth"] = (a.colwidth as number[]).map((w) => Math.round(w)).join(",");
    const style = cellCss(a);
    if (style) attrs.style = style;
    // Paragraphs in a cell are laid out like in the body (no collapsing margins)
    return ["td", attrs, ["div", { class: "td-flow" }, 0]];
  },
};

const opaque_block: NodeSpec = {
  attrs: { xml: { default: "" }, kind: { default: "block" }, label: { default: "Content" }, text: { default: "" }, sdt: { default: null } },
  group: "block",
  atom: true,
  selectable: true,
  parseDOM: [{ tag: "div[data-opaque]", getAttrs: (dom) => parseData(dom as HTMLElement) }],
  toDOM(node) {
    const a = node.attrs;
    return [
      "div",
      { class: `opq-block opq-${a.kind}`, contenteditable: "false", title: `${a.label} (kept as it is)` },
      ["span", { class: "opq-label" }, String(a.label)],
      ["span", { class: "opq-text" }, String(a.text || "")],
    ];
  },
};

/** Data attributes of a tab (alignment tabs carry where they align). */
export function tabData(node: PMNode): Record<string, string> {
  const a = node.attrs;
  const out: Record<string, string> = { "data-tab": "1" };
  if (a.align) {
    out["data-align"] = String(a.align);
    out["data-rel"] = String(a.relativeTo ?? "margin");
    out["data-ptab-leader"] = String(a.leader ?? "none");
  }
  return out;
}

const tab: NodeSpec = {
  // `align` is set for alignment tabs (w:ptab): left, center or right of
  // the margins (`relativeTo` "margin") or of the indents ("indent")
  attrs: { align: { default: null }, relativeTo: { default: null }, leader: { default: null } },
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  parseDOM: [
    {
      tag: "span[data-tab]",
      getAttrs: (dom) => {
        const d = (dom as HTMLElement).dataset;
        return d.align ? { align: d.align, relativeTo: d.rel ?? "margin", leader: d.ptabLeader ?? "none" } : {};
      },
    },
    { tag: "span.pm-tab" },
  ],
  toDOM: (node) => ["span", { class: "pm-tab", ...tabData(node) }, "\t"],
  leafText: () => "\t",
};

const hard_break: NodeSpec = {
  attrs: { type: { default: "line" }, clear: { default: null } },
  inline: true,
  group: "inline",
  selectable: false,
  parseDOM: [
    { tag: "br", getAttrs: (dom) => ((dom as HTMLElement).classList.contains("hb-page") ? { type: "page" } : { type: "line" }) },
    { tag: "span.hb", getAttrs: (dom) => ({ type: (dom as HTMLElement).dataset.type ?? "line" }) },
  ],
  toDOM(node) {
    const t = node.attrs.type as string;
    if (t === "page" || t === "column") return ["span", { class: `hb hb-${t}`, "data-type": t }, ["br"]];
    return ["br"];
  },
  leafText: (node) => (node.attrs.type === "page" ? "\f" : "\n"),
};

const IMAGE_ATTRS = ["rid", "target", "external", "cx", "cy", "alt", "title", "name", "anchor", "raw"];

/** Pictures Word can store but browsers can't draw. */
export function isDrawableImage(target: string): boolean {
  return !/\.(emf|wmf|tif|tiff|wdp)$/i.test(target);
}

export function imageSrc(a: Attrs): string | null {
  const target = str(a.target);
  if (!target || a.external) return null;
  if (target.startsWith("data:")) return target;
  return ctx.docId ? mediaUrl(ctx.docId, target) : null;
}

const image: NodeSpec = {
  attrs: attrsOf(IMAGE_ATTRS),
  inline: true,
  group: "inline",
  draggable: true,
  atom: true,
  parseDOM: [
    {
      tag: "span.img-wrap[data-pm]",
      getAttrs: (dom) => parseData(dom as HTMLElement),
    },
    {
      tag: "img[data-pm]",
      getAttrs: (dom) => parseData(dom as HTMLElement),
    },
    {
      tag: "img[src]",
      getAttrs: (dom) => {
        const el = dom as HTMLImageElement;
        const w = Number(el.getAttribute("width")) || el.naturalWidth || 96;
        const h = Number(el.getAttribute("height")) || el.naturalHeight || 96;
        return { target: el.getAttribute("src"), alt: el.getAttribute("alt") ?? "", cx: Math.round(w * EMU_PER_PX), cy: Math.round(h * EMU_PER_PX), pending: true };
      },
    },
  ],
  toDOM(node) {
    // The same boxes as the editor's picture view (floating pictures too)
    const a = node.attrs;
    const w = (num(a.cx) ?? 914400) / EMU_PER_PX;
    const h = (num(a.cy) ?? 914400) / EMU_PER_PX;
    const src = imageSrc(a);
    const target = String(a.target ?? "");
    const layout = anchorLayout(a.raw as string | null, a.anchor === true);
    const wrap: Record<string, string> = { class: `img-wrap img-${layout.mode}${layout.behind ? " img-behind" : ""}`, title: String(a.alt || a.name || "") };
    if (layout.mode === "absolute") {
      wrap.style = `left:${Number.isFinite(layout.x) ? zpx(layout.x) : `calc(50% - ${w / 2}px * var(--z))`};top:${zpx(layout.y)}`;
    }
    const inner: DOMOutputSpec =
      src && isDrawableImage(target)
        ? ["img", { src, alt: String(a.alt ?? ""), draggable: "false" }]
        : ["span", { class: "img-missing" }, a.external ? "Linked picture" : /\.(emf|wmf)$/i.test(target) ? "Picture (EMF/WMF)" : String(a.alt || "Picture")];
    return ["span", wrap, ["span", { class: "img-box", style: `width:${zpx(w)};height:${zpx(h)}` }, inner]];
  },
};

const field_start: NodeSpec = {
  attrs: { instr: { default: "" }, xml: { default: "" } },
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  parseDOM: [{ tag: "span.fld-s", getAttrs: (dom) => parseData(dom as HTMLElement) }],
  toDOM: (node) => ["span", { class: "fld-s", "data-instr": String(node.attrs.instr ?? "") }],
  leafText: () => "",
};

const field_end: NodeSpec = {
  attrs: { xml: { default: "" } },
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  parseDOM: [{ tag: "span.fld-e", getAttrs: (dom) => parseData(dom as HTMLElement) }],
  toDOM: () => ["span", { class: "fld-e" }],
  leafText: () => "",
};

const opaque_inline: NodeSpec = {
  attrs: {
    xml: { default: "" },
    kind: { default: "unknown" },
    label: { default: "" },
    text: { default: "" },
    hidden: { default: false },
    noteId: { default: null },
  },
  inline: true,
  group: "inline",
  atom: true,
  parseDOM: [{ tag: "span[data-opaque]", getAttrs: (dom) => parseData(dom as HTMLElement) }],
  toDOM(node) {
    const a = node.attrs;
    if (a.hidden) return ["span", { class: `opq opq-hidden opq-${a.kind}`, "data-label": String(a.label ?? "") }];
    // Watermarks are drawn on the page, behind the text
    if (/PowerPlusWaterMarkObject/.test(String(a.xml ?? ""))) return ["span", { class: "opq opq-hidden opq-watermark", "data-label": "Watermark" }];
    const kind = a.kind as string;
    if (kind === "sym") {
      return ["span", { class: "opq opq-sym", style: `font-family:${fontStack(String(a.label || "Symbol"))}` }, String(a.text || "?")];
    }
    if (kind === "footnote" || kind === "endnote") {
      return ["span", { class: `opq opq-note opq-${kind}`, "data-note": String(a.noteId ?? "") }];
    }
    if (kind === "noteRef") {
      // The number at the start of a note (filled in when drawn)
      return ["span", { class: "opq opq-noteRef", "data-kind": String(a.label ?? "") }];
    }
    if (kind === "comment") {
      return ["span", { class: "opq opq-comment", "data-note": String(a.noteId ?? ""), title: "Comment" }];
    }
    const text = String(a.text || "");
    return ["span", { class: `opq opq-${kind}`, title: `${a.label} (kept as it is)` }, text || String(a.label || "Object")];
  },
  leafText: (node) => (node.attrs.hidden ? "" : String(node.attrs.text || "")),
};

// ----------------------------------------------------------------------
// Marks
// ----------------------------------------------------------------------

function cssMark(type: string, attrNames: string[], extra?: Partial<MarkSpec>): MarkSpec {
  return {
    attrs: attrsOf(attrNames),
    parseDOM: [{ tag: `span[data-mark="${type}"]`, getAttrs: (dom) => parseData(dom as HTMLElement) }],
    toDOM(mark: Mark): DOMOutputSpec {
      const style = markCss(type, mark.attrs);
      return ["span", style ? { style } : { class: `m-${type}` }, 0];
    },
    ...extra,
  };
}

/** Toggle marks: `on` is false when the run turns the property off. */
function onMark(type: string, html: { tags: string[]; styles?: [string, (v: string) => boolean][] }): MarkSpec {
  return {
    attrs: { on: { default: true } },
    parseDOM: [
      { tag: `span[data-mark="${type}"]`, getAttrs: (dom) => parseData(dom as HTMLElement) },
      ...html.tags.map((tag) => ({ tag })),
      ...(html.styles ?? []).map(([style, test]) => ({
        style,
        getAttrs: (v: string) => (test(v) ? {} : false),
      })),
    ],
    toDOM(mark: Mark): DOMOutputSpec {
      const style = markCss(type, mark.attrs);
      return ["span", style ? { style } : {}, 0];
    },
  };
}

const FONT_ATTRS = ["hint", "ascii", "hAnsi", "eastAsia", "cs", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"];
const COLOR_ATTRS = ["val", "themeColor", "themeTint", "themeShade"];
const UNDERLINE_ATTRS = ["val", "color", "themeColor", "themeTint", "themeShade"];
const SHADING_ATTRS = ["val", "color", "themeColor", "themeTint", "themeShade", "fill", "themeFill", "themeFillTint", "themeFillShade"];

const marks: Record<string, MarkSpec> = {
  // Wrappers first: they enclose the formatting spans
  sdt: {
    attrs: { id: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: "span.sdt", getAttrs: (dom) => parseData(dom as HTMLElement) }],
    toDOM: () => ["span", { class: "sdt" }, 0],
  },
  link: {
    attrs: attrsOf(["href", "anchor", "tooltip", "tgtFrame", "docLocation", "history"]),
    inclusive: false,
    parseDOM: [
      { tag: "a[data-pm]", getAttrs: (dom) => parseData(dom as HTMLElement) },
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = (dom as HTMLElement).getAttribute("href") ?? "";
          return href.startsWith("#") ? { anchor: href.slice(1) } : { href };
        },
      },
    ],
    toDOM(mark) {
      const a = mark.attrs;
      const href = a.href ? String(a.href) : a.anchor ? `#${a.anchor}` : "";
      return ["a", { href, title: String(a.tooltip ?? href), class: "lnk" }, 0];
    },
  },
  ins: {
    attrs: attrsOf(["id", "author", "date", "move"]),
    inclusive: false,
    parseDOM: [{ tag: "ins", getAttrs: (dom) => parseData(dom as HTMLElement) || {} }],
    toDOM: (mark) => ["ins", { class: "tc-ins", "data-author": String(mark.attrs.author ?? "") }, 0],
  },
  del: {
    attrs: attrsOf(["id", "author", "date", "move"]),
    inclusive: false,
    parseDOM: [{ tag: "del", getAttrs: (dom) => parseData(dom as HTMLElement) || {} }],
    toDOM: (mark) => ["del", { class: "tc-del", "data-author": String(mark.attrs.author ?? "") }, 0],
  },
  cstyle: {
    attrs: { id: { default: null } },
    parseDOM: [{ tag: "span[data-cstyle]", getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.cstyle }) }],
    toDOM: (mark) => ["span", { class: styleClass("cs", String(mark.attrs.id ?? "")) }, 0],
  },
  font: cssMark("font", FONT_ATTRS, {
    parseDOM: [
      { tag: 'span[data-mark="font"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      {
        style: "font-family",
        getAttrs: (v) => {
          const name = String(v).split(",")[0].trim().replace(/^["']|["']$/g, "");
          return name && !/^(inherit|initial|serif|sans-serif|monospace)$/i.test(name) ? { ascii: name, hAnsi: name, cs: name } : false;
        },
      },
    ],
  }),
  size: cssMark("size", ["val", "cs"], {
    parseDOM: [
      { tag: 'span[data-mark="size"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      {
        style: "font-size",
        getAttrs: (v) => {
          const m = /^([\d.]+)(pt|px)$/.exec(String(v).trim());
          if (!m) return false;
          const pt = m[2] === "px" ? parseFloat(m[1]) * 0.75 : parseFloat(m[1]);
          const half = String(Math.round(pt * 2));
          return { val: half, cs: half };
        },
      },
    ],
  }),
  bold: onMark("bold", {
    tags: ["strong", "b:not([style*='font-weight: normal'])"],
    styles: [["font-weight", (v) => /^(bold(er)?|[6-9]\d\d)$/.test(v)]],
  }),
  italic: onMark("italic", { tags: ["i", "em", "cite"], styles: [["font-style", (v) => v === "italic"]] }),
  underline: cssMark("underline", UNDERLINE_ATTRS, {
    parseDOM: [
      { tag: 'span[data-mark="underline"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      { tag: "u", getAttrs: () => ({ val: "single" }) },
      { style: "text-decoration", getAttrs: (v) => (String(v).includes("underline") ? { val: "single" } : false) },
      { style: "text-decoration-line", getAttrs: (v) => (String(v).includes("underline") ? { val: "single" } : false) },
    ],
  }),
  strike: onMark("strike", {
    tags: ["s", "strike"],
    styles: [
      ["text-decoration", (v) => v.includes("line-through")],
      ["text-decoration-line", (v) => v.includes("line-through")],
    ],
  }),
  dstrike: onMark("dstrike", { tags: [] }),
  caps: onMark("caps", { tags: [], styles: [["text-transform", (v) => v === "uppercase"]] }),
  smallCaps: onMark("smallCaps", { tags: [], styles: [["font-variant", (v) => v.includes("small-caps")]] }),
  hidden: {
    attrs: { on: { default: true } },
    parseDOM: [{ tag: 'span[data-mark="hidden"]', getAttrs: (dom) => parseData(dom as HTMLElement) }],
    toDOM: (mark) => ["span", mark.attrs.on !== false ? { class: "hidden-text" } : {}, 0],
  },
  color: cssMark("color", COLOR_ATTRS, {
    parseDOM: [
      { tag: 'span[data-mark="color"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      {
        style: "color",
        getAttrs: (v) => {
          const hex = cssToHex(String(v));
          return hex && hex !== "000000" ? { val: hex } : false;
        },
      },
    ],
  }),
  highlight: {
    attrs: { val: { default: "yellow" } },
    parseDOM: [
      { tag: 'span[data-mark="highlight"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      { tag: "mark", getAttrs: () => ({ val: "yellow" }) },
    ],
    toDOM(mark) {
      const style = markCss("highlight", mark.attrs);
      return ["span", style ? { style } : {}, 0];
    },
  },
  shading: cssMark("shading", SHADING_ATTRS, {
    parseDOM: [
      { tag: 'span[data-mark="shading"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      {
        style: "background-color",
        getAttrs: (v) => {
          const hex = cssToHex(String(v));
          return hex && hex !== "FFFFFF" ? { val: "clear", color: "auto", fill: hex } : false;
        },
      },
    ],
  }),
  charSpacing: cssMark("charSpacing", ["val"]),
  vert: {
    attrs: { val: { default: "superscript" } },
    excludes: "vert",
    parseDOM: [
      { tag: 'span[data-mark="vert"]', getAttrs: (dom) => parseData(dom as HTMLElement) },
      { tag: "sup", getAttrs: () => ({ val: "superscript" }) },
      { tag: "sub", getAttrs: () => ({ val: "subscript" }) },
    ],
    toDOM(mark) {
      const style = markCss("vert", mark.attrs);
      return ["span", style ? { style } : {}, 0];
    },
  },
  rextra: {
    attrs: { items: { default: [] } },
    parseDOM: [{ tag: 'span[data-mark="rextra"]', getAttrs: (dom) => parseData(dom as HTMLElement) }],
    toDOM: () => ["span", { class: "m-rx" }, 0],
  },
};

/** "rgb(255, 0, 0)" / "#f00" / "red" → "FF0000". */
export function cssToHex(v: string): string | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split("").map((c) => c + c).join("").toUpperCase();
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [m[1], m[2], m[3]].map((n) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const named: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", yellow: "FFFF00", gray: "808080", grey: "808080" };
  return named[s] ?? null;
}

export const schema = new Schema({
  nodes: {
    doc: { content: "block+", attrs: attrsOf(["page", "titlePg", "evenOdd", "numAdded", "background"]) },
    paragraph,
    table,
    table_row,
    table_cell,
    opaque_block,
    text: { group: "inline" },
    tab,
    hard_break,
    image,
    field_start,
    field_end,
    opaque_inline,
  },
  marks,
});

export type { PMNode };

/** Marks that are formatting (cleared by "Clear Formatting"). */
export const FORMAT_MARKS = [
  "font",
  "size",
  "bold",
  "italic",
  "underline",
  "strike",
  "dstrike",
  "caps",
  "smallCaps",
  "hidden",
  "color",
  "highlight",
  "shading",
  "charSpacing",
  "vert",
  "cstyle",
  "rextra",
];

/** A JSON document from the backend, made safe for the schema. */
export function docFromJSON(json: unknown): PMNode {
  try {
    return schema.nodeFromJSON(json as object);
  } catch (e) {
    console.error("Document doesn't match the schema; repairing", e);
    return schema.nodeFromJSON(repair(json) as object);
  }
}

/** Drops unknown node and mark types (a newer backend, a damaged file). */
function repair(json: unknown): unknown {
  const fix = (n: Record<string, unknown>): Record<string, unknown> | null => {
    if (!n || typeof n !== "object") return null;
    const type = n.type as string;
    if (!(type in schema.nodes)) return null;
    const out: Record<string, unknown> = { ...n };
    if (Array.isArray(n.marks)) out.marks = (n.marks as Record<string, unknown>[]).filter((m) => (m?.type as string) in schema.marks);
    if (Array.isArray(n.content)) {
      const kids = (n.content as Record<string, unknown>[]).map(fix).filter(Boolean);
      out.content = kids;
    }
    if (type === "doc" || type === "table_cell") {
      if (!Array.isArray(out.content) || !(out.content as unknown[]).length) out.content = [{ type: "paragraph" }];
    }
    return out;
  };
  return fix(json as Record<string, unknown>) ?? { type: "doc", content: [{ type: "paragraph" }] };
}
