//! Built-in document templates (the "New" page of Docs).
//!
//! A template is an editor document (see `docx::read` for the node types)
//! plus optional headers and footers. New documents made from a template
//! are ordinary unsaved documents.

use serde_json::{json, Value};

use crate::{docx::text::list_defs, templates::TemplateMeta};

pub struct DocTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    /// Tutorial tiles show a banner instead of a page preview.
    pub banner: Option<(&'static str, &'static str)>,
    build: fn() -> Built,
}

/// A template's content: the body and its headers and footers.
pub struct Built {
    pub doc: Value,
    pub headers: Value,
    pub footers: Value,
}

pub static TEMPLATES: &[DocTemplate] = &[
    DocTemplate {
        id: "welcome",
        name: "Welcome to Docs",
        description: "A short tour of writing, formatting, tables, page layout and sharing.",
        category: "Tutorials",
        banner: Some(("Welcome to", "Docs")),
        build: welcome,
    },
    DocTemplate {
        id: "single-spaced",
        name: "Single spaced (blank)",
        description: "A blank document with single line spacing and no space between paragraphs.",
        category: "Blank",
        banner: None,
        build: single_spaced,
    },
    DocTemplate {
        id: "toc-tutorial",
        name: "Insert your first table of contents",
        description: "Learn how headings build a table of contents you can update in one click.",
        category: "Tutorials",
        banner: Some(("Insert your first", "table of contents")),
        build: toc_tutorial,
    },
    DocTemplate {
        id: "resume",
        name: "Modern resume",
        description: "A clean one-page resume with experience, education and skills.",
        category: "Resumes and letters",
        banner: None,
        build: resume,
    },
    DocTemplate {
        id: "cover-letter",
        name: "Cover letter",
        description: "A cover letter that matches the modern resume.",
        category: "Resumes and letters",
        banner: None,
        build: cover_letter,
    },
    DocTemplate {
        id: "business-letter",
        name: "Business letter",
        description: "A formal letter with letterhead, reference line and signature block.",
        category: "Resumes and letters",
        banner: None,
        build: business_letter,
    },
    DocTemplate {
        id: "report",
        name: "Report",
        description: "A report with a title page, sections, a summary table and page numbers.",
        category: "Business",
        banner: None,
        build: report,
    },
    DocTemplate {
        id: "meeting-notes",
        name: "Meeting notes",
        description: "Agenda, discussion and action items for a team meeting.",
        category: "Business",
        banner: None,
        build: meeting_notes,
    },
    DocTemplate {
        id: "flyer",
        name: "Event flyer",
        description: "A bold one-page flyer for an event or announcement.",
        category: "Flyers",
        banner: None,
        build: flyer,
    },
];

pub fn list() -> Vec<TemplateMeta> {
    TEMPLATES
        .iter()
        .map(|t| TemplateMeta {
            id: t.id.to_string(),
            name: t.name.to_string(),
            description: t.description.to_string(),
            category: t.category.to_string(),
            kind: if t.banner.is_some() { "tutorial" } else { "template" }.to_string(),
            banner: t.banner.map(|(a, b)| (a.to_string(), b.to_string())),
            icon: None,
            source: "builtin".to_string(),
        })
        .collect()
}

pub fn get(id: &str) -> Option<&'static DocTemplate> {
    TEMPLATES.iter().find(|t| t.id == id)
}

impl DocTemplate {
    pub fn build(&self) -> Built {
        (self.build)()
    }
}

// ----------------------------------------------------------------------
// Building blocks
// ----------------------------------------------------------------------

const ACCENT: &str = "1F3864";
const ACCENT2: &str = "2F5496";
const MUTED: &str = "595959";

