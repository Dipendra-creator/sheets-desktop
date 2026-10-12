// Word's keyboard shortcuts and AutoFormat As You Type.

import { chainCommands, exitCode } from "prosemirror-commands";
import { InputRule, inputRules, undoInputRule } from "prosemirror-inputrules";
import type { Attrs as PMAttrs } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import { schema } from "../model/schema";
import type { DocController } from "./controller";
import { BULLET_FORMATS, NUMBER_FORMATS, type ListFormat } from "./lists";

type Attrs = Record<string, unknown>;

const cmd =
  (fn: () => void): Command =>
  () => {
    fn();
    return true;
  };

/** Enter: the new paragraph gets the style's "next" style (Heading → Normal). */
function enter(ctl: DocController): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const para = $from.parent;
    if (para.type.name !== "paragraph" || !$from.sameParent($to)) return false;
    const a = para.attrs as Attrs;
    // Enter on an empty list item ends the list
    const numPr = ctl.sheet.numPr((a.style as string) ?? null, a.numPr as Attrs);
    if (numPr && para.content.size === 0) {
      if (numPr.ilvl > 0) return ctl.lists.shiftLevel(state, dispatch ?? (() => {}), -1);
      return ctl.lists.removeAtCursor(state, dispatch ?? (() => {}));
    }
    // "---" / "===" / "___" … then Enter: a border under the paragraph
    const text = para.textContent;
    const border = /^(-{3,}|={3,}|_{3,}|\*{3,}|~{3,}|#{3,})$/.exec(text);
    if (border && dispatch) {
      const kind = border[1][0];
      const line: Record<string, Attrs> = {
        "-": { val: "single", sz: "6" },
        "=": { val: "double", sz: "6" },
        _: { val: "single", sz: "18" },
        "*": { val: "dotted", sz: "18" },
        "~": { val: "wave", sz: "6" },
        "#": { val: "thinThickThinSmallGap", sz: "24" },
      };
      const tr = state.tr;
      const start = $from.start();
      tr.delete(start, start + para.content.size);
      tr.setNodeMarkup($from.before(), undefined, { ...a, pBdr: { bottom: { ...line[kind], space: "1", color: "auto" } } });
      const pos = tr.mapping.map(start);
      tr.split(pos, 1, [{ type: schema.nodes.paragraph, attrs: { ...a, pBdr: null } as PMAttrs }]);
      dispatch(tr.scrollIntoView());
      return true;
    }
    if (!dispatch) return true;
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const pos = tr.selection.from;
    const $pos = tr.doc.resolve(pos);
    const atEnd = $pos.parentOffset === $pos.parent.content.size;
    const atStart = $pos.parentOffset === 0;
    const style = (a.style as string) ?? ctl.sheet.defaultParagraph;
    const next = ctl.sheet.get(style)?.next;
    let newAttrs: Attrs = { ...a, sect: null };
    let firstAttrs: Attrs | null = null;
    if (atEnd && next && next !== style) {
      newAttrs = { style: next === ctl.sheet.defaultParagraph ? null : next };
    }
    // A section break stays with the paragraph mark (the second half)
    if (a.sect) {
      firstAttrs = { ...a, sect: null };
      newAttrs = { ...newAttrs, sect: a.sect };
    }
    // Page break before only applies to the first half
    if (a.pageBreakBefore) newAttrs.pageBreakBefore = null;
    const marks = state.storedMarks ?? $pos.marks();
    tr.split(pos, 1, [{ type: schema.nodes.paragraph, attrs: newAttrs as PMAttrs }]);
    if (firstAttrs) tr.setNodeMarkup($pos.before(), undefined, firstAttrs);
    if (atStart && !atEnd) {
      // Enter at the start: the empty paragraph above keeps the attributes
    }
    if (marks.length) tr.setStoredMarks(marks.filter((m) => m.type.name !== "link" && m.type.name !== "sdt"));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Backspace at the start of a list item removes its number. */
function backspace(ctl: DocController): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "paragraph") return false;
    const a = $from.parent.attrs as Attrs;
    const numPr = ctl.sheet.numPr((a.style as string) ?? null, a.numPr as Attrs);
    if (numPr) return ctl.lists.removeAtCursor(state, dispatch ?? (() => {}));
    // A first-line indent goes before joining paragraphs
    const ind = a.ind as Attrs | null;
    if (ind && (ind.firstLine || ind.hanging) && dispatch) {
      dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...a, ind: { ...ind, firstLine: null, hanging: null } }));
      return true;
    }
    return false;
  };
}

