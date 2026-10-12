// Tables in the editor: column widths from the document, scaled with zoom.

import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import { styleClass, tableCss } from "../model/schema";

export class DocTableView implements NodeView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;

  constructor(
    public node: PMNode,
    private cellMinWidth: number,
    _view?: EditorView,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.render();
  }

  private render() {
    const a = this.node.attrs;
    const cls = ["tbl"];
    if (a.style) cls.push(styleClass("ts", a.style as string));
    this.table.className = cls.join(" ");
    const widths: (number | null)[] = [];
    const row = this.node.firstChild;
    row?.forEach((cell) => {
      const span = (cell.attrs.colspan as number) || 1;
      const cw = cell.attrs.colwidth as number[] | null;
      for (let j = 0; j < span; j++) widths.push(cw?.[j] ?? null);
    });
    while (this.colgroup.children.length > widths.length) this.colgroup.lastChild!.remove();
    while (this.colgroup.children.length < widths.length) this.colgroup.appendChild(document.createElement("col"));
    let total = 0;
    let fixed = true;
    widths.forEach((w, i) => {
      const col = this.colgroup.children[i] as HTMLElement;
      const css = w ? `calc(${w}px * var(--z))` : "";
      if (col.style.width !== css) col.style.width = css;
      total += w ?? this.cellMinWidth;
      if (!w) fixed = false;
    });
    let style = tableCss(a);
    if (!/(^|;)width:/.test(style)) style += `;${fixed ? "width" : "min-width"}:calc(${total}px * var(--z))`;
    this.table.setAttribute("style", style);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(record: ViewMutationRecord) {
    return record.type === "attributes" && (record.target === this.table || this.colgroup.contains(record.target as Node));
  }
}
