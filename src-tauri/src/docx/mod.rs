//! Word documents (.docx): reading into the editor model and writing back.
//!
//! The editor model is ProseMirror JSON (see `read.rs` for the node types).
//! Fidelity rules, so a document survives a round trip:
//!
//! * every part the editor doesn't change (footnotes, comments, custom XML,
//!   fonts, embedded objects, other sections' headers…) is written back
//!   byte for byte;
//! * every property element the editor doesn't understand is kept as raw
//!   XML and put back in schema order;
//! * content the editor can't show (equations, shapes, text boxes, fields'
//!   instructions, bookmarks, content controls) travels in opaque nodes or
//!   wrapper ids and is written back unchanged.

pub mod numbering;
pub mod package;
pub mod parts;
pub mod props;
pub mod read;
pub mod styles;
pub mod text;
pub mod write;
pub mod xml;

#[cfg(test)]
pub(crate) mod tests;

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use package::{
    rels_name, resolve, Package, CT_COMMENTS, CT_CORE, CT_DOCUMENT, CT_ENDNOTES, CT_FOOTER, CT_FOOTNOTES, CT_HEADER, CT_MACRO_DOCUMENT, CT_MACRO_TEMPLATE, CT_NUMBERING,
    CT_STYLES, CT_TEMPLATE, REL_APP, REL_COMMENTS, REL_CORE, REL_ENDNOTES, REL_FOOTER, REL_FOOTNOTES, REL_HEADER, REL_NUMBERING,
    REL_SETTINGS, REL_STYLES, REL_THEME,
};
use read::Ctx;
use write::{sect_xml, DocPrIds, PartWriter};
use xml::{decode, ensure_namespaces, is_w, parse, rattr, wattr, wchild};

/// A header or footer referenced by the final section.
#[derive(Clone, Debug)]
pub struct HfRef {
    /// "header" | "footer"
    pub kind: String,
    /// "default" | "first" | "even"
    pub ty: String,
    pub part: String,
    pub rid: String,
}

/// Everything about an opened document that the editor JSON doesn't carry.
#[derive(Clone, Debug, Default)]
pub struct DocState {
    pub pkg: Package,
    pub main: String,
    /// Start tag of `w:document` (namespace declarations).
    pub root_start: String,
    /// The final section's `w:sectPr`, raw.
    pub body_sect: Option<String>,
    /// Content control properties by id.
    pub sdts: Map<String, Value>,
    pub hf: Vec<HfRef>,
    /// Start tags of header/footer parts.
    pub hf_roots: BTreeMap<String, String>,
    /// Pictures added in the editor (part name → bytes).
    pub media: BTreeMap<String, Vec<u8>>,
    /// The file is a macro-enabled document or a template.
    pub macro_enabled: bool,
    pub template: bool,
}

/// Start tag of an element, as written.
fn start_tag(text: &str, node: roxmltree::Node) -> String {
    let start = node.range().start;
    let bytes = text.as_bytes();
    let mut quote: Option<u8> = None;
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'>' => return text[start..=i].to_string(),
            None => {}
        }
        i += 1;
    }
    text[start..].to_string()
}

fn qname(start: &str) -> String {
    start.trim_start_matches('<').split(|c: char| c.is_whitespace() || c == '>' || c == '/').next().unwrap_or("w:document").to_string()
}

/// Page setup and header/footer references of a raw `w:sectPr`.
fn sect_info(root_start: &str, raw: Option<&str>) -> (Value, bool, Vec<(String, String, String)>) {
    let mut page = json!({});
    let mut title_pg = false;
    let mut refs = Vec::new();
    let Some(raw) = raw else { return (page, title_pg, refs) };
    let wrapped = write::wrap_fragment(root_start, raw);
    let Ok(doc) = roxmltree::Document::parse(&wrapped) else { return (page, title_pg, refs) };
    let Some(sect) = doc.root_element().children().find(|c| c.is_element()) else { return (page, title_pg, refs) };
    for el in sect.children().filter(|c| c.is_element() && xml::is_wns(c.tag_name().namespace())) {
        let name = el.tag_name().name();
        match name {
            "pgSz" | "pgMar" | "cols" | "pgNumType" => page[name] = xml::attr_map(el),
            "titlePg" => title_pg = xml::on_off(el),
            "headerReference" | "footerReference" => {
                let kind = if name == "headerReference" { "header" } else { "footer" };
                if let Some(rid) = rattr(el, "id") {
                    refs.push((kind.to_string(), wattr(el, "type").unwrap_or("default").to_string(), rid.to_string()));
                }
            }
            _ => {}
        }
    }
    (page, title_pg, refs)
}

/// The result of opening a document, for the editor.
pub struct Opened {
    pub state: DocState,
    pub payload: Value,
    pub warnings: Vec<String>,
}

fn part_by_rel(pkg: &Package, main: &str, kind: &str) -> Option<String> {
    pkg.rels_of(main).items.iter().find(|r| r.kind == kind && !r.external).map(|r| resolve(main, &r.target))
}