fn t(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

fn tm(text: &str, marks: Vec<Value>) -> Value {
    json!({ "type": "text", "text": text, "marks": marks })
}

fn bold() -> Value {
    json!({ "type": "bold", "attrs": { "on": true } })
}

fn italic() -> Value {
    json!({ "type": "italic", "attrs": { "on": true } })
}

fn caps() -> Value {
    json!({ "type": "caps", "attrs": { "on": true } })
}

fn color(hex: &str) -> Value {
    json!({ "type": "color", "attrs": { "val": hex } })
}

fn size(pt: f64) -> Value {
    let half = format!("{}", (pt * 2.0).round() as i64);
    json!({ "type": "size", "attrs": { "val": half, "cs": half } })
}

fn spacing(tw: i64) -> Value {
    json!({ "type": "charSpacing", "attrs": { "val": tw.to_string() } })
}

fn font(name: &str) -> Value {
    json!({ "type": "font", "attrs": { "ascii": name, "hAnsi": name, "cs": name } })
}

fn cstyle(id: &str) -> Value {
    json!({ "type": "cstyle", "attrs": { "id": id } })
}

fn link(href: &str) -> Value {
    json!({ "type": "link", "attrs": { "href": href } })
}

fn tab() -> Value {
    json!({ "type": "tab" })
}

fn para(attrs: Value, content: Vec<Value>) -> Value {
    let mut p = json!({ "type": "paragraph" });
    if attrs.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
        p["attrs"] = attrs;
    }
    if !content.is_empty() {
        p["content"] = Value::Array(content);
    }
    p
}

fn p(content: Vec<Value>) -> Value {
    para(json!({}), content)
}

fn styled(style: &str, content: Vec<Value>) -> Value {
    para(json!({ "style": style }), content)
}

fn h(level: u8, text: &str) -> Value {
    styled(&format!("Heading{level}"), vec![t(text)])
}

fn empty() -> Value {
    p(vec![])
}

fn bullet(content: Vec<Value>) -> Value {
    para(json!({ "style": "ListParagraph", "numPr": { "numId": 9001, "ilvl": 0 } }), content)
}

fn numbered(content: Vec<Value>) -> Value {
    para(json!({ "style": "ListParagraph", "numPr": { "numId": 9002, "ilvl": 0 } }), content)
}

fn page_break() -> Value {
    p(vec![json!({ "type": "hard_break", "attrs": { "type": "page" } })])
}

fn field(instr: &str, result: &str) -> Vec<Value> {
    vec![
        json!({ "type": "field_start", "attrs": { "instr": instr, "xml": "" } }),
        t(result),
        json!({ "type": "field_end", "attrs": { "xml": "" } }),
    ]
}

fn border(side: &str, color: &str, size_eighths: u32, space: u32) -> Value {
    json!({ side: { "val": "single", "sz": size_eighths.to_string(), "space": space.to_string(), "color": color } })
}

/// A table; `widths` in twips, `rows` of cells of blocks.
fn table(widths: &[i64], rows: Vec<Vec<Vec<Value>>>, header_fill: Option<&str>, borders: bool) -> Value {
    let px = |tw: i64| ((tw as f64 / 15.0) * 1000.0).round() / 1000.0;
    let total: i64 = widths.iter().sum();
    let mut out_rows = Vec::new();
    for (r, row) in rows.into_iter().enumerate() {
        let mut cells = Vec::new();
        for (c, content) in row.into_iter().enumerate() {
            let w = widths.get(c).copied().unwrap_or(1440);
            let mut attrs = json!({
                "colspan": 1,
                "rowspan": 1,
                "colwidth": [px(w)],
                "tcW": { "w": w.to_string(), "type": "dxa" },
            });
            if r == 0 {
                if let Some(fill) = header_fill {
                    attrs["shd"] = json!({ "val": "clear", "color": "auto", "fill": fill });
                }
            }
            cells.push(json!({ "type": "table_cell", "attrs": attrs, "content": content }));
        }
        let mut row_value = json!({ "type": "table_row", "content": cells });
        if r == 0 && header_fill.is_some() {
            row_value["attrs"] = json!({ "header": true });
        }
        out_rows.push(row_value);
    }
    let mut attrs = json!({
        "style": if borders { "TableGrid" } else { "TableNormal" },
        "tblW": { "w": total.to_string(), "type": "dxa" },
        "tblLook": { "val": "04A0", "firstRow": "1", "lastRow": "0", "firstColumn": "1", "lastColumn": "0", "noHBand": "0", "noVBand": "1" },
        "grid": widths.iter().map(|w| *w as f64).collect::<Vec<f64>>(),
    });
    if !borders {
        attrs["tblLayout"] = json!({ "type": "fixed" });
    }
    json!({ "type": "table", "attrs": attrs, "content": out_rows })
}

/// A cell holding one paragraph of text.
fn cell(content: Vec<Value>) -> Vec<Value> {
    vec![para(json!({ "spacing": { "before": "40", "after": "40" } }), content)]
}

