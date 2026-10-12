// Floating (anchored) pictures: how one sits in the text, read from its
// drawing XML. Shared by the editor and the static drawing of headers,
// footers and notes.

import { EMU_PER_PX } from "./units";

export interface AnchorLayout {
  mode: "inline" | "left" | "right" | "block" | "absolute";
  /** Offsets in unzoomed px (absolute mode). */
  x: number;
  y: number;
  behind: boolean;
  align: "left" | "center" | "right";
}

/** How a floating picture sits in the text, from its drawing XML. */
export function anchorLayout(raw: string | null, anchored: boolean): AnchorLayout {
  const out: AnchorLayout = { mode: "inline", x: 0, y: 0, behind: false, align: "left" };
  if (!anchored || !raw) return out;
  const posH = /<wp:positionH[^>]*relativeFrom="([^"]+)"[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(raw);
  const posV = /<wp:positionV[^>]*relativeFrom="([^"]+)"[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(raw);
  const alignH = posH ? /<wp:align>(\w+)<\/wp:align>/.exec(posH[2])?.[1] : undefined;
  const offH = posH ? Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posH[2])?.[1] ?? "NaN") : NaN;
  const offV = posV ? Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posV[2])?.[1] ?? "NaN") : NaN;
  out.align = alignH === "right" || alignH === "outside" ? "right" : alignH === "center" ? "center" : "left";
  out.behind = /behindDoc="(1|true)"/.test(raw);
  if (/<wp:wrapTopAndBottom/.test(raw)) {
    out.mode = "block";
  } else if (/<wp:wrap(Square|Tight|Through)/.test(raw)) {
    if (alignH) out.mode = out.align === "right" ? "right" : out.align === "center" ? "block" : "left";
    else out.mode = Number.isFinite(offH) && offH / EMU_PER_PX > 250 ? "right" : "left";
  } else {
    out.mode = "absolute";
    out.x = Number.isFinite(offH) ? offH / EMU_PER_PX : 0;
    out.y = Number.isFinite(offV) ? offV / EMU_PER_PX : 0;
    if (alignH === "center") out.x = NaN;
    if (posV && posV[1] !== "paragraph" && posV[1] !== "line") out.y = Number.isFinite(offV) ? Math.max(0, offV / EMU_PER_PX) : 0;
  }
  return out;
}
