//! XML helpers shared by the WordprocessingML reader and writer.

use roxmltree::Node;
use serde_json::{Map, Value};

pub const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub const W_STRICT: &str = "http://purl.oclc.org/ooxml/wordprocessingml/main";
pub const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const R_STRICT: &str = "http://purl.oclc.org/ooxml/officeDocument/relationships";
pub const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const WP: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
pub const MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
pub const M: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/// Namespaces a written part may need, by their usual prefix.
pub const KNOWN_NS: &[(&str, &str)] = &[
    ("w", W),
    ("r", R),
    ("wp", WP),
    ("a", A),
    ("pic", "http://schemas.openxmlformats.org/drawingml/2006/picture"),
    ("mc", MC),
    ("m", M),
    ("o", "urn:schemas-microsoft-com:office:office"),
    ("v", "urn:schemas-microsoft-com:vml"),
    ("w10", "urn:schemas-microsoft-com:office:word"),
    ("w14", "http://schemas.microsoft.com/office/word/2010/wordml"),
    ("w15", "http://schemas.microsoft.com/office/word/2012/wordml"),
    ("w16se", "http://schemas.microsoft.com/office/word/2015/wordml/symex"),
    ("w16cid", "http://schemas.microsoft.com/office/word/2016/wordml/cid"),
    ("w16", "http://schemas.microsoft.com/office/word/2018/wordml"),
    ("w16cex", "http://schemas.microsoft.com/office/word/2018/wordml/cex"),
    ("w16sdtdh", "http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"),
    ("wp14", "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"),
    ("wpc", "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"),
    ("wpg", "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"),
    ("wpi", "http://schemas.microsoft.com/office/word/2010/wordprocessingInk"),
    ("wne", "http://schemas.microsoft.com/office/word/2006/wordml"),
    ("wps", "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"),
    ("cx", "http://schemas.microsoft.com/office/drawing/2014/chartex"),
    ("aink", "http://schemas.microsoft.com/office/drawing/2016/ink"),
    ("am3d", "http://schemas.microsoft.com/office/drawing/2017/model3d"),
    ("a14", "http://schemas.microsoft.com/office/drawing/2010/main"),
];

pub fn is_wns(ns: Option<&str>) -> bool {
    matches!(ns, Some(W) | Some(W_STRICT))
}

/// A `w:` element with this local name.
pub fn is_w(node: Node, name: &str) -> bool {
    node.is_element() && node.tag_name().name() == name && is_wns(node.tag_name().namespace())
}

pub fn local<'a>(node: Node<'a, '_>) -> &'a str {
    node.tag_name().name()
}

/// `w:name` attribute (also accepts the Strict namespace and a bare name).
pub fn wattr<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attribute((W, name))
        .or_else(|| node.attribute((W_STRICT, name)))
        .or_else(|| node.attribute(name))
}

/// `r:name` attribute (relationship ids).
pub fn rattr<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attribute((R, name)).or_else(|| node.attribute((R_STRICT, name)))
}

/// First `w:` child element with this local name.
pub fn wchild<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    node.children().find(|c| is_w(*c, name))
}

/// The element exactly as written in the source.
pub fn raw<'a>(src: &'a str, node: Node) -> &'a str {
    &src[node.range()]
}

/// On/off property (`<w:b/>`, `<w:b w:val="0"/>`).
pub fn on_off(node: Node) -> bool {
    !matches!(wattr(node, "val"), Some("0") | Some("false") | Some("off"))
}

/// Every attribute of an element by local name (lossless round trip of
/// simple property elements such as `w:spacing` or `w:ind`).
pub fn attr_map(node: Node) -> Value {
    let mut map = Map::new();
    for a in node.attributes() {
        let key = match a.namespace() {
            None | Some(W) | Some(W_STRICT) => a.name().to_string(),
            Some(ns) => match KNOWN_NS.iter().find(|(_, uri)| *uri == ns) {
                Some((prefix, _)) => format!("{prefix}:{}", a.name()),
                None => continue,
            },
        };
        map.insert(key, Value::String(a.value().to_string()));
    }
    Value::Object(map)
}

/// Writes an attribute map back as `w:` attributes (keys with a prefix,
/// such as "w14:val", keep it).
pub fn attrs_xml(map: &Value) -> String {
    let mut out = String::new();
    if let Some(obj) = map.as_object() {
        for (k, v) in obj {
            let text = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => if *b { "1".into() } else { "0".into() },
                _ => continue,
            };
            if k.contains(':') {
                out.push_str(&format!(" {}=\"{}\"", k, esc(&text)));
            } else {
                out.push_str(&format!(" w:{}=\"{}\"", k, esc(&text)));
            }
        }
    }
    out
}

