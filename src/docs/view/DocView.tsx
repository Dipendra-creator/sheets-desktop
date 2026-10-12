// A Docs window showing a document: title bar, ribbon, ruler, the pages,
// navigation and comments panes, status bar, dialogs and backstage.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { CellSelection } from "prosemirror-tables";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../api";
import { APP_NAME, useApp } from "../../app/context";
import { CommandSearch, TitleBar, type SearchCommand } from "../../app/TitleBar";
import { Icon } from "../../components/Icon";
import { Menu, type MenuItem } from "../../components/Menu";
import { docsApi, type DocInfo, type DocPayload } from "../api";
import { DocsBackstage, type DocsPage } from "../backstage/DocsBackstage";
import { DocController, type DocHost } from "../editor/controller";
import { printDocument } from "../editor/print";
import { CommentsPane } from "./CommentsPane";
import { DocDialogHost } from "./dialogs/DocDialogs";
import { useDoc } from "./hooks";
import { NavPane } from "./NavPane";
import { PageArea } from "./PageArea";
import { DocRibbon } from "./ribbon/DocRibbon";
import { clipboardAction, openSearch } from "./ribbon/HomeTab";
import { Ruler } from "./Ruler";
import { DocStatusBar } from "./StatusBar";
import "./icons";

function QuickAccess({ ctl }: { ctl: DocController }) {
  useDoc(ctl, (c) => c.state);
  return (
    <div className="qat">
      <button className="qat-btn" title="Save (Ctrl+S)" onClick={() => ctl.save()}>
        <Icon name="save" />
      </button>
      <button className="qat-btn" title="Undo (Ctrl+Z)" disabled={!ctl.canUndo} onClick={() => ctl.undo()}>
        <Icon name="undo" />
      </button>
      <button className="qat-btn" title="Redo (Ctrl+Y)" disabled={!ctl.canRedo} onClick={() => ctl.redo()}>
        <Icon name="redo" />
      </button>
    </div>
  );
}

