//! Lists (`numbering.xml`).
//!
//! The editor gets every list definition to number paragraphs the way Word
//! does. Lists created in the editor come back as new definitions, which
//! are added to the document's numbering part (existing ones are kept as
//! they are).

use serde_json::{json, Map, Value};

use super::{
    props::{ppr_attrs, ppr_inner, rpr_inner, rpr_marks},
    xml::{decode, esc, is_w, parse, wattr, wchild},
};

fn level(src: &str, lvl: roxmltree::Node) -> Value {
    let val = |name: &str| wchild(lvl, name).and_then(|n| wattr(n, "val")).map(|s| s.to_string());
    let mut v = json!({
        "ilvl": wattr(lvl, "ilvl").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
        "start": val("start").and_then(|s| s.parse::<i64>().ok()),
        "numFmt": val("numFmt"),
        "lvlText": val("lvlText"),
        "lvlJc": val("lvlJc"),
        "suff": val("suff"),
        "lvlRestart": val("lvlRestart").and_then(|s| s.parse::<i64>().ok()),
        "isLgl": wchild(lvl, "isLgl").is_some(),
        "pStyle": val("pStyle"),
    });
    if let Some(ppr) = wchild(lvl, "pPr") {
        v["pPr"] = Value::Object(ppr_attrs(src, ppr));
    }
    if let Some(rpr) = wchild(lvl, "rPr") {
        v["rPr"] = Value::Array(rpr_marks(src, rpr));
    }
    v
}

/// Parses `numbering.xml` → `{ abstracts: {id: {levels}}, nums: {id: {abstract, overrides}} }`.
pub fn read_numbering(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({ "abstracts": {}, "nums": {} }) };
    let root = doc.root_element();
    let mut abstracts = Map::new();
    for a in root.children().filter(|c| is_w(*c, "abstractNum")) {
        let Some(id) = wattr(a, "abstractNumId") else { continue };
        let levels: Vec<Value> = a.children().filter(|c| is_w(*c, "lvl")).map(|l| level(&text, l)).collect();
        abstracts.insert(
            id.to_string(),
            json!({
                "levels": levels,
                "multi": wchild(a, "multiLevelType").and_then(|n| wattr(n, "val")),
                "numStyleLink": wchild(a, "numStyleLink").and_then(|n| wattr(n, "val")),
                "styleLink": wchild(a, "styleLink").and_then(|n| wattr(n, "val")),
            }),
        );
    }
    let mut nums = Map::new();
    for n in root.children().filter(|c| is_w(*c, "num")) {
        let Some(id) = wattr(n, "numId") else { continue };
        let abs = wchild(n, "abstractNumId").and_then(|a| wattr(a, "val")).unwrap_or("0");
        let mut overrides = Map::new();
        for o in n.children().filter(|c| is_w(*c, "lvlOverride")) {
            let ilvl = wattr(o, "ilvl").unwrap_or("0").to_string();
            let start = wchild(o, "startOverride").and_then(|s| wattr(s, "val")).and_then(|v| v.parse::<i64>().ok());
            let lvl = wchild(o, "lvl").map(|l| level(&text, l));
            overrides.insert(ilvl, json!({ "start": start, "level": lvl }));
        }
        nums.insert(id.to_string(), json!({ "abstract": abs, "overrides": overrides }));
    }
    json!({ "abstracts": abstracts, "nums": nums })
}

fn level_xml(l: &Value) -> String {
    let ilvl = l.get("ilvl").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut s = format!("<w:lvl w:ilvl=\"{ilvl}\">");
    if let Some(start) = l.get("start").and_then(|v| v.as_i64()) {
        s.push_str(&format!("<w:start w:val=\"{start}\"/>"));
    }
    if let Some(f) = l.get("numFmt").and_then(|v| v.as_str()) {
        s.push_str(&format!("<w:numFmt w:val=\"{}\"/>", esc(f)));
    }
    if let Some(r) = l.get("lvlRestart").and_then(|v| v.as_i64()) {
        s.push_str(&format!("<w:lvlRestart w:val=\"{r}\"/>"));
    }
    if let Some(p) = l.get("pStyle").and_then(|v| v.as_str()) {
        s.push_str(&format!("<w:pStyle w:val=\"{}\"/>", esc(p)));
    }
    if l.get("isLgl").and_then(|v| v.as_bool()).unwrap_or(false) {
        s.push_str("<w:isLgl/>");
    }
    if let Some(x) = l.get("suff").and_then(|v| v.as_str()) {
        s.push_str(&format!("<w:suff w:val=\"{}\"/>", esc(x)));
    }
    if let Some(t) = l.get("lvlText").and_then(|v| v.as_str()) {
        s.push_str(&format!("<w:lvlText w:val=\"{}\"/>", esc(t)));
    }
    s.push_str(&format!(
        "<w:lvlJc w:val=\"{}\"/>",
        esc(l.get("lvlJc").and_then(|v| v.as_str()).unwrap_or("left"))
    ));
    if let Some(p) = l.get("pPr") {
        let inner = ppr_inner(p);
        if !inner.is_empty() {
            s.push_str(&format!("<w:pPr>{inner}</w:pPr>"));
        }
    }
    if let Some(r) = l.get("rPr").and_then(|v| v.as_array()) {
        let inner = rpr_inner(r);
        if !inner.is_empty() {
            s.push_str(&format!("<w:rPr>{inner}</w:rPr>"));
        }
    }
    s.push_str("</w:lvl>");
    s
}

