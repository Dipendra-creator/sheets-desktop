// A miniature first page of a document (template tiles, previews).

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { docsApi, type TemplateContent } from "../api";
import { formattingPlugin } from "../editor/formatting";
import { docFromJSON } from "../model/schema";
import { StyleSheet } from "../model/styles";
import { geometryOf } from "../editor/pagination";

const cache = new Map<string, TemplateContent | null>();
const injected = new Set<string>();

function scopeOf(id: string) {
  return `dthumb-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** Renders `content` as a static page, scaled to `width` pixels. */
export function PageThumb({ id, content, width = 136 }: { id: string; content: TemplateContent; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const doc = docFromJSON(content.doc);
  const g = geometryOf(doc);
  const scale = width / g.pageW;
  const scope = scopeOf(id);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sheet = new StyleSheet(content.styles);
    if (!injected.has(scope)) {
      const style = document.createElement("style");
      style.textContent = sheet.css(`.${scope}`);
      document.head.appendChild(style);
      injected.add(scope);
    }
    el.textContent = "";
    const host = document.createElement("div");
    el.appendChild(host);
    const view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [formattingPlugin({ sheet, numbering: content.numbering ?? { abstracts: {}, nums: {} } })] }),
      editable: () => false,
      attributes: { class: `pm-doc ${scope}` },
    });
    return () => view.destroy();
  }, [id, content]);
  return (
    <div className="doc-thumb" style={{ width, height: Math.round(g.pageH * scale) }}>
      <div
        className="doc-thumb-page"
        style={{
          width: g.pageW,
          height: g.pageH,
          transform: `scale(${scale})`,
          padding: `${g.top}px ${g.right}px ${g.bottom}px ${g.left}px`,
          ["--z" as string]: "1",
        }}
      >
        <div ref={ref} />
      </div>
    </div>
  );
}

/** Thumbnail of a built-in template (loaded once). */
export function TemplateThumb({ id, width }: { id: string; width?: number }) {
  const [content, setContent] = useState<TemplateContent | null | undefined>(cache.get(id));
  useEffect(() => {
    if (cache.has(id)) return;
    let alive = true;
    docsApi
      .templatePreview(id)
      .then((c) => {
        cache.set(id, c);
        if (alive) setContent(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  if (!content) return <div className="doc-thumb loading" style={{ width: width ?? 136, height: Math.round((width ?? 136) * 1.294) }} />;
  return <PageThumb id={id} content={content} width={width} />;
}

export function BlankThumb({ width = 136 }: { width?: number }) {
  return <div className="doc-thumb blank" style={{ width, height: Math.round(width * 1.294) }} />;
}
