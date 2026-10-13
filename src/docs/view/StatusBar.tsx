import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Menu } from "../../components/Menu";
import type { DocController, ViewMode } from "../editor/controller";
import { useDoc } from "./hooks";

function zoomToPos(z: number) {
  return z <= 1 ? ((z - 0.1) / 0.9) * 0.5 : 0.5 + ((z - 1) / 4) * 0.5;
}

function posToZoom(p: number) {
  const z = p <= 0.5 ? 0.1 + (p / 0.5) * 0.9 : 1 + ((p - 0.5) / 0.5) * 4;
  return Math.abs(z - 1) < 0.04 ? 1 : Math.round(z * 100) / 100;
}

type Item = "page" | "words" | "language" | "track" | "accessibility";

export function DocStatusBar({ ctl }: { ctl: DocController }) {
  const s = useDoc(ctl, (c) => ({
    page: c.currentPage + 1,
    pages: c.pages.length,
    words: c.stats.words,
    sel: c.selectionWords,
    zoom: c.zoom,
    view: c.viewMode,
    track: c.trackChanges,
    painter: !!c.painter,
    status: c.status,
  }));
  const [shown, setShown] = useState<Record<Item, boolean>>(() => {
    try {
      const saved = localStorage.getItem("docs.statusItems");
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    return { page: true, words: true, language: true, track: true, accessibility: true };
  });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const view = (mode: ViewMode, icon: string, title: string) => (
    <button className={s.view === mode ? "active" : ""} title={title} onClick={() => ctl.setViewMode(mode)}>
      <Icon name={icon} size={16} />
    </button>
  );
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div
      className="status-bar doc-status"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {shown.page && (
        <button className="status-item link" title="Go To (Ctrl+G)" onClick={() => ctl.openDialog("find", { tab: "goto" })}>
          Page {s.page} of {s.pages}
        </button>
      )}
      {shown.words && (
        <button className="status-item link" title="Word Count" onClick={() => ctl.openDialog("wordcount")}>
          {s.sel != null ? `${fmt(s.sel)} of ${fmt(s.words)} words` : `${fmt(s.words)} ${s.words === 1 ? "word" : "words"}`}
        </button>
      )}
      {shown.language && <span className="status-item">English (United States)</span>}
      {shown.track && s.track && (
        <button className="status-item link" onClick={() => ctl.setTracking(false)} title="Track Changes is on">
          Track Changes: On
        </button>
      )}
      {shown.accessibility && (
        <span className="status-item">
          <Icon name="accessibility" size={14} />
          Accessibility: Good to go
        </span>
      )}
      {s.painter && <span className="status-item">Click and drag over text to apply the formatting</span>}
      {s.status && <span className="status-item">{s.status}</span>}
      <div className="status-spacer" />
      <div className="status-views">
        {view("read", "readMode", "Read Mode")}
        {view("print", "printLayout", "Print Layout")}
        {view("web", "webLayout", "Web Layout")}
      </div>
      <div className="zoom-control">
        <button title="Zoom Out" onClick={() => ctl.setZoom(Math.max(0.1, Math.round((s.zoom - 0.1) * 10) / 10))}>
          <Icon name="minus" size={12} />
        </button>
        <input type="range" min={0} max={1000} value={Math.round(zoomToPos(s.zoom) * 1000)} onChange={(e) => ctl.setZoom(posToZoom(Number(e.target.value) / 1000))} title="Zoom" />
        <button title="Zoom In" onClick={() => ctl.setZoom(Math.min(5, Math.round((s.zoom + 0.1) * 10) / 10))}>
          <Icon name="plus" size={12} />
        </button>
        <button className="zoom-pct" onClick={() => ctl.openDialog("zoom")} title="Zoom level">
          {Math.round(s.zoom * 100)}%
        </button>
      </div>
      {menu && (
        <Menu
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            { header: "Customize Status Bar" },
            ...(
              [
                ["page", "Page Number"],
                ["words", "Word Count"],
                ["language", "Language"],
                ["track", "Track Changes"],
                ["accessibility", "Accessibility Checker"],
              ] as [Item, string][]
            ).map(([k, label]) => ({
              label,
              checked: shown[k],
              onClick: () => {
                const next = { ...shown, [k]: !shown[k] };
                setShown(next);
                try {
                  localStorage.setItem("docs.statusItems", JSON.stringify(next));
                } catch {
                  /* ignore */
                }
              },
            })),
          ]}
        />
      )}
    </div>
  );
}