/// XML for definitions created in the editor: `(abstractNums, nums)`.
pub fn added_xml(added: &[Value]) -> (String, String) {
    let mut abstracts = String::new();
    let mut nums = String::new();
    for d in added {
        match d.get("kind").and_then(|k| k.as_str()) {
            Some("abstract") => {
                let id = d.get("id").and_then(|v| v.as_str().map(String::from).or_else(|| v.as_i64().map(|n| n.to_string())));
                let Some(id) = id else { continue };
                abstracts.push_str(&format!("<w:abstractNum w:abstractNumId=\"{}\">", esc(&id)));
                if let Some(n) = d.get("nsid").and_then(|v| v.as_str()) {
                    abstracts.push_str(&format!("<w:nsid w:val=\"{}\"/>", esc(n)));
                }
                abstracts.push_str(&format!(
                    "<w:multiLevelType w:val=\"{}\"/>",
                    esc(d.get("multi").and_then(|v| v.as_str()).unwrap_or("hybridMultilevel"))
                ));
                if let Some(levels) = d.get("levels").and_then(|v| v.as_array()) {
                    for l in levels {
                        abstracts.push_str(&level_xml(l));
                    }
                }
                abstracts.push_str("</w:abstractNum>");
            }
            Some("num") => {
                let id = d.get("id").and_then(|v| v.as_str().map(String::from).or_else(|| v.as_i64().map(|n| n.to_string())));
                let abs = d.get("abstract").and_then(|v| v.as_str().map(String::from).or_else(|| v.as_i64().map(|n| n.to_string())));
                let (Some(id), Some(abs)) = (id, abs) else { continue };
                nums.push_str(&format!("<w:num w:numId=\"{}\"><w:abstractNumId w:val=\"{}\"/>", esc(&id), esc(&abs)));
                if let Some(o) = d.get("overrides").and_then(|v| v.as_object()) {
                    for (ilvl, ov) in o {
                        nums.push_str(&format!("<w:lvlOverride w:ilvl=\"{}\">", esc(ilvl)));
                        if let Some(start) = ov.get("start").and_then(|v| v.as_i64()) {
                            nums.push_str(&format!("<w:startOverride w:val=\"{start}\"/>"));
                        }
                        nums.push_str("</w:lvlOverride>");
                    }
                }
                nums.push_str("</w:num>");
            }
            _ => {}
        }
    }
    (abstracts, nums)
}

pub const EMPTY_NUMBERING: &str = concat!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
    "<w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
    "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" ",
    "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"w14\"></w:numbering>"
);

/// The numbering part with the editor's new definitions added. Abstract
/// definitions must come before every `w:num`.
pub fn merge_numbering(original: Option<&[u8]>, added: &[Value]) -> Option<Vec<u8>> {
    if added.is_empty() {
        return None;
    }
    let (abstracts, nums) = added_xml(added);
    let text = original.map(decode).unwrap_or_else(|| EMPTY_NUMBERING.to_string());
    let doc = parse(&text).ok()?;
    let root = doc.root_element();
    let first_num = root.children().find(|c| is_w(*c, "num")).map(|n| n.range().start);
    let last_num_end = root.children().rfind(|c| is_w(*c, "num")).map(|n| n.range().end);
    let close = text[..root.range().end].rfind("</")?;
    let mut out = String::with_capacity(text.len() + abstracts.len() + nums.len());
    match (first_num, last_num_end) {
        (Some(first), Some(last)) => {
            out.push_str(&text[..first]);
            out.push_str(&abstracts);
            out.push_str(&text[first..last]);
            out.push_str(&nums);
            out.push_str(&text[last..]);
        }
        _ => {
            if text[..root.range().end].trim_end().ends_with("/>") {
                // <w:numbering .../> with no children
                let start_end = root.range().end;
                let head = text[..start_end].trim_end().trim_end_matches("/>");
                out.push_str(head);
                out.push('>');
                out.push_str(&abstracts);
                out.push_str(&nums);
                out.push_str("</w:numbering>");
                out.push_str(&text[start_end..]);
            } else {
                out.push_str(&text[..close]);
                out.push_str(&abstracts);
                out.push_str(&nums);
                out.push_str(&text[close..]);
            }
        }
    }
    Some(out.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn added_lists_go_in_order() {
        let added = vec![
            json!({ "kind": "abstract", "id": "7", "nsid": "1A2B3C4D", "levels": [
                { "ilvl": 0, "start": 1, "numFmt": "decimal", "lvlText": "%1.", "pPr": { "ind": { "left": "720", "hanging": "360" } } }
            ] }),
            json!({ "kind": "num", "id": "9", "abstract": "7" }),
        ];
        let orig = r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#;
        let out = String::from_utf8(merge_numbering(Some(orig.as_bytes()), &added).unwrap()).unwrap();
        let a7 = out.find("w:abstractNumId=\"7\"").unwrap();
        let n1 = out.find("<w:num w:numId=\"1\"").unwrap();
        let n9 = out.find("<w:num w:numId=\"9\"").unwrap();
        assert!(a7 < n1 && n1 < n9);
        let parsed = read_numbering(out.as_bytes());
        assert_eq!(parsed["nums"]["9"]["abstract"], "7");
        assert_eq!(parsed["abstracts"]["7"]["levels"][0]["lvlText"], "%1.");
        // a document without a numbering part gets one
        let fresh = String::from_utf8(merge_numbering(None, &added).unwrap()).unwrap();
        assert!(fresh.contains("<w:abstractNum") && fresh.ends_with("</w:numbering>"));
    }
}