/** Tab: next cell in tables, deeper list level at the start of an item, else a tab. */
function tab(ctl: DocController, dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (isInTable(state)) {
      if (goToNextCell(dir)(state, dispatch)) return true;
      if (dir > 0 && dispatch) {
        // Tab in the last cell adds a row
        addRowAfter(state, dispatch);
        return goToNextCell(1)(view!.state, dispatch);
      }
      return true;
    }
    const { $from, empty } = state.selection;
    const a = $from.parent.attrs as Attrs;
    const numPr = $from.parent.type.name === "paragraph" ? ctl.sheet.numPr((a.style as string) ?? null, a.numPr as Attrs) : null;
    if (numPr && (($from.parentOffset === 0 && empty) || !empty)) {
      return ctl.lists.shiftLevel(state, dispatch ?? (() => {}), dir);
    }
    if (dir < 0) return true;
    if (dispatch) {
      const marks = state.storedMarks ?? $from.marks();
      dispatch(state.tr.replaceSelectionWith(schema.nodes.tab.create(null, null, marks), true).scrollIntoView());
    }
    return true;
  };
}

/** Alt+Shift+Up/Down: moves the paragraph up or down. */
function moveParagraph(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth < 1) return false;
    const depth = $from.depth;
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const other = index + dir;
    if (other < 0 || other >= parent.childCount) return false;
    if (!dispatch) return true;
    const node = parent.child(index);
    const sibling = parent.child(other);
    const start = $from.before(depth);
    const tr = state.tr;
    const offset = state.selection.from - start;
    if (dir < 0) {
      const sibStart = start - sibling.nodeSize;
      tr.replaceWith(sibStart, start + node.nodeSize, Fragment.from([node, sibling]));
      tr.setSelection(TextSelection.create(tr.doc, sibStart + offset));
    } else {
      const end = start + node.nodeSize + sibling.nodeSize;
      tr.replaceWith(start, end, Fragment.from([sibling, node]));
      tr.setSelection(TextSelection.create(tr.doc, start + sibling.nodeSize + offset));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Ctrl+Up/Down: to the start of this / the next paragraph. */
function paragraphJump(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    let target: number | null = null;
    if (dir < 0) {
      if ($from.parentOffset > 0) target = $from.start();
      else {
        const before = state.doc.resolve(Math.max(0, $from.before() - 1));
        target = before.parent.isTextblock ? before.start() : null;
      }
    } else {
      const after = $from.after();
      if (after < state.doc.content.size) {
        const sel = TextSelection.findFrom(state.doc.resolve(after), 1, true);
        target = sel?.from ?? null;
      }
    }
    if (target == null) return false;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
    return true;
  };
}

function insertText(text: string): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const marks = state.storedMarks ?? state.selection.$from.marks();
      dispatch(state.tr.replaceSelectionWith(schema.text(text, marks), true).scrollIntoView());
    }
    return true;
  };
}

