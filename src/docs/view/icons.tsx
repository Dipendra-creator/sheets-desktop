// Icons of the Docs ribbon, in the style of src/components/Icon.tsx.

import { registerIcons } from "../../components/Icon";

const B = "#2B7CD3";
const B2 = "#185ABD";
const R = "#D13438";
const G = "#13A10E";
const Y = "#F2C230";
const W = "var(--icon-paper, #fafafa)";
const s = { fill: "none", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const lines = (ys: number[], x1 = 6.5, x2 = 14) => ys.map((y) => <path key={y} d={`M${x1} ${y}h${x2 - x1}`} {...s} />);

registerIcons({
  small: {
    docsLogo: () => (
      <>
        <rect x="4.5" y="1.5" width="11" height="13" rx="1.5" fill="#41A5EE" />
        <rect x="4.5" y="1.5" width="11" height="4.3" fill="#2B7CD3" />
        <rect x="4.5" y="10.2" width="11" height="4.3" fill="#103F91" />
        <rect x="0.5" y="4" width="8" height="8" rx="1" fill="#185ABD" />
        <path d="M2 5.8l1 4.4 1.5-3.4 1.5 3.4 1-4.4" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      </>
    ),
    docx: () => (
      <>
        <path d="M3.5 1.5h6l3 3v10h-9z" fill={W} stroke="#8c8c8c" />
        <rect x="1" y="6" width="7" height="6" rx="0.8" fill={B2} />
        <path d="M2.2 7.3l.8 3.4 1-2.4 1 2.4.8-3.4" stroke="#fff" strokeWidth="0.8" fill="none" />
      </>
    ),
    bullets: () => (
      <>
        <circle cx="3" cy="4" r="1.2" fill="currentColor" />
        <circle cx="3" cy="8" r="1.2" fill="currentColor" />
        <circle cx="3" cy="12" r="1.2" fill="currentColor" />
        {lines([4, 8, 12])}
      </>
    ),
    numbering: () => (
      <>
        <text x="0.5" y="5.5" fontSize="5" fill="currentColor">1</text>
        <text x="0.5" y="9.5" fontSize="5" fill="currentColor">2</text>
        <text x="0.5" y="13.5" fontSize="5" fill="currentColor">3</text>
        {lines([4, 8, 12])}
      </>
    ),
    multilevel: () => (
      <>
        <text x="0.5" y="5.5" fontSize="5" fill="currentColor">1</text>
        <text x="3.5" y="9.5" fontSize="5" fill="currentColor">a</text>
        <text x="6.5" y="13.5" fontSize="5" fill="currentColor">i</text>
        <path d="M5 4h9M8 8h6M10 12h4" {...s} />
      </>
    ),
    pilcrow: () => (
      <>
        <path d="M7.5 9.5a3.5 3.5 0 010-7h5M9.5 2.5v11.5M11.5 2.5v11.5" {...s} />
        <path d="M7.5 2.5a3.5 3.5 0 000 7h2" fill="currentColor" />
      </>
    ),
    lineSpacing: () => (
      <>
        <path d="M3 2.5v11M1 4.5l2-2 2 2M1 11.5l2 2 2-2" {...s} />
        {lines([4, 8, 12], 7)}
      </>
    ),
    shading: () => (
      <>
        <path d="M3 9l5-6 5 5-5 5z" {...s} />
        <path d="M12.5 11.5c0 1 .7 1.6 1.3 1.6s1.2-.6 1.2-1.6-1.2-2.3-1.2-2.3-1.3 1.3-1.3 2.3z" fill="currentColor" />
      </>
    ),
    alignJustify: () => <>{lines([3.5, 6.5, 9.5, 12.5], 2, 14)}</>,
    subscript: () => (
      <>
        <path d="M2 3.5l6 7M8 3.5l-6 7" {...s} />
        <text x="9.5" y="15" fontSize="6" fill={B} fontWeight="700">2</text>
      </>
    ),
    superscript: () => (
      <>
        <path d="M2 5.5l6 7M8 5.5l-6 7" {...s} />
        <text x="9.5" y="6" fontSize="6" fill={B} fontWeight="700">2</text>
      </>
    ),
    changeCase: () => (
      <>
        <text x="0" y="12" fontSize="10" fill="currentColor">A</text>
        <text x="7" y="12" fontSize="8" fill="currentColor">a</text>
      </>
    ),
    clearFormatting: () => (
      <>
        <text x="0" y="11" fontSize="10" fill="currentColor">A</text>
        <path d="M9 10.5l3.5-3.5 2.5 2.5-3.5 3.5h-2.5z" fill="#f3b3c4" stroke="#c03760" strokeWidth="0.8" />
      </>
    ),
    highlight: () => (
      <>
        <path d="M5 9.5l5.5-6.5 2.5 2.2-5.5 6.5H5z" {...s} />
        <path d="M5 9.5l-1.5 2.5h3" {...s} />
      </>
    ),
    textColor: () => <text x="3" y="11" fontSize="11" fontWeight="600" fill="currentColor">A</text>,
    styles: () => (
      <>
        <text x="1" y="12" fontSize="11" fill="currentColor" fontFamily="serif">A</text>
        <path d="M10 5h5M10 8h5M10 11h5" {...s} />
      </>
    ),
    select: () => <path d="M4 2.5v10l2.5-2.5 2 4 1.5-.8-2-3.8h3.5z" {...s} />,
    pageBreak: () => (
      <>
        <path d="M3.5 1.5v4h9v-4M3.5 14.5v-4h9v4" {...s} />
        <path d="M1.5 8h2M5.5 8h2M9.5 8h2M13.5 8h1" {...s} />
      </>
    ),
    sectionBreak: () => (
      <>
        <path d="M3.5 1.5v4h9v-4M3.5 14.5v-4h9v4" {...s} />
        <path d="M1.5 8h13" stroke={B} strokeDasharray="1.5 1" />
      </>
    ),
    blankPage: () => <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" {...s} />,
    indentLeft: () => (
      <>
        <path d="M2 2v12" {...s} />
        <path d="M5 8h8M10 5l3 3-3 3" {...s} />
      </>
    ),
    indentRight: () => (
      <>
        <path d="M14 2v12" {...s} />
        <path d="M11 8H3M6 5L3 8l3 3" {...s} />
      </>
    ),
    spaceBefore: () => (
      <>
        <path d="M2 2.5h12" stroke={B} />
        <path d="M8 4.5v4M6 6.5l2-2 2 2" {...s} />
        {lines([11, 14], 2)}
      </>
    ),
    spaceAfter: () => (
      <>
        {lines([2, 5], 2)}
        <path d="M8 7.5v4M6 9.5l2 2 2-2" {...s} />
        <path d="M2 13.5h12" stroke={B} />
      </>
    ),
    accept: () => (
      <>
        <path d="M3.5 1.5h6l3 3v10h-9z" fill={W} stroke="#8c8c8c" />
        <path d="M5 9l2 2 4-5" stroke={G} strokeWidth="1.6" fill="none" />
      </>
    ),
    reject: () => (
      <>
        <path d="M3.5 1.5h6l3 3v10h-9z" fill={W} stroke="#8c8c8c" />
        <path d="M5.5 6.5l4 4M9.5 6.5l-4 4" stroke={R} strokeWidth="1.6" />
      </>
    ),
    prevChange: () => (
      <>
        <path d="M3.5 1.5h6l3 3v10h-9z" fill={W} stroke="#8c8c8c" />
        <path d="M8 11V6M5.5 8.5L8 6l2.5 2.5" stroke={B} strokeWidth="1.3" fill="none" />
      </>
    ),
    nextChange: () => (
      <>
        <path d="M3.5 1.5h6l3 3v10h-9z" fill={W} stroke="#8c8c8c" />
        <path d="M8 6v5M5.5 8.5L8 11l2.5-2.5" stroke={B} strokeWidth="1.3" fill="none" />
      </>
    ),
    markup: () => (
      <>
        {lines([4, 8, 12], 2, 11)}
        <path d="M13 2v12" stroke={R} strokeWidth="1.5" />
      </>
    ),
    readMode: () => (
      <>
        <path d="M1.5 3.5c2-1 4.5-1 6.5.5v9c-2-1.5-4.5-1.5-6.5-.5zM14.5 3.5c-2-1-4.5-1-6.5.5v9c2-1.5 4.5-1.5 6.5-.5z" {...s} />
      </>
    ),
    printLayout: () => (
      <>
        <rect x="3.5" y="1.5" width="9" height="13" {...s} />
        {lines([4.5, 6.5, 8.5, 10.5], 5.5, 10.5)}
      </>
    ),
    webLayout: () => (
      <>
        <circle cx="8" cy="8" r="6" {...s} />
        <path d="M2 8h12M8 2c-2.5 3-2.5 9 0 12M8 2c2.5 3 2.5 9 0 12" {...s} />
      </>
    ),
    draftView: () => <>{lines([3, 6, 9, 12], 2, 14)}</>,
    outlineView: () => (
      <>
        <circle cx="3" cy="4" r="1" fill="currentColor" />
        <circle cx="6" cy="8" r="1" fill="currentColor" />
        <circle cx="6" cy="12" r="1" fill="currentColor" />
        <path d="M5.5 4h8M8.5 8h5M8.5 12h5" {...s} />
      </>
    ),
    columns: () => (
      <>
        {lines([3, 6, 9, 12], 1.5, 7)}
        {lines([3, 6, 9, 12], 9, 14.5)}
      </>
    ),
    bookmark: () => <path d="M4.5 1.5h7v13l-3.5-3-3.5 3z" {...s} />,
    footnote: () => (
      <>
        <text x="1" y="8" fontSize="7" fill="currentColor">ab</text>
        <text x="9" y="5" fontSize="5" fill={B} fontWeight="700">1</text>
        <path d="M2 11.5h12M2 14h8" {...s} />
      </>
    ),
    caption: () => (
      <>
        <rect x="2.5" y="1.5" width="11" height="8" {...s} />
        <path d="M2.5 12.5h11M2.5 14.5h7" stroke={B} />
      </>
    ),
    addText: () => (
      <>
        {lines([4, 8, 12], 2, 10)}
        <path d="M13 6v6M10 9h6" stroke={G} strokeWidth="1.4" />
      </>
    ),
    updateTable: () => (
      <>
        <path d="M2.5 8a5.5 5.5 0 019.6-3.6M13.5 8a5.5 5.5 0 01-9.6 3.6" {...s} />
        <path d="M12.5 1.5v3h-3M3.5 14.5v-3h3" {...s} />
      </>
    ),
    wordCount: () => (
      <>
        <text x="0.5" y="7" fontSize="6.5" fill="currentColor" fontWeight="700">ABC</text>
        <text x="2" y="14.5" fontSize="6.5" fill={B} fontWeight="700">123</text>
      </>
    ),
    headerIcon: () => (
      <>
        <rect x="2.5" y="1.5" width="11" height="13" {...s} />
        <rect x="3.5" y="2.5" width="9" height="3" fill={B} opacity="0.6" />
      </>
    ),
    footerIcon: () => (
      <>
        <rect x="2.5" y="1.5" width="11" height="13" {...s} />
        <rect x="3.5" y="10.5" width="9" height="3" fill={B} opacity="0.6" />
      </>
    ),
    pageNumber: () => (
      <>
        <rect x="2.5" y="1.5" width="11" height="13" {...s} />
        <text x="6" y="13" fontSize="5" fill={B} fontWeight="700">#</text>
      </>
    ),
    closeHeader: () => (
      <>
        <rect x="2.5" y="1.5" width="11" height="13" {...s} />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={R} strokeWidth="1.5" />
      </>
    ),
    altText: () => (
      <>
        <rect x="1.5" y="2.5" width="13" height="11" {...s} />
        <text x="3" y="10.5" fontSize="6" fill="currentColor">Alt</text>
      </>
    ),
    insertAbove: () => (
      <>
        <rect x="1.5" y="7.5" width="13" height="7" {...s} />
        <path d="M8 1v5M5.5 3.5h5" stroke={G} strokeWidth="1.4" />
      </>
    ),
    insertBelow: () => (
      <>
        <rect x="1.5" y="1.5" width="13" height="7" {...s} />
        <path d="M8 10v5M5.5 12.5h5" stroke={G} strokeWidth="1.4" />
      </>
    ),
    insertLeft: () => (
      <>
        <rect x="7.5" y="1.5" width="7" height="13" {...s} />
        <path d="M1 8h5M3.5 5.5v5" stroke={G} strokeWidth="1.4" />
      </>
    ),
    insertRight: () => (
      <>
        <rect x="1.5" y="1.5" width="7" height="13" {...s} />
        <path d="M10 8h5M12.5 5.5v5" stroke={G} strokeWidth="1.4" />
      </>
    ),
    splitCells: () => (
      <>
        <rect x="1.5" y="3.5" width="13" height="9" {...s} />
        <path d="M8 3.5v9" stroke={B} strokeDasharray="1.5 1" />
      </>
    ),
    cellShading: () => (
      <>
        <rect x="1.5" y="3.5" width="13" height="9" fill={Y} opacity="0.6" stroke="currentColor" />
      </>
    ),
    pageColor: () => (
      <>
        <rect x="3.5" y="1.5" width="9" height="13" fill="#dce9f8" stroke="currentColor" />
      </>
    ),
    dropCap: () => (
      <>
        <text x="1" y="10" fontSize="10" fill="currentColor" fontWeight="700">A</text>
        {lines([3, 6, 9], 9, 15)}
        {lines([12, 15], 1, 15)}
      </>
    ),
    trackChangesSmall: () => (
      <>
        <path d="M2 13.5l2-5 7-7 3 3-7 7z" {...s} />
        <path d="M9.5 3l3 3" {...s} />
      </>
    ),
  },
  large: {
    docsLogo: () => (
      <>
        <rect x="9" y="3" width="21" height="26" rx="2.5" fill="#41A5EE" />
        <rect x="9" y="3" width="21" height="8.7" fill="#2B7CD3" />
        <rect x="9" y="20.3" width="21" height="8.7" fill="#103F91" />
        <rect x="2" y="8" width="16" height="16" rx="2" fill="#185ABD" />
        <path d="M5 11.5l2 9 3-7 3 7 2-9" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      </>
    ),
    docx: () => (
      <>
        <path d="M8.5 2.5h12l6 6v21h-18z" fill={W} stroke="#8c8c8c" />
        <path d="M20.5 2.5v6h6" fill="none" stroke="#8c8c8c" />
        <rect x="3" y="12" width="14" height="13" rx="1.5" fill={B2} />
        <path d="M5.5 14.8l1.5 7 2-5 2 5 1.5-7" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      </>
    ),
    pageBreak: () => (
      <>
        <path d="M7.5 3.5v9h17v-9M7.5 28.5v-9h17v9" fill={W} stroke="#8c8c8c" />
        <path d="M3 16h4M10 16h4M17 16h4M24 16h5" stroke={B} strokeWidth="1.6" />
      </>
    ),
    blankPage: () => (
      <>
        <path d="M7.5 2.5h12l6 6v21h-18z" fill={W} stroke="#8c8c8c" />
        <path d="M19.5 2.5v6h6" fill="none" stroke="#8c8c8c" />
        <path d="M16 13v10M11 18h10" stroke={G} strokeWidth="2" />
      </>
    ),
    coverPage: () => (
      <>
        <rect x="6.5" y="2.5" width="19" height="27" fill={W} stroke="#8c8c8c" />
        <rect x="6.5" y="2.5" width="19" height="11" fill={B} />
        <path d="M10 18h12M10 21h9" stroke="#8c8c8c" />
      </>
    ),
    headerIcon: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <rect x="7" y="4" width="18" height="6" fill={B} opacity="0.75" />
        <path d="M9 14h14M9 17h14M9 20h10" stroke="#bdbdbd" />
      </>
    ),
    footerIcon: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M9 7h14M9 10h14M9 13h10" stroke="#bdbdbd" />
        <rect x="7" y="22" width="18" height="6" fill={B} opacity="0.75" />
      </>
    ),
    pageNumber: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <text x="12" y="27" fontSize="9" fontWeight="700" fill={B2}>#</text>
        <path d="M9 7h14M9 10h14M9 13h10" stroke="#bdbdbd" />
      </>
    ),
    toc: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M9 8h10M9 13h10M12 18h7M12 23h7" stroke="currentColor" />
        <path d="M20 8h3M20 13h3M20 18h3M20 23h3" stroke={B} strokeDasharray="1 1" />
      </>
    ),
    footnote: () => (
      <>
        <text x="3" y="15" fontSize="12" fill="currentColor">ab</text>
        <text x="17" y="10" fontSize="9" fill={B} fontWeight="700">1</text>
        <path d="M4 21h24M4 25h18" stroke="#8c8c8c" />
      </>
    ),
    caption: () => (
      <>
        <rect x="4.5" y="3.5" width="23" height="15" fill="#dce9f8" stroke="#8c8c8c" />
        <path d="M8 15l5-6 4 4 3-3 4 5" stroke={B} fill="none" />
        <path d="M5 23h22M5 27h14" stroke="currentColor" />
      </>
    ),
    trackChanges: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M9 9h14M9 14h8" stroke="#bdbdbd" />
        <path d="M11 26l3-7 10-10 4 4-10 10z" fill="#fde7a9" stroke="#b08a10" />
      </>
    ),
    accept: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M10 16l4.5 4.5 8-10" stroke={G} strokeWidth="3" fill="none" strokeLinecap="round" />
      </>
    ),
    reject: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M11 11l10 10M21 11L11 21" stroke={R} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    wordCount: () => (
      <>
        <rect x="3.5" y="3.5" width="25" height="25" rx="2" fill={W} stroke="#8c8c8c" />
        <text x="6" y="14" fontSize="9" fontWeight="700" fill="currentColor">ABC</text>
        <text x="7" y="25" fontSize="9" fontWeight="700" fill={B2}>123</text>
      </>
    ),
    readMode: () => (
      <>
        <path d="M2.5 7.5c4-2 9-2 13.5 1v18c-4.5-3-9.5-3-13.5-1zM29.5 7.5c-4-2-9-2-13.5 1v18c4.5-3 9.5-3 13.5-1z" fill={W} stroke="#8c8c8c" />
        <path d="M5 12c3-1 6-1 9 .5M5 16c3-1 6-1 9 .5M18 12.5c3-1.5 6-1.5 9-.5M18 16.5c3-1.5 6-1.5 9-.5" stroke="#bdbdbd" />
      </>
    ),
    printLayout: () => (
      <>
        <rect x="6.5" y="2.5" width="19" height="27" fill={W} stroke="#8c8c8c" />
        <path d="M10 8h12M10 12h12M10 16h12M10 20h8" stroke={B} />
      </>
    ),
    webLayout: () => (
      <>
        <circle cx="16" cy="16" r="12" fill="#dce9f8" stroke={B} />
        <path d="M4 16h24M16 4c-5 6-5 18 0 24M16 4c5 6 5 18 0 24" stroke={B} fill="none" />
      </>
    ),
    draftView: () => (
      <>
        <rect x="3.5" y="4.5" width="25" height="23" fill={W} stroke="#8c8c8c" />
        <path d="M7 9h18M7 13h18M7 17h18M7 21h12" stroke="currentColor" />
      </>
    ),
    outlineView: () => (
      <>
        <rect x="3.5" y="4.5" width="25" height="23" fill={W} stroke="#8c8c8c" />
        <circle cx="8" cy="10" r="1.5" fill={B} />
        <circle cx="12" cy="16" r="1.5" fill={B} />
        <circle cx="12" cy="22" r="1.5" fill={B} />
        <path d="M11 10h14M15 16h10M15 22h10" stroke="currentColor" />
      </>
    ),
    onePage: () => (
      <>
        <rect x="8.5" y="3.5" width="15" height="25" fill={W} stroke="#8c8c8c" />
        <path d="M11 8h10M11 11h10M11 14h10" stroke={B} />
      </>
    ),
    multiplePages: () => (
      <>
        <rect x="2.5" y="5.5" width="12" height="20" fill={W} stroke="#8c8c8c" />
        <rect x="17.5" y="5.5" width="12" height="20" fill={W} stroke="#8c8c8c" />
        <path d="M5 10h7M5 13h7M20 10h7M20 13h7" stroke={B} />
      </>
    ),
    pageWidth: () => (
      <>
        <rect x="6.5" y="3.5" width="19" height="25" fill={W} stroke="#8c8c8c" />
        <path d="M3 16h26M5.5 13.5L3 16l2.5 2.5M26.5 13.5L29 16l-2.5 2.5" stroke={B} fill="none" />
      </>
    ),
    columns: () => (
      <>
        <rect x="4.5" y="3.5" width="23" height="25" fill={W} stroke="#8c8c8c" />
        <path d="M7 8h8M7 11h8M7 14h8M7 17h8M17 8h8M17 11h8M17 14h8M17 17h8" stroke={B} />
      </>
    ),
    breaks: () => (
      <>
        <path d="M7.5 3.5v9h17v-9M7.5 28.5v-9h17v9" fill={W} stroke="#8c8c8c" />
        <path d="M3 16h26" stroke={B} strokeWidth="1.6" strokeDasharray="3 2" />
      </>
    ),
    styles: () => (
      <>
        <rect x="3.5" y="5.5" width="25" height="21" rx="2" fill={W} stroke="#8c8c8c" />
        <text x="6" y="22" fontSize="16" fill={B2} fontFamily="serif">A</text>
        <path d="M18 12h8M18 16h8M18 20h6" stroke="currentColor" />
      </>
    ),
    stylesPane: () => (
      <>
        <rect x="3.5" y="5.5" width="25" height="21" rx="2" fill={W} stroke="#8c8c8c" />
        <text x="6" y="22" fontSize="16" fill={B2} fontFamily="serif">A</text>
        <path d="M18 12h8M18 16h8M18 20h6" stroke="currentColor" />
      </>
    ),
    closeHeader: () => (
      <>
        <rect x="5.5" y="2.5" width="21" height="27" fill={W} stroke="#8c8c8c" />
        <rect x="7" y="4" width="18" height="6" fill={B} opacity="0.6" />
        <path d="M11 15l10 10M21 15L11 25" stroke={R} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    bookmark: () => <path d="M9.5 3.5h13v25L16 22.5l-6.5 6z" fill="#dce9f8" stroke={B} />,
    tableDesign: () => (
      <>
        <rect x="3.5" y="5.5" width="25" height="21" fill={W} stroke="#8c8c8c" />
        <rect x="4" y="6" width="24" height="5" fill={B} />
        <path d="M3.5 16h25M3.5 21h25M12 6v21M20 6v21" stroke="#8c8c8c" />
      </>
    ),
    altText: () => (
      <>
        <rect x="3.5" y="5.5" width="25" height="21" rx="2" fill="#dce9f8" stroke={B} />
        <text x="7" y="20" fontSize="10" fontWeight="700" fill={B2}>Alt</text>
      </>
    ),
    dropCap: () => (
      <>
        <rect x="3.5" y="3.5" width="25" height="25" fill={W} stroke="#8c8c8c" />
        <text x="6" y="18" fontSize="14" fontWeight="700" fill={B2}>A</text>
        <path d="M17 8h9M17 12h9M17 16h9M6 21h20M6 25h20" stroke="currentColor" />
      </>
    ),
    hyphenation: () => (
      <>
        <rect x="3.5" y="3.5" width="25" height="25" fill={W} stroke="#8c8c8c" />
        <path d="M7 10h18M7 15h14M7 20h18" stroke="currentColor" />
        <path d="M22 15h4" stroke={B} strokeWidth="2" />
      </>
    ),
    lineNumbers: () => (
      <>
        <rect x="8.5" y="3.5" width="20" height="25" fill={W} stroke="#8c8c8c" />
        <text x="2" y="11" fontSize="6" fill={B}>1</text>
        <text x="2" y="18" fontSize="6" fill={B}>2</text>
        <text x="2" y="25" fontSize="6" fill={B}>3</text>
        <path d="M12 9h13M12 16h13M12 23h9" stroke="currentColor" />
      </>
    ),
  },
});
