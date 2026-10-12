// List numbering the way Word does it.
//
// Paragraphs refer to a list instance (`numId`) and a level (`ilvl`). List
// instances share counters through their abstract definition; a level
// override with a start value begins a new count. Each level's text
// ("%1.%2.") is filled in with the counters of that level and the ones
// above it, each in its own number format.

import type { NumLevel, Numbering } from "../api";
import type { StyleSheet } from "./styles";

/** Private-use bullet characters of symbol fonts → Unicode. */
const SYMBOL_BULLETS: Record<string, string> = {
  "": "•",
  "": "▪",
  "": "➢",
  "": "✓",
  "": "❖",
  "": "◆",
  "": "■",
  "": "➔",
  "": "⇨",
  "": "♦",
  "": "◦",
  "": "►",
  "": "□",
  "": "❑",
  "": "○",
  "": "✗",
  "": "☑",
};

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function letters(n: number): string {
  // Word repeats the letter: a … z, aa … zz, aaa…
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function cardinal(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${cardinal(n % 100)}` : ""}`;
  return String(n);
}

function ordinalSuffix(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function ordinalWord(n: number): string {
  const special: Record<number, string> = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth" };
  if (special[n]) return special[n];
  const c = cardinal(n);
  if (c.endsWith("y")) return `${c.slice(0, -1)}ieth`;
  return `${c}th`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatNumber(n: number, fmt: string | null | undefined): string {
  switch (fmt ?? "decimal") {
    case "decimal":
      return String(n);
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "lowerRoman":
      return roman(n);
    case "upperLetter":
      return letters(n).toUpperCase();
    case "lowerLetter":
      return letters(n);
    case "ordinal":
      return `${n}${ordinalSuffix(n)}`;
    case "cardinalText":
      return capitalize(cardinal(n));
    case "ordinalText":
      return capitalize(ordinalWord(n));
    case "decimalEnclosedCircle":
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    case "decimalEnclosedParen":
      return `(${n})`;
    case "chicago":
      return ["*", "†", "‡", "§"][(n - 1) % 4].repeat(Math.floor((n - 1) / 4) + 1);
    case "none":
      return "";
    default:
      return String(n);
  }
}

export interface ListItem {
  text: string;
  level: NumLevel;
  numId: number;
  ilvl: number;
  bullet: boolean;
}

export class Numberer {
  /** Counters by abstract definition: one per level (null: not started). */
  private counters = new Map<string, (number | null)[]>();
  /** Start values waiting for a level's next item (list restarts). */
  private pending = new Map<string, (number | null)[]>();
  /** List instances that already applied their start overrides. */
  private started = new Set<string>();

  constructor(
    private numbering: Numbering,
    private sheet: StyleSheet,
  ) {}

  /** The abstract definition of a list instance (following style links). */
  abstractOf(numId: number): string | null {
    const n = this.numbering.nums?.[String(numId)];
    if (!n) return null;
    let abs = String(n.abstract);
    for (let i = 0; i < 4; i++) {
      const a = this.numbering.abstracts?.[abs];
      const link = a?.numStyleLink;
      if (!link) break;
      const style = this.sheet.get(link);
      const linked = (style?.pPr?.numPr as Record<string, unknown> | undefined)?.numId;
      const target = linked != null ? this.numbering.nums?.[String(linked)] : undefined;
      if (!target || String(target.abstract) === abs) break;
      abs = String(target.abstract);
    }
    return abs;
  }

  level(numId: number, ilvl: number): NumLevel | null {
    const n = this.numbering.nums?.[String(numId)];
    const override = n?.overrides?.[String(ilvl)];
    if (override?.level) return override.level;
    const abs = this.abstractOf(numId);
    const levels = abs ? this.numbering.abstracts?.[abs]?.levels : undefined;
    return levels?.find((l) => l.ilvl === ilvl) ?? levels?.[ilvl] ?? null;
  }

  reset() {
    this.counters.clear();
    this.pending.clear();
    this.started.clear();
  }

  /** Numbers the next paragraph of a list and returns its label. */
  next(numId: number, ilvl: number): ListItem | null {
    const level = this.level(numId, ilvl);
    if (!level) return null;
    const abs = this.abstractOf(numId) ?? `n${numId}`;
    let counts = this.counters.get(abs);
    let pending = this.pending.get(abs);
    if (!counts || !pending) {
      counts = new Array(9).fill(null);
      pending = new Array(9).fill(null);
      this.counters.set(abs, counts);
      this.pending.set(abs, pending);
    }
    // A list instance that overrides start values begins a new count
    const key = String(numId);
    if (!this.started.has(key)) {
      this.started.add(key);
      const overrides = this.numbering.nums?.[key]?.overrides ?? {};
      for (const [lvl, o] of Object.entries(overrides)) {
        if (o.start != null) {
          const i = Number(lvl);
          counts[i] = null;
          pending[i] = o.start;
          for (let j = i + 1; j < 9; j++) counts[j] = null;
        }
      }
    }
    const startOf = (i: number) => this.level(numId, i)?.start ?? 0;
    if (counts[ilvl] == null) {
      counts[ilvl] = pending[ilvl] ?? startOf(ilvl);
      pending[ilvl] = null;
    } else counts[ilvl] = (counts[ilvl] as number) + 1;
    for (let j = ilvl + 1; j < 9; j++) {
      const l = this.level(numId, j);
      // lvlRestart 0 means "never restart"; n restarts after level n-1
      if (l?.lvlRestart === 0) continue;
      if (l?.lvlRestart != null && l.lvlRestart - 1 > ilvl) continue;
      counts[j] = null;
    }
    const fmt = level.numFmt ?? "decimal";
    const bullet = fmt === "bullet";
    let text: string;
    if (bullet) {
      const raw = level.lvlText ?? "•";
      text = Array.from(raw)
        .map((c) => SYMBOL_BULLETS[c] ?? (c.charCodeAt(0) >= 0xf000 ? SYMBOL_BULLETS[c] ?? "•" : c))
        .join("");
    } else {
      text = (level.lvlText ?? `%${ilvl + 1}.`).replace(/%(\d)/g, (_m, d: string) => {
        const i = Number(d) - 1;
        const l = this.level(numId, i);
        const value = counts![i] ?? l?.start ?? 1;
        const f = level.isLgl && i < ilvl ? "decimal" : l?.numFmt;
        return formatNumber(value, f);
      });
    }
    return { text, level, numId, ilvl, bullet };
  }
}

/** Numbers every listed paragraph of a document, in order. */
export function bulletFor(level: NumLevel | null): string {
  if (!level) return "•";
  return Array.from(level.lvlText ?? "•").map((c) => SYMBOL_BULLETS[c] ?? c).join("");
}
