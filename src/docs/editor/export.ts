// File > Export > Web Page: the document as a single HTML file (styles
// and pictures included).

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { DocController } from "./controller";
import { formattingKey, formattingPlugin } from "./formatting";
import { noteLabel, NOTE_KINDS, referencedNotes, renderNote } from "./notes";
import { geometryOf } from "./pagination";

const BASE_CSS = `
body { margin: 0; background: #f3f3f3; }
.page { max-width: VAR_W; margin: 24px auto; background: #fff; padding: 72px 96px; box-shadow: 0 1px 4px rgba(0,0,0,.2); --z: 1; }
.pm-doc { white-space: pre-wrap; word-wrap: break-word; }
.pm-doc .p { margin: 0; }
.pm-doc .li { margin-left: var(--li-ml); text-indent: var(--li-ti); }
.pm-doc .li-label { display: inline-block; text-indent: 0; }
.pm-doc .cx-top { margin-top: 0 !important; }
.pm-doc .cx-bot { margin-bottom: 0 !important; }
.pm-doc table { border-collapse: collapse; }
.pm-doc td { vertical-align: top; padding: var(--cpt, 0) var(--cpr, 7.2px) var(--cpb, 0) var(--cpl, 7.2px); border-top: var(--bt, none); border-bottom: var(--bb, none); border-left: var(--bl, none); border-right: var(--br, none); background-color: var(--cbg, transparent); }
.pm-doc .pm-tab { display: inline-block; min-width: 2em; }
.pm-doc .opq-hidden, .pm-doc .fld-s, .pm-doc .fld-e, .pm-doc .hidden-text { display: none; }
.pm-doc a { color: inherit; }
.pm-doc img { max-width: 100%; }
.pm-doc .opq-note a, .pm-doc .opq-noteRef { font-size: 65%; vertical-align: super; line-height: 0; text-decoration: none; }
.notes { margin-top: 24px; }
.notes hr { width: 2in; margin: 0 0 8px; border: 0; border-top: 1px solid #000; }
@media print { body { background: none; } .page { box-shadow: none; margin: 0; max-width: none; } }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    if (!src || src.startsWith("data:")) continue;
    try {
      const blob = await (await fetch(src)).blob();
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      img.setAttribute("src", data);
    } catch {
      img.removeAttribute("src");
    }
  }
}

export async function documentHtml(ctl: DocController): Promise<string> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  document.body.appendChild(host);
  const state = EditorState.create({ doc: ctl.state.doc, plugins: [formattingPlugin({ sheet: ctl.sheet, numbering: ctl.payload.numbering })] });
  const view = new EditorView(host, {
    state,
    editable: () => false,
    attributes: { class: "pm-doc" },
  });
  const content = view.dom.cloneNode(true) as HTMLElement;
  view.destroy();
  content.removeAttribute("contenteditable");
  content.removeAttribute("translate");
  content.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  // Footnote and endnote marks link to the notes, listed after the text
  content.querySelectorAll<HTMLElement>(".opq-note").forEach((el) => {
    const kind = el.classList.contains("opq-endnote") ? "endnote" : "footnote";
    const a = document.createElement("a");
    a.href = `#${kind}-${el.dataset.note ?? ""}`;
    a.textContent = el.dataset.n ?? "";
    el.removeAttribute("data-n");
    el.appendChild(a);
  });
  const numbers = formattingKey.getState(state)?.notes;
  const referenced = referencedNotes(ctl.state.doc);
  const defaultTab = Number(ctl.payload.settings?.defaultTabStop ?? 720) || 720;
  for (const kind of NOTE_KINDS) {
    const ids = referenced[kind].filter((id) => ctl.notes[kind][id]);
    if (!ids.length) continue;
    const section = document.createElement("section");
    section.className = `notes ${kind}s`;
    section.appendChild(document.createElement("hr"));
    for (const id of ids) {
      const div = document.createElement("div");
      div.className = "pm-doc note";
      div.id = `${kind}-${id}`;
      host.appendChild(div);
      renderNote(div, ctl.notes[kind][id], noteLabel(kind, numbers?.get(`${kind}:${id}`) ?? 0), ctl.sheet, defaultTab);
      div.querySelectorAll<HTMLElement>(".opq-noteRef").forEach((r) => (r.textContent = r.dataset.n ?? ""));
      section.appendChild(div);
    }
    content.appendChild(section);
  }
  host.remove();
  await inlineImages(content);
  const g = geometryOf(ctl.state.doc);
  const title = ctl.payload.core?.title || ctl.info.title;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Docs">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS.replace("VAR_W", `${Math.round(g.pageW - g.left - g.right + 192)}px`)}
${ctl.sheet.css(".pm-doc")}</style>
</head>
<body>
<div class="page">${content.outerHTML}</div>
</body>
</html>
`;
}
