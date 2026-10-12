import { useEffect, useState } from "react";
import type { MenuItem } from "../../../components/Menu";
import { BigButton, CheckItem, RibbonGroup, Row, SmallButton, SplitButton, Stack } from "../../../workbook/ribbon/controls";
import { ColorPicker } from "../../../components/ColorPicker";
import { Icon } from "../../../components/Icon";
import { docsApi, type DocWindow } from "../../api";
import type { DocController, Markup } from "../../editor/controller";
import { geometryOf } from "../../editor/pagination";
import { presetWatermark, WATERMARK_PRESETS } from "../../editor/watermark";
import { num } from "../../model/units";
import { useDoc } from "../hooks";
import { SymbolGrid, TableGrid } from "./galleries";

type Attrs = Record<string, unknown>;

// ----------------------------------------------------------------------
// Insert
// ----------------------------------------------------------------------

export function InsertTab({ ctl }: { ctl: DocController }) {
  const headerMenu = (kind: "header" | "footer"): MenuItem[] => [
    { header: "Built-in" },
    { label: "Blank", onClick: () => ctl.setStory(kind, "blank") },
    { label: "Blank (Three Columns)", onClick: () => ctl.setStory(kind, "three") },
    { label: kind === "header" ? "Title" : "Page Number", onClick: () => ctl.setStory(kind, kind === "header" ? "title" : "page") },
    { separator: true },
    { label: kind === "header" ? "Edit Header" : "Edit Footer", onClick: () => ctl.editStory(kind) },
    { label: kind === "header" ? "Remove Header" : "Remove Footer", onClick: () => ctl.setStory(kind, "remove") },
  ];
  const pageNumberMenu: MenuItem[] = [
    {
      label: "Top of Page",
      submenu: [
        { label: "Plain Number 1 (left)", onClick: () => ctl.insertPageNumber("header", "left") },
        { label: "Plain Number 2 (center)", onClick: () => ctl.insertPageNumber("header", "center") },
        { label: "Plain Number 3 (right)", onClick: () => ctl.insertPageNumber("header", "right") },
        { label: "Page X of Y", onClick: () => ctl.insertPageNumber("header", "right", true) },
      ],
    },
    {
      label: "Bottom of Page",
      submenu: [
        { label: "Plain Number 1 (left)", onClick: () => ctl.insertPageNumber("footer", "left") },
        { label: "Plain Number 2 (center)", onClick: () => ctl.insertPageNumber("footer", "center") },
        { label: "Plain Number 3 (right)", onClick: () => ctl.insertPageNumber("footer", "right") },
        { label: "Page X of Y", onClick: () => ctl.insertPageNumber("footer", "center", true) },
      ],
    },
    { label: "Current Position", onClick: () => ctl.insertField("PAGE", String(ctl.currentPage + 1)) },
    { separator: true },
    { label: "Remove Page Numbers", onClick: () => ctl.removePageNumbers() },
  ];
  return (
    <>
      <RibbonGroup label="Pages">
        <Stack>
          <SmallButton
            icon="coverPage"
            label="Cover Page"
            dropdown={[
              { header: "Built-in" },
              { label: "Banded", description: "A colored band with the title and subtitle", onClick: () => ctl.insertCoverPage("banded") },
              { label: "Bold", description: "A large title with an accent bar", onClick: () => ctl.insertCoverPage("bold") },
              { label: "Simple", description: "Centered title, subtitle, author and date", onClick: () => ctl.insertCoverPage("simple") },
            ]}
          />
          <SmallButton icon="blankPage" label="Blank Page" onClick={() => ctl.blankPage()} />
          <SmallButton icon="pageBreak" label="Page Break" title="Page Break (Ctrl+Enter)" onClick={() => ctl.pageBreak()} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Tables">
        <BigButton icon="table" label="Table" dropdown={(close) => <TableGrid ctl={ctl} close={close} />} />
      </RibbonGroup>
      <RibbonGroup label="Illustrations">
        <BigButton icon="pictures" label="Pictures" title="Insert a picture from this device" onClick={() => ctl.openDialog("picture")} />
      </RibbonGroup>
      <RibbonGroup label="Links">
        <Stack>
          <SmallButton icon="link" label="Link" title="Insert Link (Ctrl+K)" onClick={() => ctl.openDialog("link")} />
          <SmallButton icon="bookmark" label="Bookmark" onClick={() => ctl.openDialog("bookmark")} />
          <SmallButton icon="link" label="Cross-reference" onClick={() => ctl.openDialog("link", { bookmarks: true })} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Comments">
        <BigButton icon="comment" label="Comment" title="New Comment (Ctrl+Alt+M)" onClick={() => ctl.newComment()} />
      </RibbonGroup>
      <RibbonGroup label="Header & Footer">
        <BigButton icon="headerIcon" label="Header" dropdown={headerMenu("header")} />
        <BigButton icon="footerIcon" label="Footer" dropdown={headerMenu("footer")} />
        <BigButton icon="pageNumber" label={"Page\nNumber"} dropdown={pageNumberMenu} />
      </RibbonGroup>
      <RibbonGroup label="Text">
        <Stack>
          <SmallButton icon="dateTime" label="Date & Time" onClick={() => ctl.openDialog("dateTime")} />
          <SmallButton icon="sectionBreak" label="Section Break" dropdown={breakMenu(ctl).slice(4)} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Symbols">
        <BigButton
          icon="symbol"
          label="Symbol"
          dropdown={(close) => (
            <>
              <SymbolGrid onPick={(s) => ctl.insertText(s)} close={close} />
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  ctl.openDialog("symbol");
                }}
              >
                <span className="menu-icon">
                  <Icon name="symbol" />
                </span>
                <span className="menu-label">More Symbols…</span>
              </button>
            </>
          )}
        />
      </RibbonGroup>
    </>
  );
}

