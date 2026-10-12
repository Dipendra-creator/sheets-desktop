//! Styles (`styles.xml`) and the built-in style catalog.
//!
//! The editor gets every style with its own paragraph attributes and run
//! marks (inheritance through `basedOn` is resolved in the UI). Styles a
//! document uses but doesn't define (a heading applied in a document that
//! never had one) are added from the built-in catalog when saving.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use super::{
    props::{ppr_attrs, rpr_marks, tblpr_attrs, tcpr_attrs, trpr_attrs},
    xml::{decode, is_w, parse, wattr, wchild},
};

fn on(node: roxmltree::Node, name: &str) -> bool {
    wchild(node, name).map(|n| !matches!(wattr(n, "val"), Some("0") | Some("false"))).unwrap_or(false)
}

fn child_val(node: roxmltree::Node, name: &str) -> Option<String> {
    wchild(node, name).and_then(|n| wattr(n, "val")).map(|s| s.to_string())
}

/// Parses `styles.xml` → `{ defaults: {pPr, rPr}, styles: [...] }`.
pub fn read_styles(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({ "defaults": {}, "styles": [] }) };
    let root = doc.root_element();
    let mut defaults = json!({});
    if let Some(dd) = wchild(root, "docDefaults") {
        if let Some(rpr) = wchild(dd, "rPrDefault").and_then(|n| wchild(n, "rPr")) {
            defaults["rPr"] = Value::Array(rpr_marks(&text, rpr));
        }
        if let Some(ppr) = wchild(dd, "pPrDefault").and_then(|n| wchild(n, "pPr")) {
            defaults["pPr"] = Value::Object(ppr_attrs(&text, ppr));
        }
    }
    let mut styles = Vec::new();
    for s in root.children().filter(|c| is_w(*c, "style")) {
        let Some(id) = wattr(s, "styleId") else { continue };
        let mut v = json!({
            "id": id,
            "type": wattr(s, "type").unwrap_or("paragraph"),
            "name": child_val(s, "name").unwrap_or_else(|| id.to_string()),
            "basedOn": child_val(s, "basedOn"),
            "next": child_val(s, "next"),
            "link": child_val(s, "link"),
            "uiPriority": child_val(s, "uiPriority").and_then(|v| v.parse::<i64>().ok()),
            "qFormat": on(s, "qFormat"),
            "hidden": on(s, "hidden"),
            "semiHidden": on(s, "semiHidden"),
            "default": matches!(wattr(s, "default"), Some("1") | Some("true")),
            "custom": matches!(wattr(s, "customStyle"), Some("1") | Some("true")),
        });
        if let Some(ppr) = wchild(s, "pPr") {
            v["pPr"] = Value::Object(ppr_attrs(&text, ppr));
        }
        if let Some(rpr) = wchild(s, "rPr") {
            v["rPr"] = Value::Array(rpr_marks(&text, rpr));
        }
        if let Some(t) = wchild(s, "tblPr") {
            v["tblPr"] = Value::Object(tblpr_attrs(&text, t));
        }
        if let Some(t) = wchild(s, "tcPr") {
            v["tcPr"] = Value::Object(tcpr_attrs(&text, t).0);
        }
        let conditional: Map<String, Value> = s
            .children()
            .filter(|c| is_w(*c, "tblStylePr"))
            .filter_map(|c| {
                let kind = wattr(c, "type")?.to_string();
                let mut part = json!({});
                if let Some(ppr) = wchild(c, "pPr") {
                    part["pPr"] = Value::Object(ppr_attrs(&text, ppr));
                }
                if let Some(rpr) = wchild(c, "rPr") {
                    part["rPr"] = Value::Array(rpr_marks(&text, rpr));
                }
                if let Some(t) = wchild(c, "tblPr") {
                    part["tblPr"] = Value::Object(tblpr_attrs(&text, t));
                }
                if let Some(t) = wchild(c, "trPr") {
                    part["trPr"] = Value::Object(trpr_attrs(&text, t));
                }
                if let Some(t) = wchild(c, "tcPr") {
                    part["tcPr"] = Value::Object(tcpr_attrs(&text, t).0);
                }
                Some((kind, part))
            })
            .collect();
        if !conditional.is_empty() {
            v["conditional"] = Value::Object(conditional);
        }
        styles.push(v);
    }
    json!({ "defaults": defaults, "styles": styles })
}

