// The document canvas: pages with their headers and footers, the editor
// laid over them, and header/footer editing.

import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fieldName, fieldResult } from "../editor/fields";
import type { DocController, HeaderFooterEdit } from "../editor/controller";
import { formattingPlugin } from "../editor/formatting";
import { ImageView } from "../editor/imageview";
import { noteLabel, noteNumberPlugin, renderNote, type NoteKind } from "../editor/notes";
import { geometryOf, hfTypeFor, paginators, type PageGeometry } from "../editor/pagination";
import { resolveStory } from "../editor/sections";
import { clipboardSerializer } from "../editor/serializer";
import { layoutTabs, TabView, tabsPlugin } from "../editor/tabs";
import { schema } from "../model/schema";
import { useDoc } from "./hooks";

const SCREEN_PAD = 24;


/** What PAGE, NUMPAGES and SECTIONPAGES show on a page. */
interface PageNumbers {
  number: number;
  label: string;
  pages: number;
  sectionPages: number;
}

/** Replaces PAGE / NUMPAGES results in rendered header or footer HTML. */
function fillFields(root: HTMLElement, nums: PageNumbers) {
  root.querySelectorAll<HTMLElement>(".fld-s").forEach((start) => {
    const instr = start.dataset.instr ?? "";
    const name = fieldName(instr);
    if (name !== "PAGE" && name !== "NUMPAGES" && name !== "SECTIONPAGES") return;
    const text = fieldResult(instr, nums.number, nums.pages, { label: nums.label, sectionPages: nums.sectionPages });
    if (text == null) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    walker.currentNode = start;
    let first = true;
    let depth = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof HTMLElement && n.classList.contains("fld-s")) depth++;
      if (n instanceof HTMLElement && n.classList.contains("fld-e")) {
        if (depth === 0) {
          // A field without a result: add one before its end
          if (first) n.before(document.createTextNode(text));
          break;
        }
        depth--;
      }
      if (n.nodeType === Node.TEXT_NODE && depth === 0) {
        (n as Text).data = first ? text : "";
        first = false;
      }
    }
  });
}

/** A header or footer drawn as static HTML. */
function StaticStory({ doc, nums, ctl }: { doc: PMNode | null; nums: PageNumbers; ctl: DocController }) {
  const ref = useRef<HTMLDivElement>(null);
  const { number, label, pages, sectionPages } = nums;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = "";
    if (!doc) return;
    const frag = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    el.appendChild(frag);
    fillFields(el, { number, label, pages, sectionPages });
    // Tabs (centred titles, right-aligned page numbers)
    const paras = Array.from(el.querySelectorAll<HTMLElement>(":scope > .p"));
    const nodes: PMNode[] = [];
    doc.forEach((n) => nodes.push(n));
    const items: { el: HTMLElement; node: PMNode }[] = [];
    let k = 0;
    for (const n of nodes) {
      if (n.type.name === "paragraph") {
        const p = paras[k++];
        if (p && p.querySelector(".pm-tab")) items.push({ el: p, node: n });
      }
    }
    if (items.length) layoutTabs(items, { sheet: ctl.sheet, defaultTab: Number(ctl.payload.settings?.defaultTabStop ?? 720) || 720 });
  }, [doc, number, label, pages, sectionPages, ctl]);
  return <div ref={ref} className="pm-doc hf-static" />;
}

/** Editing a header or footer in place. */
function StoryEditor({ ctl, edit }: { ctl: DocController; edit: HeaderFooterEdit }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kind = edit.kind;
    const source = ctl.storyDoc(kind, edit.ref);
    const style = ctl.sheet.get(kind === "header" ? "Header" : "Footer") ? (kind === "header" ? "Header" : "Footer") : null;
    const doc = source ?? schema.nodes.doc.create(null, schema.nodes.paragraph.create({ style }));
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        keymap({
          Tab: (s, d) => {
            d?.(s.tr.replaceSelectionWith(schema.nodes.tab.create()).scrollIntoView());
            return true;
          },
          Escape: () => {
            ctl.headerEdit = null;
            ctl.emit();
            return true;
          },
        }),
        keymap(baseKeymap),
        history(),
        formattingPlugin({ sheet: ctl.sheet, numbering: ctl.payload.numbering }),
        tabsPlugin({ sheet: ctl.sheet, defaultTab: Number(ctl.payload.settings?.defaultTabStop ?? 720) || 720 }),
      ],
    });
    const view = new EditorView(el, {
      state,
      attributes: { class: "pm-doc hf-editor", spellcheck: "true" },
      clipboardSerializer,
      nodeViews: {
        tab: (node) => new TabView(node),
        image: (node, v, getPos) => new ImageView(node, v, getPos as () => number | undefined),
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) ctl.storyChanged(edit, next.doc);
        ctl.emit();
      },
    });
    ctl.headerEditor = view;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    return () => {
      if (ctl.headerEditor === view) ctl.headerEditor = null;
      view.destroy();
    };
  }, [ctl, edit]);
  return <div ref={ref} className="hf-edit-host" />;
}