export function wordKeymap(ctl: DocController): Record<string, Command> {
  const style = (id: string) => cmd(() => ctl.setStyle(id));
  return {
    "Mod-b": cmd(() => ctl.toggleOn("bold")),
    "Mod-i": cmd(() => ctl.toggleOn("italic")),
    "Mod-u": cmd(() => ctl.toggleUnderline()),
    "Mod-Shift-d": cmd(() => ctl.setUnderline(ctl.format.underline === "double" ? null : "double")),
    "Mod-Shift-w": cmd(() => ctl.setUnderline(ctl.format.underline === "words" ? null : "words")),
    "Mod-=": cmd(() => ctl.setVert("subscript")),
    "Mod-Shift-=": cmd(() => ctl.setVert("superscript")),
    "Mod-+": cmd(() => ctl.setVert("superscript")),
    "Mod-Shift-a": cmd(() => ctl.toggleOn("caps")),
    "Mod-Shift-k": cmd(() => ctl.toggleOn("smallCaps")),
    "Mod-Shift-h": cmd(() => ctl.toggleOn("hidden")),
    "Mod-d": cmd(() => ctl.openDialog("font")),
    "Mod-Shift-f": cmd(() => ctl.openDialog("font")),
    "Mod-]": cmd(() => ctl.growFont(1, "point")),
    "Mod-[": cmd(() => ctl.growFont(-1, "point")),
    "Mod-Shift-.": cmd(() => ctl.growFont(1)),
    "Mod-Shift-,": cmd(() => ctl.growFont(-1)),
    "Mod->": cmd(() => ctl.growFont(1)),
    "Mod-<": cmd(() => ctl.growFont(-1)),
    "Mod- ": cmd(() => ctl.apply((state, dispatch) => {
      const tr = state.tr;
      for (const r of state.selection.ranges) for (const m of ["font", "size", "bold", "italic", "underline", "strike", "dstrike", "caps", "smallCaps", "color", "highlight", "shading", "charSpacing", "vert", "cstyle"]) tr.removeMark(r.$from.pos, r.$to.pos, schema.marks[m]);
      dispatch(tr.setStoredMarks([]));
    })),
    "Mod-q": cmd(() => ctl.apply((state, dispatch) => {
      const tr = state.tr;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name !== "paragraph") return true;
        const a = node.attrs as Attrs;
        tr.setNodeMarkup(pos, undefined, { ...Object.fromEntries(Object.keys(a).map((k) => [k, null])), style: a.style, numPr: a.numPr, sect: a.sect, sdt: a.sdt, extra: a.extra });
        return false;
      });
      dispatch(tr);
    })),
    "Mod-l": cmd(() => ctl.setAlign("left")),
    "Mod-e": cmd(() => ctl.setAlign(ctl.format.align === "center" ? "left" : "center")),
    "Mod-r": cmd(() => ctl.setAlign(ctl.format.align === "right" ? "left" : "right")),
    "Mod-j": cmd(() => ctl.setAlign(ctl.format.align === "justify" ? "left" : "both")),
    "Mod-m": cmd(() => ctl.indent(1)),
    "Mod-Shift-m": cmd(() => ctl.indent(-1)),
    "Mod-t": cmd(() => ctl.setIndent({ first: -720, left: (ctl.format.indentLeft || 0) + 720 })),
    "Mod-Shift-t": cmd(() => ctl.setIndent({ first: null, left: Math.max(0, (ctl.format.indentLeft || 0) - 720) })),
    "Mod-1": cmd(() => ctl.setLineSpacing(1)),
    "Mod-2": cmd(() => ctl.setLineSpacing(2)),
    "Mod-5": cmd(() => ctl.setLineSpacing(1.5)),
    "Mod-0": cmd(() => ctl.toggleSpace("before")),
    "Mod-Alt-1": style("Heading1"),
    "Mod-Alt-2": style("Heading2"),
    "Mod-Alt-3": style("Heading3"),
    "Mod-Shift-n": cmd(() => ctl.setStyle(ctl.sheet.defaultParagraph ?? "Normal")),
    "Mod-Shift-l": cmd(() => ctl.bullets()),
    "Mod-Shift-s": cmd(() => ctl.openDialog("styles")),
    "Mod-Shift-c": cmd(() => ctl.startPainter(false)),
    "Mod-Enter": cmd(() => ctl.pageBreak()),
    "Mod-Shift-Enter": cmd(() => ctl.columnBreak()),
    "Shift-Enter": chainCommands(exitCode, cmd(() => ctl.lineBreak())),
    Enter: enter(ctl),
    Backspace: chainCommands(undoInputRule, backspace(ctl)),
    Tab: tab(ctl, 1),
    "Shift-Tab": tab(ctl, -1),
    "Mod-k": cmd(() => ctl.openDialog("link")),
    "Mod-f": cmd(() => {
      ctl.navPane = true;
      ctl.emit();
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".nav-search input")?.focus());
    }),
    "Mod-h": cmd(() => ctl.openDialog("find", { tab: "replace" })),
    "Mod-g": cmd(() => ctl.openDialog("find", { tab: "goto" })),
    F5: cmd(() => ctl.openDialog("find", { tab: "goto" })),
    "Mod-a": cmd(() => ctl.selectAll()),
    "Mod-Shift-8": cmd(() => ctl.toggle("showMarks")),
    "Mod-*": cmd(() => ctl.toggle("showMarks")),
    "Shift-F3": cmd(() => ctl.changeCase("cycle")),
    "Mod-Shift-e": cmd(() => ctl.setTracking(!ctl.trackChanges)),
    "Ctrl-Alt-f": cmd(() => ctl.insertNote("footnote")),
    "Ctrl-Alt-d": cmd(() => ctl.insertNote("endnote")),
    "Alt-Shift-d": cmd(() => ctl.insertDate({ month: "numeric", day: "numeric", year: "numeric" }, true)),
    "Alt-Shift-t": cmd(() => ctl.insertField('TIME \\@ "h:mm am/pm"', new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))),
    "Alt-Shift-p": cmd(() => ctl.insertField("PAGE", String(ctl.currentPage + 1))),
    F9: cmd(() => ctl.updateFieldsInSelection()),
    "Mod-Alt-c": insertText("©"),
    "Mod-Alt-r": insertText("®"),
    "Mod-Alt-t": insertText("™"),
    "Mod-Alt-.": insertText("…"),
    "Mod-Shift- ": insertText(" "),
    "Mod-Shift--": insertText("‑"),
    "Mod--": insertText("­"),
    "Mod-Alt--": insertText("—"),
    "Alt-Shift-ArrowUp": moveParagraph(-1),
    "Alt-Shift-ArrowDown": moveParagraph(1),
    "Mod-ArrowUp": paragraphJump(-1),
    "Mod-ArrowDown": paragraphJump(1),
    Escape: () => {
      if (!ctl.painter) return false;
      ctl.painter = null;
      ctl.emit();
      return true;
    },
  };
}

