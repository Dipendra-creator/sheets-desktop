import { useEffect, useState } from "react";
import { Icon } from "../../../components/Icon";
import { KeyTipsLayer } from "../../../workbook/ribbon/KeyTips";
import type { DocController } from "../../editor/controller";
import { useDoc } from "../hooks";
import { HomeTab } from "./HomeTab";
import { HeaderFooterTab, HelpTab, InsertTab, LayoutTab, PictureTab, ReferencesTab, ReviewTab, TableDesignTab, TableLayoutTab, ViewTab } from "./OtherTabs";

const TABS = ["Home", "Insert", "Layout", "References", "Review", "View", "Help"] as const;

/** Word's KeyTips letters. */
const TAB_KEYS: Record<string, string> = {
  File: "F",
  Home: "H",
  Insert: "N",
  Layout: "P",
  References: "S",
  Review: "R",
  View: "W",
  Help: "Y",
  "Header & Footer": "JH",
  "Table Design": "JT",
  "Table Layout": "JL",
  "Picture Format": "JP",
};

const KNOWN: [string, string][] = [
  ["Paste", "V"],
  ["Cut", "X"],
  ["Copy", "C"],
  ["Format Painter", "FP"],
  ["Font Size", "FS"],
  ["Font", "FF"],
  ["Increase Font Size", "FG"],
  ["Decrease Font Size", "FK"],
  ["Change Case", "7"],
  ["Clear All Formatting", "E"],
  ["Bold", "1"],
  ["Italic", "2"],
  ["Underline", "3"],
  ["Strikethrough", "4"],
  ["Subscript", "5"],
  ["Superscript", "6"],
  ["Text Highlight Color", "I"],
  ["Font Color", "FC"],
  ["Bullets", "U"],
  ["Numbering", "N"],
  ["Multilevel List", "M"],
  ["Decrease Indent", "AO"],
  ["Increase Indent", "AI"],
  ["Sort", "SO"],
  ["Show/Hide", "8"],
  ["Align Left", "AL"],
  ["Center", "AC"],
  ["Align Right", "AR"],
  ["Justify", "AJ"],
  ["Line and Paragraph Spacing", "K"],
  ["Shading", "H"],
  ["Borders", "B"],
  ["Styles", "L"],
  ["Find", "FD"],
  ["Replace", "R"],
  ["Select", "SL"],
  ["Table", "T"],
  ["Pictures", "P"],
  ["Link", "I"],
  ["Header", "H"],
  ["Footer", "O"],
  ["Page Number", "NU"],
  ["Margins", "M"],
  ["Orientation", "O"],
  ["Size", "SZ"],
  ["Breaks", "B"],
  ["Table of Contents", "T"],
  ["Track Changes", "G"],
  ["Word Count", "W"],
  ["Ruler", "R"],
  ["Navigation Pane", "K"],
  ["Zoom", "Q"],
];

type ContextTab = "Header & Footer" | "Table Design" | "Table Layout" | "Picture Format";

export function DocRibbon({ ctl, onFile }: { ctl: DocController; onFile: () => void }) {
  const [tab, setTab] = useState<string>("Home");
  const collapsed = useDoc(ctl, (c) => c.ribbonCollapsed);
  const keyTips = useDoc(ctl, (c) => c.keyTips);
  const inTable = useDoc(ctl, (c) => c.format.inTable && !c.headerEdit);
  const image = useDoc(ctl, (c) => !!c.selectedImage);
  const editingHf = useDoc(ctl, (c) => !!c.headerEdit);
  const [peek, setPeek] = useState(false);

  const contextual: ContextTab[] = [];
  if (editingHf) contextual.push("Header & Footer");
  if (inTable) contextual.push("Table Design", "Table Layout");
  if (image) contextual.push("Picture Format");

  // Contextual tabs open by themselves (Header & Footer, Picture Format)
  useEffect(() => {
    if (editingHf) setTab("Header & Footer");
    else if (tab === "Header & Footer") setTab("Home");
  }, [editingHf]);
  useEffect(() => {
    if (image) setTab("Picture Format");
    else if (tab === "Picture Format") setTab("Home");
  }, [image]);
  useEffect(() => {
    if (!inTable && (tab === "Table Design" || tab === "Table Layout")) setTab("Home");
  }, [inTable]);

  const content = (
    <div className="ribbon-content" onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
      <div className="ribbon-groups">
        {tab === "Home" && <HomeTab ctl={ctl} />}
        {tab === "Insert" && <InsertTab ctl={ctl} />}
        {tab === "Layout" && <LayoutTab ctl={ctl} />}
        {tab === "References" && <ReferencesTab ctl={ctl} />}
        {tab === "Review" && <ReviewTab ctl={ctl} />}
        {tab === "View" && <ViewTab ctl={ctl} />}
        {tab === "Help" && <HelpTab ctl={ctl} />}
        {tab === "Header & Footer" && <HeaderFooterTab ctl={ctl} />}
        {tab === "Table Design" && <TableDesignTab ctl={ctl} />}
        {tab === "Table Layout" && <TableLayoutTab ctl={ctl} />}
        {tab === "Picture Format" && <PictureTab ctl={ctl} />}
      </div>
      <button
        className="ribbon-collapse"
        title={collapsed ? "Pin the ribbon" : "Collapse the Ribbon (Ctrl+F1)"}
        onClick={() => {
          ctl.toggle("ribbonCollapsed");
          setPeek(false);
        }}
      >
        <Icon name={collapsed ? "pin" : "chevronUp"} size={12} />
      </button>
    </div>
  );

  const tabButton = (t: string, contextualTab = false) => (
    <button
      key={t}
      className={`ribbon-tab ${contextualTab ? "contextual" : ""} ${t === tab && (!collapsed || peek) ? "active" : ""}`}
      onClick={() => {
        setTab(t);
        if (collapsed) setPeek(!(peek && t === tab));
      }}
      onDoubleClick={() => {
        ctl.toggle("ribbonCollapsed");
        setPeek(false);
      }}
    >
      {t}
    </button>
  );

  return (
    <div className={`ribbon doc-ribbon ${collapsed ? "collapsed" : ""}`}>
      <div className="ribbon-tabs">
        <button className="ribbon-tab file-tab" onClick={onFile}>
          File
        </button>
        {TABS.map((t) => tabButton(t))}
        {contextual.map((t) => tabButton(t, true))}
        <div className="ribbon-tabs-spacer" />
        <button className={`share-btn comments-btn ${ctl.commentsPane ? "on" : ""}`} onClick={() => ctl.toggleComments()} title="Comments">
          <Icon name="comment" size={14} />
          Comments
        </button>
      </div>
      <KeyTipsLayer
        level={keyTips === "off" ? null : keyTips}
        setLevel={(l) => {
          ctl.keyTips = l ?? "off";
          ctl.emit();
        }}
        focusContent={() => ctl.focus()}
        tab={tab}
        tabKeys={TAB_KEYS}
        known={KNOWN}
        onTab={(t) => {
          setTab(t);
          if (collapsed) setPeek(true);
        }}
        onFile={onFile}
      />
      {(!collapsed || peek || keyTips === "controls") && (
        <div className={peek ? "ribbon-peek" : ""} onMouseLeave={() => peek && setPeek(false)}>
          {content}
        </div>
      )}
    </div>
  );
}
