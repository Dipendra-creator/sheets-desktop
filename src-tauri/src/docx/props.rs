//! Paragraph, run, table, row and cell properties ⇄ editor attributes.
//!
//! Every property element is either *modelled* (turned into an attribute
//! the editor understands, written back from that attribute) or kept *raw*
//! (stored verbatim in an `extra` list and written back unchanged, in
//! schema order). Simple elements keep all their attributes as a map, so
//! nothing is lost when they come back.

use roxmltree::Node;
use serde_json::{json, Map, Value};

use super::xml::{
    attr_map, attrs_xml, esc, is_wns, items_from_json, local, on_off, ordered, raw, raw_item, wattr, PBDR_ORDER, PPR_ORDER,
    RPR_ORDER, TBLPR_ORDER, TBL_BORDER_ORDER, TCPR_ORDER, TC_BORDER_ORDER, TRPR_ORDER,
};

fn mark(kind: &str, attrs: Value) -> Value {
    json!({ "type": kind, "attrs": attrs })
}

fn sides(node: Node) -> Value {
    let mut map = Map::new();
    for c in node.children().filter(|c| c.is_element() && is_wns(c.tag_name().namespace())) {
        map.insert(local(c).to_string(), attr_map(c));
    }
    Value::Object(map)
}

fn sides_xml(tag: &str, v: &Value, order: &[&str]) -> String {
    let Some(obj) = v.as_object() else { return String::new() };
    if obj.is_empty() {
        return String::new();
    }
    let items = obj
        .iter()
        .map(|(side, attrs)| (side.clone(), true, format!("<w:{side}{}/>", attrs_xml(attrs))))
        .collect();
    format!("<w:{tag}>{}</w:{tag}>", ordered(items, order))
}

// ----------------------------------------------------------------------
// Runs
// ----------------------------------------------------------------------

/// `w:rPr` → editor marks.
pub fn rpr_marks(src: &str, rpr: Node) -> Vec<Value> {
    let mut marks = Vec::new();
    let mut extra = Vec::new();
    let mut size: Option<(Option<String>, Option<String>)> = None;
    for c in rpr.children().filter(|c| c.is_element()) {
        if !is_wns(c.tag_name().namespace()) {
            extra.push(raw_item(src, c));
            continue;
        }
        let val = || wattr(c, "val").map(|s| s.to_string());
        match local(c) {
            "rStyle" => marks.push(mark("cstyle", json!({ "id": val() }))),
            "rFonts" => marks.push(mark("font", attr_map(c))),
            "b" => marks.push(mark("bold", json!({ "on": on_off(c) }))),
            "i" => marks.push(mark("italic", json!({ "on": on_off(c) }))),
            "caps" => marks.push(mark("caps", json!({ "on": on_off(c) }))),
            "smallCaps" => marks.push(mark("smallCaps", json!({ "on": on_off(c) }))),
            "strike" => marks.push(mark("strike", json!({ "on": on_off(c) }))),
            "dstrike" => marks.push(mark("dstrike", json!({ "on": on_off(c) }))),
            "vanish" => marks.push(mark("hidden", json!({ "on": on_off(c) }))),
            "color" => marks.push(mark("color", attr_map(c))),
            "spacing" => marks.push(mark("charSpacing", json!({ "val": val() }))),
            "sz" => size.get_or_insert((None, None)).0 = val(),
            "szCs" => size.get_or_insert((None, None)).1 = val(),
            "highlight" => marks.push(mark("highlight", json!({ "val": val() }))),
            "u" => marks.push(mark("underline", attr_map(c))),
            "shd" => marks.push(mark("shading", attr_map(c))),
            "vertAlign" => marks.push(mark("vert", json!({ "val": val() }))),
            _ => extra.push(raw_item(src, c)),
        }
    }
    if let Some((val, cs)) = size {
        marks.push(mark("size", json!({ "val": val, "cs": cs })));
    }
    if !extra.is_empty() {
        marks.push(mark("rextra", json!({ "items": extra })));
    }
    marks
}