fn page(top: i64, right: i64, bottom: i64, left: i64) -> Value {
    json!({
        "pgSz": { "w": "12240", "h": "15840" },
        "pgMar": {
            "top": top.to_string(), "right": right.to_string(), "bottom": bottom.to_string(), "left": left.to_string(),
            "header": "720", "footer": "720", "gutter": "0",
        },
        "cols": { "space": "720" },
    })
}

fn doc(content: Vec<Value>, lists: bool, page_attrs: Option<Value>) -> Value {
    let mut d = json!({ "type": "doc", "content": content });
    let mut attrs = serde_json::Map::new();
    if lists {
        attrs.insert("numAdded".into(), Value::Array(list_defs()));
    }
    if let Some(pg) = page_attrs {
        attrs.insert("page".into(), pg);
    }
    if !attrs.is_empty() {
        d["attrs"] = Value::Object(attrs);
    }
    d
}

fn only(doc: Value) -> Built {
    Built { doc, headers: json!({}), footers: json!({}) }
}

fn page_number_footer() -> Value {
    let mut content = vec![t("Page ")];
    content.extend(field("PAGE", "1"));
    json!({ "default": { "type": "doc", "content": [para(json!({ "style": "Footer", "jc": "center" }), content)] } })
}

// ----------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------

fn welcome() -> Built {
    let key = |k: &str| tm(k, vec![bold()]);
    let shortcut_rows: Vec<Vec<Vec<Value>>> = [
        ("Bold, italic, underline", "Ctrl+B, Ctrl+I, Ctrl+U"),
        ("Heading 1, 2, 3", "Ctrl+Alt+1, 2, 3"),
        ("Find in the document", "Ctrl+F"),
        ("Replace", "Ctrl+H"),
        ("Insert a link", "Ctrl+K"),
        ("Page break", "Ctrl+Enter"),
        ("Save", "Ctrl+S"),
        ("Print or save as PDF", "Ctrl+P"),
    ]
    .iter()
    .map(|(what, keys)| vec![cell(vec![t(what)]), cell(vec![t(keys)])])
    .collect();
    let mut rows = vec![vec![cell(vec![tm("To do this", vec![bold()])]), cell(vec![tm("Press", vec![bold()])])]];
    rows.extend(shortcut_rows);

    let content = vec![
        styled("Title", vec![t("Welcome to Docs")]),
        styled("Subtitle", vec![t("Five minutes to everything you'll use every day")]),
        p(vec![
            t("Docs is a word processor that reads and writes Word documents (.docx). This page is a regular document: click anywhere and start typing, or try the tips below. Nothing here can break."),
        ]),
        h(1, "Write and format"),
        bullet(vec![t("Select text, then use the "), key("Home"), t(" tab to change the font, size, color and highlight.")]),
        bullet(vec![t("Pick a look from the "), key("Styles"), t(" gallery. Headings keep your document organized and appear in the Navigation pane.")]),
        bullet(vec![t("Use "), key("Format Painter"), t(" to copy formatting from one place to another. Double-click it to paint several times.")]),
        bullet(vec![t("Make lists with the "), key("Bullets"), t(" and "), key("Numbering"), t(" buttons. Press Tab to indent an item and Shift+Tab to bring it back.")]),
        h(1, "Find your way around"),
        p(vec![
            t("Open the "),
            key("Navigation pane"),
            t(" from the View tab (or press Ctrl+F) to see every heading. Click a heading to jump to it, or search to see every match highlighted."),
        ]),
        h(1, "Add tables and pictures"),
        p(vec![
            t("On the "),
            key("Insert"),
            t(" tab, choose Table to draw a grid, or Pictures to add an image from your computer. You can also paste a picture you copied."),
        ]),
        table(&[4680, 4680], rows, Some("D9E2F3"), true),
        empty(),
        h(1, "Lay out your pages"),
        p(vec![
            t("The "),
            key("Layout"),
            t(" tab sets margins, orientation and paper size. Double-click the top or bottom of a page to edit its header or footer, and add page numbers from the Insert tab."),
        ]),
        h(1, "Review and share"),
        bullet(vec![t("Turn on "), key("Track Changes"), t(" on the Review tab so every edit can be accepted or rejected later.")]),
        bullet(vec![t("The status bar counts words as you type. Click the count for the full statistics.")]),
        bullet(vec![
            t("Save with Ctrl+S. Documents are saved as Word documents, so anyone with Word, LibreOffice or Google Docs can open them. Use "),
            key("File > Export"),
            t(" for PDF, plain text or Markdown."),
        ]),
        bullet(vec![t("Docs keeps a recovery copy of your work every few minutes, and earlier versions of every file you save.")]),
        empty(),
        para(json!({ "style": "IntenseQuote" }), vec![t("Tip: press Alt to see the shortcut letter of every button on the ribbon.")]),
    ];
    only(doc(content, true, None))
}