/// Relationship type, content type and part name of footnotes or endnotes.
fn notes_part_info(kind: &str) -> (&'static str, &'static str, &'static str) {
    if kind == "footnote" {
        (REL_FOOTNOTES, CT_FOOTNOTES, "footnotes.xml")
    } else {
        (REL_ENDNOTES, CT_ENDNOTES, "endnotes.xml")
    }
}

/// Separators and continuation notices: notes Word draws itself.
fn is_special_note(n: roxmltree::Node) -> bool {
    matches!(wattr(n, "type"), Some("separator") | Some("continuationSeparator") | Some("continuationNotice"))
}

/// Footnotes or endnotes by id, as editor documents.
fn read_notes(
    pkg: &Package,
    main: &str,
    kind: &str,
    sdts: &mut Map<String, Value>,
    next_sdt: &mut usize,
    warnings: &mut Vec<String>,
) -> Value {
    let (rel, _, _) = notes_part_info(kind);
    let Some(part) = part_by_rel(pkg, main, rel) else { return json!({}) };
    let Some(text) = pkg.text(&part) else { return json!({}) };
    let Ok(doc) = parse(&text) else {
        warnings.push(format!("The {kind}s couldn't be read and are kept as they are."));
        return json!({});
    };
    let rels = pkg.rels_of(&part);
    let mut map = Map::new();
    for n in doc.root_element().children().filter(|c| is_w(*c, kind) && !is_special_note(*c)) {
        let Some(id) = wattr(n, "id") else { continue };
        let mut content = Vec::new();
        {
            let mut ctx = Ctx::new(&text, &part, &rels, sdts, next_sdt);
            ctx.blocks(n, None, &mut content);
        }
        if content.is_empty() {
            content.push(json!({ "type": "paragraph" }));
        }
        map.insert(id.to_string(), json!({ "type": "doc", "content": content }));
    }
    Value::Object(map)
}

