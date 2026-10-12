// Track Changes: with tracking on, typed text is marked as inserted and
// deleted text stays, marked as deleted, until the change is accepted or
// rejected (Review tab).

import type { Mark, Node as PMNode, Slice } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { schema } from "../model/schema";

export interface Reviewer {
  enabled: () => boolean;
  author: () => string;
}

let revisionId = Math.floor(Date.now() / 1000) % 100000 + 1000;
let revisionAt = 0;
let revisionDate = "";

/** Attributes of the current revision (one per minute of editing). */
function revision(author: string): { id: string; author: string; date: string } {
  const now = Date.now();
  if (now - revisionAt > 60000 || !revisionDate) {
    revisionAt = now;
    revisionId += 1;
    revisionDate = new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
  }
  return { id: String(revisionId), author, date: revisionDate };
}

function insMark(author: string): Mark {
  return schema.marks.ins.create({ ...revision(author), move: null });
}

function delMark(author: string): Mark {
  return schema.marks.del.create({ ...revision(author), move: null });
}

/** Marks a range deleted; our own insertions inside it really go. */
function markDeleted(tr: Transaction, from: number, to: number, author: string) {
  const ownInserted: [number, number][] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    const ins = node.marks.find((m) => m.type === schema.marks.ins);
    if (ins && ins.attrs.author === author) ownInserted.push([a, b]);
    return false;
  });
  tr.addMark(from, to, delMark(author));
  for (let i = ownInserted.length - 1; i >= 0; i--) tr.delete(ownInserted[i][0], ownInserted[i][1]);
}

export function trackedTextInput(view: EditorView, from: number, to: number, text: string, reviewer: Reviewer): boolean {
  if (!reviewer.enabled()) return false;
  const author = reviewer.author();
  const { state } = view;
  const tr = state.tr;
  let at = from;
  if (from < to) {
    markDeleted(tr, from, to, author);
    at = tr.mapping.map(to);
  }
  const marks = (state.storedMarks ?? state.doc.resolve(from).marks()).filter((m) => m.type !== schema.marks.del && m.type !== schema.marks.ins);
  tr.insert(at, schema.text(text, [...marks, insMark(author)]));
  tr.setSelection(TextSelection.create(tr.doc, at + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Backspace (dir -1) and Delete (dir 1) while tracking. */
export function trackedDelete(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1, reviewer: Reviewer): boolean {
  if (!reviewer.enabled()) return false;
  const author = reviewer.author();
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  let from = sel.from;
  let to = sel.to;
  if (sel.empty) {
    const $pos = sel.$from;
    if (dir < 0) {
      if ($pos.parentOffset === 0) return false; // joining paragraphs isn't tracked
      // Skip over text that is already deleted
      let p = from;
      while (p > $pos.start() && state.doc.rangeHasMark(p - 1, p, schema.marks.del)) p--;
      if (p === $pos.start()) {
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, p)));
        return true;
      }
      from = p - 1;
      to = p;
    } else {
      if ($pos.parentOffset === $pos.parent.content.size) return false;
      let p = from;
      while (p < $pos.end() && state.doc.rangeHasMark(p, p + 1, schema.marks.del)) p++;
      if (p === $pos.end()) {
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, p)));
        return true;
      }
      from = p;
      to = p + 1;
    }
  }
  if (!dispatch) return true;
  const tr = state.tr;
  markDeleted(tr, from, to, author);
  const cursor = dir < 0 ? tr.mapping.map(from, -1) : tr.mapping.map(to, 1);
  tr.setSelection(TextSelection.create(tr.doc, cursor));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Pasting while tracking: the pasted text is an insertion. */
export function trackedPaste(view: EditorView, slice: Slice, reviewer: Reviewer): boolean {
  if (!reviewer.enabled()) return false;
  const author = reviewer.author();
  const tr = view.state.tr;
  const { from, to } = view.state.selection;
  let at = from;
  if (from < to) {
    markDeleted(tr, from, to, author);
    at = tr.mapping.map(to);
  }
  const before = tr.doc.content.size;
  tr.replace(at, at, slice);
  const insEnd = at + (tr.doc.content.size - before);
  tr.addMark(at, insEnd, insMark(author));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export interface Change {
  from: number;
  to: number;
  kind: "ins" | "del";
  author: string;
  date: string;
}

/** Every tracked change, in document order (adjacent pieces joined). */
export function listChanges(doc: PMNode): Change[] {
  const out: Change[] = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type !== schema.marks.ins && m.type !== schema.marks.del) continue;
      const kind = m.type.name as "ins" | "del";
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.to === pos && last.author === (m.attrs.author ?? "")) last.to = pos + node.nodeSize;
      else out.push({ from: pos, to: pos + node.nodeSize, kind, author: String(m.attrs.author ?? ""), date: String(m.attrs.date ?? "") });
    }
    return false;
  });
  return out;
}

/** Accepts (true) or rejects (false) the changes in a range. */
export function resolveChanges(state: EditorState, from: number, to: number, accept: boolean): Transaction {
  const tr = state.tr;
  const removals: [number, number][] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    const ins = node.marks.some((m) => m.type === schema.marks.ins);
    const del = node.marks.some((m) => m.type === schema.marks.del);
    if ((accept && del) || (!accept && ins)) removals.push([a, b]);
    return false;
  });
  tr.removeMark(from, to, accept ? schema.marks.ins : schema.marks.del);
  for (let i = removals.length - 1; i >= 0; i--) tr.delete(removals[i][0], removals[i][1]);
  return tr;
}

/** The change at or after the cursor (dir 1) or before it (dir -1). */
export function nextChange(state: EditorState, dir: 1 | -1): Change | null {
  const changes = listChanges(state.doc);
  if (!changes.length) return null;
  const { from, to } = state.selection;
  if (dir > 0) return changes.find((c) => c.from >= to || (c.from > from && c.from >= from)) ?? changes[0];
  for (let i = changes.length - 1; i >= 0; i--) if (changes[i].to <= from) return changes[i];
  return changes[changes.length - 1];
}