/// Escapes text for attribute values.
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Characters XML 1.0 can't carry
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

/// Escapes element text.
pub fn esc_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

/// A length in twips. Accepts plain twips and universal measures
/// ("1in", "2.54cm", "72pt", "12mm", "6pc", "1pi").
pub fn twips(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Ok(n) = v.parse::<f64>() {
        return Some(n);
    }
    let units = [("mm", 56.692_913), ("cm", 566.929_13), ("in", 1440.0), ("pt", 20.0), ("pc", 240.0), ("pi", 240.0)];
    for (suffix, factor) in units {
        if let Some(num) = v.strip_suffix(suffix) {
            return num.trim().parse::<f64>().ok().map(|n| n * factor);
        }
    }
    None
}

/// Decodes an XML part (UTF-8 with or without BOM, or UTF-16).
pub fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return strip_decl_encoding(text.into_owned());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return strip_decl_encoding(text.into_owned());
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// A UTF-16 part re-encoded as UTF-8 must not claim to be UTF-16.
fn strip_decl_encoding(text: String) -> String {
    if text.starts_with("<?xml") {
        if let Some(end) = text.find("?>") {
            return format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>{}", &text[end + 2..]);
        }
    }
    text
}

/// Deepest element nesting in an XML text (iterative, so it can't overflow).
pub fn max_depth(text: &str) -> usize {
    let b = text.as_bytes();
    let (mut i, mut depth, mut max) = (0usize, 0usize, 0usize);
    while i < b.len() {
        if b[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &text[i..];
        if rest.starts_with("<!--") {
            i += rest.find("-->").map(|e| e + 3).unwrap_or(rest.len());
        } else if rest.starts_with("<![CDATA[") {
            i += rest.find("]]>").map(|e| e + 3).unwrap_or(rest.len());
        } else if rest.starts_with("<?") || rest.starts_with("<!") {
            i += rest.find('>').map(|e| e + 1).unwrap_or(rest.len());
        } else if rest.starts_with("</") {
            depth = depth.saturating_sub(1);
            i += rest.find('>').map(|e| e + 1).unwrap_or(rest.len());
        } else {
            // a start tag: find its end outside quoted attribute values
            let mut j = i + 1;
            let mut quote = 0u8;
            while j < b.len() {
                let c = b[j];
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'>' {
                    break;
                }
                j += 1;
            }
            if j > 0 && b.get(j - 1) != Some(&b'/') {
                depth += 1;
                max = max.max(depth);
            }
            i = j + 1;
        }
    }
    max
}

/// Deeper XML than this is refused: real documents stay far below it, and
/// parsing deeper input could exhaust the stack.
pub const MAX_XML_DEPTH: usize = 600;

pub fn parse(text: &str) -> Result<roxmltree::Document<'_>, String> {
    if max_depth(text) > MAX_XML_DEPTH {
        return Err("This document is nested too deeply to open safely.".into());
    }
    roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() },
    )
    .map_err(|e| format!("The file is damaged ({e})."))
}

/// A raw element remembered by name, so writers can put it back in schema order.
pub fn raw_item(src: &str, node: Node) -> Value {
    serde_json::json!({
        "n": local(node),
        "w": is_wns(node.tag_name().namespace()),
        "x": raw(src, node),
    })
}

/// Sorts `(name, is_w, xml)` children into the order a schema sequence
/// requires: known names by position, then other `w:` elements, then
/// extensions, with the change-tracking element (`*PrChange`) last.
pub fn ordered(mut items: Vec<(String, bool, String)>, order: &[&str]) -> String {
    let key = |name: &str, w: bool| -> (u8, usize) {
        if w && name.ends_with("PrChange") {
            return (3, 0);
        }
        match (w, order.iter().position(|n| *n == name)) {
            (true, Some(i)) => (0, i),
            (true, None) => (1, 0),
            (false, _) => (2, 0),
        }
    };
    items.sort_by_key(|(n, w, _)| key(n, *w));
    let mut out = String::new();
    for (_, _, x) in items {
        out.push_str(&x);
    }
    out
}

