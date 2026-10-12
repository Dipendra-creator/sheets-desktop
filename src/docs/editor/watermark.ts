// Watermarks (Design > Watermark): Word keeps them as a WordArt shape in
// the page headers (VML, id "PowerPlusWaterMarkObject…"), drawn centred
// on every page behind the text.

import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../model/schema";

export interface Watermark {
  text: string;
  font: string;
  /** "#RRGGBB" or a CSS color name. */
  color: string;
  /** Degrees clockwise (315: Word's diagonal layout). */
  rotation: number;
  /** Size of the shape (pt). */
  width: number;
  height: number;
  opacity: number;
}

/** Word's gallery: [text, diagonal]. */
export const WATERMARK_PRESETS: { group: string; items: [string, boolean][] }[] = [
  { group: "Confidential", items: [["CONFIDENTIAL", true], ["CONFIDENTIAL", false], ["DO NOT COPY", true], ["DO NOT COPY", false]] },
  { group: "Disclaimers", items: [["DRAFT", true], ["DRAFT", false], ["SAMPLE", true], ["SAMPLE", false]] },
  { group: "Urgent", items: [["ASAP", true], ["ASAP", false], ["URGENT", true], ["URGENT", false]] },
];

const MARK = /PowerPlusWaterMarkObject/;

export function isWatermarkXml(xml: string): boolean {
  return MARK.test(xml);
}

function unescapeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A watermark's properties, read from its XML. */
export function parseWatermark(xml: string): Watermark | null {
  if (!MARK.test(xml)) return null;
  const text = /<v:textpath\b[^>]*\bstring="([^"]*)"/.exec(xml)?.[1];
  if (text == null) return null;
  const style = /<v:shape\b[^>]*\bstyle="([^"]*)"/.exec(xml)?.[1] ?? "";
  const pt = (name: string, d: number) => {
    const m = new RegExp(`(?:^|;)\\s*${name}:\\s*([\\d.]+)(pt|in|px)?`).exec(style);
    if (!m) return d;
    const v = parseFloat(m[1]);
    return m[2] === "in" ? v * 72 : m[2] === "px" ? v * 0.75 : v;
  };
  const textStyle = unescapeXml(/<v:textpath\b[^>]*\bstyle="([^"]*)"/.exec(xml)?.[1] ?? "");
  const font = /font-family:\s*"?([^";]+)"?/.exec(textStyle)?.[1]?.trim() ?? "Calibri";
  const fill = /\bfillcolor="([^"]+)"/.exec(xml)?.[1] ?? "silver";
  const op = /<v:fill\b[^>]*\bopacity="([^"]+)"/.exec(xml)?.[1];
  const opacity = op ? (op.endsWith("f") ? parseFloat(op) / 65536 : parseFloat(op)) : 1;
  return {
    text: unescapeXml(text),
    font,
    color: fill.startsWith("#") || /^[a-z]+$/i.test(fill) ? fill.replace(/ .*$/, "") : "silver",
    rotation: Number(/rotation:\s*(-?[\d.]+)/.exec(style)?.[1] ?? 0) || 0,
    width: pt("width", 468),
    height: pt("height", 117),
    opacity: Number.isFinite(opacity) ? opacity : 0.5,
  };
}

/** The watermark of a header, if it has one. */
export function storyWatermark(doc: PMNode | null): Watermark | null {
  let found: Watermark | null = null;
  doc?.descendants((node) => {
    if (found) return false;
    if (node.type.name === "opaque_inline" && isWatermarkXml(String(node.attrs.xml ?? ""))) found = parseWatermark(String(node.attrs.xml));
    return !found;
  });
  return found;
}

/** Word's WordArt shape type for text watermarks. */
const SHAPETYPE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">' +
  '<v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/>' +
  '<v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/>' +
  '<v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas>' +
  '<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/>' +
  '<v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles>' +
  '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';

/** A watermark shape for a header (`n` keeps the shape ids apart). */
export function watermarkXml(w: Watermark, n: number): string {
  const style = [
    "position:absolute",
    "margin-left:0",
    "margin-top:0",
    `width:${Math.round(w.width * 100) / 100}pt`,
    `height:${Math.round(w.height * 100) / 100}pt`,
    w.rotation ? `rotation:${w.rotation}` : "",
    "z-index:-251654144",
    "mso-wrap-edited:f",
    "mso-position-horizontal:center",
    "mso-position-horizontal-relative:margin",
    "mso-position-vertical:center",
    "mso-position-vertical-relative:margin",
  ]
    .filter(Boolean)
    .join(";");
  const opacity = w.opacity < 1 ? `<v:fill opacity="${Math.round(w.opacity * 100) / 100}"/>` : "";
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>${SHAPETYPE}` +
    `<v:shape id="PowerPlusWaterMarkObject${100000 + n}" o:spid="_x0000_s${2049 + n}" type="#_x0000_t136" style="${style}" o:allowincell="f" fillcolor="${escapeXml(w.color)}" stroked="f">` +
    `${opacity}<v:textpath style="font-family:&quot;${escapeXml(w.font)}&quot;;font-size:1pt" string="${escapeXml(w.text)}"/>` +
    `<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`
  );
}

/** A watermark like Word's gallery ones (text sized to the line it fills). */
export function presetWatermark(text: string, diagonal: boolean, font = "Calibri", color = "silver", semitransparent = true): Watermark {
  const width = diagonal ? 527.85 : 468;
  const height = Math.max(40, Math.min(width / 1.6, width / Math.max(2, text.length * 0.62)));
  return { text, font, color, rotation: diagonal ? 315 : 0, width, height, opacity: semitransparent ? 0.5 : 1 };
}

/** The watermark node put in a header. */
export function watermarkNode(w: Watermark, n: number): PMNode {
  return schema.nodes.opaque_inline.create({ kind: "shape", label: "Watermark", xml: watermarkXml(w, n), hidden: false });
}

/** A header without its watermark (null when nothing changed). */
export function withoutWatermark(doc: PMNode): PMNode | null {
  let removed = false;
  const strip = (node: PMNode): PMNode => {
    if (!node.childCount) return node;
    const kids: PMNode[] = [];
    node.forEach((c) => {
      if (c.type.name === "opaque_inline" && isWatermarkXml(String(c.attrs.xml ?? ""))) {
        removed = true;
        return;
      }
      kids.push(strip(c));
    });
    return node.type.create(node.attrs, kids, node.marks);
  };
  const out = strip(doc);
  return removed ? out : null;
}
