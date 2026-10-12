// Word styles → CSS.
//
// A paragraph's formatting comes from, in order: document defaults, the
// table style (inside tables), the paragraph style and its `basedOn`
// chain, the list level, and direct formatting. The editor renders this
// with a generated stylesheet:
//
//   .pm-doc .p                     document defaults
//   .pm-doc .ts-<id> .p            table styles
//   .pm-doc .p.ps-<id>             paragraph styles (what the chain sets)
//   .pm-doc .cs-<id>               character styles
//   style="…"                      direct formatting (schema.ts)

import type { DocPayload, MarkJSON, StyleDef } from "../api";
import { indentCss, markCss, paraBorderCss, spacingCss, styleClass } from "./schema";
import { fontName, shadingColor } from "./render";
import { num, twips } from "./units";

type Attrs = Record<string, unknown>;
export type MarkMap = Record<string, Attrs>;

/** Single line height of common fonts, as a multiple of the font size. */
const LINE_FACTORS: Record<string, number> = {
  calibri: 1.22,
  "calibri light": 1.22,
  carlito: 1.22,
  aptos: 1.22,
  "aptos display": 1.22,
  "aptos narrow": 1.22,
  arial: 1.15,
  "liberation sans": 1.15,
  "times new roman": 1.15,
  "liberation serif": 1.15,
  cambria: 1.17,
  georgia: 1.14,
  "segoe ui": 1.33,
  verdana: 1.22,
  tahoma: 1.21,
  consolas: 1.17,
  "courier new": 1.13,
  garamond: 1.12,
  "century gothic": 1.23,
};

export function lineFactor(font: string | null | undefined): number {
  return (font && LINE_FACTORS[font.toLowerCase()]) || 1.17;
}

function mergeMaps(a: Attrs | undefined, b: Attrs | undefined): Attrs | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  return { ...a, ...b };
}

/** Merges paragraph properties (later wins, maps merge by attribute). */
export function mergePPr(base: Attrs, over: Attrs | undefined): Attrs {
  if (!over) return base;
  const out: Attrs = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null || v === undefined) continue;
    if (k === "spacing" || k === "ind" || k === "shd") out[k] = mergeMaps(out[k] as Attrs, v as Attrs);
    else if (k === "pBdr") out[k] = mergeMaps(out[k] as Attrs, v as Attrs);
    else if (k === "numPr") out[k] = mergeMaps(out[k] as Attrs, v as Attrs);
    else if (k === "tabs") {
      const list = [...((out.tabs as Attrs[]) ?? [])];
      for (const t of v as Attrs[]) {
        const pos = twips(t.pos);
        const i = list.findIndex((x) => twips(x.pos) === pos);
        if (i >= 0) list.splice(i, 1);
        if (t.val !== "clear") list.push(t);
      }
      out.tabs = list;
    } else out[k] = v;
  }
  return out;
}

export function marksToMap(marks: MarkJSON[] | undefined | null): MarkMap {
  const out: MarkMap = {};
  for (const m of marks ?? []) out[m.type] = { ...(m.attrs ?? {}) };
  return out;
}

export function mergeMarks(base: MarkMap, over: MarkMap): MarkMap {
  const out: MarkMap = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === "font" || k === "color" || k === "underline" || k === "shading" || k === "size") out[k] = { ...(out[k] ?? {}), ...stripNull(v) };
    else out[k] = v;
  }
  return out;
}