/// Opens a .docx/.docm/.dotx/.dotm package.
pub fn open(bytes: &[u8]) -> Result<Opened, String> {
    let pkg = Package::read(bytes)?;
    let main = pkg.main_part();
    let ct = pkg.content_types();
    let main_type = ct.of(&main).unwrap_or(CT_DOCUMENT).to_string();
    if !(main_type == CT_DOCUMENT || main_type == CT_TEMPLATE || main_type == CT_MACRO_DOCUMENT || main_type == CT_MACRO_TEMPLATE) {
        return Err("This file isn't a Word document.".into());
    }
    let mut warnings = Vec::new();
    let macro_enabled = main_type == CT_MACRO_DOCUMENT || main_type == CT_MACRO_TEMPLATE;
    if macro_enabled {
        warnings.push("This document contains macros. Docs doesn't run them, and saving it as a Word Document (.docx) removes them.".to_string());
    }
    let template = main_type == CT_TEMPLATE || main_type == CT_MACRO_TEMPLATE;

    let doc_text = pkg.text(&main).ok_or("The document is damaged (no main part).")?;
    let xml_doc = parse(&doc_text)?;
    let root = xml_doc.root_element();
    let root_start = start_tag(&doc_text, root);
    let body = wchild(root, "body").ok_or("The document is damaged (no body).")?;
    let rels = pkg.rels_of(&main);
    let mut sdts = Map::new();
    let mut next_sdt = 0usize;
    let mut blocks = Vec::new();
    {
        let mut ctx = Ctx::new(&doc_text, &main, &rels, &mut sdts, &mut next_sdt);
        ctx.blocks(body, None, &mut blocks);
    }
    if blocks.is_empty() {
        blocks.push(json!({ "type": "paragraph" }));
    }
    let body_sect = parts::body_sect_raw(&doc_text, body).map(String::from);
    let (page, title_pg, sect_refs) = sect_info(&root_start, body_sect.as_deref());

    // Headers and footers of the final section
    let mut hf = Vec::new();
    let mut hf_roots = BTreeMap::new();
    let mut headers = Map::new();
    let mut footers = Map::new();
    for (kind, ty, rid) in sect_refs {
        let Some(rel) = rels.get(&rid) else { continue };
        let part = resolve(&main, &rel.target);
        let Some(text) = pkg.text(&part) else { continue };
        let Ok(doc) = parse(&text) else {
            warnings.push(format!("A {kind} couldn't be read and is kept as it is."));
            continue;
        };
        let hroot = doc.root_element();
        let part_rels = pkg.rels_of(&part);
        let mut content = Vec::new();
        {
            let mut ctx = Ctx::new(&text, &part, &part_rels, &mut sdts, &mut next_sdt);
            ctx.blocks(hroot, None, &mut content);
        }
        if content.is_empty() {
            content.push(json!({ "type": "paragraph" }));
        }
        hf_roots.insert(part.clone(), start_tag(&text, hroot));
        let docjson = json!({ "type": "doc", "content": content });
        if kind == "header" {
            headers.insert(ty.clone(), docjson);
        } else {
            footers.insert(ty.clone(), docjson);
        }
        hf.push(HfRef { kind, ty, part, rid });
    }

    // Headers and footers of the other sections, by relationship id
    let mut stories = Map::new();
    let final_rids: BTreeSet<String> = hf.iter().map(|r| r.rid.clone()).collect();
    for block in &blocks {
        let Some(raw) = block.get("attrs").and_then(|a| a.get("sect")).and_then(|v| v.as_str()) else { continue };
        let (_, _, refs) = sect_info(&root_start, Some(raw));
        for (kind, _, rid) in refs {
            if final_rids.contains(&rid) || stories.contains_key(&rid) {
                continue;
            }
            let Some(rel) = rels.get(&rid) else { continue };
            let part = resolve(&main, &rel.target);
            let Some(text) = pkg.text(&part) else { continue };
            let Ok(doc) = parse(&text) else { continue };
            let hroot = doc.root_element();
            let part_rels = pkg.rels_of(&part);
            let mut content = Vec::new();
            {
                let mut ctx = Ctx::new(&text, &part, &part_rels, &mut sdts, &mut next_sdt);
                ctx.blocks(hroot, None, &mut content);
            }
            if content.is_empty() {
                content.push(json!({ "type": "paragraph" }));
            }
            hf_roots.insert(part.clone(), start_tag(&text, hroot));
            stories.insert(rid, json!({ "kind": kind, "content": content }));
        }
    }

    let read_part = |kind: &str| part_by_rel(&pkg, &main, kind).and_then(|p| pkg.get(&p).map(|b| b.to_vec()));
    let mut styles = read_part(REL_STYLES).map(|b| styles::read_styles(&b)).unwrap_or_else(|| json!({ "defaults": {}, "styles": [] }));
    merge_catalog(&mut styles);
    let numbering = read_part(REL_NUMBERING).map(|b| numbering::read_numbering(&b)).unwrap_or_else(|| json!({ "abstracts": {}, "nums": {} }));
    let theme = read_part(REL_THEME).map(|b| parts::read_theme(&b)).unwrap_or_else(|| json!({}));
    let settings = read_part(REL_SETTINGS).map(|b| parts::read_settings(&b)).unwrap_or_else(|| json!({ "defaultTabStop": 720 }));
    let footnotes = read_notes(&pkg, &main, "footnote", &mut sdts, &mut next_sdt, &mut warnings);
    let endnotes = read_notes(&pkg, &main, "endnote", &mut sdts, &mut next_sdt, &mut warnings);
    let comments = read_part(REL_COMMENTS).map(|b| parts::read_comments(&b)).unwrap_or_else(|| json!({}));
    let core = pkg
        .rels_of("")
        .items
        .iter()
        .find(|r| r.kind == REL_CORE)
        .and_then(|r| pkg.get(r.target.trim_start_matches('/')))
        .map(parts::read_core)
        .unwrap_or_else(|| json!({}));

    let even_odd = settings.get("evenAndOddHeaders").and_then(|v| v.as_bool()).unwrap_or(false);
    let doc = json!({
        "type": "doc",
        "attrs": { "page": page, "titlePg": title_pg, "evenOdd": even_odd },
        "content": blocks,
    });
    let payload = json!({
        "doc": doc,
        "headers": headers,
        "footers": footers,
        "stories": stories,
        "styles": styles,
        "numbering": numbering,
        "theme": theme,
        "settings": settings,
        "footnotes": footnotes,
        "endnotes": endnotes,
        "comments": comments,
        "core": core,
    });
    let state = DocState {
        pkg,
        main,
        root_start,
        body_sect,
        sdts,
        hf,
        hf_roots,
        media: BTreeMap::new(),
        macro_enabled,
        template,
    };
    Ok(Opened { state, payload, warnings })
}

/// Adds built-in styles the document doesn't define, so the gallery and
/// headings work in every document (they're written when used).
fn merge_catalog(styles: &mut Value) {
    let list = styles["styles"].as_array().cloned().unwrap_or_default();
    let ids: BTreeSet<String> = list.iter().filter_map(|s| s["id"].as_str().map(String::from)).collect();
    let names: BTreeSet<String> = list.iter().filter_map(|s| s["name"].as_str().map(|n| n.to_lowercase())).collect();
    let mut merged = list;
    for mut s in styles::catalog_json() {
        let id = s["id"].as_str().unwrap_or("").to_string();
        let name = s["name"].as_str().unwrap_or("").to_lowercase();
        if ids.contains(&id) || names.contains(&name) {
            continue;
        }
        s["builtin"] = json!(true);
        merged.push(s);
    }
    styles["styles"] = Value::Array(merged);
}

/// A new, empty document.
pub fn blank() -> Opened {
    let bytes = blank_package().write().expect("blank package");
    open(&bytes).expect("blank document opens")
}

