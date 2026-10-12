// Units of WordprocessingML and how they map to CSS.
//
// Lengths in documents are twips (1/20 pt, 1440 per inch), font sizes are
// half-points and pictures use EMUs (914400 per inch). The page is drawn
// at 96 px per inch, scaled by the zoom factor in the CSS variable --z, so
// every length the editor writes into styles is `calc(<n>px * var(--z))`.

export const TWIPS_PER_PX = 15;
export const EMU_PER_PX = 9525;
export const TWIPS_PER_INCH = 1440;
export const TWIPS_PER_CM = 566.929;

/** A number from an attribute ("720", 720, "1.5in", "2cm"…), in twips. */
export function twips(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v === "") return null;
  const m = /^(-?[\d.]+)\s*(mm|cm|in|pt|pc|pi)?$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case "mm":
      return (n / 25.4) * 1440;
    case "cm":
      return (n / 2.54) * 1440;
    case "in":
      return n * 1440;
    case "pt":
      return n * 20;
    case "pc":
    case "pi":
      return n * 240;
    default:
      return n;
  }
}

export function twToPx(tw: number): number {
  return tw / TWIPS_PER_PX;
}

export function pxToTw(px: number): number {
  return Math.round(px * TWIPS_PER_PX);
}

/** A zoom-scaled CSS length. */
export function zpx(px: number): string {
  if (!px) return "0";
  return `calc(${round(px)}px * var(--z))`;
}

export function zpt(pt: number): string {
  if (!pt) return "0";
  return `calc(${round(pt)}pt * var(--z))`;
}

export function ztw(tw: number): string {
  return zpx(tw / TWIPS_PER_PX);
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Inches with up to two decimals, for dialogs. */
export function twToInches(tw: number): string {
  return `${round(tw / TWIPS_PER_INCH, 2)}"`;
}

/** Parses a length typed in a dialog ("1", "1.5\"", "2.5 cm", "12 pt") to twips. */
export function parseLength(text: string, unit: "in" | "cm" | "pt" = "in"): number | null {
  const t = text.trim().replace(/[″"]/g, "in").replace(/\s+/g, "");
  const m = /^(-?[\d.,]+)(in|cm|mm|pt|li)?$/i.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] ?? unit).toLowerCase();
  if (u === "in") return Math.round(n * 1440);
  if (u === "cm") return Math.round((n / 2.54) * 1440);
  if (u === "mm") return Math.round((n / 25.4) * 1440);
  if (u === "pt") return Math.round(n * 20);
  return null;
}

export function formatLength(tw: number, unit: "in" | "cm" | "pt" = "in"): string {
  if (unit === "cm") return `${round((tw / 1440) * 2.54, 2)} cm`;
  if (unit === "pt") return `${round(tw / 20, 1)} pt`;
  return `${round(tw / 1440, 2)}"`;
}
