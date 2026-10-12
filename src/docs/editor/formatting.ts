// Formatting that depends on more than one node, drawn with decorations:
// list numbers, "don't add space between paragraphs of the same style",
// table borders and conditional formats (header row, banded rows),
// footnote numbers and comment ranges.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { TableMap } from "prosemirror-tables";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Numbering } from "../api";
import { Numberer, type ListItem } from "../model/numbering";
import { borderCss, shadingColor } from "../model/render";
import { cellMarginCss, markCss } from "../model/schema";
import { mergePPr, tableLook, type StyleSheet } from "../model/styles";
import { num, twips, ztw } from "../model/units";
import { noteLabel, type NoteKind } from "./notes";

type Attrs = Record<string, unknown>;

export interface FormattingEnv {
  sheet: StyleSheet;
  numbering: Numbering;
  /** Text of a footnote or endnote (the reference's tooltip). */
  noteText?: (kind: NoteKind, id: string) => string;
}

export interface FormattingState {
  decos: DecorationSet;
  /** Footnote / endnote numbers by note id. */
  notes: Map<string, number>;
  /** List label of each listed paragraph, by position. */
  labels: Map<number, ListItem>;
}

export const formattingKey = new PluginKey<FormattingState>("formatting");

const SYMBOL_FONTS = /^(symbol|wingdings.*|webdings)$/i;

function labelDom(item: ListItem, hanging: number, suffix: string): HTMLElement {
  const span = document.createElement("span");
  span.className = `li-label ${item.bullet ? "li-bullet" : "li-number"}`;
  span.contentEditable = "false";
  span.textContent = item.text;
  const styles: string[] = [];
  for (const m of item.level.rPr ?? []) {
    if (m.type === "font" && SYMBOL_FONTS.test(String(m.attrs?.ascii ?? m.attrs?.hAnsi ?? ""))) continue;
    const c = markCss(m.type, m.attrs ?? {});
    if (c) styles.push(c);
  }
  if (suffix === "tab" && hanging > 0) styles.push(`min-width:${ztw(hanging)}`);
  if (suffix === "space") styles.push("padding-right:0.3em");
  const jc = item.level.lvlJc;
  if (jc === "right" || jc === "end") styles.push("text-align:right", "padding-right:0.3em");
  else if (jc === "center") styles.push("text-align:center");
  span.setAttribute("style", styles.join(";"));
  return span;
}

/** Edge order of conditional formats (later wins). */
const CONDITIONAL_ORDER = ["wholeTable", "band1Vert", "band2Vert", "band1Horz", "band2Horz", "firstCol", "lastCol", "firstRow", "lastRow", "neCell", "nwCell", "seCell", "swCell"];

