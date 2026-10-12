// Bullets, numbering and multilevel lists.
//
// Lists made in the editor are new list definitions stored in the
// document's `numAdded` attribute; the backend adds them to numbering.xml
// when saving. A paragraph joins a list with `numPr` (list id and level).

import type { EditorState, Transaction } from "prosemirror-state";
import type { NumLevel, Numbering } from "../api";
import type { StyleSheet } from "../model/styles";
import { selectedParagraphs, type Dispatch } from "./commands";

type Attrs = Record<string, unknown>;

export interface ListFormat {
  id: string;
  kind: "bullet" | "number";
  /** Shown in the galleries. */
  sample: string[];
  levels: (ilvl: number) => Partial<NumLevel>;
}

const BULLET_CYCLE = ["•", "○", "▪"];
const INDENT = (l: number) => ({ ind: { left: String(720 * (l + 1)), hanging: "360" } });

function bulletList(id: string, first: string): ListFormat {
  return {
    id,
    kind: "bullet",
    sample: [first, BULLET_CYCLE[1], BULLET_CYCLE[2]],
    levels: (l) => ({ numFmt: "bullet", lvlText: l === 0 ? first : BULLET_CYCLE[l % 3], lvlJc: "left", pPr: INDENT(l) }),
  };
}

const NUM_CYCLE = ["decimal", "lowerLetter", "lowerRoman"];

function numberList(id: string, fmt: string, text: (n: number) => string, sample: string[]): ListFormat {
  return {
    id,
    kind: "number",
    sample,
    levels: (l) =>
      l === 0
        ? { numFmt: fmt, lvlText: text(1), lvlJc: fmt.includes("Roman") && fmt.startsWith("upper") ? "right" : "left", pPr: INDENT(0), start: 1 }
        : { numFmt: NUM_CYCLE[l % 3], lvlText: `%${l + 1}.`, lvlJc: l % 3 === 2 ? "right" : "left", pPr: INDENT(l), start: 1 },
  };
}

export const BULLET_FORMATS: ListFormat[] = [
  bulletList("b-dot", "•"),
  bulletList("b-circle", "○"),
  bulletList("b-square", "■"),
  bulletList("b-diamond", "◆"),
  bulletList("b-arrow", "➢"),
  bulletList("b-check", "✓"),
  bulletList("b-dash", "–"),
];

export const NUMBER_FORMATS: ListFormat[] = [
  numberList("n-decimal", "decimal", () => "%1.", ["1.", "2.", "3."]),
  numberList("n-paren", "decimal", () => "%1)", ["1)", "2)", "3)"]),
  numberList("n-upper-roman", "upperRoman", () => "%1.", ["I.", "II.", "III."]),
  numberList("n-upper-letter", "upperLetter", () => "%1.", ["A.", "B.", "C."]),
  numberList("n-lower-letter-paren", "lowerLetter", () => "%1)", ["a)", "b)", "c)"]),
  numberList("n-lower-letter", "lowerLetter", () => "%1.", ["a.", "b.", "c."]),
  numberList("n-lower-roman", "lowerRoman", () => "%1.", ["i.", "ii.", "iii."]),
];

export const MULTILEVEL_FORMATS: ListFormat[] = [
  {
    id: "m-legal",
    kind: "number",
    sample: ["1.", "1.1.", "1.1.1."],
    levels: (l) => ({
      numFmt: "decimal",
      lvlText: Array.from({ length: l + 1 }, (_, i) => `%${i + 1}.`).join(""),
      lvlJc: "left",
      start: 1,
      pPr: { ind: { left: String(360 + 432 * l), hanging: String(360 + 72 * l) } },
    }),
  },
  {
    id: "m-outline",
    kind: "number",
    sample: ["1)", "a)", "i)"],
    levels: (l) => ({
      numFmt: NUM_CYCLE[l % 3],
      lvlText: `%${l + 1})`,
      lvlJc: "left",
      start: 1,
      pPr: { ind: { left: String(360 * (l + 1)), hanging: "360" } },
    }),
  },
  {
    id: "m-article",
    kind: "number",
    sample: ["Article I.", "Section 1.01", "(a)"],
    levels: (l) =>
      l === 0
        ? { numFmt: "upperRoman", lvlText: "Article %1.", lvlJc: "left", start: 1, pPr: { ind: { left: "0", firstLine: "0" } } }
        : l === 1
          ? { numFmt: "decimalZero", lvlText: "Section %1.%2", lvlJc: "left", start: 1, pPr: { ind: { left: "0", firstLine: "0" } } }
          : { numFmt: "lowerLetter", lvlText: `(%${l + 1})`, lvlJc: "left", start: 1, pPr: { ind: { left: String(720 * (l - 1)), hanging: "432" } } },
  },
  bulletList("m-bullets", "•"),
];