function commandList(ctl: DocController, page: (p: DocsPage) => void): SearchCommand[] {
  const d = (kind: string, props?: Record<string, unknown>) => () => ctl.openDialog(kind, props);
  return [
    { label: "Bold", hint: "Ctrl+B", icon: "bold", run: () => ctl.toggleOn("bold") },
    { label: "Italic", hint: "Ctrl+I", icon: "italic", run: () => ctl.toggleOn("italic") },
    { label: "Underline", hint: "Ctrl+U", icon: "underline", run: () => ctl.toggleUnderline() },
    { label: "Font…", hint: "Ctrl+D", icon: "fontColor", run: d("font") },
    { label: "Paragraph…", icon: "lineSpacing", run: d("paragraph") },
    { label: "Bullets", icon: "bullets", run: () => ctl.bullets() },
    { label: "Numbering", icon: "numbering", run: () => ctl.numbering() },
    { label: "Heading 1", hint: "Ctrl+Alt+1", run: () => ctl.setStyle("Heading1") },
    { label: "Heading 2", hint: "Ctrl+Alt+2", run: () => ctl.setStyle("Heading2") },
    { label: "Heading 3", hint: "Ctrl+Alt+3", run: () => ctl.setStyle("Heading3") },
    { label: "Normal style", hint: "Ctrl+Shift+N", run: () => ctl.setStyle(ctl.sheet.defaultParagraph ?? "Normal") },
    { label: "Clear All Formatting", icon: "clearFormatting", run: () => ctl.clearFormatting() },
    { label: "Insert Table", icon: "table", run: d("insertTable") },
    { label: "Insert Picture", icon: "pictures", run: d("picture") },
    { label: "Insert Link", hint: "Ctrl+K", icon: "link", run: d("link") },
    { label: "Insert Page Break", hint: "Ctrl+Enter", icon: "pageBreak", run: () => ctl.pageBreak() },
    { label: "Insert Section Break (Next Page)", icon: "sectionBreak", run: () => ctl.sectionBreak("nextPage") },
    { label: "Insert Page Numbers", icon: "pageNumber", run: () => ctl.insertPageNumber("footer", "center") },
    { label: "Edit Header", icon: "headerIcon", run: () => ctl.editStory("header") },
    { label: "Edit Footer", icon: "footerIcon", run: () => ctl.editStory("footer") },
    { label: "Insert Date and Time", icon: "dateTime", run: d("dateTime") },
    { label: "Insert Symbol", icon: "symbol", run: d("symbol") },
    { label: "Insert Bookmark", icon: "bookmark", run: d("bookmark") },
    { label: "Table of Contents", icon: "toc", run: () => ctl.insertToc() },
    { label: "Update Table of Contents", icon: "updateTable", run: () => ctl.updateToc() },
    { label: "Insert Caption", icon: "caption", run: d("caption") },
    { label: "Find", hint: "Ctrl+F", icon: "find", run: () => openSearch(ctl) },
    { label: "Replace", hint: "Ctrl+H", icon: "replace", run: d("find", { tab: "replace" }) },
    { label: "Go To", hint: "Ctrl+G", icon: "goto", run: d("find", { tab: "goto" }) },
    { label: "Word Count", icon: "wordCount", run: d("wordcount") },
    { label: "Track Changes", hint: "Ctrl+Shift+E", icon: "trackChangesSmall", run: () => ctl.setTracking(!ctl.trackChanges) },
    { label: "Accept All Changes", icon: "accept", run: () => ctl.acceptReject(true, true) },
    { label: "Reject All Changes", icon: "reject", run: () => ctl.acceptReject(false, true) },
    { label: "New Comment", icon: "comment", run: () => ctl.newComment() },
    { label: "Show Comments", icon: "comment", run: () => ctl.toggleComments() },
    { label: "Margins", icon: "margins", run: d("pageSetup", { tab: "margins" }) },
    { label: "Page Setup", icon: "margins", run: d("pageSetup", { tab: "margins" }) },
    { label: "Orientation: Landscape", icon: "orientationPage", run: () => ctl.setOrientation(true) },
    { label: "Orientation: Portrait", icon: "printLayout", run: () => ctl.setOrientation(false) },
    { label: "Paper Size", icon: "size", run: d("pageSetup", { tab: "paper" }) },
    { label: "Show/Hide ¶", hint: "Ctrl+Shift+8", icon: "pilcrow", run: () => ctl.toggle("showMarks") },
    { label: "Ruler", icon: "ruler", run: () => ctl.toggle("ruler") },
    { label: "Navigation Pane", icon: "find", run: () => ctl.toggle("navPane") },
    { label: "Zoom", icon: "zoom", run: d("zoom") },
    { label: "Print Layout", icon: "printLayout", run: () => ctl.setViewMode("print") },
    { label: "Web Layout", icon: "webLayout", run: () => ctl.setViewMode("web") },
    { label: "Read Mode", icon: "readMode", run: () => ctl.setViewMode("read") },
    { label: "Draft", icon: "draftView", run: () => ctl.setViewMode("draft") },
    { label: "Print / Save as PDF", hint: "Ctrl+P", icon: "print", run: () => page("print") },
    { label: "Export", icon: "export", run: () => page("export") },
    { label: "Save As", hint: "F12", icon: "saveAs", run: () => ctl.host.saveAs(ctl) },
    { label: "Keyboard Shortcuts", icon: "keyboard", run: d("shortcuts") },
    { label: "Check Accessibility", icon: "accessibility", run: d("accessibility") },
    { label: "Sort", icon: "sortAZ", run: d("sort") },
    { label: "Change Case", hint: "Shift+F3", icon: "changeCase", run: () => ctl.changeCase("cycle") },
    { label: "Format Painter", hint: "Ctrl+Shift+C", icon: "formatPainter", run: () => ctl.startPainter(false) },
  ];
}

function contextMenu(ctl: DocController, inTable: boolean, image: boolean, onLink: boolean): MenuItem[] {
  const items: MenuItem[] = [
    { label: "Cut", icon: "cut", shortcut: "Ctrl+X", onClick: () => clipboardAction(ctl, "cut") },
    { label: "Copy", icon: "copy", shortcut: "Ctrl+C", onClick: () => clipboardAction(ctl, "copy") },
    { label: "Paste", icon: "paste", shortcut: "Ctrl+V", onClick: () => clipboardAction(ctl, "paste") },
    { label: "Paste as Text Only", icon: "pasteValues", onClick: () => clipboardAction(ctl, "pasteText") },
    { separator: true },
  ];
  if (image) {
    items.push({ label: "Edit Alt Text…", icon: "altText", onClick: () => ctl.openDialog("altText") }, { label: "Size and Position…", onClick: () => ctl.openDialog("pictureSize") }, { separator: true });
  }
  if (inTable) {
    items.push(
      {
        label: "Insert",
        icon: "insert",
        submenu: [
          { label: "Insert Columns to the Left", icon: "insertLeft", onClick: () => ctl.tableCommand("colBefore") },
          { label: "Insert Columns to the Right", icon: "insertRight", onClick: () => ctl.tableCommand("colAfter") },
          { label: "Insert Rows Above", icon: "insertAbove", onClick: () => ctl.tableCommand("rowBefore") },
          { label: "Insert Rows Below", icon: "insertBelow", onClick: () => ctl.tableCommand("rowAfter") },
        ],
      },
      {
        label: "Delete",
        icon: "delete",
        submenu: [
          { label: "Delete Columns", onClick: () => ctl.tableCommand("deleteCol") },
          { label: "Delete Rows", onClick: () => ctl.tableCommand("deleteRow") },
          { label: "Delete Table", onClick: () => ctl.tableCommand("deleteTable") },
        ],
      },
      { label: "Merge Cells", icon: "mergeCells", disabled: !(ctl.state.selection instanceof CellSelection), onClick: () => ctl.tableCommand("merge") },
      { label: "Split Cells", icon: "splitCells", onClick: () => ctl.tableCommand("split") },
      { separator: true },
    );
  }
  items.push(
    { label: "Font…", icon: "fontColor", onClick: () => ctl.openDialog("font") },
    { label: "Paragraph…", icon: "lineSpacing", onClick: () => ctl.openDialog("paragraph") },
    { separator: true },
    { label: onLink ? "Edit Link…" : "Link", icon: "link", onClick: () => ctl.openDialog("link") },
  );
  if (onLink) items.push({ label: "Remove Link", onClick: () => ctl.setLink(null) });
  items.push({ label: "New Comment", icon: "comment", onClick: () => ctl.newComment() });
  return items;
}

