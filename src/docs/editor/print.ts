// Printing and Save as PDF: the pages exactly as laid out on screen (100%,
// no space between pages), copied into a print-only layer.

import type { DocController } from "./controller";
import { geometryOf, layoutOptions, PAGE_GAP, paginators } from "./pagination";

function cleanup() {
  document.getElementById("print-root")?.remove();
  document.getElementById("print-page-style")?.remove();
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

export async function printDocument(ctl: DocController): Promise<void> {
  const view = ctl.view;
  if (!view) return;
  const before = { zoom: ctl.zoom, mode: ctl.viewMode, headerEdit: ctl.headerEdit };
  // Lay the document out for paper: actual size, pages touching
  layoutOptions.gap = 0;
  ctl.printMode = true;
  ctl.headerEdit = null;
  ctl.viewMode = "print";
  ctl.zoom = 1;
  ctl.emit();
  await frame();
  const pag = paginators.get(view);
  for (let i = 0; i < 20; i++) {
    pag?.invalidate();
    await frame();
    await frame();
    if (!pag?.busy) break;
  }
  const canvas = document.querySelector<HTMLElement>(".doc-scroll .doc-canvas");
  const restore = () => {
    layoutOptions.gap = PAGE_GAP;
    ctl.printMode = false;
    ctl.zoom = before.zoom;
    ctl.viewMode = before.mode;
    ctl.emit();
    requestAnimationFrame(() => ctl.relayout());
  };
  if (!canvas) {
    restore();
    return;
  }
  cleanup();
  const g = geometryOf(view.state.doc);
  const root = document.createElement("div");
  root.id = "print-root";
  root.className = "doc-print";
  root.style.setProperty("--z", "1");
  const clone = canvas.cloneNode(true) as HTMLElement;
  clone.style.width = `${g.pageW}px`;
  clone.style.height = `${ctl.pages.length * g.pageH}px`;
  clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  root.appendChild(clone);
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.id = "print-page-style";
  style.textContent = `@page { size: ${g.pageW / 96}in ${g.pageH / 96}in; margin: 0; }`;
  document.head.appendChild(style);
  restore();
  window.addEventListener("afterprint", cleanup, { once: true });
  await frame();
  try {
    await Promise.resolve(window.print());
  } catch (e) {
    ctl.host.error(String(e));
  }
}