// ----------------------------------------------------------------------
// Layout
// ----------------------------------------------------------------------

export const MARGIN_PRESETS: { name: string; desc: string; mar: Record<string, number> }[] = [
  { name: "Normal", desc: 'Top: 1"  Bottom: 1"  Left: 1"  Right: 1"', mar: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  { name: "Narrow", desc: 'Top: 0.5"  Bottom: 0.5"  Left: 0.5"  Right: 0.5"', mar: { top: 720, bottom: 720, left: 720, right: 720 } },
  { name: "Moderate", desc: 'Top: 1"  Bottom: 1"  Left: 0.75"  Right: 0.75"', mar: { top: 1440, bottom: 1440, left: 1080, right: 1080 } },
  { name: "Wide", desc: 'Top: 1"  Bottom: 1"  Left: 2"  Right: 2"', mar: { top: 1440, bottom: 1440, left: 2880, right: 2880 } },
  { name: "Office 2003 Default", desc: 'Top: 1"  Bottom: 1"  Left: 1.25"  Right: 1.25"', mar: { top: 1440, bottom: 1440, left: 1800, right: 1800 } },
];

export const PAPER_SIZES: { name: string; desc: string; w: number; h: number }[] = [
  { name: "Letter", desc: '8.5" x 11"', w: 12240, h: 15840 },
  { name: "Legal", desc: '8.5" x 14"', w: 12240, h: 20160 },
  { name: "Executive", desc: '7.25" x 10.5"', w: 10440, h: 15120 },
  { name: "Tabloid", desc: '11" x 17"', w: 15840, h: 24480 },
  { name: "A3", desc: '11.69" x 16.54"', w: 16838, h: 23811 },
  { name: "A4", desc: '8.27" x 11.69"', w: 11906, h: 16838 },
  { name: "A5", desc: '5.83" x 8.27"', w: 8391, h: 11906 },
  { name: "B5 (JIS)", desc: '7.17" x 10.12"', w: 10318, h: 14570 },
  { name: "Envelope #10", desc: '4.12" x 9.5"', w: 5940, h: 13680 },
];

export function breakMenu(ctl: DocController): MenuItem[] {
  return [
    { header: "Page Breaks" },
    { label: "Page", description: "Mark the point at which one page ends and the next page begins.", icon: "pageBreak", onClick: () => ctl.pageBreak() },
    { label: "Column", description: "Indicate that the text following the column break will begin in the next column.", onClick: () => ctl.columnBreak() },
    { label: "Text Wrapping", description: "Separate text around objects on web pages.", onClick: () => ctl.lineBreak() },
    { header: "Section Breaks" },
    { label: "Next Page", description: "Insert a section break and start the new section on the next page.", icon: "sectionBreak", onClick: () => ctl.sectionBreak("nextPage") },
    { label: "Continuous", description: "Insert a section break and start the new section on the same page.", onClick: () => ctl.sectionBreak("continuous") },
    { label: "Even Page", description: "Insert a section break and start the new section on the next even-numbered page.", onClick: () => ctl.sectionBreak("evenPage") },
    { label: "Odd Page", description: "Insert a section break and start the new section on the next odd-numbered page.", onClick: () => ctl.sectionBreak("oddPage") },
  ];
}

function Spin({ label, icon, value, unit, step, min, max, onChange }: { label: string; icon: string; value: number; unit: string; step: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(`${value}${unit}`);
  useEffect(() => setText(`${Math.round(value * 100) / 100}${unit}`), [value, unit]);
  const commit = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v * 100) / 100)));
  return (
    <div className="rb-spin" title={label}>
      <Icon name={icon} />
      <span className="rb-spin-label">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const n = parseFloat(text);
            if (Number.isFinite(n)) commit(n);
          } else if (e.key === "ArrowUp") commit(value + step);
          else if (e.key === "ArrowDown") commit(value - step);
        }}
        onBlur={() => setText(`${value}${unit}`)}
      />
      <span className="rb-spin-btns">
        <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(value + step)}>
          <Icon name="caretUp" size={10} />
        </button>
        <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(value - step)}>
          <Icon name="caretDown" size={10} />
        </button>
      </span>
    </div>
  );
}