/** A footnote or endnote drawn as static HTML. */
function StaticNote({ ctl, doc, label }: { ctl: DocController; doc: PMNode | undefined; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && doc) renderNote(ref.current, doc, label, ctl.sheet, Number(ctl.payload.settings?.defaultTabStop ?? 720) || 720);
  }, [doc, label, ctl]);
  return <div ref={ref} className="pm-doc note-body" />;
}

/** Editing a footnote or endnote in place. */
function NoteEditor({ ctl, kind, id, label }: { ctl: DocController; kind: NoteKind; id: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef(label);
  labelRef.current = label;
  useEffect(() => {
    const el = ref.current;
    const doc = ctl.notes[kind][id];
    if (!el || !doc) return;
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        keymap({
          Tab: (s, d) => {
            d?.(s.tr.replaceSelectionWith(schema.nodes.tab.create()).scrollIntoView());
            return true;
          },
          Escape: () => {
            ctl.closeNote();
            return true;
          },
        }),
        keymap(baseKeymap),
        history(),
        formattingPlugin({ sheet: ctl.sheet, numbering: ctl.payload.numbering }),
        tabsPlugin({ sheet: ctl.sheet, defaultTab: Number(ctl.payload.settings?.defaultTabStop ?? 720) || 720 }),
        noteNumberPlugin(() => labelRef.current),
      ],
    });
    const view = new EditorView(el, {
      state,
      attributes: { class: "pm-doc note-body note-editor", spellcheck: "true" },
      clipboardSerializer,
      nodeViews: {
        tab: (node) => new TabView(node),
        image: (node, v, getPos) => new ImageView(node, v, getPos as () => number | undefined),
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) ctl.noteChanged(kind, id, next.doc);
        ctl.emit();
      },
    });
    ctl.headerEditor = view;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dom.scrollIntoView({ block: "nearest" });
    return () => {
      if (ctl.headerEditor === view) ctl.headerEditor = null;
      view.destroy();
    };
  }, [ctl, kind, id]);
  return <div ref={ref} className="doc-note-edit" />;
}

function NoteBox({ ctl, kind, id, editing, style }: { ctl: DocController; kind: NoteKind; id: string; editing: boolean; style: React.CSSProperties }) {
  const n = useDoc(ctl, (c) => c.noteNumber(kind, id));
  const doc = useDoc(ctl, (c) => c.notes[kind][id]);
  const label = n != null ? noteLabel(kind, n) : "";
  return (
    <div
      className={`doc-note note-${kind} ${editing ? "editing" : ""}`}
      style={style}
      title={editing ? undefined : `${kind === "footnote" ? "Footnote" : "Endnote"} ${label}: click to edit`}
      onMouseDown={(e) => {
        if (editing) return;
        e.preventDefault();
        e.stopPropagation();
        ctl.openNote(kind, id);
      }}
    >
      {editing ? <NoteEditor ctl={ctl} kind={kind} id={id} label={label} /> : <StaticNote ctl={ctl} doc={doc} label={label} />}
    </div>
  );
}