/// Ids defined in `styles.xml` (case-insensitive names too, for localized ids).
pub fn defined_styles(bytes: &[u8]) -> (BTreeSet<String>, BTreeSet<String>) {
    let text = decode(bytes);
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    if let Ok(doc) = parse(&text) {
        for s in doc.root_element().children().filter(|c| is_w(*c, "style")) {
            if let Some(id) = wattr(s, "styleId") {
                ids.insert(id.to_string());
            }
            if let Some(n) = child_val(s, "name") {
                names.insert(n.to_lowercase());
            }
        }
    }
    (ids, names)
}

/// Adds built-in style definitions for `used` ids the document doesn't define.
pub fn add_missing_styles(bytes: &[u8], used: &BTreeSet<String>) -> Option<Vec<u8>> {
    let (ids, names) = defined_styles(bytes);
    let mut extra = String::new();
    let mut added = BTreeSet::new();
    let mut queue: Vec<String> = used.iter().cloned().collect();
    while let Some(id) = queue.pop() {
        if ids.contains(&id) || added.contains(&id) {
            continue;
        }
        let Some(def) = CATALOG.iter().find(|s| s.id == id) else { continue };
        if names.contains(&def.name.to_lowercase()) {
            continue;
        }
        added.insert(id.clone());
        extra.push_str(&def.xml());
        // Styles it depends on
        for dep in [def.based_on, def.next].into_iter().flatten() {
            queue.push(dep.to_string());
        }
    }
    if extra.is_empty() {
        return None;
    }
    let text = decode(bytes);
    let doc = parse(&text).ok()?;
    let root = doc.root_element();
    let end = root.range().end;
    let close = text[..end].rfind("</")?;
    let mut out = String::with_capacity(text.len() + extra.len());
    out.push_str(&text[..close]);
    out.push_str(&extra);
    out.push_str(&text[close..]);
    Some(out.into_bytes())
}

// ----------------------------------------------------------------------
// Built-in catalog
// ----------------------------------------------------------------------

pub struct BuiltinStyle {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    pub based_on: Option<&'static str>,
    pub next: Option<&'static str>,
    pub ui_priority: Option<i32>,
    pub q_format: bool,
    pub semi_hidden: bool,
    pub default: bool,
    pub ppr: &'static str,
    pub rpr: &'static str,
    pub extra: &'static str,
}

impl BuiltinStyle {
    pub fn xml(&self) -> String {
        let mut s = format!(
            "<w:style w:type=\"{}\"{} w:styleId=\"{}\"><w:name w:val=\"{}\"/>",
            self.kind,
            if self.default { " w:default=\"1\"" } else { "" },
            self.id,
            self.name
        );
        if let Some(b) = self.based_on {
            s.push_str(&format!("<w:basedOn w:val=\"{b}\"/>"));
        }
        if let Some(n) = self.next {
            s.push_str(&format!("<w:next w:val=\"{n}\"/>"));
        }
        if let Some(p) = self.ui_priority {
            s.push_str(&format!("<w:uiPriority w:val=\"{p}\"/>"));
        }
        if self.semi_hidden {
            s.push_str("<w:semiHidden/><w:unhideWhenUsed/>");
        }
        if self.q_format {
            s.push_str("<w:qFormat/>");
        }
        if !self.ppr.is_empty() {
            s.push_str(&format!("<w:pPr>{}</w:pPr>", self.ppr));
        }
        if !self.rpr.is_empty() {
            s.push_str(&format!("<w:rPr>{}</w:rPr>", self.rpr));
        }
        s.push_str(self.extra);
        s.push_str("</w:style>");
        s
    }
}

#[allow(clippy::too_many_arguments)]
const fn st(
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    based_on: Option<&'static str>,
    next: Option<&'static str>,
    ui_priority: Option<i32>,
    q_format: bool,
    ppr: &'static str,
    rpr: &'static str,
) -> BuiltinStyle {
    BuiltinStyle { id, name, kind, based_on, next, ui_priority, q_format, semi_hidden: false, default: false, ppr, rpr, extra: "" }
}

macro_rules! heading_rpr {
    ($color:literal, $size:literal) => {
        concat!(
            "<w:rFonts w:ascii=\"Aptos Display\" w:hAnsi=\"Aptos Display\" w:eastAsia=\"Aptos Display\" w:cs=\"Aptos Display\"/>",
            "<w:color w:val=\"",
            $color,
            "\"/><w:sz w:val=\"",
            $size,
            "\"/><w:szCs w:val=\"",
            $size,
            "\"/>"
        )
    };
}

