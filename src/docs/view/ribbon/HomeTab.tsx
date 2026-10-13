import { useEffect, useState } from "react";
import { ColorPicker } from "../../../components/ColorPicker";
import { Icon } from "../../../components/Icon";
import type { MenuItem } from "../../../components/Menu";
import { Popup } from "../../../components/Popup";
import { FONTS, SIZES } from "../../../lib/fonts";
import { BigButton, BigSplit, Combo, RibbonGroup, Row, Sep, SmallButton, SplitButton, Stack } from "../../../workbook/ribbon/controls";
import type { DocController } from "../../editor/controller";
import { HIGHLIGHTS } from "../../model/render";
import { useDoc } from "../hooks";
import { HighlightPicker, ListLibrary, StylesGallery, StyleTile } from "./galleries";

/** Clipboard commands run on the document, like Ctrl+X / C / V. */
export async function clipboardAction(ctl: DocController, action: "cut" | "copy" | "paste" | "pasteText") {
  const view = ctl.active;
  if (!view) return;
  view.focus();
  if (action === "cut" || action === "copy") {
    document.execCommand(action);
    return;
  }
  try {
    if (action === "pasteText") {
      const text = await navigator.clipboard.readText();
      view.pasteText(text);
      return;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        view.pasteHTML(html);
        return;
      }
      const image = item.types.find((t) => t.startsWith("image/"));
      if (image) {
        const blob = await item.getType(image);
        await ctl.insertImageFile(new File([blob], "image.png", { type: image }));
        return;
      }
      if (item.types.includes("text/plain")) {
        view.pasteText(await (await item.getType("text/plain")).text());
        return;
      }
    }
  } catch {
    // Reading the clipboard was refused: fall back to the keyboard shortcut
    document.execCommand("paste");
  }
}

/** Opens the Navigation pane with its search box focused (Ctrl+F). */
export function openSearch(ctl: DocController) {
  if (!ctl.navPane) ctl.toggle("navPane");
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".nav-search input")?.focus());
}

function useWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