fn on_xml(tag: &str, attrs: &Value) -> String {
    match attrs.get("on").and_then(|v| v.as_bool()) {
        Some(false) => format!("<w:{tag} w:val=\"0\"/>"),
        _ => format!("<w:{tag}/>"),
    }
}

fn val_xml(tag: &str, attrs: &Value) -> Option<String> {
    let v = attrs.get("val")?.as_str()?;
    Some(format!("<w:{tag} w:val=\"{}\"/>", esc(v)))
}

/// The inner XML of a `w:rPr` for these marks (empty when none apply).
/// Marks that aren't run properties (links, tracked changes) are ignored.
pub fn rpr_inner(marks: &[Value]) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    let mut extras = Vec::new();
    for m in marks {
        let kind = m.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let a = m.get("attrs").cloned().unwrap_or(Value::Null);
        let mut push = |name: &str, xml: String| items.push((name.to_string(), true, xml));
        match kind {
            "cstyle" => {
                if let Some(x) = a.get("id").and_then(|v| v.as_str()) {
                    push("rStyle", format!("<w:rStyle w:val=\"{}\"/>", esc(x)));
                }
            }
            "font" => push("rFonts", format!("<w:rFonts{}/>", attrs_xml(&non_null(&a)))),
            "bold" => push("b", on_xml("b", &a)),
            "italic" => push("i", on_xml("i", &a)),
            "caps" => push("caps", on_xml("caps", &a)),
            "smallCaps" => push("smallCaps", on_xml("smallCaps", &a)),
            "strike" => push("strike", on_xml("strike", &a)),
            "dstrike" => push("dstrike", on_xml("dstrike", &a)),
            "hidden" => push("vanish", on_xml("vanish", &a)),
            "color" => push("color", format!("<w:color{}/>", attrs_xml(&non_null(&a)))),
            "charSpacing" => {
                if let Some(x) = val_xml("spacing", &a) {
                    push("spacing", x);
                }
            }
            "size" => {
                if let Some(x) = val_xml("sz", &a) {
                    push("sz", x);
                }
                if let Some(cs) = a.get("cs").and_then(|v| v.as_str()) {
                    push("szCs", format!("<w:szCs w:val=\"{}\"/>", esc(cs)));
                }
            }
            "highlight" => {
                if let Some(x) = val_xml("highlight", &a) {
                    push("highlight", x);
                }
            }
            "underline" => push("u", format!("<w:u{}/>", attrs_xml(&non_null(&a)))),
            "shading" => push("shd", format!("<w:shd{}/>", attrs_xml(&non_null(&a)))),
            "vert" => {
                if let Some(x) = val_xml("vertAlign", &a) {
                    push("vertAlign", x);
                }
            }
            "rextra" => extras = items_from_json(a.get("items")),
            _ => {}
        }
    }
    // A modelled property wins over a raw copy of the same element
    for (n, w, x) in extras {
        if !(w && items.iter().any(|(m, _, _)| *m == n)) {
            items.push((n, w, x));
        }
    }
    ordered(items, RPR_ORDER)
}

pub fn rpr_xml(marks: &[Value]) -> String {
    let inner = rpr_inner(marks);
    if inner.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{inner}</w:rPr>")
    }
}

/// Drops null entries from an attribute map.
fn non_null(v: &Value) -> Value {
    match v.as_object() {
        Some(obj) => Value::Object(obj.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect()),
        None => Value::Object(Map::new()),
    }
}

// ----------------------------------------------------------------------
// Paragraphs
// ----------------------------------------------------------------------