/// The package of a new document (Word 2013+ compatibility mode).
pub fn blank_package() -> Package {
    let mut pkg = Package::default();
    pkg.set(
        "[Content_Types].xml",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
            "<Default Extension=\"png\" ContentType=\"image/png\"/>",
            "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>",
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
            "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>",
            "<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>",
            "<Override PartName=\"/word/webSettings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml\"/>",
            "<Override PartName=\"/word/fontTable.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml\"/>",
            "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
            "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>",
            "</Types>"
        ),
    );
    pkg.set(
        "_rels/.rels",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>",
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
            "</Relationships>"
        ),
    );
    pkg.set(
        "word/_rels/document.xml.rels",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>",
            "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings\" Target=\"webSettings.xml\"/>",
            "<Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable\" Target=\"fontTable.xml\"/>",
            "</Relationships>"
        ),
    );
    pkg.set(
        "word/document.xml",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" ",
            "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" ",
            "xmlns:o=\"urn:schemas-microsoft-com:office:office\" ",
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
            "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" ",
            "xmlns:v=\"urn:schemas-microsoft-com:vml\" ",
            "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" ",
            "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" ",
            "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" ",
            "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
            "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" ",
            "xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" ",
            "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" ",
            "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" ",
            "xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" ",
            "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" ",
            "mc:Ignorable=\"w14 w15 wp14\">",
            "<w:body><w:p/><w:sectPr>",
            "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>",
            "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>",
            "<w:cols w:space=\"720\"/><w:docGrid w:linePitch=\"360\"/>",
            "</w:sectPr></w:body></w:document>"
        ),
    );
    pkg.set("word/styles.xml", styles::default_styles_xml());
    pkg.set(
        "word/settings.xml",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:zoom w:percent=\"100\"/><w:defaultTabStop w:val=\"720\"/><w:characterSpacingControl w:val=\"doNotCompress\"/>",
            "<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/>",
            "<w:compatSetting w:name=\"overrideTableStyleFontSizeAndJustification\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/>",
            "<w:compatSetting w:name=\"enableOpenTypeFeatures\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/>",
            "<w:compatSetting w:name=\"doNotFlipMirrorIndents\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/>",
            "<w:compatSetting w:name=\"differentiateMultirowTableHeaders\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/>",
            "</w:compat><w:themeFontLang w:val=\"en-US\"/><w:decimalSymbol w:val=\".\"/><w:listSeparator w:val=\",\"/>",
            "</w:settings>"
        ),
    );
    pkg.set(
        "word/webSettings.xml",
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<w:webSettings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:optimizeForBrowser/><w:allowPNG/></w:webSettings>",
    );
    pkg.set(
        "word/fontTable.xml",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<w:fonts xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:font w:name=\"Aptos\"><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/></w:font>",
            "<w:font w:name=\"Aptos Display\"><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/></w:font>",
            "<w:font w:name=\"Times New Roman\"><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/></w:font>",
            "</w:fonts>"
        ),
    );
    let now = parts::w3c_now();
    pkg.set("docProps/core.xml", parts::write_core(None, &[("created", now.clone()), ("modified", now)]));
    pkg.set("docProps/app.xml", parts::write_app(&json!({})));
    pkg
}

/// What the editor sends to be saved.
pub struct SaveInput<'a> {
    pub doc: &'a Value,
    pub headers: Option<&'a Value>,
    pub footers: Option<&'a Value>,
    pub stats: &'a Value,
    pub author: &'a str,
    /// Document properties edited in the app (title, subject, keywords…).
    pub core: Option<&'a Value>,
    /// Comments added or edited in the app (null: deleted), by id.
    pub comments: Option<&'a Value>,
    /// Footnotes / endnotes added or edited in the app (null: deleted), by id.
    pub footnotes: Option<&'a Value>,
    pub endnotes: Option<&'a Value>,
    /// Headers and footers of the other sections edited in the app, by
    /// relationship id: `{kind, content}` (new ids get a new part).
    pub stories: Option<&'a Value>,
}

fn scan_doc_pr_ids(text: &str, ids: &mut DocPrIds) {
    let mut pos = 0;
    while let Some(i) = text[pos..].find("docPr ") {
        let start = pos + i;
        let end = text[start..].find('>').map(|e| start + e).unwrap_or(text.len());
        let head = &text[start..end];
        if let Some(a) = head.find(" id=\"") {
            let v = &head[a + 5..];
            if let Some(n) = v.find('"').and_then(|q| v[..q].parse::<u64>().ok()) {
                ids.register(n);
            }
        }
        pos = end.max(start + 1);
    }
}