fn single_spaced() -> Built {
    only(doc(vec![styled("NoSpacing", vec![])], false, None))
}

fn toc_tutorial() -> Built {
    let toc_line = |style: &str, text: &str, pg: &str| {
        para(
            json!({ "style": style, "tabs": [{ "val": "right", "leader": "dot", "pos": "9350" }] }),
            vec![t(text), tab(), t(pg)],
        )
    };
    let mut first = vec![json!({ "type": "field_start", "attrs": { "instr": "TOC \\o \"1-3\" \\h \\z \\u", "xml": "" } })];
    first.extend([t("Get started"), tab(), t("1")]);
    let content = vec![
        styled("Title", vec![t("Insert your first table of contents")]),
        p(vec![t("A table of contents is built from the headings in your document. It stays up to date with one click.")]),
        para(json!({ "style": "TOCHeading" }), vec![t("Contents")]),
        para(json!({ "style": "TOC1", "tabs": [{ "val": "right", "leader": "dot", "pos": "9350" }] }), first),
        toc_line("TOC2", "Use heading styles", "1"),
        toc_line("TOC2", "Update the table", "1"),
        para(
            json!({ "style": "TOC1", "tabs": [{ "val": "right", "leader": "dot", "pos": "9350" }] }),
            vec![t("Make it your own"), tab(), t("2"), json!({ "type": "field_end", "attrs": { "xml": "" } })],
        ),
        empty(),
        h(1, "Get started"),
        p(vec![
            t("The table above lists the headings of this document. To add one to your own document, put the cursor where it belongs and choose "),
            tm("References > Table of Contents", vec![bold()]),
            t("."),
        ]),
        h(2, "Use heading styles"),
        p(vec![
            t("Text formatted with Heading 1, Heading 2 or Heading 3 appears in the table. Pick a heading style from the Styles gallery on the Home tab, or press Ctrl+Alt+1, 2 or 3."),
        ]),
        h(2, "Update the table"),
        p(vec![
            t("When you add, remove or rename headings, choose "),
            tm("References > Update Table", vec![bold()]),
            t(". Page numbers are refreshed at the same time."),
        ]),
        page_break(),
        h(1, "Make it your own"),
        p(vec![t("Try it now: add a heading below this paragraph, then update the table at the top of the document.")]),
        empty(),
    ];
    Built { doc: doc(content, false, None), headers: json!({}), footers: page_number_footer() }
}

fn section_heading(text: &str) -> Value {
    para(
        json!({
            "spacing": { "before": "280", "after": "120" },
            "pBdr": border("bottom", ACCENT2, 6, 4),
            "keepNext": true,
        }),
        vec![tm(text, vec![bold(), caps(), color(ACCENT), size(11.0), spacing(20)])],
    )
}

fn entry_line(left: &str, right: &str) -> Value {
    para(
        json!({ "tabs": [{ "val": "right", "pos": "10080" }], "spacing": { "before": "120", "after": "0" }, "keepNext": true }),
        vec![tm(left, vec![bold()]), tab(), tm(right, vec![color(MUTED)])],
    )
}

