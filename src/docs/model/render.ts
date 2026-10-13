// What drawing a document needs besides its nodes: the theme (fonts and
// colours referenced by name), the document id (to load its pictures) and
// helpers that turn WordprocessingML values into CSS.

import type { Theme } from "../api";
import { round } from "./units";

export interface RenderContext {
  docId: string;
  theme: Theme;
}

/** The document shown in this window. Set when a document loads. */
export const ctx: RenderContext = { docId: "", theme: {} };

export function setRenderContext(docId: string, theme: Theme) {
  ctx.docId = docId;
  ctx.theme = theme ?? {};
}

// ----------------------------------------------------------------------
// Colours
// ----------------------------------------------------------------------

const THEME_ALIASES: Record<string, string> = {
  text1: "dk1",
  background1: "lt1",
  text2: "dk2",
  background2: "lt2",
  dark1: "dk1",
  light1: "lt1",
  dark2: "dk2",
  light2: "lt2",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

/** The Office theme, for documents without one. */
export const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: "000000",
  lt1: "FFFFFF",
  dk2: "0E2841",
  lt2: "E8E8E8",
  accent1: "156082",
  accent2: "E97132",
  accent3: "196B24",
  accent4: "0F9ED5",
  accent5: "A02B93",
  accent6: "4EA72E",
  hlink: "467886",
  folHlink: "96607D",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** Applies Word's themeTint / themeShade (hex bytes) to a colour. */
export function tintShade(hex: string, tint?: string | null, shade?: string | null): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  let lum = l;
  if (tint) {
    const t = parseInt(tint, 16) / 255;
    lum = l * t + (1 - t);
  }
  if (shade) {
    const f = parseInt(shade, 16) / 255;
    lum = lum * f;
  }
  return rgbToHex(...hslToRgb(h, s, Math.max(0, Math.min(1, lum))));
}

export function themeColor(name: string): string | null {
  const key = THEME_ALIASES[name] ?? name;
  return ctx.theme.colors?.[key] ?? DEFAULT_THEME_COLORS[key] ?? null;
}

/**
 * A CSS colour from colour attributes (`val`, `themeColor`, `themeTint`,
 * `themeShade`). Returns null for "auto".
 */
export function cssColor(a: Record<string, unknown> | null | undefined, valKey = "val", prefix = "theme"): string | null {
  if (!a) return null;
  const theme = a[`${prefix}Color`] as string | undefined;
  if (theme) {
    const base = themeColor(theme);
    if (base) return `#${tintShade(base, a[`${prefix}Tint`] as string, a[`${prefix}Shade`] as string)}`;
  }
  const v = a[valKey];
  if (typeof v !== "string" || !v || v === "auto") return null;
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : v;
}

/** Fill colour of a `w:shd` (Word ignores the pattern colour for "clear"). */
export function shadingColor(a: Record<string, unknown> | null | undefined): string | null {
  if (!a) return null;
  const val = a.val as string | undefined;
  if (val === "nil") return null;
  if (a.themeFill) {
    const base = themeColor(a.themeFill as string);
    if (base) return `#${tintShade(base, a.themeFillTint as string, a.themeFillShade as string)}`;
  }
  const fill = a.fill as string | undefined;
  if (val === "solid") {
    const c = a.color as string | undefined;
    if (c && c !== "auto") return `#${c}`;
    return "#000000";
  }
  if (fill && fill !== "auto") return `#${fill}`;
  // Percentage patterns over an automatic fill: a grey
  const pct = /^pct(\d+)$/.exec(val ?? "");
  if (pct) {
    const g = Math.round(255 * (1 - parseInt(pct[1], 10) / 100));
    return `rgb(${g},${g},${g})`;
  }
  return null;
}

export const HIGHLIGHTS: Record<string, string> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#C0C0C0",
  black: "#000000",
  white: "#FFFFFF",
};

// ----------------------------------------------------------------------
// Fonts
// ----------------------------------------------------------------------