/// Writes the document as a .docx package.
pub fn save(state: &DocState, input: &SaveInput) -> Result<Vec<u8>, String> {
    let mut pkg = state.pkg.clone();
    let mut ct = pkg.content_types();
    let main = state.main.clone();
    let attrs = input.doc.get("attrs").cloned().unwrap_or(Value::Null);
    let page = attrs.get("page").cloned().unwrap_or(json!({}));
    let num = |m: &str, k: &str, d: f64| page.get(m).and_then(|x| x.get(k)).and_then(|v| v.as_str()).and_then(xml::twips).unwrap_or(d);
    let text_width = (num("pgSz", "w", 12240.0) - num("pgMar", "left", 1440.0) - num("pgMar", "right", 1440.0)).max(1440.0);

    let rewritten: BTreeSet<String> = {
        let mut set = BTreeSet::new();
        set.insert(main.clone());
        for kind in ["header", "footer"] {
            let src = if kind == "header" { input.headers } else { input.footers };
            if let Some(obj) = src.and_then(|v| v.as_object()) {
                for ty in obj.keys() {
                    if let Some(r) = state.hf.iter().find(|r| r.kind == kind && &r.ty == ty) {
                        set.insert(r.part.clone());
                    }
                }
            }
        }
        let main_rels = pkg.rels_of(&main);
        for rid in input.stories.and_then(|v| v.as_object()).map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
            if let Some(r) = main_rels.get(&rid).filter(|r| !r.external) {
                set.insert(resolve(&main, &r.target));
            }
        }
        set
    };
    let mut doc_pr = DocPrIds::default();
    for (name, bytes) in &pkg.parts {
        if name.ends_with(".xml") && name.starts_with("word/") && !rewritten.contains(name) {
            scan_doc_pr_ids(&decode(bytes), &mut doc_pr);
        }
    }

    let mut used_styles = BTreeSet::new();
    let blocks = input.doc.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let (body_xml, mut main_rels) = {
        let rels = pkg.rels_of(&main);
        let mut w = PartWriter::new(&main, rels, &mut pkg, &mut ct, &state.sdts, &state.media, &mut used_styles, &mut doc_pr, text_width);
        // The body ends with a paragraph (Word requires one after a final table)
        let mut body = w.blocks(&blocks, true);
        let tail = w.close_open_fields();
        if !tail.is_empty() {
            body.push_str(&format!("<w:p>{tail}</w:p>"));
        }
        (body, w.rels)
    };

    // Headers and footers
    let mut refs: Vec<(String, String, String)> = Vec::new();
    let mut handled: BTreeSet<(String, String)> = BTreeSet::new();
    for kind in ["header", "footer"] {
        let src = if kind == "header" { input.headers } else { input.footers };
        let Some(obj) = src.and_then(|v| v.as_object()) else { continue };
        for (ty, docjson) in obj {
            handled.insert((kind.to_string(), ty.clone()));
            if docjson.is_null() {
                continue; // removed
            }
            let content = docjson.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
            let existing = state.hf.iter().find(|r| r.kind == kind && &r.ty == ty);
            let (part, rid, root) = match existing {
                Some(r) => (
                    r.part.clone(),
                    r.rid.clone(),
                    state.hf_roots.get(&r.part).cloned().unwrap_or_else(|| default_hf_root(kind)),
                ),
                None => {
                    let part = pkg.free_name("word", kind, "xml");
                    let target = package::relative(&main, &part);
                    let rid = main_rels.add(if kind == "header" { REL_HEADER } else { REL_FOOTER }, &target, false);
                    ct.set_override(&part, if kind == "header" { CT_HEADER } else { CT_FOOTER });
                    (part, rid, default_hf_root(kind))
                }
            };
            let rels = pkg.rels_of(&part);
            let (xml_body, rels) = {
                let mut w = PartWriter::new(&part, rels, &mut pkg, &mut ct, &state.sdts, &state.media, &mut used_styles, &mut doc_pr, text_width);
                let mut b = w.blocks(&content, true);
                let tail = w.close_open_fields();
                if !tail.is_empty() {
                    b.push_str(&format!("<w:p>{tail}</w:p>"));
                }
                (b, w.rels)
            };
            let root = ensure_namespaces(&root, &xml_body);
            let qn = qname(&root);
            pkg.set(&part, format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n{root}{xml_body}</{qn}>"));
            if !rels.items.is_empty() {
                pkg.set(&rels_name(&part), rels.to_xml());
            }
            refs.push((kind.to_string(), ty.clone(), rid));
        }
    }
    for r in &state.hf {
        if !handled.contains(&(r.kind.clone(), r.ty.clone())) {
            refs.push((r.kind.clone(), r.ty.clone(), r.rid.clone()));
        }
    }

    // Headers and footers of the other sections
    for (rid, story) in input.stories.and_then(|v| v.as_object()).map(|o| o.iter().collect::<Vec<_>>()).unwrap_or_default() {
        let kind = if story.get("kind").and_then(|k| k.as_str()) == Some("footer") { "footer" } else { "header" };
        let content = story.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
        let existing = main_rels.get(rid).filter(|r| !r.external).map(|r| resolve(&main, &r.target));
        let (part, root) = match existing {
            Some(p) => {
                let root = state.hf_roots.get(&p).cloned().unwrap_or_else(|| default_hf_root(kind));
                (p, root)
            }
            None => {
                let part = pkg.free_name("word", kind, "xml");
                let target = package::relative(&main, &part);
                main_rels.insert(rid, if kind == "header" { REL_HEADER } else { REL_FOOTER }, &target, false);
                ct.set_override(&part, if kind == "header" { CT_HEADER } else { CT_FOOTER });
                (part, default_hf_root(kind))
            }
        };
        let rels = pkg.rels_of(&part);
        let (xml_body, rels) = {
            let mut w = PartWriter::new(&part, rels, &mut pkg, &mut ct, &state.sdts, &state.media, &mut used_styles, &mut doc_pr, text_width);
            let mut b = w.blocks(&content, true);
            let tail = w.close_open_fields();
            if !tail.is_empty() {
                b.push_str(&format!("<w:p>{tail}</w:p>"));
            }
            (b, w.rels)
        };
        let root = ensure_namespaces(&root, &xml_body);
        let qn = qname(&root);
        pkg.set(&part, format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n{root}{xml_body}</{qn}>"));
        if !rels.items.is_empty() {
            pkg.set(&rels_name(&part), rels.to_xml());
        }
    }
    // Keep the original order of reference types (headers first)
    refs.sort_by_key(|(k, t, _)| (k != "header", ["default", "first", "even"].iter().position(|x| x == t).unwrap_or(3)));

    let title_pg = attrs.get("titlePg").and_then(|v| v.as_bool());
    let sect = sect_xml(state.body_sect.as_deref(), &state.root_start, &page, title_pg, &refs);
    let root = ensure_namespaces(&state.root_start, &format!("{body_xml}{sect}"));
    let qn = qname(&root);
    let prefix = qn.split(':').next().filter(|p| *p != qn).map(|p| format!("{p}:")).unwrap_or_default();
    pkg.set(
        &main,
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n{root}<{prefix}body>{body_xml}{sect}</{prefix}body></{qn}>"),
    );

    // Comments added, edited or deleted in the app
    if let Some(edits) = input.comments.and_then(|c| c.as_object()).filter(|c| !c.is_empty()) {
        let existing = part_by_rel(&pkg, &main, REL_COMMENTS);
        let part = existing.clone().unwrap_or_else(|| "word/comments.xml".to_string());
        let original = existing.as_ref().and_then(|p| pkg.text(p));
        let updated = parts::merge_comments(original.as_deref(), edits);
        pkg.set(&part, updated);
        if existing.is_none() {
            main_rels.ensure(REL_COMMENTS, "comments.xml", false);
            ct.set_override(&part, CT_COMMENTS);
        }
        if edits.values().any(|v| !v.is_null()) {
            used_styles.insert("CommentText".to_string());
            used_styles.insert("CommentReference".to_string());
        }
    }

    // Footnotes and endnotes added, edited or deleted in the app
    for (kind, edits) in [("footnote", input.footnotes), ("endnote", input.endnotes)] {
        let Some(edits) = edits.and_then(|e| e.as_object()).filter(|e| !e.is_empty()) else { continue };
        let (rel, ctype, file) = notes_part_info(kind);
        let existing = part_by_rel(&pkg, &main, rel);
        let part = existing.clone().unwrap_or_else(|| format!("word/{file}"));
        let original = existing.as_ref().and_then(|p| pkg.text(p));
        let Some((root, items)) = note_items(original.as_deref(), kind) else { continue };
        let rels = pkg.rels_of(&part);
        let (items, rels) = {
            let mut w = PartWriter::new(&part, rels, &mut pkg, &mut ct, &state.sdts, &state.media, &mut used_styles, &mut doc_pr, text_width);
            let mut items = items;
            for (id, value) in edits {
                let written = value.get("content").and_then(|c| c.as_array()).map(|content| {
                    let mut body = w.blocks(content, true);
                    let tail = w.close_open_fields();
                    if !tail.is_empty() {
                        body.push_str(&format!("<w:p>{tail}</w:p>"));
                    }
                    format!("<w:{kind} w:id=\"{}\">{body}</w:{kind}>", xml::esc(id))
                });
                match (items.iter().position(|(i, _)| i.as_deref() == Some(id.as_str())), written) {
                    (Some(at), Some(xml)) => items[at].1 = xml,
                    (Some(at), None) => {
                        items.remove(at);
                    }
                    (None, Some(xml)) => items.push((Some(id.clone()), xml)),
                    (None, None) => {}
                }
            }
            (items, w.rels)
        };
        let body: String = items.into_iter().map(|(_, x)| x).collect();
        let root = ensure_namespaces(&root, &body);
        let qn = qname(&root);
        pkg.set(&part, format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n{root}{body}</{qn}>"));
        if !rels.items.is_empty() {
            pkg.set(&rels_name(&part), rels.to_xml());
        }
        if existing.is_none() {
            main_rels.ensure(rel, file, false);
            ct.set_override(&part, ctype);
            // Word lists the separator notes in the settings
            if let Some(sp) = part_by_rel(&pkg, &main, REL_SETTINGS) {
                if let Some(updated) = pkg.text(&sp).and_then(|t| add_note_pr(&t, kind)) {
                    pkg.set(&sp, updated);
                }
            }
        }
        if edits.values().any(|v| !v.is_null()) {
            let (text_style, ref_style) = if kind == "footnote" { ("FootnoteText", "FootnoteReference") } else { ("EndnoteText", "EndnoteReference") };
            used_styles.insert(text_style.to_string());
            used_styles.insert(ref_style.to_string());
        }
    }

    // Styles used but not defined
    let styles_part = match part_by_rel(&pkg, &main, REL_STYLES) {
        Some(p) => p,
        None => {
            let p = "word/styles.xml".to_string();
            pkg.set(&p, styles::default_styles_xml());
            main_rels.ensure(REL_STYLES, "styles.xml", false);
            ct.set_override(&p, CT_STYLES);
            p
        }
    };
    if let Some(bytes) = pkg.get(&styles_part).map(|b| b.to_vec()) {
        if let Some(updated) = styles::add_missing_styles(&bytes, &used_styles) {
            pkg.set(&styles_part, updated);
        }
    }

    // Lists created in the editor
    let added = attrs.get("numAdded").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if !added.is_empty() {
        let existing = part_by_rel(&pkg, &main, REL_NUMBERING);
        let part = existing.clone().unwrap_or_else(|| "word/numbering.xml".to_string());
        let original = existing.as_ref().and_then(|p| pkg.get(p)).map(|b| b.to_vec());
        if let Some(bytes) = numbering::merge_numbering(original.as_deref(), &added) {
            pkg.set(&part, bytes);
            if existing.is_none() {
                main_rels.ensure(REL_NUMBERING, "numbering.xml", false);
                ct.set_override(&part, CT_NUMBERING);
            }
        }
    }

    // Even/odd headers live in the settings part
    if let Some(even_odd) = attrs.get("evenOdd").and_then(|v| v.as_bool()) {
        if let Some(sp) = part_by_rel(&pkg, &main, REL_SETTINGS) {
            if let Some(text) = pkg.text(&sp) {
                if let Some(updated) = set_even_odd(&text, even_odd) {
                    pkg.set(&sp, updated);
                }
            }
        }
    }

    pkg.set(&rels_name(&main), main_rels.to_xml());

    // Macros are not kept: a .docx must not carry them
    if state.macro_enabled || state.template {
        ct.set_override(&main, CT_DOCUMENT);
        if state.macro_enabled {
            let vba: Vec<String> = pkg.parts.keys().filter(|k| k.to_lowercase().contains("vbaproject") || k.to_lowercase().contains("vbadata")).cloned().collect();
            for k in vba {
                pkg.parts.remove(&k);
            }
            let mut rels = package::Rels::parse(pkg.get(&rels_name(&main)).unwrap_or_default());
            rels.items.retain(|r| !r.target.to_lowercase().contains("vba"));
            pkg.set(&rels_name(&main), rels.to_xml());
            ct.overrides.retain(|(p, _)| !p.to_lowercase().contains("vba"));
            ct.defaults.retain(|(e, _)| e != "bin");
        }
    }

    // Document properties
    let now = parts::w3c_now();
    let root_rels = pkg.rels_of("");
    let core_part = root_rels.items.iter().find(|r| r.kind == REL_CORE).map(|r| r.target.trim_start_matches('/').to_string());
    let core_original = core_part.as_ref().and_then(|p| pkg.get(p)).map(|b| b.to_vec());
    let mut updates = vec![("lastModifiedBy", input.author.to_string()), ("modified", now.clone())];
    let core_props = core_original.as_deref().map(parts::read_core).unwrap_or_else(|| json!({}));
    if core_props.get("creator").and_then(|v| v.as_str()).map(|s| s.is_empty()).unwrap_or(true) {
        updates.push(("creator", input.author.to_string()));
    }
    if core_props.get("created").and_then(|v| v.as_str()).map(|s| s.is_empty()).unwrap_or(true) {
        updates.push(("created", now));
    }
    if let Some(edits) = input.core.and_then(|c| c.as_object()) {
        for key in ["title", "subject", "creator", "keywords", "description", "category", "contentStatus"] {
            if let Some(v) = edits.get(key).and_then(|v| v.as_str()) {
                updates.retain(|(k, _)| *k != key);
                updates.push((key, v.to_string()));
            }
        }
    }
    let core_xml = parts::write_core(core_original.as_deref(), &updates);
    match core_part {
        Some(p) => pkg.set(&p, core_xml),
        None => {
            pkg.set("docProps/core.xml", core_xml);
            let mut rr = root_rels.clone();
            rr.ensure(REL_CORE, "docProps/core.xml", false);
            pkg.set("_rels/.rels", rr.to_xml());
            ct.set_override("docProps/core.xml", CT_CORE);
        }
    }
    let app_part = pkg.rels_of("").items.iter().find(|r| r.kind == REL_APP).map(|r| r.target.trim_start_matches('/').to_string());
    if let Some(p) = app_part {
        let updated = match pkg.get(&p) {
            Some(original) => parts::update_app(original, input.stats),
            None => parts::write_app(input.stats),
        };
        pkg.set(&p, updated);
    }

    pkg.set("[Content_Types].xml", ct.to_xml());
    pkg.write()
}

/// The root start tag and children (note id, raw XML) of a notes part; a
/// new part has the separator notes Word expects.
#[allow(clippy::type_complexity)]
fn note_items(original: Option<&str>, kind: &str) -> Option<(String, Vec<(Option<String>, String)>)> {
    match original {
        Some(text) => {
            let doc = parse(text).ok()?;
            let root = doc.root_element();
            let items = root
                .children()
                .filter(|c| c.is_element())
                .map(|c| {
                    let id = (is_w(c, kind) && !is_special_note(c)).then(|| wattr(c, "id").map(String::from)).flatten();
                    (id, text[c.range()].to_string())
                })
                .collect();
            Some((start_tag(text, root), items))
        }
        None => {
            let root = format!(
                "<w:{kind}s xmlns:w=\"{}\" xmlns:r=\"{}\" xmlns:wp=\"{}\" xmlns:mc=\"{}\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" mc:Ignorable=\"w14\">",
                xml::W,
                xml::R,
                xml::WP,
                xml::MC
            );
            let note = |id: &str, ty: &str, mark: &str| {
                format!("<w:{kind} w:type=\"{ty}\" w:id=\"{id}\"><w:p><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:r><w:{mark}/></w:r></w:p></w:{kind}>")
            };
            Some((root, vec![(None, note("-1", "separator", "separator")), (None, note("0", "continuationSeparator", "continuationSeparator"))]))
        }
    }
}

/// Lists the separator notes in `settings.xml` (`w:footnotePr` / `w:endnotePr`).
fn add_note_pr(text: &str, kind: &str) -> Option<String> {
    let doc = parse(text).ok()?;
    let root = doc.root_element();
    let name = format!("{kind}Pr");
    if root.children().any(|c| is_w(c, &name)) {
        return None;
    }
    // CT_Settings order: the first element that comes after it
    let after: &[&str] = if kind == "footnote" {
        &["endnotePr", "compat", "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping", "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions", "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags", "decimalSymbol", "listSeparator"]
    } else {
        &["compat", "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping", "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions", "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags", "decimalSymbol", "listSeparator"]
    };
    let anchor = root
        .children()
        .find(|c| after.iter().any(|n| is_w(*c, n)))
        .map(|n| n.range().start)
        .unwrap_or_else(|| text[..root.range().end].rfind("</").unwrap_or(root.range().end));
    let el = format!("<w:{name}><w:{kind} w:id=\"-1\"/><w:{kind} w:id=\"0\"/></w:{name}>");
    Some(format!("{}{el}{}", &text[..anchor], &text[anchor..]))
}

fn default_hf_root(kind: &str) -> String {
    let tag = if kind == "header" { "hdr" } else { "ftr" };
    format!(
        "<w:{tag} xmlns:w=\"{}\" xmlns:r=\"{}\" xmlns:wp=\"{}\" xmlns:mc=\"{}\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" mc:Ignorable=\"w14\">",
        xml::W,
        xml::R,
        xml::WP,
        xml::MC
    )
}

/// Adds or removes `w:evenAndOddHeaders` in `settings.xml`.
fn set_even_odd(text: &str, on: bool) -> Option<String> {
    let doc = parse(text).ok()?;
    let root = doc.root_element();
    let existing = root.children().find(|c| is_w(*c, "evenAndOddHeaders"));
    match (existing, on) {
        (Some(_), true) | (None, false) => None,
        (Some(n), false) => Some(format!("{}{}", &text[..n.range().start], &text[n.range().end..])),
        (None, true) => {
            // CT_Settings order: the first element that comes after w:evenAndOddHeaders
            const AFTER: &[&str] = &[
                "bookFoldRevPrinting", "bookFoldPrinting", "bookFoldPrintingSheets", "drawingGridHorizontalSpacing",
                "drawingGridVerticalSpacing", "displayHorizontalDrawingGridEvery", "displayVerticalDrawingGridEvery",
                "doNotUseMarginsForDrawingGridOrigin", "drawingGridHorizontalOrigin", "drawingGridVerticalOrigin",
                "doNotShadeFormData", "noPunctuationKerning", "characterSpacingControl", "printTwoOnOne",
                "strictFirstAndLastChars", "noLineBreaksAfter", "noLineBreaksBefore", "savePreviewPicture",
                "doNotValidateAgainstSchema", "saveInvalidXml", "ignoreMixedContent", "alwaysShowPlaceholderText",
                "doNotDemarcateInvalidXml", "saveXmlDataOnly", "useXSLTWhenSaving", "saveThroughXslt", "showXMLTags",
                "alwaysMergeEmptyNamespace", "updateFields", "hdrShapeDefaults", "footnotePr", "endnotePr", "compat",
                "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping",
                "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions",
                "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags",
                "decimalSymbol", "listSeparator",
            ];
            let anchor = root
                .children()
                .find(|c| AFTER.iter().any(|n| is_w(*c, n)))
                .map(|n| n.range().start)
                .unwrap_or_else(|| text[..root.range().end].rfind("</").unwrap_or(root.range().end));
            Some(format!("{}<w:evenAndOddHeaders/>{}", &text[..anchor], &text[anchor..]))
        }
    }
}