/// `w:pPr` → paragraph attributes.
pub fn ppr_attrs(src: &str, ppr: Node) -> Map<String, Value> {
    let mut a = Map::new();
    let mut extra = Vec::new();
    for c in ppr.children().filter(|c| c.is_element()) {
        if !is_wns(c.tag_name().namespace()) {
            extra.push(raw_item(src, c));
            continue;
        }
        let name = local(c);
        match name {
            "pStyle" => {
                a.insert("style".into(), json!(wattr(c, "val")));
            }
            "keepNext" | "keepLines" | "pageBreakBefore" | "widowControl" | "contextualSpacing" | "bidi" => {
                a.insert(name.into(), json!(on_off(c)));
            }
            "numPr" => {
                let child = |n: &str| {
                    c.children()
                        .find(|x| x.is_element() && local(*x) == n)
                        .and_then(|x| wattr(x, "val"))
                        .and_then(|v| v.parse::<i64>().ok())
                };
                a.insert("numPr".into(), json!({ "numId": child("numId"), "ilvl": child("ilvl") }));
            }
            "pBdr" => {
                a.insert("pBdr".into(), sides(c));
            }
            "shd" | "spacing" | "ind" => {
                a.insert(name.into(), attr_map(c));
            }
            "tabs" => {
                let tabs: Vec<Value> = c.children().filter(|t| t.is_element()).map(attr_map).collect();
                a.insert("tabs".into(), Value::Array(tabs));
            }
            "jc" => {
                a.insert("jc".into(), json!(wattr(c, "val")));
            }
            "outlineLvl" => {
                a.insert("outlineLvl".into(), json!(wattr(c, "val").and_then(|v| v.parse::<i64>().ok())));
            }
            "rPr" => {
                let marks = rpr_marks(src, c);
                if !marks.is_empty() {
                    a.insert("pm".into(), Value::Array(marks));
                }
            }
            "sectPr" => {
                a.insert("sect".into(), json!(raw(src, c)));
            }
            _ => extra.push(raw_item(src, c)),
        }
    }
    if !extra.is_empty() {
        a.insert("extra".into(), Value::Array(extra));
    }
    a
}

fn bool_attr(a: &Value, key: &str) -> Option<bool> {
    a.get(key).and_then(|v| v.as_bool())
}

/// The inner XML of a `w:pPr` for paragraph attributes.
pub fn ppr_inner(a: &Value) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    let mut push = |name: &str, xml: String| items.push((name.to_string(), true, xml));
    if let Some(s) = a.get("style").and_then(|v| v.as_str()) {
        push("pStyle", format!("<w:pStyle w:val=\"{}\"/>", esc(s)));
    }
    for key in ["keepNext", "keepLines", "pageBreakBefore", "widowControl", "contextualSpacing", "bidi"] {
        match bool_attr(a, key) {
            Some(true) => push(key, format!("<w:{key}/>")),
            Some(false) => push(key, format!("<w:{key} w:val=\"0\"/>")),
            None => {}
        }
    }
    if let Some(n) = a.get("numPr").filter(|v| v.is_object()) {
        let ilvl = n.get("ilvl").and_then(|v| v.as_i64());
        let num = n.get("numId").and_then(|v| v.as_i64());
        let mut x = String::from("<w:numPr>");
        if let Some(l) = ilvl {
            x.push_str(&format!("<w:ilvl w:val=\"{l}\"/>"));
        }
        if let Some(id) = num {
            x.push_str(&format!("<w:numId w:val=\"{id}\"/>"));
        }
        x.push_str("</w:numPr>");
        push("numPr", x);
    }
    if let Some(b) = a.get("pBdr").filter(|v| v.is_object()) {
        let x = sides_xml("pBdr", b, PBDR_ORDER);
        if !x.is_empty() {
            push("pBdr", x);
        }
    }
    for key in ["shd", "spacing", "ind"] {
        if let Some(m) = a.get(key).filter(|v| v.is_object()) {
            push(key, format!("<w:{key}{}/>", attrs_xml(&non_null(m))));
        }
    }
    if let Some(tabs) = a.get("tabs").and_then(|v| v.as_array()) {
        if !tabs.is_empty() {
            let inner: String = tabs.iter().map(|t| format!("<w:tab{}/>", attrs_xml(&non_null(t)))).collect();
            push("tabs", format!("<w:tabs>{inner}</w:tabs>"));
        }
    }
    if let Some(j) = a.get("jc").and_then(|v| v.as_str()) {
        push("jc", format!("<w:jc w:val=\"{}\"/>", esc(j)));
    }
    if let Some(l) = a.get("outlineLvl").and_then(|v| v.as_i64()) {
        push("outlineLvl", format!("<w:outlineLvl w:val=\"{l}\"/>"));
    }
    if let Some(pm) = a.get("pm").and_then(|v| v.as_array()) {
        let inner = rpr_inner(pm);
        if !inner.is_empty() {
            push("rPr", format!("<w:rPr>{inner}</w:rPr>"));
        }
    }
    if let Some(s) = a.get("sect").and_then(|v| v.as_str()) {
        if !s.is_empty() {
            push("sectPr", s.to_string());
        }
    }
    let extras = items_from_json(a.get("extra"));
    for (n, w, x) in extras {
        if !(w && items.iter().any(|(m, _, _)| *m == n)) {
            items.push((n, w, x));
        }
    }
    ordered(items, PPR_ORDER)
}

