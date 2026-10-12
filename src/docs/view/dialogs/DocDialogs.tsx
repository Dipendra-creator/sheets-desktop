// Dialogs of Docs: Font, Paragraph, Page Setup, Find and Replace, Insert
// Table, Link, Bookmark, Word Count, Zoom, Date and Time, Symbol, Tabs,
// Borders, Caption, Sort, picture size and alt text, help.

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../../../components/Dialog";
import { Icon } from "../../../components/Icon";
import { FONTS, SIZES } from "../../../lib/fonts";
import { keyLabel } from "../../../lib/platform";
import type { DocController } from "../../editor/controller";
import { DEFAULT_FIND, type FindOptions } from "../../editor/find";
import { formatDate } from "../../editor/fields";
import { countText } from "../../editor/wordcount";
import { cssColor, fontName, fontStack, HIGHLIGHTS } from "../../model/render";
import { schema } from "../../model/schema";
import { EMU_PER_PX, formatLength, num, parseLength, twips } from "../../model/units";
import { useDoc } from "../hooks";
import { MARGIN_PRESETS, PAPER_SIZES } from "../ribbon/OtherTabs";

type Attrs = Record<string, unknown>;

const FONT_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"];

// ----------------------------------------------------------------------
// Font
// ----------------------------------------------------------------------

function FontDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const f = ctl.format;
  const [font, setFont] = useState(f.font);
  const [size, setSize] = useState(f.size != null ? String(f.size) : "");
  const [style, setStyle] = useState(f.bold && f.italic ? "Bold Italic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular");
  const [color, setColor] = useState(f.color && f.color !== "auto" ? `#${f.color}` : "");
  const [underline, setUnderline] = useState(f.underline ?? "none");
  const [fx, setFx] = useState({ strike: f.strike, dstrike: f.dstrike, sup: f.sup, sub: f.sub, smallCaps: f.smallCaps, caps: f.caps, hidden: false });
  const [tab, setTab] = useState<"font" | "advanced">("font");
  const [spacing, setSpacing] = useState("0");

  const apply = () => {
    if (font && font !== f.font) ctl.setFont(font);
    const n = parseFloat(size);
    if (n > 0 && n !== f.size) ctl.setSize(n);
    const bold = style.includes("Bold");
    const italic = style.includes("Italic");
    if (bold !== f.bold) ctl.toggleOn("bold");
    if (italic !== f.italic) ctl.toggleOn("italic");
    if ((underline === "none" ? null : underline) !== f.underline) ctl.setUnderline(underline === "none" ? null : underline);
    if (color !== (f.color && f.color !== "auto" ? `#${f.color}` : "")) ctl.setColor(color || null);
    if (fx.strike !== f.strike) ctl.toggleOn("strike");
    if (fx.dstrike !== f.dstrike) ctl.toggleOn("dstrike");
    if (fx.smallCaps !== f.smallCaps) ctl.toggleOn("smallCaps");
    if (fx.caps !== f.caps) ctl.toggleOn("caps");
    if (fx.hidden) ctl.toggleOn("hidden");
    if (fx.sup !== f.sup) ctl.setVert("superscript");
    else if (fx.sub !== f.sub) ctl.setVert("subscript");
    const sp = parseFloat(spacing);
    if (Number.isFinite(sp) && sp !== 0) ctl.setCharSpacing(sp);
    onClose();
  };

  const sample: React.CSSProperties = {
    fontFamily: fontStack(font) ?? undefined,
    fontSize: Math.min(28, (parseFloat(size) || 11) * 1.333),
    fontWeight: style.includes("Bold") ? 700 : 400,
    fontStyle: style.includes("Italic") ? "italic" : "normal",
    color: color || undefined,
    textDecorationLine: [underline !== "none" ? "underline" : "", fx.strike || fx.dstrike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
    textDecorationStyle: fx.dstrike ? "double" : underline === "double" ? "double" : underline === "dotted" ? "dotted" : underline === "wave" ? "wavy" : undefined,
    fontVariant: fx.smallCaps ? "small-caps" : undefined,
    textTransform: fx.caps ? "uppercase" : undefined,
    verticalAlign: fx.sup ? "super" : fx.sub ? "sub" : undefined,
  };

  return (
    <Dialog title="Font" onClose={onClose} width={520} onSubmit={apply}>
      <div className="tabs">
        <button type="button" className={`tab ${tab === "font" ? "active" : ""}`} onClick={() => setTab("font")}>
          Font
        </button>
        <button type="button" className={`tab ${tab === "advanced" ? "active" : ""}`} onClick={() => setTab("advanced")}>
          Advanced
        </button>
      </div>
      {tab === "font" ? (
        <div className="tab-panel">
          <div className="font-grid">
            <label>
              Font:
              <input value={font} onChange={(e) => setFont(e.target.value)} />
              <div className="listbox short">
                {FONTS.map((n) => (
                  <div key={n} className={`lb-item ${n === font ? "selected" : ""}`} style={{ fontFamily: `"${n}"` }} onClick={() => setFont(n)}>
                    {n}
                  </div>
                ))}
              </div>
            </label>
            <label>
              Font style:
              <input value={style} readOnly />
              <div className="listbox short">
                {FONT_STYLES.map((n) => (
                  <div key={n} className={`lb-item ${n === style ? "selected" : ""}`} onClick={() => setStyle(n)}>
                    {n}
                  </div>
                ))}
              </div>
            </label>
            <label>
              Size:
              <input value={size} onChange={(e) => setSize(e.target.value)} />
              <div className="listbox short">
                {SIZES.map((n) => (
                  <div key={n} className={`lb-item ${n === size ? "selected" : ""}`} onClick={() => setSize(n)}>
                    {n}
                  </div>
                ))}
              </div>
            </label>
          </div>
          <div className="fc-row">
            <span className="lbl">Font color:</span>
            <input type="color" value={color || "#000000"} onChange={(e) => setColor(e.target.value.toUpperCase())} />
            <button type="button" className="btn" onClick={() => setColor("")}>
              Automatic
            </button>
            <span className="lbl" style={{ minWidth: 0, marginLeft: 12 }}>
              Underline style:
            </span>
            <select value={underline} onChange={(e) => setUnderline(e.target.value)}>
              <option value="none">(none)</option>
              <option value="single">Single</option>
              <option value="words">Words only</option>
              <option value="double">Double</option>
              <option value="thick">Thick</option>
              <option value="dotted">Dotted</option>
              <option value="dash">Dashed</option>
              <option value="wave">Wave</option>
            </select>
          </div>
          <div className="fc-label">Effects</div>
          <div className="effects-grid">
            {(
              [
                ["strike", "Strikethrough"],
                ["dstrike", "Double strikethrough"],
                ["sup", "Superscript"],
                ["sub", "Subscript"],
                ["smallCaps", "Small caps"],
                ["caps", "All caps"],
                ["hidden", "Hidden"],
              ] as [keyof typeof fx, string][]
            ).map(([k, label]) => (
              <label key={k} className="fc-row check">
                <input
                  type="checkbox"
                  checked={fx[k]}
                  onChange={(e) => {
                    const next = { ...fx, [k]: e.target.checked };
                    if (k === "sup" && e.target.checked) next.sub = false;
                    if (k === "sub" && e.target.checked) next.sup = false;
                    if (k === "strike" && e.target.checked) next.dstrike = false;
                    if (k === "dstrike" && e.target.checked) next.strike = false;
                    setFx(next);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="fc-label">Preview</div>
          <div className="font-preview">
            <span style={sample}>{font || "Font"}</span>
          </div>
        </div>
      ) : (
        <div className="tab-panel">
          <div className="fc-label">Character Spacing</div>
          <label className="fc-row">
            <span className="lbl">Spacing (pt):</span>
            <input type="number" step="0.1" value={spacing} onChange={(e) => setSpacing(e.target.value)} />
          </label>
          <p className="muted small">Positive values expand the text, negative values condense it.</p>
        </div>
      )}
    </Dialog>
  );
}

// ----------------------------------------------------------------------
// Paragraph
// ----------------------------------------------------------------------

function ParagraphDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const para = ctl.state.selection.$from.parent;
  const a = para.attrs as Attrs;
  const resolved = ctl.sheet.paragraph((a.style as string) ?? null, a).pPr;
  const ind = (resolved.ind as Attrs) ?? {};
  const sp = (resolved.spacing as Attrs) ?? {};
  const [tab, setTab] = useState<"indents" | "breaks">("indents");
  const [align, setAlign] = useState(String(resolved.jc ?? "left"));
  const [left, setLeft] = useState(formatLength(twips(ind.left ?? ind.start) ?? 0));
  const [right, setRight] = useState(formatLength(twips(ind.right ?? ind.end) ?? 0));
  const hang = twips(ind.hanging);
  const first = twips(ind.firstLine);
  const [special, setSpecial] = useState(hang ? "hanging" : first ? "first" : "none");
  const [by, setBy] = useState(formatLength(hang ?? first ?? 720));
  const [before, setBefore] = useState(String((num(sp.before) ?? 0) / 20));
  const [after, setAfter] = useState(String((num(sp.after) ?? 0) / 20));
  const rule = String(sp.lineRule ?? "auto");
  const line = num(sp.line);
  const initialLine = rule === "exact" ? "exact" : rule === "atLeast" ? "atLeast" : line == null || line === 240 ? "single" : line === 360 ? "1.5" : line === 480 ? "double" : "multiple";
  const [lineKind, setLineKind] = useState(initialLine);
  const [at, setAt] = useState(rule === "auto" ? String((line ?? 240) / 240) : String((line ?? 240) / 20));
  const [contextual, setContextual] = useState(resolved.contextualSpacing === true);
  const [flags, setFlags] = useState({
    widowControl: resolved.widowControl !== false,
    keepNext: resolved.keepNext === true,
    keepLines: resolved.keepLines === true,
    pageBreakBefore: resolved.pageBreakBefore === true,
  });

  const apply = () => {
    const tw = (s: string) => parseLength(s) ?? 0;
    ctl.setAlign(align === "both" ? "both" : (align as "left" | "center" | "right"));
    const firstLine = special === "none" ? null : special === "hanging" ? -tw(by) : tw(by);
    ctl.setIndent({ left: tw(left), right: tw(right), first: firstLine });
    ctl.setSpacing(parseFloat(before) || 0, parseFloat(after) || 0);
    if (lineKind === "single") ctl.setLineSpacing(1);
    else if (lineKind === "1.5") ctl.setLineSpacing(1.5);
    else if (lineKind === "double") ctl.setLineSpacing(2);
    else if (lineKind === "multiple") ctl.setLineSpacing(parseFloat(at) || 1);
    else ctl.setLineSpacing(null, lineKind as "exact" | "atLeast", parseFloat(at) || 12);
    ctl.setParagraphFlag("contextualSpacing", contextual || null);
    ctl.setParagraphFlag("widowControl", flags.widowControl ? null : false);
    ctl.setParagraphFlag("keepNext", flags.keepNext || null);
    ctl.setParagraphFlag("keepLines", flags.keepLines || null);
    ctl.setParagraphFlag("pageBreakBefore", flags.pageBreakBefore || null);
    onClose();
  };

  return (
    <Dialog
      title="Paragraph"
      onClose={onClose}
      width={500}
      onSubmit={apply}
      footer={
        <>
          <button type="button" className="btn" style={{ marginRight: "auto" }} onClick={() => ctl.openDialog("tabs")}>
            Tabs…
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="tabs">
        <button type="button" className={`tab ${tab === "indents" ? "active" : ""}`} onClick={() => setTab("indents")}>
          Indents and Spacing
        </button>
        <button type="button" className={`tab ${tab === "breaks" ? "active" : ""}`} onClick={() => setTab("breaks")}>
          Line and Page Breaks
        </button>
      </div>
      {tab === "indents" ? (
        <div className="tab-panel">
          <div className="fc-label">General</div>
          <label className="fc-row">
            <span className="lbl">Alignment:</span>
            <select value={align} onChange={(e) => setAlign(e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Centered</option>
              <option value="right">Right</option>
              <option value="both">Justified</option>
            </select>
          </label>
          <div className="fc-label">Indentation</div>
          <div className="two-col">
            <label className="fc-row">
              <span className="lbl">Left:</span>
              <input value={left} onChange={(e) => setLeft(e.target.value)} />
            </label>
            <label className="fc-row">
              <span className="lbl">Special:</span>
              <select value={special} onChange={(e) => setSpecial(e.target.value)}>
                <option value="none">(none)</option>
                <option value="first">First line</option>
                <option value="hanging">Hanging</option>
              </select>
            </label>
            <label className="fc-row">
              <span className="lbl">Right:</span>
              <input value={right} onChange={(e) => setRight(e.target.value)} />
            </label>
            <label className="fc-row">
              <span className="lbl">By:</span>
              <input value={by} disabled={special === "none"} onChange={(e) => setBy(e.target.value)} />
            </label>
          </div>
          <div className="fc-label">Spacing</div>
          <div className="two-col">
            <label className="fc-row">
              <span className="lbl">Before (pt):</span>
              <input type="number" min={0} step={6} value={before} onChange={(e) => setBefore(e.target.value)} />
            </label>
            <label className="fc-row">
              <span className="lbl">Line spacing:</span>
              <select value={lineKind} onChange={(e) => setLineKind(e.target.value)}>
                <option value="single">Single</option>
                <option value="1.5">1.5 lines</option>
                <option value="double">Double</option>
                <option value="atLeast">At least</option>
                <option value="exact">Exactly</option>
                <option value="multiple">Multiple</option>
              </select>
            </label>
            <label className="fc-row">
              <span className="lbl">After (pt):</span>
              <input type="number" min={0} step={6} value={after} onChange={(e) => setAfter(e.target.value)} />
            </label>
            <label className="fc-row">
              <span className="lbl">At:</span>
              <input value={at} disabled={!["atLeast", "exact", "multiple"].includes(lineKind)} onChange={(e) => setAt(e.target.value)} />
            </label>
          </div>
          <label className="fc-row check">
            <input type="checkbox" checked={contextual} onChange={(e) => setContextual(e.target.checked)} />
            Don't add space between paragraphs of the same style
          </label>
        </div>
      ) : (
        <div className="tab-panel">
          <div className="fc-label">Pagination</div>
          {(
            [
              ["widowControl", "Widow/Orphan control"],
              ["keepNext", "Keep with next"],
              ["keepLines", "Keep lines together"],
              ["pageBreakBefore", "Page break before"],
            ] as [keyof typeof flags, string][]
          ).map(([k, label]) => (
            <label key={k} className="fc-row check">
              <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ----------------------------------------------------------------------
// Page Setup
// ----------------------------------------------------------------------

function PageSetupDialog({ ctl, tab: initial, onClose }: { ctl: DocController; tab: string; onClose: () => void }) {
  const page = (ctl.state.doc.attrs.page as Attrs) ?? {};
  const sz = (page.pgSz as Attrs) ?? {};
  const mar = (page.pgMar as Attrs) ?? {};
  const [tab, setTab] = useState(initial === "paper" ? "paper" : initial === "layout" ? "layout" : "margins");
  const m = (k: string, d: number) => formatLength(twips(mar[k]) ?? d);
  const [vals, setVals] = useState({ top: m("top", 1440), bottom: m("bottom", 1440), left: m("left", 1440), right: m("right", 1440), gutter: m("gutter", 0), header: m("header", 720), footer: m("footer", 720) });
  const w0 = num(sz.w) ?? 12240;
  const h0 = num(sz.h) ?? 15840;
  const [landscape, setLandscape] = useState(w0 > h0);
  const [width, setWidth] = useState(formatLength(Math.min(w0, h0)));
  const [height, setHeight] = useState(formatLength(Math.max(w0, h0)));
  const [titlePg, setTitlePg] = useState(ctl.state.doc.attrs.titlePg === true);
  const [evenOdd, setEvenOdd] = useState(ctl.state.doc.attrs.evenOdd === true);
  const paper = PAPER_SIZES.find((p) => p.w === parseLength(width) && p.h === parseLength(height))?.name ?? "Custom";

  const apply = () => {
    const tw = (s: string, d: number) => parseLength(s) ?? d;
    const pw = tw(width, 12240);
    const ph = tw(height, 15840);
    ctl.setPage({
      pgMar: {
        top: String(tw(vals.top, 1440)),
        bottom: String(tw(vals.bottom, 1440)),
        left: String(tw(vals.left, 1440)),
        right: String(tw(vals.right, 1440)),
        gutter: String(tw(vals.gutter, 0)),
        header: String(tw(vals.header, 720)),
        footer: String(tw(vals.footer, 720)),
      },
      pgSz: landscape ? { w: String(ph), h: String(pw), orient: "landscape" } : { w: String(pw), h: String(ph), orient: null },
    });
    if (titlePg !== (ctl.state.doc.attrs.titlePg === true)) ctl.setPageAttr("titlePg", titlePg);
    if (evenOdd !== (ctl.state.doc.attrs.evenOdd === true)) ctl.setPageAttr("evenOdd", evenOdd);
    onClose();
  };
  const field = (k: keyof typeof vals, label: string) => (
    <label className="fc-row">
      <span className="lbl">{label}</span>
      <input value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
    </label>
  );
  return (
    <Dialog title="Page Setup" onClose={onClose} width={480} onSubmit={apply}>
      <div className="tabs">
        {(["margins", "paper", "layout"] as const).map((t) => (
          <button key={t} type="button" className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "margins" && (
        <div className="tab-panel">
          <div className="fc-label">Margins</div>
          <div className="two-col">
            {field("top", "Top:")}
            {field("bottom", "Bottom:")}
            {field("left", "Left:")}
            {field("right", "Right:")}
            {field("gutter", "Gutter:")}
          </div>
          <div className="fc-label">Presets</div>
          <div className="preset-row">
            {MARGIN_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="btn"
                title={p.desc}
                onClick={() => setVals({ ...vals, top: formatLength(p.mar.top), bottom: formatLength(p.mar.bottom), left: formatLength(p.mar.left), right: formatLength(p.mar.right) })}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="fc-label">Orientation</div>
          <div className="orient-row">
            <button type="button" className={`orient ${!landscape ? "selected" : ""}`} onClick={() => setLandscape(false)}>
              <Icon name="printLayout" size={32} />
              Portrait
            </button>
            <button type="button" className={`orient ${landscape ? "selected" : ""}`} onClick={() => setLandscape(true)}>
              <Icon name="orientationPage" size={32} />
              Landscape
            </button>
          </div>
        </div>
      )}
      {tab === "paper" && (
        <div className="tab-panel">
          <label className="fc-row">
            <span className="lbl">Paper size:</span>
            <select
              value={paper}
              onChange={(e) => {
                const p = PAPER_SIZES.find((x) => x.name === e.target.value);
                if (p) {
                  setWidth(formatLength(p.w));
                  setHeight(formatLength(p.h));
                }
              }}
            >
              {PAPER_SIZES.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.desc})
                </option>
              ))}
              <option value="Custom">Custom size</option>
            </select>
          </label>
          <label className="fc-row">
            <span className="lbl">Width:</span>
            <input value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label className="fc-row">
            <span className="lbl">Height:</span>
            <input value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
        </div>
      )}
      {tab === "layout" && (
        <div className="tab-panel">
          <div className="fc-label">Headers and footers</div>
          <label className="fc-row check">
            <input type="checkbox" checked={evenOdd} onChange={(e) => setEvenOdd(e.target.checked)} />
            Different odd and even
          </label>
          <label className="fc-row check">
            <input type="checkbox" checked={titlePg} onChange={(e) => setTitlePg(e.target.checked)} />
            Different first page
          </label>
          <div className="fc-label">From edge</div>
          {field("header", "Header:")}
          {field("footer", "Footer:")}
        </div>
      )}
    </Dialog>
  );
}

// ----------------------------------------------------------------------
// Find and Replace / Go To
// ----------------------------------------------------------------------

function FindDialog({ ctl, tab: initial, onClose }: { ctl: DocController; tab: string; onClose: () => void }) {
  const [tab, setTab] = useState(initial === "replace" ? "replace" : initial === "goto" ? "goto" : "find");
  const find = useDoc(ctl, (c) => c.findState);
  const [query, setQuery] = useState(() => find?.query || (ctl.state.selection.empty ? "" : ctl.state.doc.textBetween(ctl.state.selection.from, ctl.state.selection.to).slice(0, 255)));
  const [replacement, setReplacement] = useState("");
  const [opts, setOpts] = useState<FindOptions>(ctl.findOptions ?? DEFAULT_FIND);
  const [more, setMore] = useState(false);
  const [message, setMessage] = useState("");
  const [gotoKind, setGotoKind] = useState("page");
  const [gotoValue, setGotoValue] = useState("");

  useEffect(() => {
    if (tab !== "goto") ctl.search(query, opts);
    setMessage("");
  }, [query, opts, tab]);

  const next = (dir: 1 | -1 = 1) => {
    if (!ctl.findNext(dir)) setMessage("We couldn't find what you were looking for.");
  };

  const gotoNow = () => {
    const v = gotoValue.trim();
    if (gotoKind === "page") {
      const cur = ctl.currentPage + 1;
      const n = /^[+-]/.test(v) ? cur + Number(v) : Number(v);
      if (Number.isFinite(n) && n >= 1) ctl.goToPage(n - 1);
      else setMessage("Enter a page number.");
    } else if (gotoKind === "heading") {
      const heads: number[] = [];
      ctl.state.doc.forEach((n, pos) => {
        if (n.type.name === "paragraph" && ctl.sheet.outlineLevel(n.attrs.style as string | null, n.attrs.outlineLvl as number | null) != null) heads.push(pos);
      });
      const target = heads.find((p) => p > ctl.state.selection.head) ?? heads[0];
      if (target != null) ctl.goTo(target + 1);
    } else if (gotoKind === "bookmark") {
      const pos = ctl.findBookmark(v);
      if (pos != null) ctl.goTo(pos);
      else setMessage("That bookmark doesn't exist.");
    } else if (gotoKind === "table") {
      const tables: number[] = [];
      ctl.state.doc.descendants((n, pos) => {
        if (n.type.name === "table") tables.push(pos);
        return n.type.name !== "table";
      });
      const n = Number(v);
      const target = Number.isFinite(n) && n >= 1 ? tables[n - 1] : (tables.find((p) => p > ctl.state.selection.head) ?? tables[0]);
      if (target != null) ctl.goTo(target + 3);
    }
  };

  const count = find?.matches.length ?? 0;
  return (
    <Dialog
      title="Find and Replace"
      onClose={() => {
        onClose();
      }}
      width={520}
      onSubmit={() => (tab === "goto" ? gotoNow() : next(1))}
      footer={
        tab === "goto" ? (
          <>
            <button type="submit" className="btn primary">
              Go To
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            {tab === "replace" && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={!query}
                  onClick={() => {
                    const n = ctl.replaceAll(replacement);
                    setMessage(n ? `All done. We made ${n} replacement${n === 1 ? "" : "s"}.` : "We couldn't find anything to replace.");
                  }}
                >
                  Replace All
                </button>
                <button type="button" className="btn" disabled={!query} onClick={() => ctl.replace(replacement)}>
                  Replace
                </button>
              </>
            )}
            <button type="button" className="btn" disabled={!query} onClick={() => next(-1)}>
              Find Previous
            </button>
            <button type="submit" className="btn primary" disabled={!query}>
              Find Next
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </>
        )
      }
    >
      <div className="tabs">
        {(["find", "replace", "goto"] as const).map((t) => (
          <button key={t} type="button" className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "goto" ? "Go To" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "goto" ? (
        <div className="tab-panel find-panel">
          <div className="goto-grid">
            <div>
              <div className="fc-label small">Go to what:</div>
              <div className="listbox short">
                {[
                  ["page", "Page"],
                  ["heading", "Heading"],
                  ["bookmark", "Bookmark"],
                  ["table", "Table"],
                ].map(([k, label]) => (
                  <div key={k} className={`lb-item ${gotoKind === k ? "selected" : ""}`} onClick={() => setGotoKind(k)}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
            <label>
              <div className="fc-label small">Enter {gotoKind === "page" ? "page number" : gotoKind === "bookmark" ? "bookmark name" : `${gotoKind} number`}:</div>
              <input value={gotoValue} onChange={(e) => setGotoValue(e.target.value)} autoFocus />
              <p className="muted small">{gotoKind === "page" ? "Enter + and − to move relative to the current page. Example: +4 moves forward four pages." : "Leave empty to go to the next one."}</p>
            </label>
          </div>
          {message && <div className="find-message">{message}</div>}
        </div>
      ) : (
        <div className="tab-panel find-panel">
          <label className="fc-row">
            <span className="lbl">Find what:</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          {tab === "replace" && (
            <label className="fc-row">
              <span className="lbl">Replace with:</span>
              <input value={replacement} onChange={(e) => setReplacement(e.target.value)} />
            </label>
          )}
          <div className="muted small">{query ? `${count} match${count === 1 ? "" : "es"} in the document` : ""}</div>
          <button type="button" className="link-btn" onClick={() => setMore(!more)}>
            {more ? "<< Less" : "More >>"}
          </button>
          {more && (
            <div className="find-options">
              <label className="fc-row check">
                <input type="checkbox" checked={opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} /> Match case
              </label>
              <label className="fc-row check">
                <input type="checkbox" checked={opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} /> Find whole words only
              </label>
              <label className="fc-row check">
                <input type="checkbox" checked={opts.wildcards} onChange={(e) => setOpts({ ...opts, wildcards: e.target.checked })} /> Use wildcards
              </label>
              <label className="fc-row check">
                <input type="checkbox" checked={opts.ignoreSpace} onChange={(e) => setOpts({ ...opts, ignoreSpace: e.target.checked })} /> Ignore white-space characters
              </label>
            </div>
          )}
          {message && <div className="find-message">{message}</div>}
        </div>
      )}
    </Dialog>
  );
}

// ----------------------------------------------------------------------
// Small dialogs
// ----------------------------------------------------------------------

function InsertTableDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [cols, setCols] = useState("5");
  const [rows, setRows] = useState("2");
  return (
    <Dialog
      title="Insert Table"
      onClose={onClose}
      width={320}
      onSubmit={() => {
        const c = Math.max(1, Math.min(63, parseInt(cols, 10) || 1));
        const r = Math.max(1, Math.min(32767, parseInt(rows, 10) || 1));
        onClose();
        ctl.insertTable(r, c);
      }}
    >
      <div className="fc-label">Table size</div>
      <label className="fc-row">
        <span className="lbl">Number of columns:</span>
        <input type="number" min={1} max={63} value={cols} onChange={(e) => setCols(e.target.value)} />
      </label>
      <label className="fc-row">
        <span className="lbl">Number of rows:</span>
        <input type="number" min={1} value={rows} onChange={(e) => setRows(e.target.value)} />
      </label>
    </Dialog>
  );
}

function bookmarksOf(ctl: DocController): string[] {
  const out: string[] = [];
  ctl.state.doc.descendants((n) => {
    if (n.type.name === "opaque_inline" && n.attrs.label === "bookmarkStart") {
      const name = /w:name="([^"]+)"/.exec(String(n.attrs.xml))?.[1];
      if (name && !name.startsWith("_")) out.push(name);
    }
    return true;
  });
  return out;
}

function LinkDialog({ ctl, onClose, bookmarksOnly }: { ctl: DocController; onClose: () => void; bookmarksOnly?: boolean }) {
  const sel = ctl.state.selection;
  const current = ctl.format.link;
  const [text, setText] = useState(() => (sel.empty ? "" : ctl.state.doc.textBetween(sel.from, sel.to)));
  const [address, setAddress] = useState(current && !current.startsWith("#") ? current : "");
  const [place, setPlace] = useState(current?.startsWith("#") ? current.slice(1) : "");
  const [kind, setKind] = useState<"web" | "place">(bookmarksOnly || current?.startsWith("#") ? "place" : "web");
  const headings = useMemo(() => {
    const out: { text: string; pos: number }[] = [];
    ctl.state.doc.forEach((n, pos) => {
      if (n.type.name === "paragraph" && ctl.sheet.outlineLevel(n.attrs.style as string | null, n.attrs.outlineLvl as number | null) != null && n.textContent.trim()) out.push({ text: n.textContent.trim(), pos });
    });
    return out;
  }, [ctl]);
  const bookmarks = bookmarksOf(ctl);
  const submit = () => {
    if (kind === "web") {
      let href = address.trim();
      if (!href) return;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = href.includes("@") && !href.includes("/") ? `mailto:${href}` : `https://${href}`;
      ctl.setLink(href, text || undefined);
    } else {
      if (!place) return;
      // A heading without a bookmark gets one
      let name = place;
      const heading = headings.find((h) => `__h${h.pos}` === place);
      if (heading) name = ctl.ensureBookmarkAt(heading.pos);
      ctl.setLink(`#${name}`, text || undefined);
    }
    onClose();
  };
  return (
    <Dialog
      title={current ? "Edit Hyperlink" : "Insert Hyperlink"}
      onClose={onClose}
      width={520}
      onSubmit={submit}
      footer={
        <>
          {current && (
            <button
              type="button"
              className="btn"
              style={{ marginRight: "auto" }}
              onClick={() => {
                ctl.setLink(null);
                onClose();
              }}
            >
              Remove Link
            </button>
          )}
          <button type="submit" className="btn primary">
            OK
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <label className="fc-row">
        <span className="lbl">Text to display:</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="<<Selection in document>>" />
      </label>
      <div className="tabs">
        <button type="button" className={`tab ${kind === "web" ? "active" : ""}`} onClick={() => setKind("web")}>
          Existing File or Web Page
        </button>
        <button type="button" className={`tab ${kind === "place" ? "active" : ""}`} onClick={() => setKind("place")}>
          Place in This Document
        </button>
      </div>
      {kind === "web" ? (
        <div className="tab-panel short-panel">
          <label className="fc-row">
            <span className="lbl">Address:</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://" autoFocus />
          </label>
        </div>
      ) : (
        <div className="tab-panel short-panel">
          <div className="listbox">
            <div className="lb-group">Headings</div>
            {headings.map((h) => (
              <div key={h.pos} className={`lb-item ${place === `__h${h.pos}` ? "selected" : ""}`} onClick={() => setPlace(`__h${h.pos}`)}>
                {h.text}
              </div>
            ))}
            <div className="lb-group">Bookmarks</div>
            {bookmarks.map((b) => (
              <div key={b} className={`lb-item ${place === b ? "selected" : ""}`} onClick={() => setPlace(b)}>
                {b}
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function BookmarkDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [name, setName] = useState("");
  const list = bookmarksOf(ctl);
  const valid = /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name);
  return (
    <Dialog
      title="Bookmark"
      onClose={onClose}
      width={360}
      onSubmit={() => {
        if (!valid) return;
        ctl.addBookmark(name);
        onClose();
      }}
      footer={
        <>
          <button type="submit" className="btn primary" disabled={!valid}>
            Add
          </button>
          <button
            type="button"
            className="btn"
            disabled={!list.includes(name)}
            onClick={() => {
              const pos = ctl.findBookmark(name);
              if (pos != null) ctl.goTo(pos);
              onClose();
            }}
          >
            Go To
          </button>
          <button
            type="button"
            className="btn"
            disabled={!list.includes(name)}
            onClick={() => {
              ctl.removeBookmark(name);
              setName("");
            }}
          >
            Delete
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <label className="fc-row">
        <span className="lbl">Bookmark name:</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="listbox">
        {list.map((b) => (
          <div key={b} className={`lb-item ${b === name ? "selected" : ""}`} onClick={() => setName(b)}>
            {b}
          </div>
        ))}
        {!list.length && <div className="lb-item muted">No bookmarks yet.</div>}
      </div>
      {name && !valid && <p className="muted small">Bookmark names start with a letter and contain only letters, numbers and underscores.</p>}
    </Dialog>
  );
}

function WordCountDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  ctl.recount();
  const s = ctl.stats;
  const sel = ctl.state.selection;
  const selStats = !sel.empty ? countText(ctl.state.doc.textBetween(sel.from, sel.to, "\n", " ")) : null;
  const rows: [string, number][] = [
    ["Pages", ctl.pages.length],
    ["Words", selStats?.words ?? s.words],
    ["Characters (no spaces)", selStats?.chars ?? s.chars],
    ["Characters (with spaces)", selStats?.charsWithSpaces ?? s.charsWithSpaces],
    ["Paragraphs", s.paragraphs],
    ["Lines", s.lines],
  ];
  return (
    <Dialog title="Word Count" onClose={onClose} width={340} onSubmit={onClose} footer={<button type="submit" className="btn primary">Close</button>}>
      <div className="fc-label">{selStats ? "Statistics (selection):" : "Statistics:"}</div>
      <div className="props">
        {rows.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <span>{v.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function ZoomDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [pct, setPct] = useState(String(Math.round(ctl.zoom * 100)));
  const presets = [200, 100, 75];
  return (
    <Dialog
      title="Zoom"
      onClose={onClose}
      width={340}
      onSubmit={() => {
        const n = parseInt(pct, 10);
        if (n >= 10 && n <= 500) ctl.setZoom(n / 100);
        onClose();
      }}
    >
      <div className="fc-label">Zoom to</div>
      {presets.map((p) => (
        <label key={p} className="fc-row check">
          <input type="radio" checked={pct === String(p)} onChange={() => setPct(String(p))} />
          {p}%
        </label>
      ))}
      <label className="fc-row">
        <span className="lbl">Percent:</span>
        <input type="number" min={10} max={500} value={pct} onChange={(e) => setPct(e.target.value)} />
      </label>
      <div className="preset-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            onClose();
            import("../ribbon/OtherTabs").then((m) => m.fitZoom(ctl, "width"));
          }}
        >
          Page width
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onClose();
            import("../ribbon/OtherTabs").then((m) => m.fitZoom(ctl, "page"));
          }}
        >
          Whole page
        </button>
      </div>
    </Dialog>
  );
}

const DATE_FORMATS = ["M/d/yyyy", "dddd, MMMM d, yyyy", "MMMM d, yyyy", "M/d/yy", "yyyy-MM-dd", "d-MMM-yy", "M.d.yyyy", "MMM. d, yy", "d MMMM yyyy", "MMMM yy", "MMM-yy", "M/d/yyyy h:mm am/pm", "M/d/yyyy h:mm:ss am/pm", "h:mm am/pm", "h:mm:ss am/pm", "HH:mm", "HH:mm:ss"];

function DateTimeDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [fmt, setFmt] = useState(DATE_FORMATS[0]);
  const [auto, setAuto] = useState(false);
  const now = new Date();
  return (
    <Dialog
      title="Date and Time"
      onClose={onClose}
      width={360}
      onSubmit={() => {
        const text = formatDate(new Date(), fmt);
        const isTime = /h|H/.test(fmt) && !/[dMy]/.test(fmt);
        if (auto) {
          const instr = `${isTime ? "TIME" : "DATE"} \\@ "${fmt}"`;
          if (ctl.headerEditor) ctl.insertFieldInStory(instr);
          else ctl.insertField(instr, text);
        } else ctl.insertText(text);
        onClose();
      }}
    >
      <div className="fc-label">Available formats:</div>
      <div className="listbox">
        {DATE_FORMATS.map((f) => (
          <div key={f} className={`lb-item ${f === fmt ? "selected" : ""}`} onClick={() => setFmt(f)} onDoubleClick={() => setFmt(f)}>
            {formatDate(now, f)}
          </div>
        ))}
      </div>
      <label className="fc-row check">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Update automatically
      </label>
    </Dialog>
  );
}

const SYMBOL_SETS: [string, string][] = [
  ["Common", "©®™€£¥¢§¶†‡•…–—±×÷≠≈≤≥∞°µ¼½¾"],
  ["Arrows", "←↑→↓↔↕⇐⇑⇒⇓⇔➔➜➤↩↪"],
  ["Math", "∑∏√∛∫∂∆∇∈∉∩∪⊂⊃⊆⊇∀∃¬∧∨⊕⊗∝∠⊥∥"],
  ["Greek", "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ"],
  ["Shapes", "■□▪▫▲△▶▷▼▽◀◁◆◇○●◎◉★☆♠♣♥♦✓✔✗✘☐☑☒"],
  ["Punctuation", "‘’“”‚„‹›«»¡¿‰′″·¦¨¯´¸"],
  ["Currency", "$€£¥¢₹₽₩₪₫₱₦₴₸₺₿"],
];

function SymbolDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [set, setSet] = useState(0);
  const [pick, setPick] = useState("");
  return (
    <Dialog
      title="Symbol"
      onClose={onClose}
      width={460}
      onSubmit={() => {
        if (pick) ctl.insertText(pick);
        onClose();
      }}
      footer={
        <>
          <button type="submit" className="btn primary" disabled={!pick}>
            Insert
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <label className="fc-row">
        <span className="lbl">Subset:</span>
        <select value={set} onChange={(e) => setSet(Number(e.target.value))}>
          {SYMBOL_SETS.map(([name], i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="symbol-grid big">
        {Array.from(SYMBOL_SETS[set][1]).map((c) => (
          <button
            key={c}
            type="button"
            className={pick === c ? "selected" : ""}
            onClick={() => setPick(c)}
            onDoubleClick={() => {
              ctl.insertText(c);
              onClose();
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="muted small">{pick ? `Unicode character U+${pick.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` : "Choose a symbol"}</div>
    </Dialog>
  );
}

function TabsDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const para = ctl.state.selection.$from.parent;
  const [stops, setStops] = useState(() => ctl.sheet.tabStops((para.attrs.style as string) ?? null, para.attrs.tabs as Attrs[] | null).map((t) => ({ ...t })));
  const [pos, setPos] = useState("");
  const [align, setAlign] = useState("left");
  const [leader, setLeader] = useState("none");
  const set = () => {
    const tw = parseLength(pos);
    if (tw == null || tw < 0) return;
    setStops([...stops.filter((s) => Math.abs(s.pos - tw) > 5), { pos: tw, val: align, leader }].sort((a, b) => a.pos - b.pos));
    setPos("");
  };
  return (
    <Dialog
      title="Tabs"
      onClose={onClose}
      width={420}
      onSubmit={() => {
        ctl.setTabs(stops.map((s) => ({ val: s.val, pos: String(Math.round(s.pos)), leader: s.leader !== "none" ? s.leader : null })));
        onClose();
      }}
    >
      <div className="two-col">
        <div>
          <label className="fc-row">
            <span className="lbl">Tab stop position:</span>
            <input value={pos} onChange={(e) => setPos(e.target.value)} placeholder='e.g. 1.5"' />
          </label>
          <div className="listbox short">
            {stops.map((s) => (
              <div key={s.pos} className="lb-item" onClick={() => setPos(formatLength(s.pos))}>
                {formatLength(s.pos)} — {s.val}
                {s.leader !== "none" ? `, ${s.leader}` : ""}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="fc-label small">Alignment</div>
          {["left", "center", "right", "decimal"].map((a) => (
            <label key={a} className="fc-row check">
              <input type="radio" checked={align === a} onChange={() => setAlign(a)} />
              {a[0].toUpperCase() + a.slice(1)}
            </label>
          ))}
          <div className="fc-label small">Leader</div>
          {[
            ["none", "1 None"],
            ["dot", "2 ......."],
            ["hyphen", "3 -------"],
            ["underscore", "4 ____"],
          ].map(([k, label]) => (
            <label key={k} className="fc-row check">
              <input type="radio" checked={leader === k} onChange={() => setLeader(k)} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="preset-row">
        <button type="button" className="btn" onClick={set}>
          Set
        </button>
        <button type="button" className="btn" onClick={() => setStops(stops.filter((s) => s.pos !== parseLength(pos)))}>
          Clear
        </button>
        <button type="button" className="btn" onClick={() => setStops([])}>
          Clear All
        </button>
      </div>
    </Dialog>
  );
}

function BordersDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [setting, setSetting] = useState("box");
  const [style, setStyle] = useState("single");
  const [color, setColor] = useState("#000000");
  const [width, setWidth] = useState("4");
  const [fill, setFill] = useState("");
  return (
    <Dialog
      title="Borders and Shading"
      onClose={onClose}
      width={420}
      onSubmit={() => {
        ctl.setBorders(setting === "none" ? "none" : setting === "box" ? "outside" : setting === "all" ? "all" : setting, { val: style, sz: Number(width), color: color.replace("#", "").toUpperCase() });
        if (fill !== "keep") ctl.setShadingPara(fill || null);
        onClose();
      }}
    >
      <div className="fc-label">Borders (paragraph)</div>
      <div className="preset-row">
        {[
          ["none", "None", "borderNone"],
          ["box", "Box", "borderOutside"],
          ["all", "All", "borderAll"],
          ["bottom", "Bottom", "borderBottom"],
          ["top", "Top", "borderTop"],
        ].map(([k, label, icon]) => (
          <button key={k} type="button" className={`btn ${setting === k ? "primary" : ""}`} onClick={() => setSetting(k)}>
            <Icon name={icon} /> {label}
          </button>
        ))}
      </div>
      <label className="fc-row">
        <span className="lbl">Style:</span>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="single">Single</option>
          <option value="double">Double</option>
          <option value="dotted">Dotted</option>
          <option value="dashed">Dashed</option>
          <option value="thick">Thick</option>
          <option value="wave">Wave</option>
        </select>
      </label>
      <label className="fc-row">
        <span className="lbl">Color:</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <label className="fc-row">
        <span className="lbl">Width:</span>
        <select value={width} onChange={(e) => setWidth(e.target.value)}>
          <option value="2">¼ pt</option>
          <option value="4">½ pt</option>
          <option value="6">¾ pt</option>
          <option value="8">1 pt</option>
          <option value="12">1½ pt</option>
          <option value="18">2¼ pt</option>
          <option value="24">3 pt</option>
        </select>
      </label>
      <div className="fc-label">Shading</div>
      <label className="fc-row">
        <span className="lbl">Fill:</span>
        <input type="color" value={fill || "#ffffff"} onChange={(e) => setFill(e.target.value.toUpperCase())} />
        <button type="button" className="btn" onClick={() => setFill("")}>
          No Color
        </button>
      </label>
    </Dialog>
  );
}

function CaptionDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [label, setLabel] = useState("Figure");
  const [below, setBelow] = useState(true);
  const count = useMemo(() => {
    let n = 0;
    ctl.state.doc.descendants((node) => {
      if (node.type.name === "field_start" && new RegExp(`^\\s*SEQ\\s+${label}\\b`, "i").test(String(node.attrs.instr))) n++;
      return true;
    });
    return n + 1;
  }, [ctl, label]);
  const [text, setText] = useState("");
  return (
    <Dialog
      title="Caption"
      onClose={onClose}
      width={380}
      onSubmit={() => {
        ctl.insertCaption(label, count, text, below);
        onClose();
      }}
    >
      <label className="fc-row">
        <span className="lbl">Caption:</span>
        <input value={`${label} ${count}${text ? `: ${text}` : ""}`} readOnly />
      </label>
      <label className="fc-row">
        <span className="lbl">Text:</span>
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <label className="fc-row">
        <span className="lbl">Label:</span>
        <select value={label} onChange={(e) => setLabel(e.target.value)}>
          <option>Figure</option>
          <option>Table</option>
          <option>Equation</option>
        </select>
      </label>
      <label className="fc-row">
        <span className="lbl">Position:</span>
        <select value={below ? "below" : "above"} onChange={(e) => setBelow(e.target.value === "below")}>
          <option value="below">Below selected item</option>
          <option value="above">Above selected item</option>
        </select>
      </label>
    </Dialog>
  );
}

function SortDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [desc, setDesc] = useState(false);
  const [type, setType] = useState("text");
  return (
    <Dialog
      title="Sort Text"
      onClose={onClose}
      width={360}
      onSubmit={() => {
        ctl.sortParagraphs(desc, type === "number");
        onClose();
      }}
    >
      <div className="fc-label">Sort by Paragraphs</div>
      <label className="fc-row">
        <span className="lbl">Type:</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="text">Text</option>
          <option value="number">Number</option>
        </select>
      </label>
      <label className="fc-row check">
        <input type="radio" checked={!desc} onChange={() => setDesc(false)} /> Ascending
      </label>
      <label className="fc-row check">
        <input type="radio" checked={desc} onChange={() => setDesc(true)} /> Descending
      </label>
    </Dialog>
  );
}

function AltTextDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const img = ctl.selectedImage;
  const [alt, setAlt] = useState(String(img?.node.attrs.alt ?? ""));
  const [decorative, setDecorative] = useState(false);
  if (!img) return null;
  return (
    <Dialog
      title="Alt Text"
      onClose={onClose}
      width={400}
      onSubmit={() => {
        ctl.setImageAttrs({ alt: decorative ? "" : alt });
        onClose();
      }}
    >
      <p className="muted small">How would you describe this picture to someone who is blind or has low vision?</p>
      <textarea className="plain-textarea" rows={4} value={alt} disabled={decorative} onChange={(e) => setAlt(e.target.value)} autoFocus />
      <label className="fc-row check">
        <input type="checkbox" checked={decorative} onChange={(e) => setDecorative(e.target.checked)} />
        Mark as decorative
      </label>
    </Dialog>
  );
}

function PictureSizeDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const img = ctl.selectedImage;
  const cx = num(img?.node.attrs.cx) ?? 914400;
  const cy = num(img?.node.attrs.cy) ?? 914400;
  const [w, setW] = useState(formatLength((cx / EMU_PER_PX) * 15));
  const [h, setH] = useState(formatLength((cy / EMU_PER_PX) * 15));
  const [lock, setLock] = useState(true);
  if (!img) return null;
  const ratio = cx / cy;
  return (
    <Dialog
      title="Layout — Size"
      onClose={onClose}
      width={360}
      onSubmit={() => {
        const wt = parseLength(w);
        const ht = parseLength(h);
        if (wt && ht) ctl.setImageAttrs({ cx: Math.round((wt / 15) * EMU_PER_PX), cy: Math.round((ht / 15) * EMU_PER_PX) });
        onClose();
      }}
    >
      <label className="fc-row">
        <span className="lbl">Height:</span>
        <input
          value={h}
          onChange={(e) => {
            setH(e.target.value);
            const t = parseLength(e.target.value);
            if (lock && t) setW(formatLength(t * ratio));
          }}
        />
      </label>
      <label className="fc-row">
        <span className="lbl">Width:</span>
        <input
          value={w}
          onChange={(e) => {
            setW(e.target.value);
            const t = parseLength(e.target.value);
            if (lock && t) setH(formatLength(t / ratio));
          }}
        />
      </label>
      <label className="fc-row check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        Lock aspect ratio
      </label>
    </Dialog>
  );
}

function StylesDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = ctl.sheet.allStyles().filter((s) => s.type !== "table" && (!q || s.name.toLowerCase().includes(q.toLowerCase())));
  const [pick, setPick] = useState(ctl.format.style);
  return (
    <Dialog
      title="Apply Styles"
      onClose={onClose}
      width={360}
      onSubmit={() => {
        const s = ctl.sheet.find(q) ?? ctl.sheet.get(pick);
        if (s) ctl.setStyle(s.id);
        onClose();
      }}
      footer={
        <>
          <button type="submit" className="btn primary">
            Apply
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <label className="fc-row">
        <span className="lbl">Style Name:</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ctl.sheet.name(pick)} autoFocus />
      </label>
      <div className="listbox">
        {list.map((s) => (
          <div key={s.id} className={`lb-item ${s.id === pick ? "selected" : ""}`} onClick={() => setPick(s.id)} onDoubleClick={() => (ctl.setStyle(s.id), onClose())}>
            <span>{s.name}</span>
            <span className="muted small" style={{ float: "right" }}>
              {s.type === "character" ? "a" : "¶"}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function AccessibilityDialog({ ctl, onClose }: { ctl: DocController; onClose: () => void }) {
  const issues = useMemo(() => {
    const out: { kind: string; text: string; pos: number }[] = [];
    let lastLevel = 0;
    ctl.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && !String(node.attrs.alt ?? "").trim()) out.push({ kind: "Missing alternative text", text: String(node.attrs.name || "Picture"), pos });
      if (node.type.name === "paragraph") {
        const lvl = ctl.sheet.outlineLevel(node.attrs.style as string | null, node.attrs.outlineLvl as number | null);
        if (lvl != null) {
          if (!node.textContent.trim()) out.push({ kind: "Empty heading", text: ctl.sheet.name(node.attrs.style as string), pos });
          else if (lvl > lastLevel + 1 && lastLevel > 0) out.push({ kind: "Skipped heading level", text: node.textContent.slice(0, 60), pos });
          lastLevel = lvl;
        }
        return false;
      }
      if (node.type.name === "table") {
        const first = node.firstChild;
        if (first && !first.attrs.header) out.push({ kind: "No header row specified", text: "Table", pos });
      }
      return true;
    });
    return out;
  }, [ctl]);
  return (
    <Dialog title="Accessibility" onClose={onClose} width={440} onSubmit={onClose} footer={<button type="submit" className="btn primary">Close</button>}>
      {issues.length ? (
        <div className="listbox">
          {issues.map((i, k) => (
            <div key={k} className="lb-item" onClick={() => ctl.goTo(i.pos)}>
              <b>{i.kind}</b> — {i.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="message-box">
          <Icon name="accessibility" size={32} />
          <div className="message-text">
            <p>No accessibility issues found. People with disabilities should not have difficulty reading this document.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+N", "New document"],
  ["Ctrl+O", "Open"],
  ["Ctrl+S", "Save"],
  ["F12", "Save As"],
  ["Ctrl+P", "Print"],
  ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
  ["Ctrl+B / I / U", "Bold / Italic / Underline"],
  ["Ctrl+Shift+D", "Double underline"],
  ["Ctrl+= / Ctrl+Shift+=", "Subscript / Superscript"],
  ["Ctrl+Shift+A / K", "All caps / Small caps"],
  ["Ctrl+] / Ctrl+[", "Font size up / down 1 pt"],
  ["Ctrl+Shift+> / <", "Next / previous font size"],
  ["Ctrl+Space", "Remove character formatting"],
  ["Ctrl+Q", "Remove paragraph formatting"],
  ["Ctrl+D", "Font dialog"],
  ["Ctrl+L / E / R / J", "Align left / center / right / justify"],
  ["Ctrl+M / Ctrl+Shift+M", "Indent / outdent"],
  ["Ctrl+T / Ctrl+Shift+T", "Hanging indent / remove it"],
  ["Ctrl+1 / 2 / 5", "Single / double / 1.5 line spacing"],
  ["Ctrl+0", "Add or remove space before"],
  ["Ctrl+Alt+1 / 2 / 3", "Heading 1 / 2 / 3"],
  ["Ctrl+Shift+N", "Normal style"],
  ["Ctrl+Shift+L", "Bullets"],
  ["Ctrl+Enter", "Page break"],
  ["Shift+Enter", "Line break"],
  ["Ctrl+K", "Insert link"],
  ["Ctrl+F", "Search in Navigation pane"],
  ["Ctrl+H", "Replace"],
  ["Ctrl+G / F5", "Go To"],
  ["Ctrl+Shift+8", "Show/hide formatting marks"],
  ["Shift+F3", "Change case"],
  ["Ctrl+Shift+E", "Track changes"],
  ["Alt+Shift+D / T", "Insert date / time"],
  ["F9", "Update fields"],
  ["Alt+Shift+↑ / ↓", "Move paragraph up / down"],
  ["Ctrl+Shift+C", "Format Painter"],
  ["Alt", "KeyTips on the ribbon"],
];

function HelpDialog({ kind, onClose }: { kind: "help" | "shortcuts" | "about" | "spelling"; onClose: () => void }) {
  if (kind === "shortcuts") {
    return (
      <Dialog title="Keyboard Shortcuts" onClose={onClose} width={520} onSubmit={onClose} footer={<button type="submit" className="btn primary">Close</button>}>
        <div className="shortcut-list">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="sc-row">
              <span className="sc-keys">{keyLabel(k)}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </Dialog>
    );
  }
  const text =
    kind === "spelling"
      ? [
          "Spelling is checked as you type: misspelled words are underlined in red.",
          "Right-click an underlined word while holding Shift to see suggestions from your system's spell checker.",
        ]
      : kind === "about"
        ? ["Docs — a word processor for Word documents (.docx), part of the Sheets app.", "Documents stay on your computer. AutoRecover and version history keep your work safe."]
        : [
            "Docs opens and saves Word documents (.docx), plain text (.txt) and Markdown (.md).",
            "Use the Home tab for fonts, paragraphs and styles; Insert for tables, pictures, links and page numbers; Layout for margins, orientation and paper size; References for a table of contents; Review for word count, comments and Track Changes.",
            "Press Alt to see the shortcut letter of every ribbon button, and F1 for this help.",
          ];
  return (
    <Dialog title={kind === "about" ? "About Docs" : kind === "spelling" ? "Spelling & Grammar" : "Help"} onClose={onClose} width={440} onSubmit={onClose} footer={<button type="submit" className="btn primary">OK</button>}>
      <div className="message-box">
        <Icon name={kind === "about" ? "docsLogo" : "infoCircle"} size={32} />
        <div className="message-text">
          {text.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Renders the dialog the controller asked for. */
export function DocDialogHost({ ctl }: { ctl: DocController }) {
  const dialog = useDoc(ctl, (c) => c.dialog);
  useEffect(() => {
    if (dialog?.kind !== "picture") return;
    ctl.closeDialog();
    openDialog({ title: "Insert Picture", multiple: false, directory: false, filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "bmp"] }] })
      .then((path) => {
        if (typeof path === "string") ctl.insertPictureFile(path);
      })
      .catch(() => {});
  }, [dialog]);
  if (!dialog) return null;
  const close = () => ctl.closeDialog();
  const p = dialog.props ?? {};
  switch (dialog.kind) {
    case "font":
      return <FontDialog ctl={ctl} onClose={close} />;
    case "paragraph":
      return <ParagraphDialog ctl={ctl} onClose={close} />;
    case "pageSetup":
      return <PageSetupDialog ctl={ctl} tab={String(p.tab ?? "margins")} onClose={close} />;
    case "find":
      return <FindDialog ctl={ctl} tab={String(p.tab ?? "find")} onClose={close} />;
    case "insertTable":
      return <InsertTableDialog ctl={ctl} onClose={close} />;
    case "link":
      return <LinkDialog ctl={ctl} onClose={close} bookmarksOnly={p.bookmarks === true} />;
    case "bookmark":
      return <BookmarkDialog ctl={ctl} onClose={close} />;
    case "wordcount":
      return <WordCountDialog ctl={ctl} onClose={close} />;
    case "zoom":
      return <ZoomDialog ctl={ctl} onClose={close} />;
    case "dateTime":
      return <DateTimeDialog ctl={ctl} onClose={close} />;
    case "symbol":
      return <SymbolDialog ctl={ctl} onClose={close} />;
    case "tabs":
      return <TabsDialog ctl={ctl} onClose={close} />;
    case "borders":
      return <BordersDialog ctl={ctl} onClose={close} />;
    case "caption":
      return <CaptionDialog ctl={ctl} onClose={close} />;
    case "sort":
      return <SortDialog ctl={ctl} onClose={close} />;
    case "altText":
      return <AltTextDialog ctl={ctl} onClose={close} />;
    case "pictureSize":
      return <PictureSizeDialog ctl={ctl} onClose={close} />;
    case "styles":
      return <StylesDialog ctl={ctl} onClose={close} />;
    case "accessibility":
      return <AccessibilityDialog ctl={ctl} onClose={close} />;
    case "help":
    case "shortcuts":
    case "about":
    case "spelling":
      return <HelpDialog kind={dialog.kind} onClose={close} />;
    default:
      return null;
  }
}

void schema;
void cssColor;
void fontName;
void HIGHLIGHTS;