const ALL_FORMATS = [...BULLET_FORMATS, ...NUMBER_FORMATS, ...MULTILEVEL_FORMATS];

function randomNsid(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0");
}

function levelsOf(format: ListFormat): NumLevel[] {
  return Array.from({ length: 9 }, (_, l) => ({
    ilvl: l,
    start: 1,
    numFmt: null,
    lvlText: null,
    lvlJc: "left",
    suff: null,
    lvlRestart: null,
    isLgl: false,
    pStyle: null,
    ...format.levels(l),
  })) as NumLevel[];
}

export class Lists {
  constructor(
    private numbering: Numbering,
    private sheet: StyleSheet,
  ) {}

  /** Bullet or number, for the ribbon. */
  kind(numId: number, ilvl: number): "bullet" | "number" | null {
    const n = this.numbering.nums?.[String(numId)];
    if (!n) return null;
    const abs = this.numbering.abstracts?.[String(n.abstract)];
    const level = n.overrides?.[String(ilvl)]?.level ?? abs?.levels?.find((l) => l.ilvl === ilvl) ?? abs?.levels?.[ilvl];
    if (!level) return null;
    return level.numFmt === "bullet" ? "bullet" : level.numFmt === "none" ? null : "number";
  }

  /** The format a list instance was made from (lists made in this app). */
  formatOf(numId: number): string | null {
    const abs = this.numbering.nums?.[String(numId)]?.abstract;
    return (abs && this.formatByAbstract.get(String(abs))) || null;
  }

  private formatByAbstract = new Map<string, string>();

  private nextId(map: Record<string, unknown> | undefined, floor: number): string {
    let max = floor;
    for (const k of Object.keys(map ?? {})) {
      const n = parseInt(k, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return String(max + 1);
  }

  /**
   * A list instance of `format`: continues `continueNum` when given,
   * otherwise starts a new one. Adds the definitions to the transaction.
   */
  instance(tr: Transaction, format: ListFormat, continueNum: number | null): number {
    if (continueNum != null) return continueNum;
    const added = [...(((tr.doc.attrs.numAdded as Attrs[] | null) ?? []) as Attrs[])];
    // One abstract definition per format, shared by its list instances
    let absId = [...this.formatByAbstract.entries()].find(([, f]) => f === format.id)?.[0] ?? null;
    if (!absId || !added.some((d) => d.kind === "abstract" && String(d.id) === absId)) {
      absId = this.nextId(this.numbering.abstracts, 90);
      const levels = levelsOf(format);
      this.numbering.abstracts[absId] = { levels, multi: "hybridMultilevel", numStyleLink: null, styleLink: null };
      this.formatByAbstract.set(absId, format.id);
      added.push({ kind: "abstract", id: absId, nsid: randomNsid(), multi: "hybridMultilevel", levels });
    }
    const numId = this.nextId(this.numbering.nums, 90);
    // A new list starts at 1 even when an earlier list used the same format
    const overrides = { "0": { start: 1, level: null } };
    this.numbering.nums[numId] = { abstract: absId, overrides };
    added.push({ kind: "num", id: numId, abstract: absId, overrides: { "0": { start: 1 } } });
    tr.setDocAttribute("numAdded", added);
    return Number(numId);
  }

  /** Applies a list format to the selected paragraphs, or removes it. */
  toggle(state: EditorState, dispatch: Dispatch, format: ListFormat, force = false) {
    const paras = selectedParagraphs(state);
    if (!paras.length) return;
    const current = paras.map((p) => this.sheet.numPr((p.node.attrs.style as string) ?? null, p.node.attrs.numPr as Attrs));
    const sameKind = current.every((c) => c && this.kind(c.numId, c.ilvl) === format.kind);
    const sameFormat = current.every((c) => c && this.formatOf(c.numId) === format.id);
    const tr = state.tr;
    if (!force && sameKind && (sameFormat || format.id === "b-dot" || format.id === "n-decimal")) {
      // Clicking the button of the current list removes it
      for (const { node, pos } of paras) {
        const a = { ...node.attrs } as Attrs;
        const styleNum = this.sheet.paragraph((a.style as string) ?? null).pPr.numPr;
        a.numPr = styleNum ? { numId: 0, ilvl: 0 } : null;
        if (a.style === "ListParagraph") a.style = null;
        tr.setNodeMarkup(pos, undefined, a, node.marks);
      }
      dispatch(tr);
      return;
    }
    // Continue the list just above when it has the same format
    const first = paras[0];
    const $first = state.doc.resolve(first.pos);
    const index = $first.index();
    const before = index > 0 ? $first.parent.child(index - 1) : null;
    let continueNum: number | null = null;
    if (before?.type.name === "paragraph") {
      const b = this.sheet.numPr((before.attrs.style as string) ?? null, before.attrs.numPr as Attrs);
      if (b && this.formatOf(b.numId) === format.id) continueNum = b.numId;
    }
    // Re-formatting an existing list keeps its paragraphs together
    if (continueNum == null && current[0] && sameKind) {
      const existing = current[0];
      if (existing && this.formatOf(existing.numId) === format.id) continueNum = existing.numId;
    }
    const numId = this.instance(tr, format, continueNum);
    for (let i = 0; i < paras.length; i++) {
      const { node, pos } = paras[i];
      const a = { ...node.attrs } as Attrs;
      const ilvl = current[i]?.ilvl ?? 0;
      a.numPr = { numId, ilvl };
      if (!a.style || a.style === this.sheet.defaultParagraph) a.style = this.sheet.get("ListParagraph") ? "ListParagraph" : a.style;
      // List indents replace direct ones
      if (a.ind) a.ind = null;
      tr.setNodeMarkup(tr.mapping.map(pos), undefined, a, node.marks);
    }
    dispatch(tr);
  }

  /** Moves the selected list paragraphs one level down (+1) or up (-1). */
  shiftLevel(state: EditorState, dispatch: Dispatch, delta: number): boolean {
    const paras = selectedParagraphs(state);
    const tr = state.tr;
    let any = false;
    for (const { node, pos } of paras) {
      const np = this.sheet.numPr((node.attrs.style as string) ?? null, node.attrs.numPr as Attrs);
      if (!np) continue;
      const ilvl = Math.max(0, Math.min(8, np.ilvl + delta));
      if (ilvl === np.ilvl) continue;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, numPr: { numId: np.numId, ilvl } }, node.marks);
      any = true;
    }
    if (any) dispatch(tr);
    return any;
  }