function tableDecorations(table: PMNode, pos: number, env: FormattingEnv, out: Decoration[]) {
  const a = table.attrs as Attrs;
  const chain = env.sheet.table(a.style as string | null);
  // Table-level properties: style chain, then direct
  let tblPr: Attrs = {};
  const conditional: Record<string, { tblPr?: Attrs; tcPr?: Attrs }> = {};
  for (const s of chain) {
    tblPr = { ...tblPr, ...(s.tblPr ?? {}) };
    if (s.tcPr) tblPr = { ...tblPr, __tcPr: { ...((tblPr.__tcPr as Attrs) ?? {}), ...s.tcPr } };
    for (const [k, v] of Object.entries(s.conditional ?? {})) conditional[k] = { ...(conditional[k] ?? {}), ...v };
  }
  const borders: Attrs = { ...((tblPr.tblBorders as Attrs) ?? {}), ...((a.tblBorders as Attrs) ?? {}) };
  const cellMar: Attrs = { ...((tblPr.tblCellMar as Attrs) ?? {}), ...((a.tblCellMar as Attrs) ?? {}) };
  const look = tableLook(a.tblLook as Attrs);
  const map = TableMap.get(table);
  const headerRows = look.firstRow && conditional.firstRow ? 1 : 0;
  const start = pos + 1;
  const seen = new Set<number>();
  for (let i = 0; i < map.map.length; i++) {
    const offset = map.map[i];
    if (seen.has(offset)) continue;
    seen.add(offset);
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const rect = map.findCell(offset);
    const top = rect.top === 0;
    const bottom = rect.bottom === map.height;
    const left = rect.left === 0;
    const right = rect.right === map.width;
    const kinds: string[] = ["wholeTable"];
    if (look.firstRow && top && conditional.firstRow) kinds.push("firstRow");
    if (look.lastRow && bottom && conditional.lastRow) kinds.push("lastRow");
    if (look.firstColumn && left && conditional.firstCol) kinds.push("firstCol");
    if (look.lastColumn && right && conditional.lastCol) kinds.push("lastCol");
    const bodyRow = rect.top - headerRows;
    if (!look.noHBand && bodyRow >= 0 && !(look.lastRow && bottom && conditional.lastRow)) kinds.push(bodyRow % 2 === 0 ? "band1Horz" : "band2Horz");
    const bodyCol = rect.left - (look.firstColumn && conditional.firstCol ? 1 : 0);
    if (!look.noVBand && bodyCol >= 0) kinds.push(bodyCol % 2 === 0 ? "band1Vert" : "band2Vert");
    if (top && left && look.firstRow && look.firstColumn && conditional.nwCell) kinds.push("nwCell");
    if (top && right && look.firstRow && look.lastColumn && conditional.neCell) kinds.push("neCell");
    kinds.sort((x, y) => CONDITIONAL_ORDER.indexOf(x) - CONDITIONAL_ORDER.indexOf(y));

    // Borders: table edges and inside lines, then conditional, then the cell's own
    const edge: Record<string, unknown> = {
      top: top ? borders.top : borders.insideH,
      bottom: bottom ? borders.bottom : borders.insideH,
      left: left ? (borders.left ?? borders.start) : (borders.insideV ?? null),
      right: right ? (borders.right ?? borders.end) : (borders.insideV ?? null),
    };
    let shade: string | null = null;
    for (const k of kinds) {
      const part = conditional[k];
      if (!part) continue;
      const tcB = (part.tcPr?.tcBorders as Attrs) ?? {};
      const tbB = (part.tblPr?.tblBorders as Attrs) ?? {};
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const v = tcB[side] ?? (side === "left" ? tcB.start : side === "right" ? tcB.end : undefined) ?? tbB[side];
        if (v) edge[side] = v;
      }
      if (tcB.insideH) {
        if (!top) edge.top = tcB.insideH;
        if (!bottom) edge.bottom = tcB.insideH;
      }
      if (tcB.insideV) {
        if (!left) edge.left = tcB.insideV;
        if (!right) edge.right = tcB.insideV;
      }
      const s = shadingColor(part.tcPr?.shd as Attrs);
      if (s) shade = s;
    }
    const own = (cell.attrs.tcBorders as Attrs) ?? {};
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const v = own[side] ?? (side === "left" ? own.start : side === "right" ? own.end : undefined);
      if (v) edge[side] = v;
    }
    if (!shade) shade = shadingColor((tblPr.__tcPr as Attrs | undefined)?.shd as Attrs);

    const style: string[] = [];
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const css = borderCss(edge[side] as Attrs);
      if (css && css !== "none") style.push(`--b${side[0]}:${css}`);
    }
    if (shade) style.push(`--cbg:${shade}`);
    if (!cell.attrs.tcMar) {
      for (const d of cellMarginCss(cellMar)) {
        const [k, v] = d.split(":");
        style.push(`--c${k.replace("padding-", "p")}:${v}`);
      }
    }
    out.push(
      Decoration.node(start + offset, start + offset + cell.nodeSize, {
        class: kinds
          .filter((k) => k !== "wholeTable")
          .map((k) => `c-${k}`)
          .join(" "),
        style: style.join(";"),
      }),
    );
  }
  void num;
}