/// Raw items stored in JSON (`[{n, w, x}]`).
pub fn items_from_json(v: Option<&Value>) -> Vec<(String, bool, String)> {
    v.and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    Some((
                        it.get("n")?.as_str()?.to_string(),
                        it.get("w").and_then(|w| w.as_bool()).unwrap_or(true),
                        it.get("x")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub const RPR_ORDER: &[&str] = &[
    "ins", "del", "moveFrom", "moveTo", "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike",
    "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
    "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang",
    "eastAsianLayout", "specVanish", "oMath",
];

pub const PPR_ORDER: &[&str] = &[
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr",
    "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
    "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr",
    "sectPr",
];

pub const TBLPR_ORDER: &[&str] = &[
    "tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc",
    "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription",
];

pub const TRPR_ORDER: &[&str] = &[
    "cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter", "cantSplit", "trHeight", "tblHeader",
    "tblCellSpacing", "jc", "hidden", "ins", "del",
];

pub const TCPR_ORDER: &[&str] = &[
    "cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText",
    "vAlign", "hideMark", "headers", "cellIns", "cellDel", "cellMerge",
];

pub const SECTPR_ORDER: &[&str] = &[
    "headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders",
    "lnNumType", "pgNumType", "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter",
    "docGrid", "printerSettings",
];

/// Border sides in schema order for `w:pBdr`, `w:tblBorders` and `w:tcBorders`.
pub const PBDR_ORDER: &[&str] = &["top", "left", "bottom", "right", "between", "bar"];
pub const TBL_BORDER_ORDER: &[&str] = &["top", "left", "start", "bottom", "right", "end", "insideH", "insideV"];
pub const TC_BORDER_ORDER: &[&str] =
    &["top", "left", "start", "bottom", "right", "end", "insideH", "insideV", "tl2br", "tr2bl"];

/// Namespace prefixes used by element and attribute names in `xml`.
pub fn used_prefixes(xml: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    let bytes = xml.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        // element names follow '<' or '</'; attribute names follow whitespace
        let start = if c == b'<' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'/' { i + 2 } else { i + 1 }
        } else if c == b' ' || c == b'\n' || c == b'\t' {
            i + 1
        } else {
            i += 1;
            continue;
        };
        let mut j = start;
        while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-') {
            j += 1;
        }
        if j > start && j < bytes.len() && bytes[j] == b':' {
            let prefix = &xml[start..j];
            if prefix != "xmlns" && prefix != "xml" && prefix.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
                out.insert(prefix.to_string());
            }
        }
        i = j.max(i + 1);
    }
    out
}

/// Adds `xmlns:` declarations for known prefixes that `body` uses but the
/// root start tag doesn't declare (content copied between parts).
pub fn ensure_namespaces(root_start: &str, body: &str) -> String {
    let used = used_prefixes(body);
    let mut extra = String::new();
    for prefix in used {
        let decl = format!("xmlns:{prefix}=");
        if root_start.contains(&decl) {
            continue;
        }
        if let Some((_, uri)) = KNOWN_NS.iter().find(|(p, _)| *p == prefix) {
            extra.push_str(&format!(" xmlns:{prefix}=\"{uri}\""));
        }
    }
    if extra.is_empty() {
        return root_start.to_string();
    }
    let trimmed = root_start.trim_end();
    let (head, close) = if let Some(h) = trimmed.strip_suffix("/>") { (h, "/>") } else { (trimmed.strip_suffix('>').unwrap_or(trimmed), ">") };
    format!("{head}{extra}{close}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_and_order() {
        let p = used_prefixes(r#"<w:p w14:paraId="1"><w:r><wps:wsp/></w:r></w:p>"#);
        assert!(p.contains("w") && p.contains("w14") && p.contains("wps"));
        let root = r#"<w:document xmlns:w="x">"#;
        let fixed = ensure_namespaces(root, "<w14:x/>");
        assert!(fixed.contains("xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\""));
        assert!(fixed.ends_with('>'));
        let xml = ordered(
            vec![
                ("jc".into(), true, "<jc/>".into()),
                ("pStyle".into(), true, "<pStyle/>".into()),
                ("pPrChange".into(), true, "<chg/>".into()),
                ("x".into(), false, "<ext/>".into()),
                ("spacing".into(), true, "<sp/>".into()),
            ],
            PPR_ORDER,
        );
        assert_eq!(xml, "<pStyle/><sp/><jc/><ext/><chg/>");
        assert_eq!(twips("1in"), Some(1440.0));
        assert_eq!(max_depth("<a><b x='>'><c/></b><!-- <d> --><e></e></a>"), 2);
        assert_eq!(twips("720"), Some(720.0));
    }
}
