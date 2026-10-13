// Find and Replace: highlights every match and the current one.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  /** Word's wildcards (? * [ ] < >) are translated to a regular expression. */
  wildcards: boolean;
  /** Ignore punctuation / white space (simple: collapse spaces). */
  ignoreSpace: boolean;
}

export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  options: FindOptions;
  matches: Match[];
  current: number;
  decos: DecorationSet;
}

export const findKey = new PluginKey<FindState>("find");

export const DEFAULT_FIND: FindOptions = { matchCase: false, wholeWord: false, wildcards: false, ignoreSpace: false };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word wildcards → a regular expression source. */
function wildcardToRe(q: string): string {
  let out = "";
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === "?") out += ".";
    else if (c === "*") out += ".*?";
    else if (c === "<") out += "\\b(?=\\w)";
    else if (c === ">") out += "\\b(?<=\\w)";
    else if (c === "[") {
      const end = q.indexOf("]", i);
      if (end > i) {
        out += `[${q.slice(i + 1, end).replace(/^!/, "^")}]`;
        i = end;
      } else out += "\\[";
    } else if (c === "@") out += "+";
    else if (c === "{") {
      const end = q.indexOf("}", i);
      if (end > i) {
        out += `{${q.slice(i + 1, end)}}`;
        i = end;
      } else out += "\\{";
    } else if (c === "\\" && i + 1 < q.length) {
      out += escapeRe(q[i + 1]);
      i++;
    } else out += escapeRe(c);
  }
  return out;
}

/** Special characters of Word's Find box (^p paragraph, ^t tab…). */
function specials(q: string): string {
  return q.replace(/\^t/g, "\t").replace(/\^\^/g, "^");
}

export function buildRegex(query: string, o: FindOptions): RegExp | null {
  if (!query) return null;
  let src = o.wildcards ? wildcardToRe(specials(query)) : escapeRe(specials(query));
  if (o.ignoreSpace) src = src.replace(/(\\ |\s)+/g, "\\s*");
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, `gu${o.matchCase ? "" : "i"}`);
  } catch {
    return null;
  }
}

/** Text of each textblock with a map from string offsets to positions. */
export function findAll(doc: PMNode, query: string, o: FindOptions): Match[] {
  const re = buildRegex(query, o);
  if (!re) return [];
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        // Deleted text (tracked) isn't found
        if (child.marks.some((m) => m.type.name === "del")) {
          text += "\u0000".repeat(child.text!.length);
          for (let i = 0; i < child.text!.length; i++) map.push(start + i);
          return;
        }
        text += child.text!;
        for (let i = 0; i < child.text!.length; i++) map.push(start + i);
      } else if (child.type.name === "tab") {
        text += "\t";
        map.push(start);
      } else {
        text += "\u0000";
        map.push(start);
      }
    });
    map.push(pos + 1 + node.content.size);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m[0].includes("\u0000")) continue;
      out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
      if (out.length > 20000) return false;
    }
    return false;
  });
  return out;
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "find-hit current" : "find-hit" })),
  );
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: "", options: DEFAULT_FIND, matches: [], current: -1, decos: DecorationSet.empty }),
      apply(tr: Transaction, old: FindState, _o: EditorState, state: EditorState) {
        const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
        if (meta) {
          const query = meta.query ?? old.query;
          const options = meta.options ?? old.options;
          const matches = query ? findAll(state.doc, query, options) : [];
          let current = meta.current ?? -1;
          if (current < 0 && matches.length) {
            const head = state.selection.from;
            current = Math.max(0, matches.findIndex((m) => m.from >= head));
          }
          current = matches.length ? Math.min(current, matches.length - 1) : -1;
          return { query, options, matches, current, decos: decorate(state.doc, matches, current) };
        }
        if (tr.docChanged && old.query) {
          const matches = findAll(state.doc, old.query, old.options);
          const current = Math.min(old.current, matches.length - 1);
          return { ...old, matches, current, decos: decorate(state.doc, matches, current) };
        }
        return old;
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.decos,
    },
  });
}

export function setSearch(view: EditorView, query: string, options?: FindOptions) {
  view.dispatch(view.state.tr.setMeta(findKey, { query, options, current: -1 }));
}

/** Selects the next (or previous) match and scrolls to it. */
export function gotoMatch(view: EditorView, dir: 1 | -1, select = true): boolean {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return false;
  let i: number;
  const head = view.state.selection.from;
  if (st.current >= 0 && st.matches[st.current] && st.matches[st.current].from === view.state.selection.from && st.matches[st.current].to === view.state.selection.to) {
    i = (st.current + dir + st.matches.length) % st.matches.length;
  } else if (dir === 1) {
    i = st.matches.findIndex((m) => m.from >= head);
    if (i < 0) i = 0;
  } else {
    i = -1;
    for (let k = st.matches.length - 1; k >= 0; k--) if (st.matches[k].to <= head) { i = k; break; }
    if (i < 0) i = st.matches.length - 1;
  }
  const m = st.matches[i];
  const tr = view.state.tr.setMeta(findKey, { current: i });
  if (select) tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Replaces the current match (if selected) and moves to the next one. */
export function replaceOne(view: EditorView, replacement: string): boolean {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return false;
  const { from, to } = view.state.selection;
  const hit = st.matches.find((m) => m.from === from && m.to === to);
  if (!hit) return gotoMatch(view, 1);
  const marks = view.state.doc.resolve(from + 1).marks();
  const tr = view.state.tr;
  if (replacement) tr.replaceWith(from, to, view.state.schema.text(replacement, marks));
  else tr.delete(from, to);
  view.dispatch(tr);
  gotoMatch(view, 1);
  return true;
}

/** Replaces every match; returns how many. */
export function replaceAll(view: EditorView, replacement: string): number {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return 0;
  const tr = view.state.tr;
  for (let i = st.matches.length - 1; i >= 0; i--) {
    const m = st.matches[i];
    const marks = view.state.doc.resolve(Math.min(m.from + 1, m.to)).marks();
    if (replacement) tr.replaceWith(m.from, m.to, view.state.schema.text(replacement, marks));
    else tr.delete(m.from, m.to);
  }
  view.dispatch(tr);
  return st.matches.length;
}