function stripNull(a: Attrs): Attrs {
  const out: Attrs = {};
  for (const [k, v] of Object.entries(a)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/** CSS declarations for run properties. */
export function runCss(m: MarkMap): string[] {
  const out: string[] = [];
  const deco: string[] = [];
  for (const [type, a] of Object.entries(m)) {
    if (type === "underline" || type === "strike" || type === "dstrike") {
      const c = markCss(type, a);
      if (c) deco.push(c);
      continue;
    }
    const c = markCss(type, a);
    if (c) out.push(c);
  }
  // Underline and strikethrough share text-decoration
  if (deco.length) {
    const lines: string[] = [];
    let style = "";
    let color = "";
    for (const d of deco) {
      for (const part of d.split(";")) {
        const [k, v] = part.split(":");
        if (k === "text-decoration-line") lines.push(v);
        else if (k === "text-decoration-style" && !style) style = v;
        else if (k === "text-decoration-color") color = v;
      }
    }
    out.push(`text-decoration-line:${lines.join(" ")}`);
    if (style) out.push(`text-decoration-style:${style}`);
    if (color) out.push(`text-decoration-color:${color}`);
  }
  const font = fontName(m.font);
  if (font) out.push(`--font-lh:${lineFactor(font)}`);
  return out;
}

/** CSS declarations for paragraph properties (style definitions). */
export function pprCss(p: Attrs): string[] {
  const out: string[] = [];
  out.push(...spacingCss(p.spacing as Attrs));
  out.push(...indentCss(p.ind as Attrs));
  const jc = p.jc as string | undefined;
  if (jc) {
    const map: Record<string, string> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
    if (map[jc]) out.push(`text-align:${map[jc]}`);
  }
  out.push(...paraBorderCss(p.pBdr as Attrs));
  const shd = shadingColor(p.shd as Attrs);
  if (shd) out.push(`background-color:${shd}`);
  return out;
}

export interface ResolvedParagraph {
  pPr: Attrs;
  rPr: MarkMap;
}

export interface GalleryStyle {
  id: string;
  name: string;
  type: "paragraph" | "character" | "table" | "numbering";
}

/** Display names of the built-in styles (documents store "heading 1"…). */
export function displayName(name: string): string {
  const m = /^heading (\d)$/i.exec(name);
  if (m) return `Heading ${m[1]}`;
  if (/^toc (\d)$/i.test(name)) return name.replace(/^toc/i, "TOC");
  const map: Record<string, string> = { caption: "Caption", header: "Header", footer: "Footer", "footnote text": "Footnote Text", "endnote text": "Endnote Text", "footnote reference": "Footnote Reference" };
  return map[name.toLowerCase()] ?? name;
}

export class StyleSheet {
  readonly byId = new Map<string, StyleDef>();
  readonly defaults: { rPr: MarkMap; pPr: Attrs };
  readonly defaultParagraph: string | null;
  readonly defaultCharacter: string | null;
  readonly defaultTable: string | null;
  private cacheP = new Map<string, ResolvedParagraph>();

  constructor(readonly payload: DocPayload["styles"]) {
    for (const s of payload.styles ?? []) if (!this.byId.has(s.id)) this.byId.set(s.id, s);
    this.defaults = { rPr: marksToMap(payload.defaults?.rPr), pPr: (payload.defaults?.pPr as Attrs) ?? {} };
    const def = (type: string) => (payload.styles ?? []).find((s) => s.type === type && s.default && !s.builtin)?.id ?? (payload.styles ?? []).find((s) => s.type === type && s.default)?.id ?? null;
    this.defaultParagraph = def("paragraph");
    this.defaultCharacter = def("character");
    this.defaultTable = def("table");
  }

  get(id: string | null | undefined): StyleDef | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** Style chain from the root ancestor to the style itself. */
  chain(id: string | null | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = this.get(id);
    while (cur && !seen.has(cur.id) && out.length < 20) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = this.get(cur.basedOn);
    }
    return out;
  }

  /** What a paragraph style's chain sets (without document defaults). */
  ownParagraph(id: string | null | undefined): ResolvedParagraph {
    const key = id ?? "";
    const hit = this.cacheP.get(key);
    if (hit) return hit;
    let pPr: Attrs = {};
    let rPr: MarkMap = {};
    for (const s of this.chain(id ?? this.defaultParagraph)) {
      pPr = mergePPr(pPr, s.pPr);
      rPr = mergeMarks(rPr, marksToMap(s.rPr));
    }
    const r = { pPr, rPr };
    this.cacheP.set(key, r);
    return r;
  }

  /** Full paragraph properties: defaults + style chain (+ direct when given). */
  paragraph(id: string | null | undefined, direct?: Attrs): ResolvedParagraph {
    const own = this.ownParagraph(id);
    let pPr = mergePPr({ ...this.defaults.pPr }, own.pPr);
    if (direct) pPr = mergePPr(pPr, direct);
    return { pPr, rPr: mergeMarks(this.defaults.rPr, own.rPr) };
  }

  character(id: string | null | undefined): MarkMap {
    let rPr: MarkMap = {};
    for (const s of this.chain(id)) {
      if (s.id === this.defaultCharacter) continue;
      rPr = mergeMarks(rPr, marksToMap(s.rPr));
    }
    return rPr;
  }

  table(id: string | null | undefined): StyleDef[] {
    return this.chain(id ?? this.defaultTable);
  }

  name(id: string | null | undefined): string {
    const s = this.get(id ?? this.defaultParagraph);
    return s ? displayName(s.name) : "Normal";
  }

  /** Heading level (1–9) of a paragraph style, from its outline level. */
  outlineLevel(id: string | null | undefined, direct?: number | null): number | null {
    if (typeof direct === "number" && direct < 9) return direct + 1;
    const lvl = this.ownParagraph(id).pPr.outlineLvl;
    if (typeof lvl === "number" && lvl < 9) return lvl + 1;
    const s = this.get(id);
    const m = s ? /^heading (\d)$/i.exec(s.name) : null;
    return m ? Number(m[1]) : null;
  }

  /** Styles for the gallery: quick styles first, in Word's order. */
  quickStyles(): GalleryStyle[] {
    const list = (this.payload.styles ?? []).filter((s) => (s.type === "paragraph" || s.type === "character") && s.qFormat && !s.hidden && !s.semiHidden);
    // A style without a priority sorts first (ECMA-376 17.7.4.19)
    const order = (s: StyleDef) => s.uiPriority ?? 0;
    list.sort((a, b) => order(a) - order(b) || displayName(a.name).localeCompare(displayName(b.name)));
    // Word always offers Normal, No Spacing and the first headings
    const pinned = ["Normal", "NoSpacing", "Heading1", "Heading2", "Heading3", "Title", "Subtitle"];
    const seen = new Set(list.map((s) => s.id));
    for (const id of pinned) {
      const s = this.get(id);
      if (s && !seen.has(id)) {
        list.push(s);
        seen.add(id);
      }
    }
    return list.map((s) => ({ id: s.id, name: displayName(s.name), type: s.type }));
  }

  allStyles(type?: "paragraph" | "character" | "table"): GalleryStyle[] {
    return (this.payload.styles ?? [])
      .filter((s) => (!type || s.type === type) && !s.hidden && s.type !== "numbering")
      .map((s) => ({ id: s.id, name: displayName(s.name), type: s.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The style a name refers to (case-insensitive name or id). */
  find(nameOrId: string): StyleDef | undefined {
    const lower = nameOrId.toLowerCase();
    return this.get(nameOrId) ?? (this.payload.styles ?? []).find((s) => s.name.toLowerCase() === lower || displayName(s.name).toLowerCase() === lower);
  }

  /** Tab stops of a paragraph (style chain + direct), in twips, sorted. */
  tabStops(styleId: string | null | undefined, direct: Attrs[] | null | undefined): { pos: number; val: string; leader: string }[] {
    const merged = mergePPr(mergePPr({}, this.paragraph(styleId).pPr), direct ? { tabs: direct } : undefined);
    return ((merged.tabs as Attrs[]) ?? [])
      .map((t) => ({ pos: twips(t.pos) ?? 0, val: String(t.val ?? "left"), leader: String(t.leader ?? "none") }))
      .filter((t) => t.val !== "clear" && t.val !== "bar")
      .sort((a, b) => a.pos - b.pos);
  }

  /** The list a paragraph belongs to (direct numPr or its style's). */
  numPr(styleId: string | null | undefined, direct: Attrs | null | undefined): { numId: number; ilvl: number } | null {
    let numId: number | null = null;
    let ilvl: number | null = null;
    const style = this.paragraph(styleId).pPr.numPr as Attrs | undefined;
    if (style) {
      numId = num(style.numId);
      ilvl = num(style.ilvl);
    }
    if (direct) {
      if (direct.numId != null) numId = num(direct.numId);
      if (direct.ilvl != null) ilvl = num(direct.ilvl);
    }
    if (numId == null || numId === 0) return null;
    return { numId, ilvl: ilvl ?? 0 };
  }

  /** The generated stylesheet, scoped under `scope`. */
  css(scope = ".pm-doc"): string {
    const rules: string[] = [];
    const base = [...pprCss(this.defaults.pPr), ...runCss(this.defaults.rPr)];
    if (!this.defaults.rPr.font) base.push('font-family:"Times New Roman", "Liberation Serif", Tinos, serif', "--font-lh:1.15");
    if (!this.defaults.rPr.size) base.push("font-size:calc(10pt * var(--z))");
    rules.push(`${scope} .p { ${base.join(";")} }`);
    rules.push(`${scope} { ${runCss(this.defaults.rPr).filter((d) => d.startsWith("font") || d.startsWith("--font")).join(";")} }`);

    // Table styles (beaten by paragraph styles that set the same property)
    for (const s of this.payload.styles ?? []) {
      if (s.type !== "table") continue;
      let pPr: Attrs = {};
      let rPr: MarkMap = {};
      for (const t of this.chain(s.id)) {
        pPr = mergePPr(pPr, t.pPr);
        rPr = mergeMarks(rPr, marksToMap(t.rPr));
      }
      const decl = [...pprCss(pPr), ...runCss(rPr)];
      if (decl.length) rules.push(`${scope} .${styleClass("ts", s.id)} .p { ${decl.join(";")} }`);
      // Conditional formatting: text of header rows, banded rows…
      for (const t of this.chain(s.id)) {
        for (const [kind, part] of Object.entries(t.conditional ?? {})) {
          const d = [...pprCss((part.pPr as Attrs) ?? {}), ...runCss(marksToMap(part.rPr))];
          if (d.length) rules.push(`${scope} .${styleClass("ts", s.id)} .c-${kind} .p { ${d.join(";")} }`);
        }
      }
    }

    // Paragraph styles: what each chain sets. Unstyled paragraphs use the default style.
    for (const s of this.payload.styles ?? []) {
      if (s.type !== "paragraph") continue;
      const own = this.ownParagraph(s.id);
      const decl = [...pprCss(own.pPr), ...runCss(own.rPr)];
      if (own.rPr.hidden && own.rPr.hidden.on !== false) decl.push("display:none");
      if (!decl.length) continue;
      const sel = [`${scope} .p.${styleClass("ps", s.id)}`];
      if (s.id === this.defaultParagraph) sel.push(`${scope} .p:not([class*=" ps-"])`);
      rules.push(`${sel.join(", ")} { ${decl.join(";")} }`);
    }

    // Character styles
    for (const s of this.payload.styles ?? []) {
      if (s.type !== "character") continue;
      const decl = runCss(this.character(s.id));
      if (decl.length) rules.push(`${scope} .${styleClass("cs", s.id)} { ${decl.join(";")} }`);
    }
    // List indents beat style indents (direct formatting, inline, beats both)
    rules.push(`${scope} .p.li { margin-left: var(--li-ml); text-indent: var(--li-ti); }`);
    return rules.join("\n");
  }
}

/** Table look flags (which conditional formats apply). */
export function tableLook(look: Attrs | null | undefined) {
  const val = look?.val ? parseInt(String(look.val), 16) : NaN;
  const flag = (name: string, bit: number, def: boolean) => {
    const v = look?.[name];
    if (v !== undefined && v !== null) return v === "1" || v === "true" || v === 1 || v === true;
    if (!Number.isNaN(val)) return (val & bit) !== 0;
    return def;
  };
  return {
    firstRow: flag("firstRow", 0x20, true),
    lastRow: flag("lastRow", 0x40, false),
    firstColumn: flag("firstColumn", 0x80, true),
    lastColumn: flag("lastColumn", 0x100, false),
    noHBand: flag("noHBand", 0x200, false),
    noVBand: flag("noVBand", 0x400, true),
  };
}