fn resume() -> Built {
    let content = vec![
        para(
            json!({ "spacing": { "after": "0" } }),
            vec![tm("Alex Morgan", vec![font("Aptos Display"), size(30.0), color(ACCENT), bold()])],
        ),
        para(json!({ "spacing": { "after": "40" } }), vec![tm("Product Designer", vec![size(13.0), color(ACCENT2)])]),
        para(
            json!({ "spacing": { "after": "200" } }),
            vec![tm("Portland, OR  •  (555) 012-3456  •  alex.morgan@example.com  •  linkedin.com/in/alexmorgan", vec![color(MUTED), size(10.0)])],
        ),
        section_heading("Summary"),
        p(vec![t("Product designer with eight years of experience turning complex workflows into simple, accessible tools. Comfortable from research to pixel-perfect delivery, and happiest working closely with engineers.")]),
        section_heading("Experience"),
        entry_line("Senior Product Designer, Northwind Software", "2021 – Present"),
        bullet(vec![t("Led the redesign of the billing experience, cutting support tickets by 35%.")]),
        bullet(vec![t("Built and maintained a design system used by six product teams.")]),
        bullet(vec![t("Mentored four designers and ran the weekly design critique.")]),
        entry_line("Product Designer, Contoso Health", "2017 – 2021"),
        bullet(vec![t("Designed the patient scheduling app used by 1.2 million people.")]),
        bullet(vec![t("Ran usability studies every sprint and shared findings with the whole company.")]),
        entry_line("UX Designer, Fabrikam Studio", "2015 – 2017"),
        bullet(vec![t("Delivered websites and apps for clients in retail, travel and education.")]),
        section_heading("Education"),
        entry_line("B.F.A. Interaction Design, Pacific College of Art", "2015"),
        section_heading("Skills"),
        p(vec![t("User research  •  Prototyping  •  Design systems  •  Accessibility (WCAG)  •  Figma  •  HTML & CSS  •  Workshop facilitation")]),
    ];
    only(doc(content, true, Some(page(1008, 1080, 1008, 1080))))
}

fn letter_head(name: &str, detail: &str) -> Vec<Value> {
    vec![
        para(json!({ "spacing": { "after": "0" } }), vec![tm(name, vec![font("Aptos Display"), size(26.0), color(ACCENT), bold()])]),
        para(
            json!({ "spacing": { "after": "360" }, "pBdr": border("bottom", ACCENT2, 6, 6) }),
            vec![tm(detail, vec![color(MUTED), size(10.0)])],
        ),
    ]
}

