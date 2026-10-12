// The horizontal ruler: margins, paragraph indents and tab stops of the
// paragraph with the cursor. Markers can be dragged; clicking the ruler
// adds a left tab stop, dragging a stop off the ruler removes it.

import { useEffect, useRef, useState } from "react";
import type { DocController } from "../editor/controller";
import { geometryOf } from "../editor/pagination";
import { num, twips } from "../model/units";
import { useDoc } from "./hooks";

type Attrs = Record<string, unknown>;

interface Drag {
  kind: "first" | "hanging" | "left" | "right" | "marginL" | "marginR" | "tab";
  startX: number;
  value: number;
  index?: number;
}

export function Ruler({ ctl }: { ctl: DocController }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  const zoom = useDoc(ctl, (c) => c.zoom);
  const page = useDoc(ctl, (c) => c.state.doc.attrs.page);
  const para = useDoc(ctl, (c) => c.state.selection.$from.parent);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  // Follow the page as the canvas scrolls or resizes
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const pageEl = document.querySelector<HTMLElement>(".doc-scroll .page, .doc-scroll .doc-host");
      const host = ref.current;
      if (!pageEl || !host) return;
      const isPage = pageEl.classList.contains("page");
      const g = geometryOf(ctl.state.doc);
      const x = pageEl.getBoundingClientRect().left - host.getBoundingClientRect().left - (isPage ? 0 : g.left * ctl.zoom);
      setLeft(x);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const scroller = document.querySelector(".doc-scroll");
    scroller?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (scroller) ro.observe(scroller);
    schedule();
    return () => {
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ctl, zoom, page]);

  const g = geometryOf(ctl.state.doc);
  const z = zoom;
  const tw = (t: number) => (t / 15) * z;
  const a = para.attrs as Attrs;
  const resolved = ctl.sheet.paragraph((a.style as string) ?? null, a).pPr;
  const ind = (resolved.ind as Attrs) ?? {};
  const indLeft = twips(ind.left ?? ind.start) ?? 0;
  const indRight = twips(ind.right ?? ind.end) ?? 0;
  const hanging = twips(ind.hanging);
  const firstLine = hanging != null ? -hanging : (twips(ind.firstLine) ?? 0);
  const tabs = ctl.sheet.tabStops((a.style as string) ?? null, a.tabs as Attrs[] | null);
  const textW = Math.round((g.pageW - g.left - g.right) * 15);
  const marginL = g.left * z;
  const pageW = g.pageW * z;
  const marginR = g.right * z;

  const begin = (e: React.PointerEvent, d: Omit<Drag, "startX">) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ ...d, startX: e.clientX });
    setPreview(d.value);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const delta = ((e.clientX - drag.startX) / z) * 15;
    // Snap to 1/16" unless Alt is held
    let v = drag.value + delta;
    if (!e.altKey) v = Math.round(v / 90) * 90;
    setPreview(v);
  };

  const onUp = (e: React.PointerEvent) => {
    if (!drag || preview == null) {
      setDrag(null);
      return;
    }
    const v = Math.round(preview);
    const rect = ref.current!.getBoundingClientRect();
    switch (drag.kind) {
      case "first":
        ctl.setIndent({ first: v - indLeft });
        break;
      case "hanging":
        // The hanging marker moves the left indent, keeping the first line
        ctl.setIndent({ left: Math.max(-1440, v), first: indLeft + firstLine - v });
        break;
      case "left":
        ctl.setIndent({ left: v });
        break;
      case "right":
        ctl.setIndent({ right: Math.max(-1440, textW - v) });
        break;
      case "marginL":
        ctl.setPage({ pgMar: { left: String(Math.max(0, Math.round(v))) } });
        break;
      case "marginR":
        ctl.setPage({ pgMar: { right: String(Math.max(0, Math.round(v))) } });
        break;
      case "tab": {
        const list = ((a.tabs as Attrs[] | null) ?? []).filter((t) => t.val !== "clear");
        const all = tabs.map((t) => ({ val: t.val, pos: String(t.pos), leader: t.leader !== "none" ? t.leader : null }));
        const base = list.length ? list : all;
        const out = Math.abs(e.clientY - rect.top - rect.height / 2) > 24;
        const next = base
          .map((t, i) => (i === drag.index ? (out ? null : { ...t, pos: String(Math.max(0, v)) }) : t))
          .filter(Boolean) as Attrs[];
        ctl.setTabs(next);
        break;
      }
    }
    setDrag(null);
    setPreview(null);
  };

  const show = (kind: Drag["kind"], value: number) => (drag && drag.kind === kind && preview != null ? preview : value);
  const firstPos = show("first", indLeft + firstLine);
  const leftPos = show("left", show("hanging", indLeft));
  const rightPos = show("right", textW - indRight);

  // Ticks every 1/8 inch, numbers every inch (from the left margin)
  const ticks: React.ReactElement[] = [];
  const inches = g.pageW / 96;
  const zeroAt = marginL;
  for (let i = -Math.floor((g.left / 96) * 8); i <= Math.ceil((inches - g.left / 96) * 8); i++) {
    const x = zeroAt + i * 12 * z;
    if (x < 0 || x > pageW) continue;
    const major = i % 8 === 0;
    const half = i % 4 === 0;
    ticks.push(
      major && i !== 0 ? (
        <span key={i} className="ruler-num" style={{ left: x }}>
          {Math.abs(i / 8)}
        </span>
      ) : (
        <span key={i} className={`ruler-tick ${half ? "half" : ""}`} style={{ left: x }} />
      ),
    );
  }

  return (
    <div className="ruler" ref={ref} onPointerMove={onMove} onPointerUp={onUp}>
      <div className="ruler-page" style={{ left, width: pageW }}>
        <div className="ruler-margin" style={{ left: 0, width: marginL }} />
        <div className="ruler-margin" style={{ right: 0, width: marginR }} />
        <div
          className="ruler-text"
          style={{ left: marginL, width: pageW - marginL - marginR }}
          onPointerDown={(e) => {
            // Click: add a left tab stop
            if (e.target !== e.currentTarget) return;
            const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
            const pos = Math.round(((x / z) * 15) / 90) * 90;
            const list = ((a.tabs as Attrs[] | null) ?? []).filter((t) => num(t.pos) !== pos);
            ctl.setTabs([...list, { val: "left", pos: String(pos) }]);
          }}
        />
        {ticks}
        <span className="ruler-margin-handle" style={{ left: marginL - 3 }} title="Left Margin" onPointerDown={(e) => begin(e, { kind: "marginL", value: Math.round(g.left * 15) })} />
        <span className="ruler-margin-handle" style={{ left: pageW - marginR - 3 }} title="Right Margin" onPointerDown={(e) => begin(e, { kind: "marginR", value: Math.round(g.right * 15) })} />
        <span className="ind ind-first" style={{ left: marginL + tw(firstPos) - 5 }} title="First Line Indent" onPointerDown={(e) => begin(e, { kind: "first", value: indLeft + firstLine })} />
        <span className="ind ind-hanging" style={{ left: marginL + tw(leftPos) - 5 }} title="Hanging Indent" onPointerDown={(e) => begin(e, { kind: "hanging", value: indLeft })} />
        <span className="ind ind-left" style={{ left: marginL + tw(leftPos) - 5 }} title="Left Indent" onPointerDown={(e) => begin(e, { kind: "left", value: indLeft })} />
        <span className="ind ind-right" style={{ left: marginL + tw(rightPos) - 5 }} title="Right Indent" onPointerDown={(e) => begin(e, { kind: "right", value: textW - indRight })} />
        {tabs.map((t, i) => ({ t, i })).filter(({ t }) => t.pos >= -g.left * 15 && t.pos <= textW + g.right * 15).map(({ t, i }) => (
          <span
            key={`${t.pos}-${i}`}
            className={`ruler-tab tab-${t.val}`}
            style={{ left: marginL + tw(drag?.kind === "tab" && drag.index === i && preview != null ? preview : t.pos) - 4 }}
            title={`${t.val[0].toUpperCase()}${t.val.slice(1)} Tab`}
            onPointerDown={(e) => begin(e, { kind: "tab", value: t.pos, index: i })}
            onDoubleClick={() => ctl.openDialog("tabs")}
          />
        ))}
        {drag && preview != null && <span className="ruler-guide" style={{ left: drag.kind === "marginL" ? tw(preview) : drag.kind === "marginR" ? pageW - tw(preview) : marginL + tw(preview) }} />}
      </div>
    </div>
  );
}