pub fn ppr_xml(a: &Value) -> String {
    let inner = ppr_inner(a);
    if inner.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{inner}</w:pPr>")
    }
}

// ----------------------------------------------------------------------
// Tables
// ----------------------------------------------------------------------

pub fn tblpr_attrs(src: &str, tblpr: Node) -> Map<String, Value> {
    let mut a = Map::new();
    let mut extra = Vec::new();
    for c in tblpr.children().filter(|c| c.is_element()) {
        if !is_wns(c.tag_name().namespace()) {
            extra.push(raw_item(src, c));
            continue;
        }
        match local(c) {
            "tblStyle" => {
                a.insert("style".into(), json!(wattr(c, "val")));
            }
            "jc" => {
                a.insert("jc".into(), json!(wattr(c, "val")));
            }
            "tblW" | "tblInd" | "shd" | "tblLayout" | "tblLook" => {
                a.insert(local(c).into(), attr_map(c));
            }
            "tblBorders" | "tblCellMar" => {
                a.insert(local(c).into(), sides(c));
            }
            _ => extra.push(raw_item(src, c)),
        }
    }
    if !extra.is_empty() {
        a.insert("extra".into(), Value::Array(extra));
    }
    a
}

pub fn tblpr_xml(a: &Value) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    if let Some(s) = a.get("style").and_then(|v| v.as_str()) {
        items.push(("tblStyle".into(), true, format!("<w:tblStyle w:val=\"{}\"/>", esc(s))));
    }
    if let Some(j) = a.get("jc").and_then(|v| v.as_str()) {
        items.push(("jc".into(), true, format!("<w:jc w:val=\"{}\"/>", esc(j))));
    }
    for key in ["tblW", "tblInd", "shd", "tblLayout", "tblLook"] {
        if let Some(m) = a.get(key).filter(|v| v.is_object()) {
            items.push((key.into(), true, format!("<w:{key}{}/>", attrs_xml(&non_null(m)))));
        }
    }
    if let Some(b) = a.get("tblBorders").filter(|v| v.is_object()) {
        let x = sides_xml("tblBorders", b, TBL_BORDER_ORDER);
        if !x.is_empty() {
            items.push(("tblBorders".into(), true, x));
        }
    }
    if let Some(m) = a.get("tblCellMar").filter(|v| v.is_object()) {
        let x = sides_xml("tblCellMar", m, TBL_BORDER_ORDER);
        if !x.is_empty() {
            items.push(("tblCellMar".into(), true, x));
        }
    }
    for (n, w, x) in items_from_json(a.get("extra")) {
        if !(w && items.iter().any(|(m, _, _)| *m == n)) {
            items.push((n, w, x));
        }
    }
    format!("<w:tblPr>{}</w:tblPr>", ordered(items, TBLPR_ORDER))
}

