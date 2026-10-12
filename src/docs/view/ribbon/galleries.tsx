// Galleries of the Docs ribbon: styles, list libraries, table grid,
// symbols and colours.

import { useState, type CSSProperties } from "react";
import { cssColor, fontName, fontStack, HIGHLIGHTS } from "../../model/render";
import type { StyleSheet } from "../../model/styles";
import { num } from "../../model/units";
import type { DocController } from "../../editor/controller";
import { BULLET_FORMATS, MULTILEVEL_FORMATS, NUMBER_FORMATS, type ListFormat } from "../../editor/lists";

/** How a style looks, for gallery tiles. */
export function stylePreview(sheet: StyleSheet, id: string, maxPx = 18): CSSProperties {
  const def = sheet.get(id);
  const rPr = def?.type === "character" ? { ...sheet.paragraph(null).rPr, ...sheet.character(id) } : sheet.paragraph(id).rPr;
  const size = (num(rPr.size?.val) ?? 22) / 2;
  const px = Math.max(9, Math.min(maxPx, size * 1.333 * 0.85));
  const css: CSSProperties = { fontSize: px };
  const font = fontStack(fontName(rPr.font));
  if (font) css.fontFamily = font;
  if (rPr.bold && rPr.bold.on !== false) css.fontWeight = 700;
  if (rPr.italic && rPr.italic.on !== false) css.fontStyle = "italic";
  const color = cssColor(rPr.color);
  if (color) css.color = color;
  if (rPr.caps && rPr.caps.on !== false) css.textTransform = "uppercase";
  if (rPr.smallCaps && rPr.smallCaps.on !== false) css.fontVariant = "small-caps";
  if (rPr.underline && rPr.underline.val !== "none") css.textDecoration = "underline";
  const sp = num(rPr.charSpacing?.val);
  if (sp) css.letterSpacing = `${sp / 20}pt`;
  return css;
}

export function StyleTile({ ctl, id, name, active, onPick }: { ctl: DocController; id: string; name: string; active?: boolean; onPick: () => void }) {
  return (
    <button className={`doc-style-tile ${active ? "active" : ""}`} title={name} onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      <span className="dst-sample" style={stylePreview(ctl.sheet, id)}>
        AaBbCcDd
      </span>
      <span className="dst-name">{name}</span>
    </button>
  );
}

export function StylesGallery({ ctl, close }: { ctl: DocController; close: () => void }) {
  const styles = ctl.sheet.quickStyles();
  return (
    <div className="gallery-panel doc-styles-panel">
      <div className="doc-style-grid">
        {styles.map((s) => (
          <StyleTile
            key={s.id}
            ctl={ctl}
            id={s.id}
            name={s.name}
            active={ctl.format.style === s.id || ctl.format.charStyle === s.id}
            onPick={() => {
              close();
              ctl.setStyle(s.id);
            }}
          />
        ))}
      </div>
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          close();
          ctl.clearFormatting();
        }}
      >
        <span className="menu-label">Clear Formatting</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          close();
          ctl.openDialog("styles");
        }}
      >
        <span className="menu-label">Apply Styles…</span>
      </button>
    </div>
  );
}

function ListSample({ f }: { f: ListFormat }) {
  return (
    <span className="list-sample">
      {f.sample.map((t, i) => (
        <span key={i} className="ls-row" style={{ paddingLeft: f.id.startsWith("m-") ? i * 10 : 0 }}>
          <span className="ls-mark">{t}</span>
          <span className="ls-line" />
        </span>
      ))}
    </span>
  );
}

export function ListLibrary({ ctl, kind, close }: { ctl: DocController; kind: "bullet" | "number" | "multi"; close: () => void }) {
  const formats = kind === "bullet" ? BULLET_FORMATS : kind === "number" ? NUMBER_FORMATS : MULTILEVEL_FORMATS;
  const title = kind === "bullet" ? "Bullet Library" : kind === "number" ? "Numbering Library" : "List Library";
  return (
    <div className="gallery-panel list-library">
      <div className="menu-header">{title}</div>
      <div className={`list-grid ${kind}`}>
        <button
          className="list-tile none"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            close();
            if (ctl.format.list) ctl.apply((state, dispatch) => ctl.lists.toggle(state, dispatch, kind === "bullet" ? BULLET_FORMATS[0] : NUMBER_FORMATS[0]));
          }}
        >
          None
        </button>
        {formats.map((f) => (
          <button
            key={f.id}
            className="list-tile"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              close();
              ctl.toggleList(f, true);
            }}
          >
            {kind === "bullet" ? <span className="bullet-big">{f.sample[0]}</span> : <ListSample f={f} />}
          </button>
        ))}
      </div>
      {kind !== "bullet" && (
        <>
          <div className="menu-sep" />
          <button
            className="menu-item"
            disabled={!ctl.format.list}
            onClick={() => {
              close();
              ctl.restartNumbering();
            }}
          >
            <span className="menu-label">Restart at 1</span>
          </button>
        </>
      )}
      <div className="menu-sep" />
      <button
        className="menu-item"
        disabled={!ctl.format.list}
        onClick={() => {
          close();
          ctl.indent(-1);
        }}
      >
        <span className="menu-label">Decrease List Level</span>
      </button>
      <button
        className="menu-item"
        disabled={!ctl.format.list}
        onClick={() => {
          close();
          ctl.indent(1);
        }}
      >
        <span className="menu-label">Increase List Level</span>
      </button>
    </div>
  );
}

/** Insert Table: hover a grid to choose its size. */
export function TableGrid({ ctl, close }: { ctl: DocController; close: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const rows = 8;
  const cols = 10;
  return (
    <div className="table-picker">
      <div className="menu-header">{hover[0] ? `${hover[1]}x${hover[0]} Table` : "Insert Table"}</div>
      <div className="tp-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => (
            <span
              key={`${r}-${c}`}
              className={`tp-cell ${r < hover[0] && c < hover[1] ? "on" : ""}`}
              onMouseEnter={() => setHover([r + 1, c + 1])}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                close();
                ctl.insertTable(r + 1, c + 1);
              }}
            />
          )),
        )}
      </div>
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          close();
          ctl.openDialog("insertTable");
        }}
      >
        <span className="menu-label">Insert Table…</span>
      </button>
    </div>
  );
}

export const COMMON_SYMBOLS = ["©", "®", "™", "€", "£", "¥", "±", "≠", "≤", "≥", "÷", "×", "∞", "µ", "α", "β", "π", "Ω", "∑", "√", "°", "•", "…", "—", "–", "§", "¶", "←", "→", "↑", "↓", "✓", "★", "♥", "☺"];

export function SymbolGrid({ onPick, close }: { onPick: (s: string) => void; close: () => void }) {
  return (
    <div className="symbol-picker">
      <div className="symbol-grid">
        {COMMON_SYMBOLS.map((s) => (
          <button
            key={s}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              close();
              onPick(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export const HIGHLIGHT_ORDER = ["yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray", "black"];

export function HighlightPicker({ onPick, close }: { onPick: (name: string | null) => void; close: () => void }) {
  return (
    <div className="highlight-picker">
      <div className="hl-grid">
        {HIGHLIGHT_ORDER.map((h) => (
          <button
            key={h}
            title={h.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
            style={{ background: HIGHLIGHTS[h] }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              close();
              onPick(h);
            }}
          />
        ))}
      </div>
      <button
        className="menu-item"
        onClick={() => {
          close();
          onPick(null);
        }}
      >
        <span className="menu-label">No Color</span>
      </button>
    </div>
  );
}