  /** Removes the list from the paragraph at the cursor (Backspace / Enter on an empty item). */
  removeAtCursor(state: EditorState, dispatch: Dispatch): boolean {
    const { $from } = state.selection;
    const para = $from.parent;
    if (para.type.name !== "paragraph") return false;
    const np = this.sheet.numPr((para.attrs.style as string) ?? null, para.attrs.numPr as Attrs);
    if (!np) return false;
    const styleNum = this.sheet.paragraph((para.attrs.style as string) ?? null).pPr.numPr;
    const a = { ...para.attrs } as Attrs;
    a.numPr = styleNum ? { numId: 0, ilvl: 0 } : null;
    if (a.style === "ListParagraph") a.style = null;
    dispatch(state.tr.setNodeMarkup($from.before(), undefined, a, para.marks));
    return true;
  }

  /** Starts the list again at 1 from the paragraph at the cursor. */
  restart(state: EditorState, dispatch: Dispatch) {
    const { $from } = state.selection;
    const para = $from.parent;
    const np = this.sheet.numPr((para.attrs.style as string) ?? null, para.attrs.numPr as Attrs);
    if (!np) return;
    const formatId = this.formatOf(np.numId);
    const format = ALL_FORMATS.find((f) => f.id === formatId);
    const tr = state.tr;
    let numId: number;
    if (format) numId = this.instance(tr, format, null);
    else {
      // A list from the file: a new instance of its definition, restarting
      const added = [...(((tr.doc.attrs.numAdded as Attrs[] | null) ?? []) as Attrs[])];
      const abs = this.numbering.nums[String(np.numId)]?.abstract;
      if (abs == null) return;
      const id = this.nextId(this.numbering.nums, 90);
      this.numbering.nums[id] = { abstract: String(abs), overrides: { [String(np.ilvl)]: { start: 1, level: null } } };
      added.push({ kind: "num", id, abstract: String(abs), overrides: { [String(np.ilvl)]: { start: 1 } } });
      tr.setDocAttribute("numAdded", added);
      numId = Number(id);
    }
    // This paragraph and the following ones of the same list
    const parent = $from.node($from.depth - 1);
    const startIndex = $from.index($from.depth - 1);
    let pos = $from.before();
    for (let i = startIndex; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (child.type.name === "paragraph") {
        const c = this.sheet.numPr((child.attrs.style as string) ?? null, child.attrs.numPr as Attrs);
        if (c && c.numId === np.numId) tr.setNodeMarkup(pos, undefined, { ...child.attrs, numPr: { numId, ilvl: c.ilvl } }, child.marks);
        else if (i > startIndex && !c && child.textContent.trim()) break;
      }
      pos += child.nodeSize;
    }
    dispatch(tr);
  }
}

export function findFormat(id: string): ListFormat | undefined {
  return ALL_FORMATS.find((f) => f.id === id);
}
