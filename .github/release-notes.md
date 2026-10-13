## Download Sheets {{VERSION}}

Every file below contains both apps: **Sheets** for spreadsheets and, new in 0.5, **Docs** for Word documents.

### 🪟 Windows (10 / 11, 64-bit)

| File | What it is |
| --- | --- |
| [**Sheets_{{VERSION}}_x64-setup.exe**](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sheets_{{VERSION}}_x64-setup.exe) | **Recommended.** Installer (per-user, no admin rights). Adds **Sheets** and **Docs** to the Start menu and opens `.xlsx`, `.csv` and `.docx` files. |
| [Sheets_{{VERSION}}_x64_en-US.msi](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sheets_{{VERSION}}_x64_en-US.msi) | MSI package for IT deployment (Intune, Group Policy). |
| [Sheets_{{VERSION}}_x64-portable.exe](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sheets_{{VERSION}}_x64-portable.exe) | Portable: a single file, nothing to install. Start it with `--docs` for Docs, or use the app button in the title bar. |

> The app is not code-signed yet. If SmartScreen shows "Windows protected your PC", click **More info → Run anyway**.

### 🍎 macOS (10.15 Catalina or later)

| File | Mac |
| --- | --- |
| [**Sheets_{{VERSION}}_aarch64.dmg**](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sheets_{{VERSION}}_aarch64.dmg) | Apple Silicon (M1, M2, M3, M4…) |
| [**Sheets_{{VERSION}}_x64.dmg**](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sheets_{{VERSION}}_x64.dmg) | Intel Macs |

Open the `.dmg` and drag **Sheets** to **Applications**. Double-click a `.docx` file (or use the app button in the title bar) to open Docs. The app is not notarized by Apple yet, so the first time:
**right-click Sheets → Open → Open**. If macOS says the app "is damaged", run once in Terminal:
`xattr -dr com.apple.quarantine /Applications/Sheets.app`

---

## What's new in {{VERSION}}

**New: Docs, a word processor for Word documents**
- Opens and saves `.docx` files, and writes back everything it doesn't edit (charts, SmartArt, equations, content controls…) unchanged, so your documents go back to Word intact.
- Word's ribbon (Home, Insert, Design, Layout, References, Review, View), KeyTips (Alt), command search (Alt+Q) and Word's keyboard shortcuts (F1 lists them).
- Styles and the Navigation pane, lists, tables, pictures, links, headers and footers, page numbers, footnotes and endnotes, a table of contents, captions, cover pages, watermarks, comments and Track Changes, laid out on real pages as you type.
- Nine templates (resume, cover letter, report, meeting notes…); export as text, Markdown or a web page; Print / Save as PDF.
- The same safety net as Sheets: AutoRecover, Document Recovery, Recover Unsaved Documents and version history.

**Getting to Docs**
- Windows: the new **Docs** entry in the Start menu, or double-click a Word document. Mac: double-click a `.docx` file.
- In either app, the app button at the left of the title bar opens the other one.

**Good to know:** text columns show as a single column, a document uses one page size and orientation throughout, EMF/WMF pictures show as placeholders (they stay in the file), and `.doc`, `.rtf` and `.odt` files don't open yet.

**Also in Sheets:** one-click updates from the title bar (0.4); AutoFill Options, Flash Fill (Ctrl+E), Paste Special, KeyTips and the full Excel keyboard shortcut set (0.3); AutoRecover and crash recovery, version history, data-integrity guards (leading zeros, long numbers, gene names), encoding-aware CSV, AutoFilter, charts, PivotTable summaries, Text to Columns, Print / Save as PDF (0.2).

Updating from 0.3.0 or earlier? Install this version once from the files above. From then on Sheets updates itself.

See the [README](https://github.com/{{REPO}}/blob/{{TAG}}/README.md), the [roadmap](https://github.com/{{REPO}}/blob/{{TAG}}/docs/ROADMAP.md) and [why Sheets is safer than Excel](https://github.com/{{REPO}}/blob/{{TAG}}/docs/EXCEL_PAIN_POINTS.md) for details.
