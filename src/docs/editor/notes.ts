// Footnotes and endnotes. The reference mark in the text is an opaque
// node (kind "footnote" / "endnote", with the note's id); the note itself
// is a small document of its own, starting with the note's number (an
// opaque "noteRef" node). Footnotes are drawn at the bottom of the page
// their reference is on, endnotes after the end of the document.

import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "../model/schema";
import type { StyleSheet } from "../model/styles";
import { layoutTabs } from "./tabs";

export type NoteKind = "footnote" | "endnote";

export const NOTE_KINDS: NoteKind[] = ["footnote", "endnote"];

/** Height of the short line above the notes of a page (unzoomed px). */
export const NOTE_SEPARATOR = 16;

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** How a note's number is shown: 1, 2, 3 for footnotes; i, ii, iii for endnotes (Word's defaults). */
export function noteLabel(kind: NoteKind, n: number): string {
  return kind === "endnote" ? roman(n) : String(n);
}

function styles(kind: NoteKind) {
  return kind === "footnote" ? { text: "FootnoteText", ref: "FootnoteReference" } : { text: "EndnoteText", ref: "EndnoteReference" };
}

/** The reference mark put in the text. */
export function noteReference(kind: NoteKind, id: string): PMNode {
  const tag = kind === "footnote" ? "footnoteReference" : "endnoteReference";
  return schema.nodes.opaque_inline.create({
    kind,
    label: kind,
    noteId: id,
    xml: `<w:r><w:rPr><w:rStyle w:val="${styles(kind).ref}"/></w:rPr><w:${tag} w:id="${id}"/></w:r>`,
  });
}

/** A new, empty note: its number and a space, in the note text style. */
export function newNote(kind: NoteKind, sheet: StyleSheet): PMNode {
  const s = styles(kind);
  const number = schema.nodes.opaque_inline.create({
    kind: "noteRef",
    label: kind,
    xml: `<w:r><w:rPr><w:rStyle w:val="${s.ref}"/></w:rPr><w:${kind}Ref/></w:r>`,
  });
  const para = schema.nodes.paragraph.create({ style: sheet.get(s.text) ? s.text : null }, [number, schema.text(" ")]);
  return schema.nodes.doc.create(null, para);
}

const REF_IN_XML = /<w:(footnote|endnote)Reference\b[^>]*\bw:id="([^"]+)"/g;

/** Ids of the notes the document refers to, in order (including references kept in raw XML). */
export function referencedNotes(doc: PMNode): Record<NoteKind, string[]> {
  const out: Record<NoteKind, string[]> = { footnote: [], endnote: [] };
  const seen = new Set<string>();
  const add = (kind: NoteKind, id: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[kind].push(id);
  };
  doc.descendants((node) => {
    if (node.type.name === "opaque_inline") {
      const kind = node.attrs.kind as string;
      if ((kind === "footnote" || kind === "endnote") && node.attrs.noteId != null) add(kind, String(node.attrs.noteId));
      else for (const m of String(node.attrs.xml ?? "").matchAll(REF_IN_XML)) add(m[1] as NoteKind, m[2]);
      return false;
    }
    if (node.type.name === "opaque_block") {
      for (const m of String(node.attrs.xml ?? "").matchAll(REF_IN_XML)) add(m[1] as NoteKind, m[2]);
      return false;
    }
    return true;
  });
  return out;
}

/** Plain text of a note (tooltips), without its number. */
export function noteText(doc: PMNode | undefined): string {
  if (!doc) return "";
  return doc.textBetween(0, doc.content.size, "\n", (leaf) => (leaf.type.name === "tab" ? "\t" : "")).trim();
}

/** Shows the note's number on its "noteRef" nodes (in the note editor). */
export function noteNumberPlugin(label: () => string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === "opaque_inline" && node.attrs.kind === "noteRef") decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-n": label() }));
          return node.isBlock;
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/** A note drawn as static HTML (its number filled in, tabs laid out). */
export function renderNote(el: HTMLElement, doc: PMNode, label: string, sheet: StyleSheet, defaultTab: number) {
  el.textContent = "";
  el.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  el.querySelectorAll<HTMLElement>(".opq-noteRef").forEach((r) => (r.dataset.n = label));
  const paras = Array.from(el.querySelectorAll<HTMLElement>(":scope > .p"));
  const items: { el: HTMLElement; node: PMNode }[] = [];
  let k = 0;
  doc.forEach((n) => {
    if (n.type.name !== "paragraph") return;
    const p = paras[k++];
    if (p && p.querySelector(".pm-tab")) items.push({ el: p, node: n });
  });
  if (items.length && el.isConnected) layoutTabs(items, { sheet, defaultTab });
}