export function LayoutTab({ ctl }: { ctl: DocController }) {
  const f = useDoc(ctl, (c) => c.format);
  const page = useDoc(ctl, (c) => c.state.doc.attrs.page as Attrs | null);
  const sz = (page?.pgSz as Attrs) ?? {};
  const landscape = (num(sz.w) ?? 12240) > (num(sz.h) ?? 15840);
  const marginsMenu: MenuItem[] = [
    ...MARGIN_PRESETS.map((m) => ({
      label: m.name,
      description: m.desc,
      icon: "margins",
      onClick: () => ctl.setPage({ pgMar: Object.fromEntries(Object.entries(m.mar).map(([k, v]) => [k, String(v)])) }),
    })),
    { separator: true },
    { label: "Custom Margins…", onClick: () => ctl.openDialog("pageSetup", { tab: "margins" }) },
  ];
  const sizeMenu: MenuItem[] = [
    ...PAPER_SIZES.map((p) => ({
      label: p.name,
      description: p.desc,
      onClick: () => ctl.setPage({ pgSz: landscape ? { w: String(p.h), h: String(p.w), orient: "landscape" } : { w: String(p.w), h: String(p.h), orient: null } }),
    })),
    { separator: true },
    { label: "More Paper Sizes…", onClick: () => ctl.openDialog("pageSetup", { tab: "paper" }) },
  ];
  const indL = f.indentLeft / 1440;
  const indR = f.indentRight / 1440;
  return (
    <>
      <RibbonGroup label="Page Setup" launcher={() => ctl.openDialog("pageSetup", { tab: "margins" })}>
        <BigButton icon="margins" label="Margins" dropdown={marginsMenu} largeMenu />
        <BigButton
          icon="orientationPage"
          label="Orientation"
          dropdown={[
            { label: "Portrait", checked: !landscape, onClick: () => ctl.setOrientation(false) },
            { label: "Landscape", checked: landscape, onClick: () => ctl.setOrientation(true) },
          ]}
        />
        <BigButton icon="size" label="Size" dropdown={sizeMenu} largeMenu />
        <Stack>
          <SmallButton icon="pageBreak" label="Breaks" dropdown={breakMenu(ctl)} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Paragraph" launcher={() => ctl.openDialog("paragraph")}>
        <Stack className="spin-stack">
          <Row>
            <span className="rb-spin-title">Indent</span>
          </Row>
          <Row>
            <Spin label="Left:" icon="indentLeft" value={indL} unit={'"'} step={0.1} min={-11} max={22} onChange={(v) => ctl.setIndent({ left: Math.round(v * 1440) })} />
          </Row>
          <Row>
            <Spin label="Right:" icon="indentRight" value={indR} unit={'"'} step={0.1} min={-11} max={22} onChange={(v) => ctl.setIndent({ right: Math.round(v * 1440) })} />
          </Row>
        </Stack>
        <Stack className="spin-stack">
          <Row>
            <span className="rb-spin-title">Spacing</span>
          </Row>
          <Row>
            <Spin label="Before:" icon="spaceBefore" value={f.spaceBefore} unit=" pt" step={6} min={0} max={1584} onChange={(v) => ctl.setSpacing(v, undefined)} />
          </Row>
          <Row>
            <Spin label="After:" icon="spaceAfter" value={f.spaceAfter} unit=" pt" step={6} min={0} max={1584} onChange={(v) => ctl.setSpacing(undefined, v)} />
          </Row>
        </Stack>
      </RibbonGroup>
    </>
  );
}