fn cover_letter() -> Built {
    let mut content = letter_head("Alex Morgan", "Portland, OR  •  (555) 012-3456  •  alex.morgan@example.com");
    content.extend([
        p(vec![t("October 12, 2026")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Jordan Lee")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Head of Design")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Tailspin Toys")]),
        p(vec![t("1200 Market Street, Seattle, WA 98101")]),
        p(vec![t("Dear Jordan,")]),
        p(vec![t("I'm writing to apply for the Senior Product Designer role at Tailspin Toys. I have spent the last eight years designing products that make complicated tasks feel simple, and your focus on playful, accessible experiences is exactly the kind of work I want to do next.")]),
        p(vec![t("At Northwind Software I led the redesign of our billing experience, which cut related support tickets by 35%, and I built the design system that six teams now use every day. I work closely with engineers from the first sketch, and I bring research into every decision.")]),
        p(vec![t("I would love to talk about how I could help your team. Thank you for your time and consideration.")]),
        p(vec![t("Sincerely,")]),
        empty(),
        p(vec![tm("Alex Morgan", vec![bold()])]),
    ]);
    only(doc(content, false, None))
}

fn business_letter() -> Built {
    let mut content = vec![
        para(
            json!({ "jc": "right", "spacing": { "after": "0" } }),
            vec![tm("NORTHWIND TRADERS", vec![font("Aptos Display"), size(20.0), bold(), color(ACCENT), spacing(30)])],
        ),
        para(
            json!({ "jc": "right", "spacing": { "after": "480" }, "pBdr": border("bottom", ACCENT2, 12, 6) }),
            vec![tm("400 Harbor Road, Suite 12  •  Boston, MA 02110  •  (555) 010-2000  •  northwind.example.com", vec![size(9.0), color(MUTED)])],
        ),
    ];
    content.extend([
        p(vec![t("October 12, 2026")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Ms. Taylor Brooks")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Purchasing Manager")]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Adventure Works")]),
        p(vec![t("78 Lake Avenue, Chicago, IL 60601")]),
        p(vec![tm("Re: ", vec![bold()]), t("Renewal of supply agreement #2291")]),
        p(vec![t("Dear Ms. Brooks,")]),
        p(vec![t("Thank you for your continued partnership over the past three years. As our supply agreement comes up for renewal on December 31, we are pleased to offer the same pricing for the coming year, together with free expedited shipping on orders above $5,000.")]),
        p(vec![t("The enclosed proposal summarizes the terms. If they meet your needs, please sign and return a copy by November 30 so that deliveries continue without interruption.")]),
        p(vec![t("Please don't hesitate to contact me with any questions.")]),
        p(vec![t("Yours sincerely,")]),
        empty(),
        para(json!({ "spacing": { "after": "0" } }), vec![tm("Sam Rivera", vec![bold()])]),
        para(json!({ "spacing": { "after": "0" } }), vec![t("Account Director, Northwind Traders")]),
        p(vec![t("sam.rivera@northwind.example.com")]),
        p(vec![tm("Enclosure: Supply agreement proposal", vec![italic(), color(MUTED)])]),
    ]);
    only(doc(content, false, None))
}

fn report() -> Built {
    let rows = vec![
        vec![cell(vec![tm("Region", vec![bold()])]), cell(vec![tm("Revenue", vec![bold()])]), cell(vec![tm("Growth", vec![bold()])])],
        vec![cell(vec![t("North")]), cell(vec![t("$1.24M")]), cell(vec![t("+12%")])],
        vec![cell(vec![t("South")]), cell(vec![t("$0.98M")]), cell(vec![t("+7%")])],
        vec![cell(vec![t("East")]), cell(vec![t("$1.51M")]), cell(vec![t("+18%")])],
        vec![cell(vec![t("West")]), cell(vec![t("$1.12M")]), cell(vec![t("+4%")])],
    ];
    let content = vec![
        para(json!({ "spacing": { "before": "2400", "after": "0" } }), vec![]),
        para(json!({ "style": "Title", "pBdr": border("bottom", ACCENT2, 12, 8) }), vec![t("Annual Report")]),
        styled("Subtitle", vec![t("Fiscal year 2026  •  Prepared for the leadership team")]),
        para(json!({ "spacing": { "before": "480" } }), vec![tm("Prepared by: ", vec![bold()]), t("Strategy & Operations")]),
        p(vec![tm("Date: ", vec![bold()]), t("October 12, 2026")]),
        page_break(),
        h(1, "Executive summary"),
        p(vec![t("This year we grew revenue in every region, opened two new offices and launched our subscription plan. This report summarizes the results, the lessons we learned and our priorities for next year.")]),
        h(1, "Results"),
        h(2, "Revenue by region"),
        p(vec![t("All four regions grew. The East region grew fastest thanks to new enterprise customers.")]),
        table(&[3120, 3120, 3120], rows, Some("D9E2F3"), true),
        para(json!({ "style": "Caption" }), vec![t("Table 1. Revenue and growth by region")]),
        h(2, "Highlights"),
        bullet(vec![t("Subscriptions reached 40% of new sales within six months.")]),
        bullet(vec![t("Customer satisfaction rose from 4.2 to 4.6 out of 5.")]),
        bullet(vec![t("Average delivery time dropped from five days to three.")]),
        h(1, "Next year"),
        numbered(vec![t("Expand the subscription plan to small businesses.")]),
        numbered(vec![t("Open a support center in the West region.")]),
        numbered(vec![t("Reduce delivery times to two days in major cities.")]),
        h(1, "Conclusion"),
        p(vec![t("We finish the year in a strong position. With focused investment in subscriptions and service, we expect another year of steady growth.")]),
    ];
    Built { doc: doc(content, true, None), headers: json!({}), footers: page_number_footer() }
}

fn meeting_notes() -> Built {
    let label = |s: &str| cell(vec![tm(s, vec![bold(), color(ACCENT)])]);
    let details = vec![
        vec![label("Date"), cell(vec![t("Monday, October 12, 2026")])],
        vec![label("Time"), cell(vec![t("10:00 – 11:00")])],
        vec![label("Location"), cell(vec![t("Conference room B / video call")])],
        vec![label("Facilitator"), cell(vec![t("Priya Shah")])],
        vec![label("Note taker"), cell(vec![t("Chris Doe")])],
    ];
    let actions = vec![
        vec![cell(vec![tm("Action item", vec![bold()])]), cell(vec![tm("Owner", vec![bold()])]), cell(vec![tm("Due", vec![bold()])])],
        vec![cell(vec![t("Share the updated launch plan")]), cell(vec![t("Priya")]), cell(vec![t("Oct 14")])],
        vec![cell(vec![t("Book the venue for the customer event")]), cell(vec![t("Chris")]), cell(vec![t("Oct 16")])],
        vec![cell(vec![t("Draft the press release")]), cell(vec![t("Morgan")]), cell(vec![t("Oct 21")])],
    ];
    let content = vec![
        styled("Title", vec![t("Team meeting")]),
        styled("Subtitle", vec![t("Product launch planning")]),
        table(&[2160, 7200], details, None, false),
        h(1, "Attendees"),
        p(vec![t("Priya Shah, Chris Doe, Morgan Lee, Sam Rivera, Taylor Brooks")]),
        h(1, "Agenda"),
        numbered(vec![t("Review of last week's action items")]),
        numbered(vec![t("Launch timeline")]),
        numbered(vec![t("Customer event")]),
        numbered(vec![t("Open questions")]),
        h(1, "Discussion"),
        h(2, "Launch timeline"),
        p(vec![t("The team agreed to move the launch to November 3 to leave time for a second round of testing. Marketing materials stay on schedule.")]),
        h(2, "Customer event"),
        p(vec![t("We will host about 60 customers. Two venues are shortlisted; Chris will confirm one by Friday.")]),
        h(1, "Action items"),
        table(&[5400, 2160, 1800], actions, Some("D9E2F3"), true),
        empty(),
        h(1, "Next meeting"),
        p(vec![t("Monday, October 19, 2026 at 10:00")]),
    ];
    only(doc(content, true, None))
}

fn flyer() -> Built {
    let center = |spacing_after: i64, content: Vec<Value>| para(json!({ "jc": "center", "spacing": { "after": spacing_after.to_string() } }), content);
    let content = vec![
        center(120, vec![tm("YOU'RE INVITED", vec![bold(), color(ACCENT2), size(16.0), spacing(60)])]),
        center(0, vec![tm("Summer", vec![font("Aptos Display"), size(66.0), bold(), color(ACCENT)])]),
        center(240, vec![tm("Street Festival", vec![font("Aptos Display"), size(48.0), color(ACCENT)])]),
        para(
            json!({ "jc": "center", "spacing": { "after": "360" }, "pBdr": border("bottom", ACCENT2, 18, 12) }),
            vec![tm("Saturday, July 18  •  12:00 – 8:00 PM", vec![size(20.0), bold(), color(MUTED)])],
        ),
        center(200, vec![tm("Live music • Food trucks • Kids' corner • Local artists", vec![size(16.0)])]),
        center(200, vec![t("Join your neighbors for an afternoon of music, food and games on Main Street. Bring the whole family — admission is free.")]),
        center(600, vec![tm("Main Street between 3rd and 7th Avenue", vec![bold(), size(14.0)])]),
        center(0, vec![tm("More information: ", vec![color(MUTED)]), tm("festival.example.com", vec![cstyle("Hyperlink"), link("https://festival.example.com")])]),
    ];
    only(doc(content, false, Some(page(1440, 1260, 1440, 1260))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{docs::from_built, docx};

    #[test]
    fn every_template_saves_and_reopens() {
        for t in TEMPLATES {
            let built = t.build();
            let opened = from_built(built);
            let session = crate::docs::DocSession::new("x".into(), t.name.into(), opened, None);
            let bytes = session.docx_bytes("Tester").unwrap_or_else(|e| panic!("{}: {e}", t.id));
            let again = docx::open(&bytes).unwrap_or_else(|e| panic!("{}: {e}", t.id));
            let blocks = again.payload["doc"]["content"].as_array().unwrap();
            assert!(!blocks.is_empty(), "{}", t.id);
            let text = docx::text::to_plain_text(&again.payload["doc"]);
            assert!(!text.trim().is_empty() || t.id == "single-spaced", "{}", t.id);
            if t.id == "report" || t.id == "toc-tutorial" {
                assert!(again.payload["footers"]["default"].is_object(), "{} footer", t.id);
            }
            if t.id == "toc-tutorial" {
                let toc = blocks.iter().find(|b| b["attrs"]["style"] == "TOC1").unwrap();
                assert_eq!(toc["content"][0]["type"], "field_start");
                assert!(toc["content"][0]["attrs"]["instr"].as_str().unwrap().starts_with("TOC"));
            }
        }
        assert_eq!(list().len(), TEMPLATES.len());
    }
}