pub static CATALOG: &[BuiltinStyle] = &[
    BuiltinStyle {
        id: "Normal",
        name: "Normal",
        kind: "paragraph",
        based_on: None,
        next: None,
        ui_priority: None,
        q_format: true,
        semi_hidden: false,
        default: true,
        ppr: "",
        rpr: "",
        extra: "",
    },
    BuiltinStyle {
        id: "DefaultParagraphFont",
        name: "Default Paragraph Font",
        kind: "character",
        based_on: None,
        next: None,
        ui_priority: Some(1),
        q_format: false,
        semi_hidden: true,
        default: true,
        ppr: "",
        rpr: "",
        extra: "",
    },
    BuiltinStyle {
        id: "TableNormal",
        name: "Normal Table",
        kind: "table",
        based_on: None,
        next: None,
        ui_priority: Some(99),
        q_format: false,
        semi_hidden: true,
        default: true,
        ppr: "",
        rpr: "",
        extra: "<w:tblPr><w:tblInd w:w=\"0\" w:type=\"dxa\"/><w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr>",
    },
    BuiltinStyle {
        id: "NoList",
        name: "No List",
        kind: "numbering",
        based_on: None,
        next: None,
        ui_priority: Some(99),
        q_format: false,
        semi_hidden: true,
        default: true,
        ppr: "",
        rpr: "",
        extra: "",
    },
    st("NoSpacing", "No Spacing", "paragraph", None, None, Some(1), true, "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>", ""),
    st(
        "Heading1",
        "heading 1",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"360\" w:after=\"80\"/><w:outlineLvl w:val=\"0\"/>",
        heading_rpr!("1F3864", "40"),
    ),
    st(
        "Heading2",
        "heading 2",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"160\" w:after=\"80\"/><w:outlineLvl w:val=\"1\"/>",
        heading_rpr!("2F5496", "32"),
    ),
    st(
        "Heading3",
        "heading 3",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"160\" w:after=\"80\"/><w:outlineLvl w:val=\"2\"/>",
        heading_rpr!("1F3864", "28"),
    ),
    st(
        "Heading4",
        "heading 4",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"80\" w:after=\"40\"/><w:outlineLvl w:val=\"3\"/>",
        concat!(heading_rpr!("2F5496", "24"), "<w:i/><w:iCs/>"),
    ),
    st(
        "Heading5",
        "heading 5",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"80\" w:after=\"40\"/><w:outlineLvl w:val=\"4\"/>",
        heading_rpr!("2F5496", "24"),
    ),
    st(
        "Heading6",
        "heading 6",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(9),
        true,
        "<w:keepNext/><w:keepLines/><w:spacing w:before=\"40\" w:after=\"0\"/><w:outlineLvl w:val=\"5\"/>",
        concat!(heading_rpr!("595959", "24"), "<w:i/><w:iCs/>"),
    ),
    st(
        "Title",
        "Title",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(10),
        true,
        "<w:spacing w:after=\"80\" w:line=\"240\" w:lineRule=\"auto\"/><w:contextualSpacing/>",
        "<w:rFonts w:ascii=\"Aptos Display\" w:hAnsi=\"Aptos Display\" w:eastAsia=\"Aptos Display\" w:cs=\"Aptos Display\"/><w:spacing w:val=\"-10\"/><w:kern w:val=\"28\"/><w:sz w:val=\"56\"/><w:szCs w:val=\"56\"/>",
    ),
    st(
        "Subtitle",
        "Subtitle",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(11),
        true,
        "<w:spacing w:after=\"160\"/>",
        "<w:color w:val=\"595959\"/><w:spacing w:val=\"15\"/><w:sz w:val=\"28\"/><w:szCs w:val=\"28\"/>",
    ),
    st("SubtleEmphasis", "Subtle Emphasis", "character", Some("DefaultParagraphFont"), None, Some(19), true, "", "<w:i/><w:iCs/><w:color w:val=\"404040\"/>"),
    st("Emphasis", "Emphasis", "character", Some("DefaultParagraphFont"), None, Some(20), true, "", "<w:i/><w:iCs/>"),
    st("IntenseEmphasis", "Intense Emphasis", "character", Some("DefaultParagraphFont"), None, Some(21), true, "", "<w:i/><w:iCs/><w:color w:val=\"2F5496\"/>"),
    st("Strong", "Strong", "character", Some("DefaultParagraphFont"), None, Some(22), true, "", "<w:b/><w:bCs/>"),
    st(
        "Quote",
        "Quote",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(29),
        true,
        "<w:spacing w:before=\"160\"/><w:jc w:val=\"center\"/>",
        "<w:i/><w:iCs/><w:color w:val=\"404040\"/>",
    ),
    st(
        "IntenseQuote",
        "Intense Quote",
        "paragraph",
        Some("Normal"),
        Some("Normal"),
        Some(30),
        true,
        "<w:pBdr><w:top w:val=\"single\" w:sz=\"4\" w:space=\"10\" w:color=\"2F5496\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"10\" w:color=\"2F5496\"/></w:pBdr><w:spacing w:before=\"360\" w:after=\"360\"/><w:ind w:left=\"864\" w:right=\"864\"/><w:jc w:val=\"center\"/>",
        "<w:i/><w:iCs/><w:color w:val=\"2F5496\"/>",
    ),
    st("SubtleReference", "Subtle Reference", "character", Some("DefaultParagraphFont"), None, Some(31), true, "", "<w:smallCaps/><w:color w:val=\"5A5A5A\"/>"),
    st(
        "IntenseReference",
        "Intense Reference",
        "character",
        Some("DefaultParagraphFont"),
        None,
        Some(32),
        true,
        "",
        "<w:b/><w:bCs/><w:smallCaps/><w:color w:val=\"2F5496\"/><w:spacing w:val=\"5\"/>",
    ),
    st("BookTitle", "Book Title", "character", Some("DefaultParagraphFont"), None, Some(33), true, "", "<w:b/><w:bCs/><w:i/><w:iCs/><w:spacing w:val=\"5\"/>"),
    st("ListParagraph", "List Paragraph", "paragraph", Some("Normal"), None, Some(34), true, "<w:ind w:left=\"720\"/><w:contextualSpacing/>", ""),
    st(
        "Header",
        "header",
        "paragraph",
        Some("Normal"),
        None,
        Some(99),
        false,
        "<w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        "",
    ),
    st(
        "Footer",
        "footer",
        "paragraph",
        Some("Normal"),
        None,
        Some(99),
        false,
        "<w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        "",
    ),
    st("Caption", "caption", "paragraph", Some("Normal"), Some("Normal"), Some(35), true, "<w:spacing w:after=\"200\" w:line=\"240\" w:lineRule=\"auto\"/>", "<w:i/><w:iCs/><w:color w:val=\"1F3864\"/><w:sz w:val=\"18\"/><w:szCs w:val=\"18\"/>"),
    st(
        "TOCHeading",
        "TOC Heading",
        "paragraph",
        Some("Heading1"),
        Some("Normal"),
        Some(39),
        true,
        "<w:spacing w:before=\"240\" w:after=\"0\" w:line=\"259\" w:lineRule=\"auto\"/><w:outlineLvl w:val=\"9\"/>",
        "",
    ),
    st("TOC1", "toc 1", "paragraph", Some("Normal"), Some("Normal"), Some(39), false, "<w:spacing w:after=\"100\"/>", ""),
    st("TOC2", "toc 2", "paragraph", Some("Normal"), Some("Normal"), Some(39), false, "<w:spacing w:after=\"100\"/><w:ind w:left=\"240\"/>", ""),
    st("TOC3", "toc 3", "paragraph", Some("Normal"), Some("Normal"), Some(39), false, "<w:spacing w:after=\"100\"/><w:ind w:left=\"480\"/>", ""),
    st("Hyperlink", "Hyperlink", "character", Some("DefaultParagraphFont"), None, Some(99), false, "", "<w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/>"),
    st(
        "FootnoteText",
        "footnote text",
        "paragraph",
        Some("Normal"),
        None,
        Some(99),
        false,
        "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/>",
    ),
    st("FootnoteReference", "footnote reference", "character", Some("DefaultParagraphFont"), None, Some(99), false, "", "<w:vertAlign w:val=\"superscript\"/>"),
    st(
        "EndnoteText",
        "endnote text",
        "paragraph",
        Some("Normal"),
        None,
        Some(99),
        false,
        "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/>",
    ),
    st("EndnoteReference", "endnote reference", "character", Some("DefaultParagraphFont"), None, Some(99), false, "", "<w:vertAlign w:val=\"superscript\"/>"),
    BuiltinStyle {
        id: "TableGrid",
        name: "Table Grid",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(39),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/></w:tblBorders></w:tblPr>",
    },
    st("CommentReference", "annotation reference", "character", Some("DefaultParagraphFont"), None, Some(99), false, "", "<w:sz w:val=\"16\"/><w:szCs w:val=\"16\"/>"),
    st(
        "CommentText",
        "annotation text",
        "paragraph",
        Some("Normal"),
        None,
        Some(99),
        false,
        "<w:spacing w:line=\"240\" w:lineRule=\"auto\"/>",
        "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/>",
    ),
    BuiltinStyle {
        id: "PlainTable1",
        name: "Plain Table 1",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(41),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\" w:themeColor=\"background1\"/></w:tblBorders></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"double\" w:sz=\"4\" w:space=\"0\" w:color=\"BFBFBF\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"band1Vert\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F2F2F2\" w:themeFill=\"background1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Horz\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F2F2F2\" w:themeFill=\"background1\"/></w:tcPr></w:tblStylePr>",
    },
    BuiltinStyle {
        id: "GridTable1Light",
        name: "Grid Table 1 Light",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(46),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\" w:themeColor=\"text1\" w:themeTint=\"66\"/></w:tblBorders></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:bottom w:val=\"single\" w:sz=\"12\" w:space=\"0\" w:color=\"666666\" w:themeColor=\"text1\" w:themeTint=\"99\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"double\" w:sz=\"2\" w:space=\"0\" w:color=\"666666\" w:themeColor=\"text1\" w:themeTint=\"99\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr>",
    },
    BuiltinStyle {
        id: "GridTable4-Accent1",
        name: "Grid Table 4 Accent 1",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(49),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"45B0E1\" w:themeColor=\"accent1\" w:themeTint=\"99\"/></w:tblBorders></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tcBorders><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"double\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"band1Vert\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"C1E4F5\" w:themeFill=\"accent1\" w:themeFillTint=\"33\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Horz\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"C1E4F5\" w:themeFill=\"accent1\" w:themeFillTint=\"33\"/></w:tcPr></w:tblStylePr>",
    },
    BuiltinStyle {
        id: "GridTable4-Accent2",
        name: "Grid Table 4 Accent 2",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(49),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"F1A983\" w:themeColor=\"accent2\" w:themeTint=\"99\"/></w:tblBorders></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"E97132\" w:themeColor=\"accent2\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"E97132\" w:themeColor=\"accent2\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"E97132\" w:themeColor=\"accent2\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"E97132\" w:themeColor=\"accent2\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tcBorders><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E97132\" w:themeFill=\"accent2\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"double\" w:sz=\"4\" w:space=\"0\" w:color=\"E97132\" w:themeColor=\"accent2\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"band1Vert\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"FAE2D5\" w:themeFill=\"accent2\" w:themeFillTint=\"33\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Horz\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"FAE2D5\" w:themeFill=\"accent2\" w:themeFillTint=\"33\"/></w:tcPr></w:tblStylePr>",
    },
    BuiltinStyle {
        id: "ListTable3-Accent1",
        name: "List Table 3 Accent 1",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(48),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/></w:tblBorders></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:top w:val=\"double\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr><w:tblStylePr w:type=\"band1Vert\"><w:tcPr><w:tcBorders><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/></w:tcBorders></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Horz\"><w:tcPr><w:tcBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"156082\" w:themeColor=\"accent1\"/></w:tcBorders></w:tcPr></w:tblStylePr>",
    },
    BuiltinStyle {
        id: "GridTable5Dark-Accent1",
        name: "Grid Table 5 Dark Accent 1",
        kind: "table",
        based_on: Some("TableNormal"),
        next: None,
        ui_priority: Some(50),
        q_format: false,
        semi_hidden: false,
        default: false,
        ppr: "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>",
        rpr: "",
        extra: "<w:tblPr><w:tblStyleRowBandSize w:val=\"1\"/><w:tblStyleColBandSize w:val=\"1\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"FFFFFF\" w:themeColor=\"background1\"/></w:tblBorders><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"C1E4F5\" w:themeFill=\"accent1\" w:themeFillTint=\"33\"/></w:tblPr><w:tblStylePr w:type=\"firstRow\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastRow\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"firstCol\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"lastCol\"><w:rPr><w:b/><w:bCs/><w:color w:val=\"FFFFFF\" w:themeColor=\"background1\"/></w:rPr><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"156082\" w:themeFill=\"accent1\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Vert\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"83CAEB\" w:themeFill=\"accent1\" w:themeFillTint=\"66\"/></w:tcPr></w:tblStylePr><w:tblStylePr w:type=\"band1Horz\"><w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"83CAEB\" w:themeFill=\"accent1\" w:themeFillTint=\"66\"/></w:tcPr></w:tblStylePr>",
    },
];

