// Word Count: words, characters and paragraphs, counted like Word does
// (deleted tracked text and hidden markers don't count).

import type { Node as PMNode } from "prosemirror-model";

export interface WordStats {
  words: number;
  /** Characters without spaces. */
  chars: number;
  charsWithSpaces: number;
  paragraphs: number;
  lines: number;
}

const WORD = /[^\s ]+/g;

function textOf(block: PMNode): string {
  let text = "";
  block.forEach((child) => {
    if (child.isText) {
      if (!child.marks.some((m) => m.type.name === "del" || (m.type.name === "hidden" && m.attrs.on !== false))) text += child.text;
    } else if (child.type.name === "tab") text += "\t";
    else if (child.type.name === "hard_break") text += "\n";
    else if (child.type.name === "opaque_inline" && !child.attrs.hidden) text += String(child.attrs.text ?? "");
  });
  return text;
}

export function countText(text: string): { words: number; chars: number; charsWithSpaces: number } {
  const words = (text.match(WORD) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const charsWithSpaces = Array.from(text.replace(/[\n\t]/g, " ")).length;
  const chars = Array.from(text.replace(/\s/g, "")).length;
  return { words, chars, charsWithSpaces };
}

export function countWords(doc: PMNode): WordStats {
  const out: WordStats = { words: 0, chars: 0, charsWithSpaces: 0, paragraphs: 0, lines: 0 };
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const text = textOf(node);
    if (text.trim()) out.paragraphs++;
    const c = countText(text);
    out.words += c.words;
    out.chars += c.chars;
    out.charsWithSpaces += c.charsWithSpaces;
    // Roughly 12 words a line on a Letter page
    out.lines += text.trim() ? Math.max(1, Math.ceil(c.words / 12)) : 0;
    return false;
  });
  return out;
}