// ----------------------------------------------------------------------
// AutoFormat As You Type and AutoCorrect
// ----------------------------------------------------------------------

const TYPOS: Record<string, string> = {
  teh: "the",
  adn: "and",
  recieve: "receive",
  seperate: "separate",
  occured: "occurred",
  untill: "until",
  wich: "which",
  beleive: "believe",
  definately: "definitely",
  accomodate: "accommodate",
  acheive: "achieve",
  alot: "a lot",
  thier: "their",
  freind: "friend",
  goverment: "government",
  wierd: "weird",
  tommorow: "tomorrow",
  begining: "beginning",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  isnt: "isn't",
  wasnt: "wasn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  wouldnt: "wouldn't",
  ive: "I've",
  youre: "you're",
  thats: "that's",
  becuase: "because",
  hte: "the",
  taht: "that",
  waht: "what",
  whcih: "which",
};

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|fig|approx|inc|ltd|jr|sr)\.\s$/i;

function listRule(re: RegExp, format: ListFormat, ctl: DocController): InputRule {
  return new InputRule(re, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type.name !== "paragraph" || $start.parentOffset !== 0) return null;
    const a = $start.parent.attrs as Attrs;
    if (ctl.sheet.numPr((a.style as string) ?? null, a.numPr as Attrs)) return null;
    const tr = state.tr.delete(start, end);
    let result: Transaction | null = null;
    ctl.lists.toggle(state.apply(tr), (t) => (result = t), format, true);
    if (!result) return null;
    // Merge: the deletion, then the list
    const merged = state.tr.delete(start, end);
    for (const step of (result as Transaction).steps) merged.step(step);
    return merged;
  });
}

function replaceRule(re: RegExp, replace: (m: RegExpMatchArray) => string | null): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const text = replace(match);
    if (text == null) return null;
    const marks = state.doc.resolve(start).marks();
    return state.tr.replaceWith(start, end, schema.text(text, marks));
  });
}