/// `styles.xml` of a new document.
pub fn default_styles_xml() -> String {
    let mut s = String::from(concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
        "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
        "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" ",
        "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"w14\">",
        "<w:docDefaults><w:rPrDefault><w:rPr>",
        "<w:rFonts w:ascii=\"Aptos\" w:eastAsia=\"Aptos\" w:hAnsi=\"Aptos\" w:cs=\"Aptos\"/>",
        "<w:kern w:val=\"2\"/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/>",
        "<w:lang w:val=\"en-US\" w:eastAsia=\"en-US\" w:bidi=\"ar-SA\"/>",
        "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>",
        "<w:spacing w:after=\"160\" w:line=\"276\" w:lineRule=\"auto\"/>",
        "</w:pPr></w:pPrDefault></w:docDefaults>",
    ));
    for id in [
        "Normal", "DefaultParagraphFont", "TableNormal", "NoList", "NoSpacing", "Heading1", "Heading2", "Heading3", "Title",
        "Subtitle", "SubtleEmphasis", "Emphasis", "IntenseEmphasis", "Strong", "Quote", "IntenseQuote", "SubtleReference",
        "IntenseReference", "BookTitle", "ListParagraph", "Header", "Footer", "Hyperlink", "TableGrid",
    ] {
        if let Some(def) = CATALOG.iter().find(|s| s.id == id) {
            s.push_str(&def.xml());
        }
    }
    s.push_str("</w:styles>");
    s
}