/** Metric-compatible stand-ins for fonts that may not be installed. */
const FALLBACKS: Record<string, string[]> = {
  calibri: ["Carlito"],
  "calibri light": ["Carlito"],
  cambria: ["Caladea"],
  arial: ["Liberation Sans", "Arimo", "Helvetica"],
  "times new roman": ["Liberation Serif", "Tinos", "Times"],
  "courier new": ["Liberation Mono", "Cousine", "Courier"],
  aptos: ["Segoe UI", "Calibri", "Carlito", "Helvetica Neue"],
  "aptos display": ["Segoe UI Semibold", "Calibri Light", "Carlito", "Helvetica Neue"],
  "aptos narrow": ["Arial Narrow", "Liberation Sans Narrow"],
  "segoe ui": ["Helvetica Neue", "Ubuntu", "Cantarell"],
  "helvetica neue": ["Helvetica", "Arial"],
  consolas: ["Menlo", "DejaVu Sans Mono"],
  georgia: ["Gelasio"],
  "century gothic": ["URW Gothic"],
  symbol: ["Symbol"],
};

const SERIF = /times|cambria|georgia|garamond|book|serif|palatino|constantia|caladea|baskerville|minion|mincho|song|batang|century schoolbook/i;
const MONO = /mono|courier|consolas|console|code|typewriter/i;

export function fontStack(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.replace(/["\\]/g, "");
  const extra = FALLBACKS[clean.toLowerCase()] ?? [];
  const generic = MONO.test(clean) ? "monospace" : SERIF.test(clean) ? "serif" : "sans-serif";
  return [clean, ...extra].map((f) => `"${f}"`).join(", ") + `, ${generic}`;
}

/** The font of a `w:rFonts` (ASCII range), resolving theme fonts. */
export function fontName(a: Record<string, unknown> | null | undefined): string | null {
  if (!a) return null;
  const theme = (a.asciiTheme ?? a.hAnsiTheme) as string | undefined;
  if (theme) {
    const major = theme.startsWith("major");
    const t = major ? ctx.theme.fonts?.major : ctx.theme.fonts?.minor;
    if (t) return t;
    return major ? "Aptos Display" : "Aptos";
  }
  return (a.ascii as string) || (a.hAnsi as string) || (a.cs as string) || (a.eastAsia as string) || null;
}

// ----------------------------------------------------------------------
// Borders
// ----------------------------------------------------------------------

/** CSS for a border element (`w:top`, `w:insideH`…): width, style, colour. */
export function borderCss(b: Record<string, unknown> | null | undefined): string | null {
  if (!b) return null;
  const val = (b.val as string) ?? "single";
  if (val === "nil" || val === "none") return "none";
  const sz = Math.max(2, Number(b.sz ?? 4)); // eighths of a point
  let pt = sz / 8;
  let style = "solid";
  switch (val) {
    case "double":
    case "triple":
    case "thinThickSmallGap":
    case "thickThinSmallGap":
    case "thinThickMediumGap":
    case "thickThinMediumGap":
    case "thinThickLargeGap":
    case "thickThinLargeGap":
    case "thinThickThinSmallGap":
    case "thinThickThinMediumGap":
    case "thinThickThinLargeGap":
    case "doubleWave":
      style = "double";
      pt = Math.max(pt * 3, 2.25);
      break;
    case "dotted":
      style = "dotted";
      break;
    case "dashed":
    case "dashSmallGap":
    case "dotDash":
    case "dotDotDash":
      style = "dashed";
      break;
    case "thick":
      pt = Math.max(pt, 1.5);
      break;
    case "wave":
      style = "solid";
      break;
    case "threeDEmboss":
      style = "ridge";
      break;
    case "threeDEngrave":
      style = "groove";
      break;
    case "outset":
      style = "outset";
      break;
    case "inset":
      style = "inset";
      break;
  }
  const color = cssColor(b, "color") ?? "#000";
  return `max(1px, calc(${round(pt)}pt * var(--z))) ${style} ${color}`;
}