pub fn trpr_attrs(src: &str, trpr: Node) -> Map<String, Value> {
    let mut a = Map::new();
    let mut extra = Vec::new();
    for c in trpr.children().filter(|c| c.is_element()) {
        if !is_wns(c.tag_name().namespace()) {
            extra.push(raw_item(src, c));
            continue;
        }
        match local(c) {
            "trHeight" => {
                a.insert("trHeight".into(), attr_map(c));
            }
            "tblHeader" => {
                a.insert("header".into(), json!(on_off(c)));
            }
            "cantSplit" => {
                a.insert("cantSplit".into(), json!(on_off(c)));
            }
            _ => extra.push(raw_item(src, c)),
        }
    }
    if !extra.is_empty() {
        a.insert("extra".into(), Value::Array(extra));
    }
    a
}

pub fn trpr_xml(a: &Value) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    if let Some(m) = a.get("trHeight").filter(|v| v.is_object()) {
        items.push(("trHeight".into(), true, format!("<w:trHeight{}/>", attrs_xml(&non_null(m)))));
    }
    if bool_attr(a, "header") == Some(true) {
        items.push(("tblHeader".into(), true, "<w:tblHeader/>".into()));
    }
    if bool_attr(a, "cantSplit") == Some(true) {
        items.push(("cantSplit".into(), true, "<w:cantSplit/>".into()));
    }
    for (n, w, x) in items_from_json(a.get("extra")) {
        if !(w && items.iter().any(|(m, _, _)| *m == n)) {
            items.push((n, w, x));
        }
    }
    if items.is_empty() {
        return String::new();
    }
    format!("<w:trPr>{}</w:trPr>", ordered(items, TRPR_ORDER))
}

/// `w:tcPr` → cell attributes. `gridSpan` and `vMerge` are returned
/// separately: they become colspan / rowspan.
pub fn tcpr_attrs(src: &str, tcpr: Node) -> (Map<String, Value>, usize, Option<String>) {
    let mut a = Map::new();
    let mut extra = Vec::new();
    let mut span = 1;
    let mut vmerge = None;
    for c in tcpr.children().filter(|c| c.is_element()) {
        if !is_wns(c.tag_name().namespace()) {
            extra.push(raw_item(src, c));
            continue;
        }
        match local(c) {
            "gridSpan" => span = wattr(c, "val").and_then(|v| v.parse().ok()).unwrap_or(1).max(1),
            "vMerge" => vmerge = Some(wattr(c, "val").unwrap_or("continue").to_string()),
            "tcW" | "shd" => {
                a.insert(local(c).into(), attr_map(c));
            }
            "vAlign" => {
                a.insert("vAlign".into(), json!(wattr(c, "val")));
            }
            "tcBorders" | "tcMar" => {
                a.insert(local(c).into(), sides(c));
            }
            _ => extra.push(raw_item(src, c)),
        }
    }
    if !extra.is_empty() {
        a.insert("extra".into(), Value::Array(extra));
    }
    (a, span, vmerge)
}

