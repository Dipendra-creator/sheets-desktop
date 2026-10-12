//! Theme, settings, notes, comments and document properties.

use serde_json::{json, Map, Value};

use super::{
    read::plain_text,
    xml::{decode, esc, esc_text, is_w, parse, raw, wattr, wchild, A},
};

/// Theme fonts and colours (`theme1.xml`).
pub fn read_theme(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({}) };
    let find = |name: &str| doc.descendants().find(|n| n.is_element() && n.tag_name().namespace() == Some(A) && n.tag_name().name() == name);
    let latin = |name: &str| {
        find(name)
            .and_then(|f| f.children().find(|c| c.is_element() && c.tag_name().name() == "latin"))
            .and_then(|l| l.attribute("typeface"))
            .map(|s| s.to_string())
    };
    let mut colors = Map::new();
    if let Some(scheme) = find("clrScheme") {
        for c in scheme.children().filter(|c| c.is_element()) {
            let value = c.children().find(|x| x.is_element()).and_then(|x| match x.tag_name().name() {
                "srgbClr" => x.attribute("val").map(|s| s.to_string()),
                "sysClr" => x.attribute("lastClr").map(|s| s.to_string()),
                _ => None,
            });
            if let Some(v) = value {
                colors.insert(c.tag_name().name().to_string(), json!(v));
            }
        }
    }
    json!({ "fonts": { "major": latin("majorFont"), "minor": latin("minorFont") }, "colors": colors })
}

/// Settings the editor needs (`settings.xml`).
pub fn read_settings(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({}) };
    let root = doc.root_element();
    let tab = wchild(root, "defaultTabStop").and_then(|n| wattr(n, "val")).and_then(|v| v.parse::<i64>().ok());
    let compat = root
        .descendants()
        .find(|n| is_w(*n, "compatSetting") && wattr(*n, "name") == Some("compatibilityMode"))
        .and_then(|n| wattr(n, "val"))
        .and_then(|v| v.parse::<i64>().ok());
    json!({
        "defaultTabStop": tab.unwrap_or(720),
        "evenAndOddHeaders": wchild(root, "evenAndOddHeaders").map(|n| wattr(n, "val") != Some("0")).unwrap_or(false),
        "mirrorMargins": wchild(root, "mirrorMargins").is_some(),
        "compatibilityMode": compat,
    })
}

/// Footnote / endnote texts by id (shown when hovering the reference).
pub fn read_notes(bytes: &[u8], element: &str) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({}) };
    let mut map = Map::new();
    for n in doc.root_element().children().filter(|c| is_w(*c, element)) {
        if matches!(wattr(n, "type"), Some("separator") | Some("continuationSeparator") | Some("continuationNotice")) {
            continue;
        }
        if let Some(id) = wattr(n, "id") {
            map.insert(id.to_string(), json!(plain_text(n)));
        }
    }
    Value::Object(map)
}

/// Comments by id: author, initials, date and text.
pub fn read_comments(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({}) };
    let mut map = Map::new();
    for c in doc.root_element().children().filter(|c| is_w(*c, "comment")) {
        if let Some(id) = wattr(c, "id") {
            map.insert(
                id.to_string(),
                json!({
                    "author": wattr(c, "author"),
                    "initials": wattr(c, "initials"),
                    "date": wattr(c, "date"),
                    "text": plain_text(c),
                }),
            );
        }
    }
    Value::Object(map)
}

/// Core properties (`docProps/core.xml`): title, author, dates…
pub fn read_core(bytes: &[u8]) -> Value {
    let text = decode(bytes);
    let Ok(doc) = parse(&text) else { return json!({}) };
    let mut map = Map::new();
    for c in doc.root_element().children().filter(|c| c.is_element()) {
        map.insert(c.tag_name().name().to_string(), json!(c.text().unwrap_or("").trim()));
    }
    Value::Object(map)
}

const CORE_NS: &[(&str, &str)] = &[
    ("cp", "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"),
    ("dc", "http://purl.org/dc/elements/1.1/"),
    ("dcterms", "http://purl.org/dc/terms/"),
    ("dcmitype", "http://purl.org/dc/dcmitype/"),
    ("xsi", "http://www.w3.org/2001/XMLSchema-instance"),
];

fn prefix_for(name: &str) -> &'static str {
    match name {
        "title" | "subject" | "creator" | "description" | "language" | "identifier" => "dc",
        "created" | "modified" => "dcterms",
        _ => "cp",
    }
}

/// A new `core.xml`: the existing properties with `updates` applied
/// (`created`/`modified` are W3C dates).
pub fn write_core(original: Option<&[u8]>, updates: &[(&str, String)]) -> String {
    let mut props: Vec<(String, String)> = Vec::new();
    if let Some(bytes) = original {
        let text = decode(bytes);
        if let Ok(doc) = parse(&text) {
            for c in doc.root_element().children().filter(|c| c.is_element()) {
                props.push((c.tag_name().name().to_string(), c.text().unwrap_or("").to_string()));
            }
        }
    }
    for (k, v) in updates {
        match props.iter_mut().find(|(n, _)| n == k) {
            Some(p) => p.1 = v.clone(),
            None => props.push((k.to_string(), v.clone())),
        }
    }
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<cp:coreProperties");
    for (p, uri) in CORE_NS {
        out.push_str(&format!(" xmlns:{p}=\"{uri}\""));
    }
    out.push('>');
    for (k, v) in props {
        let p = prefix_for(&k);
        if p == "dcterms" {
            out.push_str(&format!("<dcterms:{k} xsi:type=\"dcterms:W3CDTF\">{}</dcterms:{k}>", esc_text(&v)));
        } else {
            out.push_str(&format!("<{p}:{k}>{}</{p}:{k}>", esc_text(&v)));
        }
    }
    out.push_str("</cp:coreProperties>");
    out
}