// ----------------------------------------------------------------------
// References
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// Design
// ----------------------------------------------------------------------

function WatermarkGallery({ ctl, close }: { ctl: DocController; close: () => void }) {
  return (
    <div className="gallery-panel watermark-gallery">
      {WATERMARK_PRESETS.map((g) => (
        <div key={g.group}>
          <div className="menu-header">{g.group}</div>
          <div className="wm-grid">
            {g.items.map(([text, diagonal]) => (
              <button
                key={`${text}-${diagonal}`}
                className="wm-tile"
                title={`${text} ${diagonal ? 1 : 2}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  ctl.setWatermark(presetWatermark(text, diagonal));
                }}
              >
                <span className="wm-page">
                  <span className={`wm-text ${diagonal ? "diagonal" : ""}`}>{text}</span>
                </span>
                <span className="wm-name">
                  {text === "ASAP" ? text : text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} {diagonal ? 1 : 2}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          close();
          ctl.openDialog("watermark");
        }}
      >
        <span className="menu-label">Custom Watermark…</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          close();
          ctl.setWatermark(null);
        }}
      >
        <span className="menu-label">Remove Watermark</span>
      </button>
    </div>
  );
}

export function DesignTab({ ctl }: { ctl: DocController }) {
  return (
    <>
      <RibbonGroup label="Page Background">
        <BigButton icon="watermark" label="Watermark" dropdown={(close) => <WatermarkGallery ctl={ctl} close={close} />} />
        <BigButton
          icon="pageColorBig"
          label={"Page\nColor"}
          dropdown={(close) => (
            <ColorPicker
              noneLabel="No Color"
              onPick={(c) => {
                close();
                ctl.setPageColor(c || null);
              }}
            />
          )}
        />
        <BigButton icon="pageBorders" label={"Page\nBorders"} onClick={() => ctl.openDialog("pageBorders")} />
      </RibbonGroup>
    </>
  );
}

export function ReferencesTab({ ctl }: { ctl: DocController }) {
  const f = useDoc(ctl, (c) => c.format);
  const level = /^Heading(\d)$/.exec(f.style)?.[1];
  return (
    <>
      <RibbonGroup label="Table of Contents">
        <BigButton
          icon="toc"
          label={"Table of\nContents"}
          dropdown={[
            { header: "Built-in" },
            { label: "Automatic Table", description: "Contents built from Heading 1–3, with page numbers", onClick: () => ctl.insertToc() },
            { separator: true },
            { label: "Remove Table of Contents", onClick: () => ctl.removeToc() },
          ]}
        />
        <Stack>
          <SmallButton
            icon="addText"
            label="Add Text"
            dropdown={[
              { label: "Do Not Show in Table of Contents", checked: !level, onClick: () => ctl.setStyle(ctl.sheet.defaultParagraph ?? "Normal") },
              { label: "Level 1", checked: level === "1", onClick: () => ctl.setStyle("Heading1") },
              { label: "Level 2", checked: level === "2", onClick: () => ctl.setStyle("Heading2") },
              { label: "Level 3", checked: level === "3", onClick: () => ctl.setStyle("Heading3") },
            ]}
          />
          <SmallButton icon="updateTable" label="Update Table" onClick={() => ctl.updateToc()} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Footnotes">
        <BigButton icon="footnote" label={"Insert\nFootnote"} title="Insert Footnote (Ctrl+Alt+F)" onClick={() => ctl.insertNote("footnote")} />
        <Stack>
          <SmallButton icon="endnote" label="Insert Endnote" title="Insert Endnote (Ctrl+Alt+D)" onClick={() => ctl.insertNote("endnote")} />
          <SmallButton
            icon="nextNote"
            label="Next Footnote"
            onClick={() => ctl.nextNote("footnote", 1)}
            dropdown={[
              { label: "Next Footnote", onClick: () => ctl.nextNote("footnote", 1) },
              { label: "Previous Footnote", onClick: () => ctl.nextNote("footnote", -1) },
              { label: "Next Endnote", onClick: () => ctl.nextNote("endnote", 1) },
              { label: "Previous Endnote", onClick: () => ctl.nextNote("endnote", -1) },
            ]}
          />
          <SmallButton icon="showNotes" label="Show Notes" onClick={() => ctl.showNotes()} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Captions">
        <BigButton icon="caption" label={"Insert\nCaption"} onClick={() => ctl.openDialog("caption")} />
      </RibbonGroup>
      <RibbonGroup label="Fields">
        <Stack>
          <SmallButton icon="updateTable" label="Update Fields" title="Update the fields in the selection (F9)" onClick={() => ctl.updateFieldsInSelection()} />
          <SmallButton icon="link" label="Cross-reference (Bookmark)" onClick={() => ctl.openDialog("link", { bookmarks: true })} />
        </Stack>
      </RibbonGroup>
    </>
  );
}

// ----------------------------------------------------------------------
// Review
// ----------------------------------------------------------------------

export function ReviewTab({ ctl }: { ctl: DocController }) {
  const track = useDoc(ctl, (c) => c.trackChanges);
  const markup = useDoc(ctl, (c) => c.markup);
  const comments = useDoc(ctl, (c) => c.commentsPane);
  const labels: Record<Markup, string> = { simple: "Simple Markup", all: "All Markup", none: "No Markup", original: "Original" };
  return (
    <>
      <RibbonGroup label="Proofing">
        <Stack>
          <SmallButton icon="spelling" label="Spelling & Grammar" onClick={() => ctl.openDialog("spelling")} />
          <SmallButton icon="wordCount" label="Word Count" onClick={() => ctl.openDialog("wordcount")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Accessibility">
        <BigButton icon="accessibility" label={"Check\nAccessibility"} onClick={() => ctl.openDialog("accessibility")} />
      </RibbonGroup>
      <RibbonGroup label="Comments">
        <BigButton icon="comment" label={"New\nComment"} title="New Comment (Ctrl+Alt+M)" onClick={() => ctl.newComment()} />
        <Stack>
          <SmallButton icon="x" label="Delete" onClick={() => ctl.deleteComment()} />
          <SmallButton icon="caretLeft" label="Previous" onClick={() => ctl.nextComment(-1)} />
          <SmallButton icon="caretRight" label="Next" onClick={() => ctl.nextComment(1)} />
        </Stack>
        <BigButton icon="comment" label={"Show\nComments"} active={comments} onClick={() => ctl.toggleComments()} />
      </RibbonGroup>
      <RibbonGroup label="Tracking">
        <BigButton icon="trackChanges" label={"Track\nChanges"} active={track} title="Track Changes (Ctrl+Shift+E)" onClick={() => ctl.setTracking(!track)} />
        <Stack>
          <SmallButton
            icon="markup"
            label={labels[markup]}
            dropdown={(["simple", "all", "none", "original"] as Markup[]).map((m) => ({ label: labels[m], checked: markup === m, onClick: () => ctl.setMarkup(m) }))}
          />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Changes">
        <SplitAccept ctl={ctl} accept />
        <SplitAccept ctl={ctl} accept={false} />
        <Stack>
          <SmallButton icon="prevChange" label="Previous" onClick={() => ctl.nextChange(-1)} />
          <SmallButton icon="nextChange" label="Next" onClick={() => ctl.nextChange(1)} />
        </Stack>
      </RibbonGroup>
    </>
  );
}

function SplitAccept({ ctl, accept }: { ctl: DocController; accept: boolean }) {
  const verb = accept ? "Accept" : "Reject";
  return (
    <SplitButton
      icon={accept ? "accept" : "reject"}
      label={verb}
      onClick={() => ctl.acceptReject(accept, false)}
      dropdown={[
        { label: `${verb} and Move to Next`, onClick: () => ctl.acceptReject(accept, false) },
        { label: `${verb} This Change`, onClick: () => ctl.acceptReject(accept, false) },
        { label: `${verb} All Changes`, onClick: () => ctl.acceptReject(accept, true) },
        ...(accept ? [{ label: "Accept All Changes and Stop Tracking", onClick: () => (ctl.acceptReject(true, true), ctl.setTracking(false)) }] : []),
      ]}
    />
  );
}

// ----------------------------------------------------------------------
// View
// ----------------------------------------------------------------------

export function fitZoom(ctl: DocController, mode: "page" | "width") {
  const scroller = document.querySelector<HTMLElement>(".doc-scroll");
  if (!scroller) return;
  const g = geometryOf(ctl.state.doc);
  const z = mode === "width" ? (scroller.clientWidth - 48) / g.pageW : Math.min((scroller.clientHeight - 48) / g.pageH, (scroller.clientWidth - 48) / g.pageW);
  ctl.setZoom(Math.max(0.1, Math.min(5, z)));
}

export function ViewTab({ ctl }: { ctl: DocController }) {
  const v = useDoc(ctl, (c) => ({ mode: c.viewMode, ruler: c.ruler, nav: c.navPane, marks: c.showMarks }));
  const [windows, setWindows] = useState<DocWindow[]>([]);
  return (
    <>
      <RibbonGroup label="Views">
        <BigButton icon="readMode" label={"Read\nMode"} active={v.mode === "read"} onClick={() => ctl.setViewMode("read")} />
        <BigButton icon="printLayout" label={"Print\nLayout"} active={v.mode === "print"} onClick={() => ctl.setViewMode("print")} />
        <BigButton icon="webLayout" label={"Web\nLayout"} active={v.mode === "web"} onClick={() => ctl.setViewMode("web")} />
        <Stack>
          <SmallButton icon="draftView" label="Draft" active={v.mode === "draft"} onClick={() => ctl.setViewMode("draft")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Show">
        <div className="show-checks">
          <CheckItem label="Ruler" checked={v.ruler} onChange={() => ctl.toggle("ruler")} />
          <CheckItem label="Navigation Pane" checked={v.nav} onChange={() => ctl.toggle("navPane")} />
          <CheckItem label="Formatting Marks" checked={v.marks} onChange={() => ctl.toggle("showMarks")} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <BigButton icon="zoom" label="Zoom" onClick={() => ctl.openDialog("zoom")} />
        <BigButton icon="zoom100" label="100%" onClick={() => ctl.setZoom(1)} />
        <Stack>
          <SmallButton icon="printLayout" label="One Page" onClick={() => fitZoom(ctl, "page")} />
          <SmallButton icon="pageLayoutView" label="Page Width" onClick={() => fitZoom(ctl, "width")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Window">
        <BigButton icon="newWindow" label={"New\nWindow"} title="Open a new Docs window" onClick={() => docsApi.openAppWindow("docs").catch((e) => ctl.host.error(String(e)))} />
        <BigButton
          icon="switchWindow"
          label={"Switch\nWindows"}
          dropdown={(close) => {
            if (!windows.length) docsApi.docWindows().then(setWindows).catch(() => {});
            return (
              <div className="menu">
                {windows.map((w) => (
                  <button
                    key={w.label}
                    className="menu-item"
                    onClick={() => {
                      close();
                      import("../../../api").then(({ api }) => api.focusBook(w.doc)).catch(() => {});
                    }}
                  >
                    <span className="menu-icon">{w.doc === ctl.id && <Icon name="check" />}</span>
                    <span className="menu-label">
                      {w.title}
                      {w.dirty ? " •" : ""}
                    </span>
                  </button>
                ))}
                {!windows.length && <div className="menu-item disabled">Loading…</div>}
              </div>
            );
          }}
        />
      </RibbonGroup>
    </>
  );
}

// ----------------------------------------------------------------------
// Help
// ----------------------------------------------------------------------

export function HelpTab({ ctl }: { ctl: DocController }) {
  return (
    <RibbonGroup label="Help">
      <BigButton icon="help" label="Help" onClick={() => ctl.openDialog("help")} />
      <BigButton icon="keyboard" label={"Keyboard\nShortcuts"} onClick={() => ctl.openDialog("shortcuts")} />
      <BigButton icon="about" label="About" onClick={() => ctl.openDialog("about")} />
    </RibbonGroup>
  );
}

// ----------------------------------------------------------------------
// Contextual tabs
// ----------------------------------------------------------------------

export const TABLE_STYLES: { id: string; name: string; header: string | null; band: string | null; border: string; headerText?: string }[] = [
  { id: "TableGrid", name: "Table Grid", header: null, band: null, border: "#000000" },
  { id: "PlainTable1", name: "Plain Table 1", header: null, band: "#F2F2F2", border: "#BFBFBF" },
  { id: "GridTable1Light", name: "Grid Table 1 Light", header: null, band: null, border: "#999999" },
  { id: "GridTable4-Accent1", name: "Grid Table 4 - Accent 1", header: "#156082", band: "#C1E4F5", border: "#45B0E1", headerText: "#FFFFFF" },
  { id: "GridTable4-Accent2", name: "Grid Table 4 - Accent 2", header: "#E97132", band: "#FAE2D5", border: "#F1A983", headerText: "#FFFFFF" },
  { id: "ListTable3-Accent1", name: "List Table 3 - Accent 1", header: "#156082", band: null, border: "#156082", headerText: "#FFFFFF" },
  { id: "GridTable5Dark-Accent1", name: "Grid Table 5 Dark - Accent 1", header: "#156082", band: "#83CAEB", border: "#FFFFFF", headerText: "#FFFFFF" },
];

function TableStyleThumb({ t }: { t: (typeof TABLE_STYLES)[number] }) {
  return (
    <svg width="61" height="46" viewBox="0 0 61 46">
      {[0, 1, 2, 3, 4].map((r) => (
        <rect key={r} x="0.5" y={0.5 + r * 9} width="60" height="9" fill={r === 0 ? (t.header ?? "#fff") : r % 2 === 1 && t.band ? t.band : "#fff"} stroke={t.border} strokeWidth="0.6" />
      ))}
      {[15, 30, 45].map((x) => (
        <line key={x} x1={x + 0.5} x2={x + 0.5} y1="0.5" y2="45.5" stroke={t.border} strokeWidth="0.6" />
      ))}
    </svg>
  );
}

export function TableDesignTab({ ctl }: { ctl: DocController }) {
  return (
    <>
      <RibbonGroup label="Table Styles">
        <div className="table-style-row">
          {TABLE_STYLES.map((t) => (
            <button key={t.id} className="table-thumb" title={t.name} onMouseDown={(e) => e.preventDefault()} onClick={() => ctl.setTableStyle(t.id)}>
              <TableStyleThumb t={t} />
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="Shading">
        <BigButton
          icon="cellShading"
          label="Shading"
          dropdown={(close) => (
            <ColorPicker
              noneLabel="No Color"
              onPick={(c) => {
                close();
                ctl.setCellShading(c || null);
              }}
            />
          )}
        />
      </RibbonGroup>
    </>
  );
}

export function TableLayoutTab({ ctl }: { ctl: DocController }) {
  return (
    <>
      <RibbonGroup label="Table">
        <SmallButton
          icon="select"
          label="Select"
          dropdown={[
            { label: "Select Cell", onClick: () => ctl.tableCommand("selectCell") },
            { label: "Select Column", onClick: () => ctl.tableCommand("selectCol") },
            { label: "Select Row", onClick: () => ctl.tableCommand("selectRow") },
            { label: "Select Table", onClick: () => ctl.tableCommand("selectTable") },
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Rows & Columns">
        <BigButton
          icon="delete"
          label="Delete"
          dropdown={[
            { label: "Delete Columns", icon: "deleteCol", onClick: () => ctl.tableCommand("deleteCol") },
            { label: "Delete Rows", icon: "deleteRow", onClick: () => ctl.tableCommand("deleteRow") },
            { label: "Delete Table", icon: "delete", onClick: () => ctl.tableCommand("deleteTable") },
          ]}
        />
        <Stack>
          <SmallButton icon="insertAbove" label="Insert Above" onClick={() => ctl.tableCommand("rowBefore")} />
          <SmallButton icon="insertBelow" label="Insert Below" onClick={() => ctl.tableCommand("rowAfter")} />
        </Stack>
        <Stack>
          <SmallButton icon="insertLeft" label="Insert Left" onClick={() => ctl.tableCommand("colBefore")} />
          <SmallButton icon="insertRight" label="Insert Right" onClick={() => ctl.tableCommand("colAfter")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Merge">
        <Stack>
          <SmallButton icon="mergeCells" label="Merge Cells" onClick={() => ctl.tableCommand("merge")} />
          <SmallButton icon="splitCells" label="Split Cells" onClick={() => ctl.tableCommand("split")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Alignment">
        <Stack>
          <Row>
            <SmallButton icon="alignTop" title="Align Top" onClick={() => ctl.setCellAttrs({ vAlign: null })} />
            <SmallButton icon="alignMiddle" title="Align Center Vertically" onClick={() => ctl.setCellAttrs({ vAlign: "center" })} />
            <SmallButton icon="alignBottom" title="Align Bottom" onClick={() => ctl.setCellAttrs({ vAlign: "bottom" })} />
          </Row>
          <Row>
            <SmallButton icon="alignLeft" title="Align Left" onClick={() => ctl.setAlign("left")} />
            <SmallButton icon="alignCenter" title="Center" onClick={() => ctl.setAlign("center")} />
            <SmallButton icon="alignRight" title="Align Right" onClick={() => ctl.setAlign("right")} />
          </Row>
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Data">
        <BigButton icon="table" label={"Repeat Header\nRows"} onClick={() => ctl.toggleHeaderRow()} />
      </RibbonGroup>
    </>
  );
}

export function PictureTab({ ctl }: { ctl: DocController }) {
  const img = useDoc(ctl, (c) => c.selectedImage?.node.attrs ?? null);
  if (!img) return null;
  const w = (num(img.cx) ?? 0) / 914400;
  const h = (num(img.cy) ?? 0) / 914400;
  return (
    <>
      <RibbonGroup label="Accessibility">
        <BigButton icon="altText" label={"Alt\nText"} onClick={() => ctl.openDialog("altText")} />
      </RibbonGroup>
      <RibbonGroup label="Arrange">
        <BigButton
          icon="wrapText"
          label={"Wrap\nText"}
          dropdown={[
            { label: "In Line with Text", checked: img.anchor !== true, onClick: () => ctl.setImageAttrs({ anchor: false, raw: null }) },
            { label: "Other wrapping is kept from the file", disabled: true },
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Size" launcher={() => ctl.openDialog("pictureSize")}>
        <Stack className="spin-stack">
          <Row>
            <span className="rb-spin-title">
              {h.toFixed(2)}" × {w.toFixed(2)}"
            </span>
          </Row>
          <Row>
            <SmallButton icon="zoom" label="Size…" onClick={() => ctl.openDialog("pictureSize")} />
          </Row>
        </Stack>
      </RibbonGroup>
    </>
  );
}

export function HeaderFooterTab({ ctl }: { ctl: DocController }) {
  const titlePg = useDoc(ctl, (c) => c.state.doc.attrs.titlePg === true);
  const evenOdd = useDoc(ctl, (c) => c.state.doc.attrs.evenOdd === true);
  const edit = useDoc(ctl, (c) => c.headerEdit);
  return (
    <>
      <RibbonGroup label="Header & Footer">
        <Stack>
          <SmallButton icon="pageNumber" label="Page Number" onClick={() => ctl.insertFieldInStory("PAGE")} />
          <SmallButton icon="dateTime" label="Date & Time" onClick={() => ctl.openDialog("dateTime")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Navigation">
        <Stack>
          <SmallButton icon="headerIcon" label="Go to Header" disabled={edit?.kind === "header"} onClick={() => ctl.editStory("header")} />
          <SmallButton icon="footerIcon" label="Go to Footer" disabled={edit?.kind === "footer"} onClick={() => ctl.editStory("footer")} />
        </Stack>
      </RibbonGroup>
      <RibbonGroup label="Options">
        <div className="show-checks">
          <CheckItem label="Different First Page" checked={titlePg} onChange={(v) => ctl.setPageAttr("titlePg", v)} />
          <CheckItem label="Different Odd & Even Pages" checked={evenOdd} onChange={(v) => ctl.setPageAttr("evenOdd", v)} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Close">
        <BigButton
          icon="closeHeader"
          label={"Close Header\nand Footer"}
          onClick={() => {
            ctl.headerEdit = null;
            ctl.emit();
            ctl.view?.focus();
          }}
        />
      </RibbonGroup>
    </>
  );
}