/// The catalog as editor styles (for documents without a style part and
/// for the style gallery when a document lacks a built-in style).
pub fn catalog_json() -> Vec<Value> {
    let xml = format!(
        "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">{}</w:styles>",
        CATALOG.iter().map(|s| s.xml()).collect::<String>()
    );
    read_styles(xml.as_bytes())["styles"].as_array().cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_styles_parse() {
        let xml = default_styles_xml();
        let parsed = read_styles(xml.as_bytes());
        let styles = parsed["styles"].as_array().unwrap();
        let h1 = styles.iter().find(|s| s["id"] == "Heading1").unwrap();
        assert_eq!(h1["name"], "heading 1");
        assert_eq!(h1["pPr"]["keepNext"], true);
        assert!(parsed["defaults"]["rPr"].as_array().unwrap().iter().any(|m| m["type"] == "size"));
        let used: BTreeSet<String> = ["Heading4".to_string(), "Normal".to_string()].into();
        let out = add_missing_styles(xml.as_bytes(), &used).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("w:styleId=\"Heading4\""));
        assert!(text.ends_with("</w:styles>"));
        assert!(add_missing_styles(text.as_bytes(), &used).is_none());
    }

    #[test]
    fn catalog_parses() {
        let all = catalog_json();
        assert_eq!(all.len(), CATALOG.len(), "every built-in style parses");
        let grid4 = all.iter().find(|s| s["id"] == "GridTable4-Accent1").unwrap();
        assert_eq!(grid4["type"], "table");
        assert!(grid4["conditional"]["firstRow"]["tcPr"]["shd"].is_object());
        assert!(grid4["tblPr"]["tblBorders"]["insideH"].is_object());
        let used: BTreeSet<String> = ["GridTable4-Accent1".to_string(), "CommentText".to_string()].into();
        let out = String::from_utf8(add_missing_styles(default_styles_xml().as_bytes(), &used).unwrap()).unwrap();
        assert!(out.contains("w:styleId=\"GridTable4-Accent1\"") && out.contains("w:styleId=\"CommentText\""));
        assert!(crate::docx::xml::parse(&out).is_ok());
    }
}