function smartQuote(state: EditorState, start: number, open: string, close: string): string {
  const before = state.doc.textBetween(Math.max(start - 1, state.doc.resolve(start).start()), start);
  return !before || /[\s([{“‘—–-]$/.test(before) ? open : close;
}

export function autoFormatRules(ctl: DocController) {
  const rules: InputRule[] = [
    listRule(/^\s*[*•]\s$/, BULLET_FORMATS[0], ctl),
    listRule(/^\s*-\s$/, BULLET_FORMATS[6], ctl),
    listRule(/^\s*>\s$/, BULLET_FORMATS[4], ctl),
    listRule(/^1[.]\s$/, NUMBER_FORMATS[0], ctl),
    listRule(/^1[)]\s$/, NUMBER_FORMATS[1], ctl),
    listRule(/^I[.]\s$/, NUMBER_FORMATS[2], ctl),
    listRule(/^A[.]\s$/, NUMBER_FORMATS[3], ctl),
    listRule(/^a[)]\s$/, NUMBER_FORMATS[4], ctl),
    listRule(/^a[.]\s$/, NUMBER_FORMATS[5], ctl),
    listRule(/^i[.]\s$/, NUMBER_FORMATS[6], ctl),
    new InputRule(/"$/, (state, _m, start, end) => state.tr.replaceWith(start, end, schema.text(smartQuote(state, start, "“", "”"), state.doc.resolve(start).marks()))),
    new InputRule(/'$/, (state, _m, start, end) => state.tr.replaceWith(start, end, schema.text(smartQuote(state, start, "‘", "’"), state.doc.resolve(start).marks()))),
    replaceRule(/\(c\)$/i, () => "©"),
    replaceRule(/\(r\)$/i, () => "®"),
    replaceRule(/\(tm\)$/i, () => "™"),
    replaceRule(/\.\.\.$/, () => "…"),
    replaceRule(/->$/, () => "→"),
    replaceRule(/<-$/, () => "←"),
    replaceRule(/=>$/, () => "⇒"),
    replaceRule(/(\S)--(\S)$/, (m) => (m[2] === "-" ? null : `${m[1]}—${m[2]}`)),
    replaceRule(/ -- $/, () => " – "),
    replaceRule(/(^|\s)1\/2(\s)$/, (m) => `${m[1]}½${m[2]}`),
    replaceRule(/(^|\s)1\/4(\s)$/, (m) => `${m[1]}¼${m[2]}`),
    replaceRule(/(^|\s)3\/4(\s)$/, (m) => `${m[1]}¾${m[2]}`),
    // AutoCorrect: common typos and a lone "i"
    replaceRule(/(^|[\s(“"])([A-Za-z]+)([\s.,;:!?])$/, (m) => {
      const word = m[2];
      const fix = TYPOS[word.toLowerCase()];
      if (word === "i") return `${m[1]}I${m[3]}`;
      if (!fix) return null;
      const out = word[0] === word[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
      return `${m[1]}${out}${m[3]}`;
    }),
    // Capitalize the first letter of sentences
    new InputRule(/(?:^|[.!?]\s+)(\p{Ll})(\p{L}*)\s$/u, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      const before = $start.parent.textBetween(0, $start.parentOffset, " ", " ");
      if (ABBREVIATIONS.test(before + match[0].replace(/\s$/, "") + " ")) return null;
      if (/^(https?|www)/i.test(match[1] + match[2])) return null;
      const letterPos = start + match[0].indexOf(match[1]);
      const marks = state.doc.resolve(letterPos).marks();
      return state.tr.replaceWith(letterPos, letterPos + match[1].length, schema.text(match[1].toUpperCase(), marks)).insertText(" ", end);
    }),
    // Ordinals: 1st → 1ˢᵗ
    new InputRule(/(?:^|\s)(\d+)(st|nd|rd|th)\s$/, (state, match, start, end) => {
      const sufStart = end - match[2].length;
      const marks = state.doc.resolve(end).marks().filter((m) => m.type.name !== "vert");
      const tr = state.tr.addMark(sufStart, end, schema.marks.vert.create({ val: "superscript" }));
      tr.insert(end, schema.text(" ", marks));
      tr.setStoredMarks(marks);
      void start;
      return tr;
    }),
  ];
  return inputRules({ rules });
}