export function HomeTab({ ctl }: { ctl: DocController }) {
  const f = useDoc(ctl, (c) => c.format);
  const painter = useDoc(ctl, (c) => !!c.painter);
  const showMarks = useDoc(ctl, (c) => c.showMarks);
  const width = useWidth();
  const [lastHighlight, setLastHighlight] = useState("yellow");
  const [lastColor, setLastColor] = useState("#C00000");
  const [lastShade, setLastShade] = useState("#FFFF00");
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState<DOMRect | null>(null);
  const styles = ctl.sheet.quickStyles();
  const perRow = width >= 1700 ? 6 : width >= 1450 ? 4 : width >= 1250 ? 3 : 0;
  const shown = styles.slice(offset, offset + perRow);

  const caseMenu: MenuItem[] = [
    { label: "Sentence case.", onClick: () => ctl.changeCase("sentence") },
    { label: "lowercase", onClick: () => ctl.changeCase("lower") },
    { label: "UPPERCASE", onClick: () => ctl.changeCase("upper") },
    { label: "Capitalize Each Word", onClick: () => ctl.changeCase("title") },
    { label: "tOGGLE cASE", onClick: () => ctl.changeCase("toggle") },
  ];

  const underlineMenu: MenuItem[] = [
    ["single", "Underline"],
    ["double", "Double Underline"],
    ["thick", "Thick Underline"],
    ["dotted", "Dotted Underline"],
    ["dash", "Dashed Underline"],
    ["dotDash", "Dot-dash Underline"],
    ["wave", "Wave Underline"],
    ["words", "Words Only"],
  ].map(([val, label]) => ({ label, checked: f.underline === val, onClick: () => ctl.setUnderline(f.underline === val ? null : val) }));

  const spacingMenu: MenuItem[] = [
    ...LINE_SPACINGS.map((m) => ({ label: m.toFixed(m === 1.15 ? 2 : 1), checked: f.lineSpacing != null && Math.abs(f.lineSpacing - m) < 0.01, onClick: () => ctl.setLineSpacing(m) })),
    { separator: true },
    { label: "Line Spacing Options…", onClick: () => ctl.openDialog("paragraph") },
    { separator: true },
    { label: f.spaceBefore > 0 ? "Remove Space Before Paragraph" : "Add Space Before Paragraph", onClick: () => ctl.toggleSpace("before") },
    { label: f.spaceAfter > 0 ? "Remove Space After Paragraph" : "Add Space After Paragraph", onClick: () => ctl.toggleSpace("after") },
  ];

  const borderMenu: MenuItem[] = [
    ["bottom", "Bottom Border", "borderBottom"],
    ["top", "Top Border", "borderTop"],
    ["left", "Left Border", "borderLeft"],
    ["right", "Right Border", "borderRight"],
    ["none", "No Border", "borderNone"],
    ["all", "All Borders", "borderAll"],
    ["outside", "Outside Borders", "borderOutside"],
    ["inside", "Inside Horizontal Border", "borderInside"],
  ].map(([k, label, icon]) => ({ label, icon, onClick: () => ctl.setBorders(k) }));
  borderMenu.push({ separator: true }, { label: "Borders and Shading…", onClick: () => ctl.openDialog("borders") });

  const findMenu: MenuItem[] = [
    { label: "Find", icon: "find", shortcut: "Ctrl+F", onClick: () => openSearch(ctl) },
    { label: "Advanced Find…", onClick: () => ctl.openDialog("find", { tab: "find" }) },
    { label: "Go To…", icon: "goto", shortcut: "Ctrl+G", onClick: () => ctl.openDialog("find", { tab: "goto" }) },
  ];

  return (
    <>
      <RibbonGroup label="Clipboard">
        <BigSplit
          icon="paste"
          label="Paste"
          title="Paste (Ctrl+V)"
          onClick={() => clipboardAction(ctl, "paste")}
          dropdown={[
            { header: "Paste Options:" },
            { label: "Keep Source Formatting", icon: "paste", onClick: () => clipboardAction(ctl, "paste") },
            { label: "Keep Text Only", icon: "pasteValues", shortcut: "Ctrl+Shift+V", onClick: () => clipboardAction(ctl, "pasteText") },
          ]}
        />
        <Stack>
          <SmallButton icon="cut" label="Cut" title="Cut (Ctrl+X)" onClick={() => clipboardAction(ctl, "cut")} />
          <SmallButton icon="copy" label="Copy" title="Copy (Ctrl+C)" onClick={() => clipboardAction(ctl, "copy")} />
          <SmallButton icon="formatPainter" label="Format Painter" active={painter} title="Format Painter (double-click to keep it on)" onClick={() => ctl.startPainter(false)} />
        </Stack>
      </RibbonGroup>

      <RibbonGroup label="Font" launcher={() => ctl.openDialog("font")}>
        <Stack className="font-stack">
          <Row>
            <Combo
              value={f.font}
              options={f.font && !FONTS.includes(f.font) ? [f.font, ...FONTS] : FONTS}
              width={130}
              title="Font (Ctrl+Shift+F)"
              onCommit={(v) => {
                ctl.setFont(v);
                ctl.focus();
              }}
              renderOption={(o) => <span style={{ fontFamily: `"${o}"`, fontSize: 14 }}>{o}</span>}
            />
            <Combo
              value={f.size != null ? String(f.size) : ""}
              options={SIZES}
              width={46}
              title="Font Size"
              onCommit={(v) => {
                const n = parseFloat(v);
                if (n > 0) ctl.setSize(Math.round(n * 2) / 2);
                ctl.focus();
              }}
            />
            <SmallButton icon="fontGrow" title="Increase Font Size (Ctrl+>)" onClick={() => ctl.growFont(1)} />
            <SmallButton icon="fontShrink" title="Decrease Font Size (Ctrl+<)" onClick={() => ctl.growFont(-1)} />
            <Sep />
            <SmallButton icon="changeCase" title="Change Case (Shift+F3)" dropdown={caseMenu} />
            <SmallButton icon="clearFormatting" title="Clear All Formatting" onClick={() => ctl.clearFormatting()} />
          </Row>
          <Row>
            <SmallButton icon="bold" title="Bold (Ctrl+B)" active={f.bold} onClick={() => ctl.toggleOn("bold")} />
            <SmallButton icon="italic" title="Italic (Ctrl+I)" active={f.italic} onClick={() => ctl.toggleOn("italic")} />
            <SplitButton icon="underline" title="Underline (Ctrl+U)" active={!!f.underline} onClick={() => ctl.toggleUnderline()} dropdown={underlineMenu} />
            <SmallButton icon="strike" title="Strikethrough" active={f.strike} onClick={() => ctl.toggleOn("strike")} />
            <SmallButton icon="subscript" title="Subscript (Ctrl+=)" active={f.sub} onClick={() => ctl.setVert("subscript")} />
            <SmallButton icon="superscript" title="Superscript (Ctrl+Shift++)" active={f.sup} onClick={() => ctl.setVert("superscript")} />
            <Sep />
            <SplitButton
              title="Text Highlight Color"
              onClick={() => ctl.setHighlight(f.highlight ? null : lastHighlight)}
              dropdown={(close) => (
                <HighlightPicker
                  close={close}
                  onPick={(h) => {
                    if (h) setLastHighlight(h);
                    ctl.setHighlight(h);
                  }}
                />
              )}
            >
              <span className="color-bar-icon">
                <Icon name="highlight" />
                <span className="color-bar" style={{ background: HIGHLIGHTS[lastHighlight] }} />
              </span>
            </SplitButton>
            <SplitButton
              title="Font Color"
              onClick={() => ctl.setColor(lastColor)}
              dropdown={(close) => (
                <ColorPicker
                  automaticLabel="Automatic"
                  onPick={(c) => {
                    close();
                    if (c) setLastColor(c);
                    ctl.setColor(c || null);
                  }}
                />
              )}
            >
              <span className="color-bar-icon">
                <Icon name="fontColor" />
                <span className="color-bar" style={{ background: lastColor }} />
              </span>
            </SplitButton>
          </Row>
        </Stack>
      </RibbonGroup>

      <RibbonGroup label="Paragraph" launcher={() => ctl.openDialog("paragraph")}>
        <Stack>
          <Row>
            <SplitButton icon="bullets" title="Bullets" active={f.list === "bullet"} onClick={() => ctl.bullets()} dropdown={(close) => <ListLibrary ctl={ctl} kind="bullet" close={close} />} />
            <SplitButton icon="numbering" title="Numbering" active={f.list === "number"} onClick={() => ctl.numbering()} dropdown={(close) => <ListLibrary ctl={ctl} kind="number" close={close} />} />
            <SmallButton icon="multilevel" title="Multilevel List" dropdown={(close) => <ListLibrary ctl={ctl} kind="multi" close={close} />} />
            <Sep />
            <SmallButton icon="indentDecrease" title="Decrease Indent" onClick={() => ctl.indent(-1)} />
            <SmallButton icon="indentIncrease" title="Increase Indent" onClick={() => ctl.indent(1)} />
            <Sep />
            <SmallButton icon="sortAZ" title="Sort" onClick={() => ctl.openDialog("sort")} />
            <SmallButton icon="pilcrow" title="Show/Hide ¶ (Ctrl+*)" active={showMarks} onClick={() => ctl.toggle("showMarks")} />
          </Row>
          <Row>
            <SmallButton icon="alignLeft" title="Align Left (Ctrl+L)" active={f.align === "left"} onClick={() => ctl.setAlign("left")} />
            <SmallButton icon="alignCenter" title="Center (Ctrl+E)" active={f.align === "center"} onClick={() => ctl.setAlign("center")} />
            <SmallButton icon="alignRight" title="Align Right (Ctrl+R)" active={f.align === "right"} onClick={() => ctl.setAlign("right")} />
            <SmallButton icon="alignJustify" title="Justify (Ctrl+J)" active={f.align === "justify"} onClick={() => ctl.setAlign("both")} />
            <Sep />
            <SmallButton icon="lineSpacing" title="Line and Paragraph Spacing" dropdown={spacingMenu} />
            <Sep />
            <SplitButton
              title="Shading"
              onClick={() => ctl.setShadingPara(lastShade)}
              dropdown={(close) => (
                <ColorPicker
                  noneLabel="No Color"
                  onPick={(c) => {
                    close();
                    if (c) setLastShade(c);
                    ctl.setShadingPara(c || null);
                  }}
                />
              )}
            >
              <span className="color-bar-icon">
                <Icon name="shading" />
                <span className="color-bar" style={{ background: lastShade }} />
              </span>
            </SplitButton>
            <SplitButton icon="borderBottom" title="Borders" onClick={() => ctl.setBorders("bottom")} dropdown={borderMenu} />
          </Row>
        </Stack>
      </RibbonGroup>

      <RibbonGroup label="Styles" className="styles-group" launcher={() => ctl.openDialog("styles")}>
        {perRow > 0 ? (
          <div className="doc-styles-inline">
            <div className="doc-style-row">
              {shown.map((s) => (
                <StyleTile key={s.id} ctl={ctl} id={s.id} name={s.name} active={f.style === s.id || f.charStyle === s.id} onPick={() => ctl.setStyle(s.id)} />
              ))}
            </div>
            <div className="styles-scroll">
              <button tabIndex={-1} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - perRow))} title="Previous row">
                <Icon name="caretUp" size={10} />
              </button>
              <button tabIndex={-1} disabled={offset + perRow >= styles.length} onClick={() => setOffset(Math.min(styles.length - 1, offset + perRow))} title="Next row">
                <Icon name="caretDown" size={10} />
              </button>
              <button tabIndex={-1} title="More" onClick={(e) => setMore(e.currentTarget.parentElement!.parentElement!.getBoundingClientRect())}>
                <Icon name="customize" size={10} />
              </button>
            </div>
            {more && (
              <Popup anchor={more} onClose={() => setMore(null)}>
                <div className="menu flyout">
                  <StylesGallery ctl={ctl} close={() => setMore(null)} />
                </div>
              </Popup>
            )}
          </div>
        ) : (
          <BigButton icon="styles" label="Styles" dropdown={(close) => <StylesGallery ctl={ctl} close={close} />} />
        )}
      </RibbonGroup>

      <RibbonGroup label="Editing">
        <Stack>
          <SplitButton icon="find" label="Find" title="Find (Ctrl+F)" onClick={() => openSearch(ctl)} dropdown={findMenu} />
          <SmallButton icon="replace" label="Replace" title="Replace (Ctrl+H)" onClick={() => ctl.openDialog("find", { tab: "replace" })} />
          <SmallButton
            icon="select"
            label="Select"
            dropdown={[{ label: "Select All", shortcut: "Ctrl+A", onClick: () => ctl.selectAll() }]}
          />
        </Stack>
      </RibbonGroup>
    </>
  );
}
