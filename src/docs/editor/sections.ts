// Sections: each section of a document can have its own headers and
// footers, "different first page" and page numbering. A section without
// its own header of a kind uses the previous section's ("Link to
// Previous"). Sections end at paragraphs carrying a section break (their
// `sect` attribute, the raw w:sectPr); the last section's properties are
// the document's.

import type { Node as PMNode } from "prosemirror-model";
import { formatNumber } from "../model/numbering";
import type { HfType, PageInfo } from "./pagination";

export type StoryKind = "header" | "footer";

export interface SectionInfo {
  /** Position of the paragraph that ends the section (null: the last section). */
  pos: number | null;
  /** Relationship ids of the section's own headers and footers. */
  refs: Record<StoryKind, Partial<Record<HfType, string>>>;
  titlePg: boolean;
  /** Page numbering: restart value and format (decimal, lowerRoman…). */
  pgNumStart: number | null;
  pgNumFmt: string | null;
}

const attr = (attrs: string, name: string) => new RegExp(`\\bw:${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/** Headers, footers, first page and numbering of a raw w:sectPr. */
export function parseSect(raw: string): Omit<SectionInfo, "pos"> {
  const refs: SectionInfo["refs"] = { header: {}, footer: {} };
  for (const m of raw.matchAll(/<w:(header|footer)Reference\b([^>]*?)\/?>/g)) {
    const rid = /\br:id="([^"]+)"/.exec(m[2])?.[1];
    if (rid) refs[m[1] as StoryKind][(attr(m[2], "type") ?? "default") as HfType] = rid;
  }
  const tp = /<w:titlePg\b([^>]*?)\/?>/.exec(raw);
  const titlePg = !!tp && !/w:val="(0|false|off)"/.test(tp[1]);
  const num = /<w:pgNumType\b([^>]*?)\/?>/.exec(raw);
  const start = num ? attr(num[1], "start") : null;
  return { refs, titlePg, pgNumStart: start != null && Number.isFinite(Number(start)) ? Number(start) : null, pgNumFmt: num ? attr(num[1], "fmt") : null };
}

/** The document's sections, in order (the last one from the document's own settings). */
export function sectionsOf(doc: PMNode, finalHeaders: Record<string, PMNode | null>, finalFooters: Record<string, PMNode | null>): SectionInfo[] {
  const out: SectionInfo[] = [];
  doc.forEach((node, pos) => {
    const raw = node.type.name === "paragraph" ? node.attrs.sect : null;
    if (typeof raw === "string" && raw) out.push({ pos, ...parseSect(raw) });
  });
  const page = (doc.attrs.page ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const numType = page.pgNumType ?? {};
  const start = numType.start != null ? Number(numType.start) : null;
  const refs: SectionInfo["refs"] = { header: {}, footer: {} };
  for (const [t, d] of Object.entries(finalHeaders)) if (d) refs.header[t as HfType] = `final:${t}`;
  for (const [t, d] of Object.entries(finalFooters)) if (d) refs.footer[t as HfType] = `final:${t}`;
  out.push({
    pos: null,
    refs,
    titlePg: doc.attrs.titlePg === true,
    pgNumStart: start != null && Number.isFinite(start) ? start : null,
    pgNumFmt: (numType.fmt as string | undefined) ?? null,
  });
  return out;
}

/** Where a page's header or footer comes from: a section's own story, inherited, or none yet. */
export interface StoryRef {
  /** "final:default" for the last section's, else a relationship id; null: none. */
  ref: string | null;
  /** The section that owns it (or that would get a new one). */
  section: number;
}

export function resolveStory(sections: SectionInfo[], section: number, kind: StoryKind, type: HfType): StoryRef {
  for (let s = Math.min(section, sections.length - 1); s >= 0; s--) {
    const ref = sections[s].refs[kind][type];
    if (ref) return { ref, section: s };
  }
  return { ref: null, section };
}

/** Facts about each page: its section, header/footer type and page number. */
export interface PageFacts {
  section: number;
  firstOfSection: boolean;
  type: HfType;
  /** Page number as shown by PAGE fields (section restarts and formats applied). */
  number: number;
  label: string;
  /** Pages in the page's section (SECTIONPAGES). */
  sectionPages: number;
}

export function pageFacts(pages: PageInfo[], sections: SectionInfo[], evenOdd: boolean): PageFacts[] {
  const out: PageFacts[] = [];
  let n = 0;
  pages.forEach((p, i) => {
    const section = Math.min(p.section ?? 0, sections.length - 1);
    const first = i === 0 || (pages[i - 1].section ?? 0) !== (p.section ?? 0);
    const sec = sections[section];
    n = first && sec?.pgNumStart != null ? sec.pgNumStart : n + 1;
    const type: HfType = first && sec?.titlePg ? "first" : evenOdd && n % 2 === 0 ? "even" : "default";
    out.push({ section, firstOfSection: first, type, number: n, label: formatNumber(n, sec?.pgNumFmt ?? "decimal"), sectionPages: 0 });
  });
  for (const f of out) f.sectionPages = out.filter((o) => o.section === f.section).length;
  return out;
}

/** A section's w:sectPr with a header or footer reference added. */
export function addStoryRef(raw: string, kind: StoryKind, type: HfType, rid: string): string {
  const ref = `<w:${kind}Reference w:type="${type}" r:id="${rid}"/>`;
  const start = /<w:sectPr\b[^>]*?(\/?)>/.exec(raw);
  if (!start) return raw;
  if (start[1] === "/") return raw.replace(start[0], `${start[0].slice(0, -2)}>${ref}</w:sectPr>`);
  const at = start.index + start[0].length;
  return raw.slice(0, at) + ref + raw.slice(at);
}