export function DocView({ info, payload }: { info: DocInfo; payload: DocPayload }) {
  const app = useApp();
  const [backstage, setBackstage] = useState<DocsPage | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [, setTitleTick] = useState(0);

  const host: DocHost = useMemo(
    () => ({
      author: () => app.settings.userName,
      ask: app.ask,
      error: app.error,
      onInfo: () => setTitleTick((t) => t + 1),
      saveAs: async (c: DocController) => {
        const current = c.info.path;
        const source = c.info.sourcePath?.replace(/\.[^.\\/]+$/, ".docx");
        const path = await saveDialog({
          title: "Save As",
          defaultPath: current?.replace(/\.(txt|md)$/i, (m) => m) ?? source ?? `${c.info.title}.docx`,
          filters: [
            { name: "Word Document (*.docx)", extensions: ["docx"] },
            { name: "Plain Text (*.txt)", extensions: ["txt"] },
            { name: "Markdown (*.md)", extensions: ["md"] },
          ],
        });
        if (!path) return false;
        try {
          if (await docsApi.formatIsLossy(path)) {
            const answer = await app.ask(
              "Docs",
              "Saving as plain text or Markdown keeps only the text: formatting, pictures and other objects are lost.\n\nDo you want to continue?",
              [
                { label: "Continue", value: "yes", primary: true },
                { label: "Cancel", value: "no" },
              ],
              "warning",
            );
            if (answer !== "yes") return false;
          }
          const ok = await c.saveTo(path);
          if (ok) app.refreshRecent();
          return ok;
        } catch (e) {
          app.error(errorMessage(e));
          return false;
        }
      },
    }),
    [app],
  );

  const ctl = useMemo(() => new DocController(info, payload, host), [info.id]);
  const title = useDoc(ctl, (c) => c.info.title);
  const dirty = useDoc(ctl, (c) => c.info.dirty);
  const status = useDoc(ctl, (c) => c.status);
  const collapsed = useDoc(ctl, (c) => c.ribbonCollapsed);
  const ruler = useDoc(ctl, (c) => c.ruler && (c.viewMode === "print" || c.viewMode === "draft"));
  const nav = useDoc(ctl, (c) => c.navPane);
  const comments = useDoc(ctl, (c) => c.commentsPane);
  const compat = (payload.settings?.compatibilityMode ?? 15) < 15;

  const confirmClose = async (): Promise<boolean> => {
    if (!ctl.info.dirty) return true;
    const answer = await app.ask(
      "Docs",
      `Want to save your changes to '${ctl.info.title}'?`,
      [
        { label: "Save", value: "save", primary: true },
        { label: "Don't Save", value: "discard" },
        { label: "Cancel", value: "cancel" },
      ],
      "questionCircle",
    );
    if (answer === "save") return ctl.save();
    if (answer === "discard") {
      // Keep the last state for "Recover Unsaved Documents"
      await docsApi.update(ctl.id, ctl.snapshot(), true).catch(() => {});
      return true;
    }
    return false;
  };

  const closeDocument = async () => {
    if (!(await confirmClose())) return;
    await docsApi.close(ctl.id).catch(() => {});
    app.showStart();
  };

  // The document's styles as CSS
  useEffect(() => {
    const style = document.createElement("style");
    style.id = `doc-styles-${ctl.id}`;
    style.textContent = ctl.sheet.css(".pm-doc");
    document.head.appendChild(style);
    return () => style.remove();
  }, [ctl]);

  useEffect(() => {
    getCurrentWindow()
      .setTitle(`${title}${compat ? " [Compatibility Mode]" : ""} - Docs`)
      .catch(() => {});
  }, [title, compat]);

  // Window close button: ask to save
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        if (await confirmClose()) {
          closing = true;
          await docsApi.close(ctl.id).catch(() => {});
          await getCurrentWindow().destroy();
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, [ctl]);

  // Alt alone or F10: KeyTips; app-wide shortcuts
  useEffect(() => {
    let altAlone = false;
    const onDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Alt") {
        altAlone = !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey;
        return;
      }
      altAlone = false;
      if (document.querySelector(".dialog-backdrop")) return;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && k === "s") {
        e.preventDefault();
        ctl.save();
      } else if (e.key === "F12" && !mod) {
        e.preventDefault();
        ctl.host.saveAs(ctl);
      } else if (mod && !e.shiftKey && k === "p") {
        e.preventDefault();
        setBackstage("print");
      } else if (mod && !e.shiftKey && k === "o") {
        e.preventDefault();
        setBackstage("open");
      } else if (mod && !e.shiftKey && k === "n") {
        e.preventDefault();
        app.newWorkbook();
      } else if (mod && !e.shiftKey && k === "w") {
        e.preventDefault();
        closeDocument();
      } else if (e.ctrlKey && e.key === "F1") {
        e.preventDefault();
        ctl.toggle("ribbonCollapsed");
      } else if (e.key === "F1") {
        e.preventDefault();
        ctl.openDialog("help");
      } else if (e.key === "F10" && !e.shiftKey && !mod && !e.altKey && ctl.keyTips === "off") {
        e.preventDefault();
        ctl.keyTips = "tabs";
        ctl.emit();
      } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
        const coords = ctl.view?.coordsAtPos(ctl.state.selection.head);
        if (coords) {
          e.preventDefault();
          setMenu({ x: coords.left, y: coords.bottom });
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      if (document.querySelector(".dialog-backdrop, .backstage-overlay")) return;
      ctl.keyTips = ctl.keyTips === "off" ? "tabs" : "off";
      ctl.emit();
    };
    const reset = () => (altAlone = false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("mousedown", reset, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("mousedown", reset, true);
    };
  }, [ctl]);

  const inTable = useDoc(ctl, (c) => c.format.inTable);
  const image = useDoc(ctl, (c) => !!c.selectedImage);
  const onLink = useDoc(ctl, (c) => !!c.format.link);

  return (
    <div
      className={`doc-window ${collapsed ? "ribbon-collapsed" : ""}`}
      onContextMenu={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest(".doc-host, .hf-edit-host")) return;
        e.preventDefault();
        // Right-click outside the selection moves the cursor there first
        const view = ctl.active;
        if (view) {
          const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
          const { from, to } = view.state.selection;
          if (pos && (pos.pos < from || pos.pos > to)) {
            import("prosemirror-state").then(({ TextSelection }) => {
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
              setMenu({ x: e.clientX, y: e.clientY });
            });
            return;
          }
        }
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <TitleBar
        left={<QuickAccess ctl={ctl} />}
        title={`${title}${compat ? " [Compatibility Mode]" : ""}${status ? ` • ${status}` : dirty ? "" : ""} - ${APP_NAME}`}
        center={
          <CommandSearch
            commands={() => commandList(ctl, (p) => setBackstage(p))}
            onFind={(q) => {
              ctl.navPane = true;
              ctl.emit();
              ctl.search(q);
              ctl.findNext(1);
            }}
          />
        }
      />
      <DocRibbon ctl={ctl} onFile={() => setBackstage("home")} />
      {ruler && (
        <div className="ruler-row">
          <Ruler ctl={ctl} />
        </div>
      )}
      <div className="doc-main">
        {nav && <NavPane ctl={ctl} />}
        <PageArea ctl={ctl} />
        {comments && <CommentsPane ctl={ctl} />}
      </div>
      <DocStatusBar ctl={ctl} />
      <DocDialogHost ctl={ctl} />
      {menu && (
        <Menu
          anchor={{ x: menu.x, y: menu.y }}
          items={contextMenu(ctl, inTable, image, onLink)}
          onClose={() => {
            setMenu(null);
            ctl.focus();
          }}
        />
      )}
      {backstage && (
        <div className="backstage-overlay">
          <DocsBackstage
            initial={backstage}
            doc={{
              ctl,
              back: () => {
                setBackstage(null);
                requestAnimationFrame(() => ctl.focus());
              },
              save: () => ctl.save(),
              saveAs: () => ctl.host.saveAs(ctl),
              close: closeDocument,
              print: () => printDocument(ctl),
            }}
          />
        </div>
      )}
    </div>
  );
}