export function PageArea({ ctl }: { ctl: DocController }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoom = useDoc(ctl, (c) => c.zoom);
  const viewMode = useDoc(ctl, (c) => c.viewMode);
  const pageCount = useDoc(ctl, (c) => c.pages.length);
  const pageAttrs = useDoc(ctl, (c) => c.state.doc.attrs.page);
  const titlePg = useDoc(ctl, (c) => c.state.doc.attrs.titlePg === true);
  const evenOdd = useDoc(ctl, (c) => c.state.doc.attrs.evenOdd === true);
  useDoc(ctl, (c) => c.hfTick);
  const pageList = useDoc(ctl, (c) => c.pages);
  const headerEdit = useDoc(ctl, (c) => c.headerEdit);
  const markup = useDoc(ctl, (c) => c.markup);
  const showMarks = useDoc(ctl, (c) => c.showMarks);
  const painter = useDoc(ctl, (c) => !!c.painter);
  const printMode = useDoc(ctl, (c) => c.printMode);
  const noteLayout = useDoc(ctl, (c) => c.noteLayout);
  const noteEdit = useDoc(ctl, (c) => c.noteEdit);
  const measureRef = useRef<HTMLDivElement>(null);
  const PAD = printMode ? 0 : SCREEN_PAD;
  const [width, setWidth] = useState(1000);

  const geo: PageGeometry = useMemo(() => geometryOf(ctl.state.doc), [pageAttrs, ctl, printMode]);

  useEffect(() => {
    ctl.mount(hostRef.current!);
    ctl.view?.focus();
    return () => ctl.destroy();
  }, [ctl]);

  // Notes are measured in a hidden box as wide as the text, at 100%
  useLayoutEffect(() => {
    ctl.measureHost = measureRef.current;
    if (ctl.view) paginators.get(ctl.view)?.invalidate();
    return () => {
      if (ctl.measureHost === measureRef.current) ctl.measureHost = null;
    };
  }, [ctl]);

  // Headers and footers taller than the margins push the text (measured after drawing)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !(viewMode === "print" || viewMode === "read")) return;
    const heights: Record<string, number> = {};
    el.querySelectorAll<HTMLElement>(".hf[data-ref]").forEach((hf) => {
      const key = `${hf.classList.contains("hf-header") ? "header" : "footer"}:${hf.dataset.ref}`;
      if (heights[key] != null) return;
      const box = hf.querySelector<HTMLElement>(":scope > .hf-static, :scope > .hf-edit-host");
      if (box) heights[key] = box.getBoundingClientRect().height / zoom;
    });
    ctl.setHfHeights(heights);
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Ctrl + wheel zooms, like Word
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      ctl.setZoom(ctl.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ctl]);

  const z = zoom;
  const paged = viewMode === "print" || viewMode === "read";
  const pageW = geo.pageW * z;
  const pageH = geo.pageH * z;
  const pitch = (geo.pageH + geo.gap) * z;
  const canvasW = Math.max(width, pageW + PAD * 2);
  const pageLeft = printMode ? 0 : paged ? Math.max(PAD, (canvasW - pageW) / 2) : 0;
  const textW = (geo.pageW - geo.left - geo.right) * z;
  const webPad = 40;

  let hostStyle: React.CSSProperties;
  let canvasH: number | undefined;
  if (paged) {
    hostStyle = { left: pageLeft + geo.left * z, top: PAD + geo.top * z, width: textW };
    canvasH = PAD * 2 + pageCount * pitch - geo.gap * z;
  } else if (viewMode === "draft") {
    hostStyle = { left: 24, top: 16, width: textW };
  } else {
    hostStyle = { left: webPad, top: 24, width: Math.max(200, width - webPad * 2) };
  }

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    // Clicks in the margins place the cursor on the nearest line
    if (!ctl.view || e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("page")) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const x = Math.max(rect.left + 2, Math.min(rect.right - 2, e.clientX));
    const pos = ctl.view.posAtCoords({ left: x, top: Math.max(rect.top + 2, Math.min(rect.bottom - 2, e.clientY)) });
    if (pos) {
      e.preventDefault();
      ctl.view.dispatch(ctl.view.state.tr.setSelection(TextSelection.near(ctl.view.state.doc.resolve(pos.pos))));
      ctl.view.focus();
    }
  };

  const sections = ctl.sections();
  const facts = ctl.pageFacts();
  void pageList;
  const pages = paged
    ? Array.from({ length: pageCount }, (_, i) => {
        const f = facts[i] ?? { section: sections.length - 1, type: hfTypeFor(i, titlePg, evenOdd), number: i + 1, label: String(i + 1), sectionPages: pageCount, firstOfSection: i === 0 };
        const type = f.type;
        const nums: PageNumbers = { number: f.number, label: f.label, pages: pageCount, sectionPages: f.sectionPages };
        const headerRef = resolveStory(sections, f.section, "header", type).ref;
        const footerRef = resolveStory(sections, f.section, "footer", type).ref;
        const top = PAD + i * pitch;
        const editingHere = headerEdit && headerEdit.page === i;
        const openEditor = (kind: "header" | "footer") => {
          ctl.noteEdit = null;
          ctl.headerEdit = ctl.storyTarget(kind, i);
          ctl.emit();
        };
        return (
          <div key={i} className="page" style={{ left: pageLeft, top, width: pageW, height: pageH }} data-page={i + 1}>
            <div
              className={`hf hf-header ${editingHere && headerEdit.kind === "header" ? "editing" : ""}`}
              data-ref={headerRef ?? ""}
              style={{ left: geo.left * z, right: geo.right * z, top: geo.header * z, minHeight: Math.max(8, (geo.top - geo.header) * z - 4) }}
              onDoubleClick={() => openEditor("header")}
            >
              {editingHere && headerEdit.kind === "header" ? (
                <StoryEditor ctl={ctl} edit={headerEdit} />
              ) : (
                <StaticStory doc={ctl.storyDoc("header", headerRef)} nums={nums} ctl={ctl} />
              )}
              {editingHere && headerEdit.kind === "header" && <span className="hf-tag">{type === "first" ? "First Page Header" : type === "even" ? "Even Page Header" : "Header"}</span>}
            </div>
            <div
              className={`hf hf-footer ${editingHere && headerEdit.kind === "footer" ? "editing" : ""}`}
              data-ref={footerRef ?? ""}
              style={{ left: geo.left * z, right: geo.right * z, bottom: geo.footer * z, minHeight: Math.max(8, (geo.bottom - geo.footer) * z - 4) }}
              onDoubleClick={() => openEditor("footer")}
            >
              {editingHere && headerEdit.kind === "footer" ? (
                <StoryEditor ctl={ctl} edit={headerEdit} />
              ) : (
                <StaticStory doc={ctl.storyDoc("footer", footerRef)} nums={nums} ctl={ctl} />
              )}
              {editingHere && headerEdit.kind === "footer" && <span className="hf-tag">{type === "first" ? "First Page Footer" : type === "even" ? "Even Page Footer" : "Footer"}</span>}
            </div>
            {noteLayout.separators
              .filter((sp) => sp.page === i)
              .map((sp) => (
                <div key={`sep-${sp.kind}`} className={`doc-note-sep doc-note-sep-${sp.kind}`} style={{ left: geo.left * z, top: sp.top * z }} />
              ))}
            {noteLayout.notes
              .filter((n) => n.page === i)
              .map((n) => (
                <NoteBox
                  key={`${n.kind}-${n.id}`}
                  ctl={ctl}
                  kind={n.kind}
                  id={n.id}
                  editing={noteEdit?.kind === n.kind && noteEdit.id === n.id}
                  style={{ left: geo.left * z, top: n.top * z, width: textW }}
                />
              ))}
          </div>
        );
      })
    : null;

  const classes = [
    "doc-scroll",
    `view-${viewMode}`,
    `markup-${markup}`,
    showMarks ? "show-marks" : "",
    headerEdit ? "editing-hf" : "",
    painter ? "painting" : "",
  ].join(" ");

  return (
    <div className={classes} ref={scrollRef} style={{ ["--z" as string]: String(z) }}>
      <div className="doc-canvas" style={{ width: paged ? canvasW : "100%", height: canvasH, minHeight: paged ? undefined : "100%" }} onMouseDown={onCanvasMouseDown}>
        {pages}
        <div className="doc-note-measure" ref={measureRef} aria-hidden style={{ width: geo.pageW - geo.left - geo.right, ["--z" as string]: "1" }} />
        <div
          className="doc-host"
          style={hostStyle}
          ref={hostRef}
          onMouseDown={() => {
            // Clicking the text leaves the note being edited
            if (ctl.noteEdit) ctl.closeNote();
          }}
          onDoubleClick={() => {
            if (ctl.headerEdit) {
              ctl.headerEdit = null;
              ctl.emit();
            }
          }}
        />
      </div>
    </div>
  );
}