function compute(doc: PMNode, env: FormattingEnv): FormattingState {
  const decos: Decoration[] = [];
  const numberer = new Numberer(env.numbering, env.sheet);
  const notes = new Map<string, number>();
  const labels = new Map<number, ListItem>();
  let footnote = 0;
  let endnote = 0;
  const commentStarts = new Map<string, number>();
  const prevByParent = new Map<PMNode, { node: PMNode; pos: number; style: string | null; ctx: boolean } | null>();

  doc.descendants((node, pos, parent) => {
    if (node.type.name === "table") {
      tableDecorations(node, pos, env, decos);
      if (parent) prevByParent.set(parent, null);
      return true;
    }
    if (node.type.name === "paragraph") {
      const a = node.attrs as Attrs;
      const styleId = (a.style as string | null) ?? env.sheet.defaultParagraph;
      const resolved = env.sheet.paragraph(styleId, undefined);
      const contextual = (a.contextualSpacing as boolean | null) ?? (resolved.pPr.contextualSpacing === true);
      // Contextual spacing between paragraphs of the same style
      const prev = parent ? prevByParent.get(parent) : null;
      if (prev && prev.style === styleId) {
        if (contextual) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "cx-top" }));
        if (prev.ctx) decos.push(Decoration.node(prev.pos, prev.pos + prev.node.nodeSize, { class: "cx-bot" }));
      }
      if (parent) prevByParent.set(parent, { node, pos, style: styleId, ctx: contextual });

      // Lists
      const numPr = env.sheet.numPr(styleId, a.numPr as Attrs);
      if (numPr) {
        const item = numberer.next(numPr.numId, numPr.ilvl);
        if (item) {
          labels.set(pos, item);
          // Indents: style < list level < direct
          const lvlInd = (item.level.pPr?.ind as Attrs) ?? {};
          const ind = mergePPr(mergePPr({}, { ind: resolved.pPr.ind as Attrs }), { ind: lvlInd }).ind as Attrs;
          const left = twips(ind.left ?? ind.start) ?? 0;
          const hanging = twips(ind.hanging);
          const first = twips(ind.firstLine);
          const ti = hanging != null ? -hanging : (first ?? 0);
          decos.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "li",
              style: `--li-ml:${ztw(left)};--li-ti:${ztw(ti)}`,
            }),
          );
          const suffix = item.level.suff ?? "tab";
          if (item.text || suffix !== "nothing") {
            decos.push(
              Decoration.widget(pos + 1, () => labelDom(item, hanging ?? 0, suffix), {
                side: -1,
                ignoreSelection: true,
                key: `li:${item.text}:${hanging}:${suffix}:${JSON.stringify(item.level.rPr ?? [])}`,
                marks: [],
              }),
            );
          }
        }
      }
      return true;
    }
    if (node.type.name === "opaque_inline") {
      const kind = node.attrs.kind as string;
      if (kind === "footnote" || kind === "endnote") {
        const n = kind === "footnote" ? ++footnote : ++endnote;
        const id = String(node.attrs.noteId ?? "");
        notes.set(`${kind}:${id}`, n);
        const tip = env.noteText?.(kind, id);
        decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-n": noteLabel(kind, n), ...(tip ? { title: tip } : {}) }));
      } else if (node.attrs.hidden && /^commentRange(Start|End)$/.test(String(node.attrs.label))) {
        const id = /w:id="([^"]+)"/.exec(String(node.attrs.xml))?.[1];
        if (id) {
          if (node.attrs.label === "commentRangeStart") commentStarts.set(id, pos);
          else {
            const from = commentStarts.get(id);
            if (from != null && pos > from) decos.push(Decoration.inline(from, pos, { class: "cmt-range", "data-cid": id }));
          }
        }
      }
      return false;
    }
    return true;
  });
  return { decos: DecorationSet.create(doc, decos), notes, labels };
}

export function formattingPlugin(env: FormattingEnv): Plugin<FormattingState> {
  return new Plugin<FormattingState>({
    key: formattingKey,
    state: {
      init: (_config, state: EditorState) => compute(state.doc, env),
      apply: (tr, old, _oldState, newState) => (tr.docChanged || tr.getMeta(formattingKey) ? compute(newState.doc, env) : old),
    },
    props: {
      decorations: (state) => formattingKey.getState(state)?.decos,
    },
  });
}
