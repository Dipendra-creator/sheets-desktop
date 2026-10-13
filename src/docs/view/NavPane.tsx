// Navigation pane: search the document, jump between headings and pages.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import type { DocController } from "../editor/controller";
import { useDoc } from "./hooks";

interface HeadingItem {
  pos: number;
  level: number;
  text: string;
}

export function NavPane({ ctl }: { ctl: DocController }) {
  const [tab, setTab] = useState<"headings" | "pages" | "results">("headings");
  const [query, setQuery] = useState(ctl.findState?.query ?? "");
  const doc = useDoc(ctl, (c) => c.state.doc);
  const find = useDoc(ctl, (c) => c.findState);
  const head = useDoc(ctl, (c) => c.state.selection.head);
  const pages = useDoc(ctl, (c) => c.pages);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const headings = useMemo(() => {
    const out: HeadingItem[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name !== "paragraph") return;
      const level = ctl.sheet.outlineLevel(node.attrs.style as string | null, node.attrs.outlineLvl as number | null);
      if (level == null || level > 9) return;
      const style = ctl.sheet.get((node.attrs.style as string) ?? null);
      if (style && /^(toc|TOC Heading)/i.test(style.name)) return;
      const text = node.textContent.trim();
      if (text) out.push({ pos, level, text });
    });
    return out;
  }, [doc, ctl]);

  useEffect(() => {
    if (find?.query && tab !== "results") setTab("results");
  }, [find?.query]);

  // The heading of the section with the cursor
  let current = -1;
  for (let i = 0; i < headings.length; i++) if (headings[i].pos <= head) current = i;

  const visible: (HeadingItem & { index: number; hasChildren: boolean })[] = [];
  let hideBelow = Infinity;
  headings.forEach((h, i) => {
    if (h.level > hideBelow) return;
    hideBelow = Infinity;
    const hasChildren = i + 1 < headings.length && headings[i + 1].level > h.level;
    visible.push({ ...h, index: i, hasChildren });
    if (collapsed.has(h.pos) && hasChildren) hideBelow = h.level;
  });

  const matches = find?.matches ?? [];
  const snippet = (from: number, to: number) => {
    const $from = doc.resolve(from);
    const text = $from.parent.textContent;
    const start = $from.parentOffset;
    const len = to - from;
    const pre = text.slice(Math.max(0, start - 30), start);
    return { pre: (start > 30 ? "…" : "") + pre, hit: text.slice(start, start + len), post: text.slice(start + len, start + len + 50) };
  };

  return (
    <aside className="nav-pane">
      <div className="nav-head">
        <span>Navigation</span>
        <button className="tb-icon" title="Close" onClick={() => ctl.toggle("navPane")}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="nav-search">
        <input
          placeholder="Search document"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            ctl.search(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") ctl.findNext(e.shiftKey ? -1 : 1);
            if (e.key === "Escape") {
              setQuery("");
              ctl.search("");
              ctl.focus();
            }
          }}
        />
        {query ? (
          <button
            title="Clear"
            onClick={() => {
              setQuery("");
              ctl.search("");
            }}
          >
            <Icon name="x" size={12} />
          </button>
        ) : (
          <Icon name="search" size={14} />
        )}
      </div>
      <div className="nav-tabs">
        <button className={tab === "headings" ? "active" : ""} onClick={() => setTab("headings")}>
          Headings
        </button>
        <button className={tab === "pages" ? "active" : ""} onClick={() => setTab("pages")}>
          Pages
        </button>
        <button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}>
          Results
        </button>
      </div>
      <div className="nav-body">
        {tab === "headings" &&
          (headings.length ? (
            visible.map((h) => (
              <div
                key={h.pos}
                className={`nav-heading ${h.index === current ? "current" : ""}`}
                style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
                onClick={() => ctl.goTo(h.pos + 1)}
                title={h.text}
              >
                <span
                  className="nav-twisty"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = new Set(collapsed);
                    if (next.has(h.pos)) next.delete(h.pos);
                    else next.add(h.pos);
                    setCollapsed(next);
                  }}
                >
                  {h.hasChildren && <Icon name={collapsed.has(h.pos) ? "caretRight" : "caretDown"} size={12} />}
                </span>
                <span className="nav-text">{h.text}</span>
              </div>
            ))
          ) : (
            <p className="nav-empty">
              Create an interactive outline of your document.
              <br />
              <br />
              It's a great way to keep track of where you are or quickly move your content around.
              <br />
              <br />
              To get started, go to the Home tab and apply Heading styles to the headings in your document.
            </p>
          ))}
        {tab === "pages" && (
          <div className="nav-pages">
            {pages.map((p) => (
              <button key={p.index} className={`nav-page ${ctl.currentPage === p.index ? "current" : ""}`} onClick={() => ctl.goToPage(p.index)}>
                <span className="nav-page-sheet" />
                <span>{p.index + 1}</span>
              </button>
            ))}
          </div>
        )}
        {tab === "results" &&
          (query ? (
            <>
              <div className="nav-count">{matches.length ? `Result ${Math.max(1, (find?.current ?? 0) + 1)} of ${matches.length}` : "No results"}</div>
              {matches.slice(0, 500).map((m, i) => {
                const s = snippet(m.from, m.to);
                return (
                  <div
                    key={`${m.from}-${i}`}
                    className={`nav-result ${i === find?.current ? "current" : ""}`}
                    onClick={() => {
                      ctl.goTo(m.from);
                      ctl.findNext(1);
                    }}
                  >
                    {s.pre}
                    <mark>{s.hit}</mark>
                    {s.post}
                  </div>
                );
              })}
            </>
          ) : (
            <p className="nav-empty">Search for text in your document.</p>
          ))}
      </div>
    </aside>
  );
}