/// `docProps/app.xml` with fresh statistics.
pub fn write_app(stats: &Value) -> String {
    let n = |k: &str| stats.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" ",
            "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">",
            "<Template>Normal.dotm</Template><TotalTime>0</TotalTime><Pages>{}</Pages><Words>{}</Words>",
            "<Characters>{}</Characters><Application>{}</Application><DocSecurity>0</DocSecurity>",
            "<Lines>{}</Lines><Paragraphs>{}</Paragraphs><ScaleCrop>false</ScaleCrop>",
            "<LinksUpToDate>false</LinksUpToDate><CharactersWithSpaces>{}</CharactersWithSpaces>",
            "<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>"
        ),
        n("pages").max(1),
        n("words"),
        n("chars"),
        esc("Docs"),
        n("lines").max(1),
        n("paragraphs").max(1),
        n("charsWithSpaces"),
    )
}

/// `docProps/app.xml` with only the statistics updated: everything else
/// (company, manager, template, custom titles…) stays as it was.
pub fn update_app(original: &[u8], stats: &Value) -> String {
    let text = decode(original);
    let Ok(doc) = parse(&text) else { return write_app(stats) };
    let n = |k: &str| stats.get(k).and_then(|v| v.as_i64());
    let wanted: Vec<(&str, Option<i64>)> = vec![
        ("Pages", n("pages").map(|v| v.max(1))),
        ("Words", n("words")),
        ("Characters", n("chars")),
        ("Lines", n("lines").map(|v| v.max(1))),
        ("Paragraphs", n("paragraphs").map(|v| v.max(1))),
        ("CharactersWithSpaces", n("charsWithSpaces")),
    ];
    let root = doc.root_element();
    // (byte range of the element, replacement) in document order
    let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
    let mut missing = String::new();
    for (name, value) in &wanted {
        let Some(v) = value else { continue };
        match root.children().find(|c| c.is_element() && c.tag_name().name() == *name) {
            Some(el) => {
                let start = text[el.range()].find('>').map(|i| el.range().start + i + 1);
                let end = text[..el.range().end].rfind("</");
                match (start, end) {
                    (Some(s), Some(e)) if s <= e => edits.push((s..e, v.to_string())),
                    _ => edits.push((el.range(), format!("<{name}>{v}</{name}>"))),
                }
            }
            None => missing.push_str(&format!("<{name}>{v}</{name}>")),
        }
    }
    if !missing.is_empty() {
        if let Some(close) = text[..root.range().end].rfind("</") {
            edits.push((close..close, missing));
        }
    }
    edits.sort_by_key(|(r, _)| r.start);
    let mut out = String::with_capacity(text.len() + 64);
    let mut pos = 0;
    for (range, repl) in edits {
        if range.start < pos {
            continue;
        }
        out.push_str(&text[pos..range.start]);
        out.push_str(&repl);
        pos = range.end;
    }
    out.push_str(&text[pos..]);
    out
}

/// The current time as a W3C date (UTC, seconds).
pub fn w3c_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // civil_from_days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// The body's last `w:sectPr` (page setup of the final section), raw.
pub fn body_sect_raw<'a>(src: &'a str, body: roxmltree::Node) -> Option<&'a str> {
    body.children().rfind(|c| is_w(*c, "sectPr")).map(|n| raw(src, n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_properties_keep_and_update() {
        let orig = r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plan</dc:title><dc:creator>Ann</dc:creator></cp:coreProperties>"#;
        let out = write_core(Some(orig.as_bytes()), &[("lastModifiedBy", "Bob".into()), ("modified", "2026-01-02T03:04:05Z".into())]);
        assert!(out.contains("<dc:title>Plan</dc:title>"));
        assert!(out.contains("<cp:lastModifiedBy>Bob</cp:lastModifiedBy>"));
        assert!(out.contains("<dcterms:modified xsi:type=\"dcterms:W3CDTF\">2026-01-02T03:04:05Z</dcterms:modified>"));
        let parsed = read_core(out.as_bytes());
        assert_eq!(parsed["creator"], "Ann");
        assert!(w3c_now().ends_with('Z'));
        let app = r#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>BB</Company><Words>1</Words></Properties>"#;
        let updated = update_app(app.as_bytes(), &json!({ "words": 42, "pages": 3 }));
        assert!(updated.contains("<Company>BB</Company>"));
        assert!(updated.contains("<Words>42</Words>"));
        assert!(updated.contains("<Pages>3</Pages></Properties>"));
    }
}
