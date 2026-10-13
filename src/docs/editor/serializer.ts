// Copying keeps every attribute: each node and mark carries its
// attributes as JSON (data-pm), which the schema's parse rules read back,
// so pasting into a document restores styles, lists, fields and objects.

import { DOMSerializer, type DOMOutputSpec, type Mark, type Node as PMNode } from "prosemirror-model";
import { schema } from "../model/schema";

const base = DOMSerializer.fromSchema(schema);
const OPAQUE = new Set(["opaque_inline", "opaque_block"]);

const nodes: Record<string, (node: PMNode) => DOMOutputSpec> = {};
for (const [name, toDOM] of Object.entries(base.nodes)) {
  nodes[name] = (node) => {
    const out = DOMSerializer.renderSpec(document, toDOM(node));
    if (out.dom instanceof HTMLElement) {
      if (Object.keys(node.attrs).length) out.dom.setAttribute("data-pm", JSON.stringify(node.attrs));
      if (OPAQUE.has(name)) out.dom.setAttribute("data-opaque", "1");
    }
    return out;
  };
}

const marks: Record<string, (mark: Mark, inline: boolean) => DOMOutputSpec> = {};
for (const [name, toDOM] of Object.entries(base.marks)) {
  marks[name] = (mark, inline) => {
    const out = DOMSerializer.renderSpec(document, toDOM(mark, inline));
    if (out.dom instanceof HTMLElement) {
      out.dom.setAttribute("data-mark", name);
      out.dom.setAttribute("data-pm", JSON.stringify(mark.attrs));
      if (name === "cstyle") out.dom.setAttribute("data-cstyle", String(mark.attrs.id ?? ""));
    }
    return out;
  };
}

export const clipboardSerializer = new DOMSerializer(nodes, marks);