/// `w:tcPr` for a cell; `width` (twips) replaces a stored tcW when the
/// column was resized.
pub fn tcpr_xml(a: &Value, colspan: usize, vmerge: Option<&str>, width: Option<i64>) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    match width {
        Some(w) => items.push(("tcW".into(), true, format!("<w:tcW w:w=\"{w}\" w:type=\"dxa\"/>"))),
        None => {
            if let Some(m) = a.get("tcW").filter(|v| v.is_object()) {
                items.push(("tcW".into(), true, format!("<w:tcW{}/>", attrs_xml(&non_null(m)))));
            }
        }
    }
    if colspan > 1 {
        items.push(("gridSpan".into(), true, format!("<w:gridSpan w:val=\"{colspan}\"/>")));
    }
    match vmerge {
        Some("restart") => items.push(("vMerge".into(), true, "<w:vMerge w:val=\"restart\"/>".into())),
        Some(_) => items.push(("vMerge".into(), true, "<w:vMerge/>".into())),
        None => {}
    }
    if let Some(b) = a.get("tcBorders").filter(|v| v.is_object()) {
        let x = sides_xml("tcBorders", b, TC_BORDER_ORDER);
        if !x.is_empty() {
            items.push(("tcBorders".into(), true, x));
        }
    }
    if let Some(m) = a.get("shd").filter(|v| v.is_object()) {
        items.push(("shd".into(), true, format!("<w:shd{}/>", attrs_xml(&non_null(m)))));
    }
    if let Some(m) = a.get("tcMar").filter(|v| v.is_object()) {
        let x = sides_xml("tcMar", m, TC_BORDER_ORDER);
        if !x.is_empty() {
            items.push(("tcMar".into(), true, x));
        }
    }
    if let Some(v) = a.get("vAlign").and_then(|v| v.as_str()) {
        items.push(("vAlign".into(), true, format!("<w:vAlign w:val=\"{}\"/>", esc(v))));
    }
    for (n, w, x) in items_from_json(a.get("extra")) {
        if !(w && items.iter().any(|(m, _, _)| *m == n)) {
            items.push((n, w, x));
        }
    }
    if items.is_empty() {
        return String::new();
    }
    format!("<w:tcPr>{}</w:tcPr>", ordered(items, TCPR_ORDER))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docx::xml::parse;

    const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml""#;

    #[test]
    fn run_properties_round_trip() {
        let src = format!(
            r#"<w:rPr {NS}><w:rStyle w:val="Strong"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:i w:val="0"/><w:color w:val="FF0000" w:themeColor="accent1"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:u w:val="double"/><w:lang w:val="en-US"/><w14:ligatures w14:val="standard"/></w:rPr>"#
        );
        let doc = parse(&src).unwrap();
        let marks = rpr_marks(&src, doc.root_element());
        let kinds: Vec<&str> = marks.iter().map(|m| m["type"].as_str().unwrap()).collect();
        assert!(kinds.contains(&"bold") && kinds.contains(&"italic") && kinds.contains(&"size") && kinds.contains(&"rextra"));
        let italic = marks.iter().find(|m| m["type"] == "italic").unwrap();
        assert_eq!(italic["attrs"]["on"], false);
        let xml = rpr_inner(&marks);
        assert_eq!(
            xml,
            r#"<w:rStyle w:val="Strong"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:bCs/><w:i w:val="0"/><w:color w:themeColor="accent1" w:val="FF0000"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:u w:val="double"/><w:lang w:val="en-US"/><w14:ligatures w14:val="standard"/>"#
        );
    }

    #[test]
    fn paragraph_properties_round_trip() {
        let src = format!(
            r#"<w:pPr {NS}><w:pStyle w:val="Heading1"/><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:before="240" w:after="0"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/><w:rPr><w:b/></w:rPr><w:snapToGrid w:val="0"/></w:pPr>"#
        );
        let doc = parse(&src).unwrap();
        let attrs = Value::Object(ppr_attrs(&src, doc.root_element()));
        assert_eq!(attrs["style"], "Heading1");
        assert_eq!(attrs["numPr"]["numId"], 3);
        assert_eq!(attrs["ind"]["hanging"], "360");
        let xml = ppr_inner(&attrs);
        assert_eq!(
            xml,
            r#"<w:pStyle w:val="Heading1"/><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr><w:pBdr><w:bottom w:color="auto" w:space="1" w:sz="6" w:val="single"/></w:pBdr><w:tabs><w:tab w:leader="dot" w:pos="9350" w:val="right"/></w:tabs><w:snapToGrid w:val="0"/><w:spacing w:after="0" w:before="240"/><w:ind w:hanging="360" w:left="720"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/><w:rPr><w:b/></w:rPr>"#
        );
    }
}
