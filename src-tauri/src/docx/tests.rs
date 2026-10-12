//! Round trips: open → save → open must keep content and unknown XML.

use serde_json::{json, Value};

use super::{open, package::Package, save, SaveInput};

const DOC_NS: &str = concat!(
    "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
    "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" ",
    "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" ",
    "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" ",
    "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" ",
    "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"w14\""
);

/// A one-pixel PNG.
pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

pub fn sample_docx() -> Vec<u8> {
    let mut pkg = super::blank_package();
    let body = concat!(
        "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>",
        // formatting, unknown rPr extension, a soft hyphen and a tab
        "<w:p><w:pPr><w:jc w:val=\"both\"/><w:spacing w:before=\"120\" w:after=\"240\" w:line=\"360\" w:lineRule=\"auto\"/><w:ind w:left=\"720\" w:firstLine=\"360\"/></w:pPr>",
        "<w:r><w:rPr><w:b/><w:color w:val=\"C00000\"/><w14:ligatures w14:val=\"standard\"/></w:rPr><w:t xml:space=\"preserve\">Bold red </w:t></w:r>",
        "<w:r><w:rPr><w:i/><w:u w:val=\"double\"/><w:sz w:val=\"28\"/></w:rPr><w:t>italic</w:t></w:r><w:r><w:tab/><w:t>after tab</w:t><w:softHyphen/></w:r></w:p>",
        // hyperlink + bookmark + comment anchors
        "<w:p><w:bookmarkStart w:id=\"0\" w:name=\"intro\"/><w:hyperlink r:id=\"rIdLink\" w:history=\"1\"><w:r><w:rPr><w:rStyle w:val=\"Hyperlink\"/></w:rPr><w:t>Example</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id=\"0\"/>",
        "<w:r><w:t xml:space=\"preserve\"> and </w:t></w:r><w:hyperlink w:anchor=\"intro\"><w:r><w:t>back to intro</w:t></w:r></w:hyperlink></w:p>",
        // a complex field (PAGE) and a simple field
        "<w:p><w:r><w:t xml:space=\"preserve\">Page </w:t></w:r><w:r><w:fldChar w:fldCharType=\"begin\"/></w:r><w:r><w:instrText xml:space=\"preserve\"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType=\"separate\"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r>",
        "<w:fldSimple w:instr=\" NUMPAGES \"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>",
        // tracked changes
        "<w:p><w:ins w:id=\"5\" w:author=\"Ann\" w:date=\"2026-01-01T00:00:00Z\"><w:r><w:t>inserted</w:t></w:r></w:ins><w:del w:id=\"6\" w:author=\"Bob\" w:date=\"2026-01-02T00:00:00Z\"><w:r><w:delText>deleted</w:delText></w:r></w:del></w:p>",
        // an equation
        "<w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>",
        // a list paragraph
        "<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>",
        // a content control around two paragraphs
        "<w:sdt><w:sdtPr><w:alias w:val=\"Summary\"/><w:id w:val=\"123\"/></w:sdtPr><w:sdtContent>",
        "<w:p><w:r><w:t>Inside control one</w:t></w:r></w:p><w:p><w:r><w:t>Inside control two</w:t></w:r></w:p>",
        "</w:sdtContent></w:sdt>",
        // a table with a horizontal and a vertical merge
        "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblLook w:val=\"04A0\"/></w:tblPr>",
        "<w:tblGrid><w:gridCol w:w=\"3000\"/><w:gridCol w:w=\"3000\"/><w:gridCol w:w=\"3000\"/></w:tblGrid>",
        "<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w=\"6000\" w:type=\"dxa\"/><w:gridSpan w:val=\"2\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"D9E2F3\"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc>",
        "<w:tc><w:tcPr><w:tcW w:w=\"3000\" w:type=\"dxa\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>Tall</w:t></w:r></w:p></w:tc></w:tr>",
        "<w:tr><w:tc><w:tcPr><w:tcW w:w=\"3000\" w:type=\"dxa\"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w=\"3000\" w:type=\"dxa\"/></w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>",
        "<w:tc><w:tcPr><w:tcW w:w=\"3000\" w:type=\"dxa\"/><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>",
        // an image and a page break
        "<w:p><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"914400\" cy=\"457200\"/><wp:docPr id=\"1\" name=\"Picture 1\" descr=\"A dot\"/>",
        "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"dot.png\"/><pic:cNvPicPr/></pic:nvPicPr>",
        "<pic:blipFill><a:blip r:embed=\"rIdImg\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"914400\" cy=\"457200\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>",
        "<w:r><w:br w:type=\"page\"/></w:r></w:p>",
        "<w:p><w:r><w:t>Last page</w:t></w:r></w:p>",
        "<w:sectPr><w:headerReference w:type=\"default\" r:id=\"rIdHdr\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/><w:cols w:space=\"708\"/><w:docGrid w:linePitch=\"360\"/></w:sectPr>",
    );
    pkg.set(
        "word/document.xml",
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<w:document {DOC_NS}><w:body>{body}</w:body></w:document>"),
    );
    pkg.set(
        "word/header1.xml",
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<w:hdr {DOC_NS}><w:p><w:pPr><w:pStyle w:val=\"Header\"/></w:pPr><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>"),
    );
    pkg.set(
        "word/numbering.xml",
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<w:numbering {DOC_NS}><w:abstractNum w:abstractNumId=\"0\"><w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"\u{2022}\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num></w:numbering>"
        ),
    );
    pkg.set("word/media/image1.png", PNG.to_vec());
    pkg.set(
        "word/_rels/document.xml.rels",
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>",
            "<Relationship Id=\"rIdNum\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>",
            "<Relationship Id=\"rIdHdr\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/>",
            "<Relationship Id=\"rIdImg\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image1.png\"/>",
            "<Relationship Id=\"rIdLink\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.com/\" TargetMode=\"External\"/>",
            "</Relationships>"
        ),
    );
    let mut ct = pkg.content_types();
    ct.set_override("word/header1.xml", super::package::CT_HEADER);
    ct.set_override("word/numbering.xml", super::package::CT_NUMBERING);
    pkg.set("[Content_Types].xml", ct.to_xml());
    pkg.write().unwrap()
}

fn resave(bytes: &[u8]) -> (Value, Vec<u8>) {
    let opened = open(bytes).unwrap();
    let doc = opened.payload["doc"].clone();
    let headers = opened.payload["headers"].clone();
    let footers = opened.payload["footers"].clone();
    let out = save(
        &opened.state,
        &SaveInput { doc: &doc, headers: Some(&headers), footers: Some(&footers), stats: &json!({ "words": 10 }), author: "Tester", core: None, comments: None, footnotes: None, endnotes: None, stories: None },
    )
    .unwrap();
    (opened.payload, out)
}

fn document_xml(bytes: &[u8]) -> String {
    Package::read(bytes).unwrap().text("word/document.xml").unwrap()
}

/// Path of the first difference between two JSON values.
pub fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                let (va, vb) = (x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null));
                if let Some(d) = first_diff(va, vb, &format!("{path}.{k}")) {
                    return Some(d);
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            for i in 0..x.len().max(y.len()) {
                let (va, vb) = (x.get(i).unwrap_or(&Value::Null), y.get(i).unwrap_or(&Value::Null));
                if let Some(d) = first_diff(va, vb, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        _ if a == b => None,
        _ => Some(format!("{path}: {a} != {b}")),
    }
}

fn without_field_xml(v: &Value) -> Value {
    match v {
        Value::Object(o) => {
            let mut out = serde_json::Map::new();
            let is_field = matches!(o.get("type").and_then(|t| t.as_str()), Some("field_start") | Some("field_end"));
            for (k, x) in o {
                if is_field && k == "attrs" {
                    let mut a = x.clone();
                    a["xml"] = json!("");
                    out.insert(k.clone(), a);
                } else {
                    out.insert(k.clone(), without_field_xml(x));
                }
            }
            Value::Object(out)
        }
        Value::Array(a) => Value::Array(a.iter().map(without_field_xml).collect()),
        x => x.clone(),
    }
}

fn find<'a>(v: &'a Value, pred: &dyn Fn(&Value) -> bool) -> Option<&'a Value> {
    if pred(v) {
        return Some(v);
    }
    match v {
        Value::Array(a) => a.iter().find_map(|x| find(x, pred)),
        Value::Object(o) => o.values().find_map(|x| find(x, pred)),
        _ => None,
    }
}

#[test]
fn reads_the_sample() {
    let opened = open(&sample_docx()).unwrap();
    let p = &opened.payload;
    let blocks = p["doc"]["content"].as_array().unwrap();
    assert_eq!(blocks[0]["attrs"]["style"], "Heading1");
    assert_eq!(blocks[0]["content"][0]["text"], "Quarterly report");
    // run formatting
    let bold = find(&blocks[1], &|v| v["text"] == "Bold red ").unwrap();
    let kinds: Vec<&str> = bold["marks"].as_array().unwrap().iter().map(|m| m["type"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"bold") && kinds.contains(&"color") && kinds.contains(&"rextra"));
    assert!(find(&blocks[1], &|v| v["type"] == "tab").is_some());
    // hyperlinks
    let link = find(&blocks[2], &|v| v["text"] == "Example").unwrap();
    assert!(link["marks"].as_array().unwrap().iter().any(|m| m["type"] == "link" && m["attrs"]["href"] == "https://example.com/"));
    let anchor = find(&blocks[2], &|v| v["text"] == "back to intro").unwrap();
    assert!(anchor["marks"].as_array().unwrap().iter().any(|m| m["attrs"]["anchor"] == "intro"));
    // fields
    let starts: Vec<&Value> = blocks[3]["content"].as_array().unwrap().iter().filter(|n| n["type"] == "field_start").collect();
    assert_eq!(starts.len(), 2);
    assert_eq!(starts[0]["attrs"]["instr"], "PAGE");
    assert_eq!(starts[1]["attrs"]["instr"], "NUMPAGES");
    // tracked changes
    assert!(find(&blocks[4], &|v| v["text"] == "deleted" && v["marks"][0]["type"] == "del").is_some());
    // equation
    assert!(find(&blocks[5], &|v| v["attrs"]["kind"] == "math" && v["attrs"]["text"] == "x=1").is_some());
    // content control
    assert_eq!(blocks[7]["attrs"]["sdt"], blocks[8]["attrs"]["sdt"]);
    // table merges
    let table = blocks.iter().find(|b| b["type"] == "table").unwrap();
    let row0 = table["content"][0]["content"].as_array().unwrap();
    assert_eq!(row0[0]["attrs"]["colspan"], 2);
    assert_eq!(row0[1]["attrs"]["rowspan"], 2);
    assert_eq!(table["content"][1]["content"].as_array().unwrap().len(), 2);
    assert_eq!(table["content"][0]["attrs"]["header"], true);
    // image
    let img = find(&p["doc"], &|v| v["type"] == "image").unwrap();
    assert_eq!(img["attrs"]["target"], "word/media/image1.png");
    assert_eq!(img["attrs"]["alt"], "A dot");
    // header, page setup, numbering
    assert_eq!(p["headers"]["default"]["content"][0]["content"][0]["text"], "Confidential");
    assert_eq!(p["doc"]["attrs"]["page"]["pgSz"]["w"], "11906");
    assert_eq!(p["numbering"]["nums"]["1"]["abstract"], "0");
    // styles: document's + catalog
    assert!(p["styles"]["styles"].as_array().unwrap().iter().any(|s| s["id"] == "Heading4" && s["builtin"] == true));
}

#[test]
fn round_trip_is_stable() {
    let original = sample_docx();
    let (first, saved) = resave(&original);
    let (second, saved_again) = resave(&saved);
    // Simple fields come back as complex fields (same meaning), so compare without their XML
    assert_eq!(first_diff(&without_field_xml(&first["doc"]), &without_field_xml(&second["doc"]), "doc"), None, "content changed after a save");
    assert_eq!(first["headers"], second["headers"]);
    // the second save writes the same document part
    assert_eq!(document_xml(&saved), document_xml(&saved_again));
    let xml = document_xml(&saved);
    // unknown and opaque content is written back
    assert!(xml.contains("<w14:ligatures w14:val=\"standard\"/>"));
    assert!(xml.contains("<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath>"));
    assert!(xml.contains("<w:bookmarkStart w:id=\"0\" w:name=\"intro\"/>"));
    assert!(xml.contains("<w:sdtPr><w:alias w:val=\"Summary\"/><w:id w:val=\"123\"/></w:sdtPr>"));
    assert!(xml.contains("<w:vMerge w:val=\"restart\"/>") && xml.contains("<w:vMerge/>"));
    assert!(xml.contains("<w:gridSpan w:val=\"2\"/>"));
    assert!(xml.contains("w:fldCharType=\"begin\"/></w:r><w:r><w:instrText xml:space=\"preserve\"> NUMPAGES </w:instrText>"));
    assert!(xml.contains("<w:del w:id=\"6\" w:author=\"Bob\" w:date=\"2026-01-02T00:00:00Z\"><w:r><w:delText xml:space=\"preserve\">deleted</w:delText></w:r></w:del>"));
    assert!(xml.contains("<w:hyperlink r:id=\"rIdLink\" w:history=\"1\">"));
    assert!(xml.contains("<w:headerReference w:type=\"default\" r:id=\"rIdHdr\"/>"));
    assert!(xml.contains("<w:pgSz w:h=\"16838\" w:w=\"11906\"/>"));
    let pkg = Package::read(&saved).unwrap();
    assert!(pkg.get("word/media/image1.png").is_some());
    assert!(pkg.text("word/header1.xml").unwrap().contains("Confidential"));
    let core = pkg.text("docProps/core.xml").unwrap();
    assert!(core.contains("<cp:lastModifiedBy>Tester</cp:lastModifiedBy>"));
}

#[test]
fn edits_are_written() {
    let opened = open(&sample_docx()).unwrap();
    let mut doc = opened.payload["doc"].clone();
    // a new paragraph using a style the document doesn't define, in a new list
    doc["content"].as_array_mut().unwrap().push(json!({
        "type": "paragraph",
        "attrs": { "style": "Heading4", "numPr": { "numId": 20, "ilvl": 0 } },
        "content": [ { "type": "text", "text": "New heading", "marks": [ { "type": "bold", "attrs": { "on": true } } ] } ]
    }));
    doc["attrs"]["numAdded"] = json!([
        { "kind": "abstract", "id": "20", "levels": [ { "ilvl": 0, "start": 1, "numFmt": "decimal", "lvlText": "%1." } ] },
        { "kind": "num", "id": "20", "abstract": "20" }
    ]);
    // a footer added in the editor and landscape pages
    let footers = json!({ "default": { "type": "doc", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Page footer" } ] } ] } });
    doc["attrs"]["page"]["pgSz"] = json!({ "w": "16838", "h": "11906", "orient": "landscape" });
    let headers = opened.payload["headers"].clone();
    let out = save(&opened.state, &SaveInput { doc: &doc, headers: Some(&headers), footers: Some(&footers), stats: &json!({}), author: "T", core: None, comments: None, footnotes: None, endnotes: None, stories: None }).unwrap();
    let pkg = Package::read(&out).unwrap();
    let styles = pkg.text("word/styles.xml").unwrap();
    assert!(styles.contains("w:styleId=\"Heading4\""));
    let numbering = pkg.text("word/numbering.xml").unwrap();
    assert!(numbering.contains("w:abstractNumId=\"20\"") && numbering.contains("<w:num w:numId=\"20\">"));
    let footer = pkg.parts.keys().find(|k| k.starts_with("word/footer")).unwrap().clone();
    assert!(pkg.text(&footer).unwrap().contains("Page footer"));
    let ct = pkg.text("[Content_Types].xml").unwrap();
    assert!(ct.contains(&format!("/{footer}")));
    let xml = document_xml(&out);
    assert!(xml.contains("<w:footerReference w:type=\"default\""));
    assert!(xml.contains("w:orient=\"landscape\""));
    // reopening shows the edits
    let again = open(&out).unwrap();
    assert_eq!(again.payload["footers"]["default"]["content"][0]["content"][0]["text"], "Page footer");
    assert!(find(&again.payload["doc"], &|v| v["text"] == "New heading").is_some());
}

#[test]
fn new_pictures_and_unbalanced_fields() {
    let mut opened = open(&sample_docx()).unwrap();
    opened.state.media.insert("word/media/image9.png".into(), super::tests::PNG.to_vec());
    let mut doc = opened.payload["doc"].clone();
    // delete the field end of PAGE (unbalanced) and add a new picture
    let para = doc["content"][3]["content"].as_array_mut().unwrap();
    let end = para.iter().position(|n| n["type"] == "field_end").unwrap();
    para.remove(end);
    doc["content"].as_array_mut().unwrap().push(json!({ "type": "paragraph", "content": [
        { "type": "image", "attrs": { "target": "word/media/image9.png", "cx": 100000, "cy": 100000, "alt": "new" } }
    ] }));
    let out = save(&opened.state, &SaveInput { doc: &doc, headers: None, footers: None, stats: &json!({}), author: "T", core: None, comments: None, footnotes: None, endnotes: None, stories: None }).unwrap();
    let pkg = Package::read(&out).unwrap();
    assert!(pkg.get("word/media/image9.png").is_some());
    let rels = pkg.text("word/_rels/document.xml.rels").unwrap();
    assert!(rels.contains("Target=\"media/image9.png\""));
    let xml = document_xml(&out);
    let begins = xml.matches("w:fldCharType=\"begin\"").count();
    let ends = xml.matches("w:fldCharType=\"end\"").count();
    assert_eq!(begins, ends, "fields are balanced");
    // docPr ids are unique
    assert!(xml.contains("wp:docPr id=\"2\"") || xml.contains("<wp:docPr id=\"2\""));
    let reopened = open(&out).unwrap();
    assert!(find(&reopened.payload["doc"], &|v| v["type"] == "image" && v["attrs"]["alt"] == "new").is_some());
}

#[test]
fn fallback_pictures() {
    // A Mac-only PDF picture with a PNG fallback shows (and keeps) both
    let mut pkg = Package::read(&sample_docx()).unwrap();
    let xml = pkg.text("word/document.xml").unwrap().replace(
        "<pic:blipFill><a:blip r:embed=\"rIdImg\"/>",
        concat!(
            "<mc:AlternateContent><mc:Choice Requires=\"ma\"><pic:blipFill><a:blip r:embed=\"rIdPdf\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill></mc:Choice>",
            "<mc:Fallback><pic:blipFill><a:blip r:embed=\"rIdImg\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill></mc:Fallback></mc:AlternateContent>",
            "<pic:blipFill><a:blip r:embed=\"rIdImg\"/>"
        ),
    );
    pkg.set("word/document.xml", xml);
    pkg.set("word/media/image9.pdf", b"%PDF-1.4".to_vec());
    let rels = pkg.text("word/_rels/document.xml.rels").unwrap().replace(
        "</Relationships>",
        "<Relationship Id=\"rIdPdf\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image9.pdf\"/></Relationships>",
    );
    pkg.set("word/_rels/document.xml.rels", rels);
    let bytes = pkg.write().unwrap();
    let (payload, saved) = resave(&bytes);
    let image = find(&payload["doc"], &|n| n["type"] == "image").unwrap();
    assert_eq!(image["attrs"]["target"], "word/media/image1.png");
    let xml = document_xml(&saved);
    assert!(xml.contains("r:embed=\"rIdPdf\"") && xml.contains("r:embed=\"rIdImg\""));
}

#[test]
fn notes_are_written() {
    // A document without footnotes gets a footnote; then it is edited and another one deleted
    let bytes = sample_docx();
    let opened = open(&bytes).unwrap();
    let mut doc = opened.payload["doc"].clone();
    let reference = |id: &str| {
        json!({ "type": "opaque_inline", "attrs": { "kind": "footnote", "noteId": id, "label": "footnote", "hidden": false, "text": "",
            "xml": format!("<w:r><w:rPr><w:rStyle w:val=\"FootnoteReference\"/></w:rPr><w:footnoteReference w:id=\"{id}\"/></w:r>") } })
    };
    let note = |text: &str| {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "attrs": { "style": "FootnoteText" }, "content": [
            { "type": "opaque_inline", "attrs": { "kind": "noteRef", "label": "footnote", "hidden": false, "text": "",
                "xml": "<w:r><w:rPr><w:rStyle w:val=\"FootnoteReference\"/></w:rPr><w:footnoteRef/></w:r>" } },
            { "type": "text", "text": text }
        ] }] })
    };
    doc["content"][0]["content"].as_array_mut().unwrap().push(reference("1"));
    doc["content"][0]["content"].as_array_mut().unwrap().push(reference("2"));
    let notes = json!({ "1": note(" First note"), "2": note(" Second note") });
    let input = |doc: &Value, notes: &Value| {
        save(
            &opened.state,
            &SaveInput { doc, headers: None, footers: None, stats: &json!({}), author: "T", core: None, comments: None, footnotes: Some(notes), endnotes: None, stories: None },
        )
        .unwrap()
    };
    let saved = input(&doc, &notes);
    let pkg = Package::read(&saved).unwrap();
    let xml = pkg.text("word/footnotes.xml").unwrap();
    assert!(xml.contains("w:type=\"separator\"") && xml.contains("w:type=\"continuationSeparator\""));
    assert!(xml.contains("First note") && xml.contains("Second note") && xml.contains("<w:footnoteRef/>"));
    assert!(pkg.text("word/_rels/document.xml.rels").unwrap().contains("relationships/footnotes"));
    assert!(pkg.text("[Content_Types].xml").unwrap().contains("footnotes+xml"));
    assert!(pkg.text("word/settings.xml").unwrap().contains("<w:footnotePr><w:footnote w:id=\"-1\"/>"));
    assert!(pkg.text("word/styles.xml").unwrap().contains("w:styleId=\"FootnoteText\""));

    // Reopened: the notes come back as content
    let again = open(&saved).unwrap();
    let first = &again.payload["footnotes"]["1"];
    assert_eq!(first["content"][0]["content"][0]["attrs"]["kind"], "noteRef");
    assert_eq!(first["content"][0]["content"][1]["text"], " First note");
    assert!(find(&again.payload["doc"], &|n| n["attrs"]["kind"] == "footnote" && n["attrs"]["noteId"] == "2").is_some());

    // Edit one, delete the other: the rest of the part is kept as it was
    let edits = json!({ "1": note(" Changed"), "2": null });
    let saved2 = save(
        &again.state,
        &SaveInput { doc: &again.payload["doc"], headers: None, footers: None, stats: &json!({}), author: "T", core: None, comments: None, footnotes: Some(&edits), endnotes: None, stories: None },
    )
    .unwrap();
    let xml2 = Package::read(&saved2).unwrap().text("word/footnotes.xml").unwrap();
    assert!(xml2.contains("Changed") && !xml2.contains("Second note") && !xml2.contains("First note"));
    assert_eq!(xml2.matches("w:type=\"separator\"").count(), 1);
}

#[test]
fn section_headers_are_written() {
    // A section break whose section gets its own new header in the editor
    let bytes = sample_docx();
    let opened = open(&bytes).unwrap();
    let mut doc = opened.payload["doc"].clone();
    doc["content"][0]["attrs"]["sect"] = json!(
        "<w:sectPr><w:headerReference w:type=\"default\" r:id=\"rIdDocsH1\"/><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:type w:val=\"nextPage\"/></w:sectPr>"
    );
    let stories = json!({ "rIdDocsH1": { "kind": "header", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Chapter one" }] }] } });
    let saved = save(
        &opened.state,
        &SaveInput { doc: &doc, headers: None, footers: None, stats: &json!({}), author: "T", core: None, comments: None, footnotes: None, endnotes: None, stories: Some(&stories) },
    )
    .unwrap();
    let pkg = Package::read(&saved).unwrap();
    let rels = pkg.text("word/_rels/document.xml.rels").unwrap();
    let target = regex_like(&rels, "rIdDocsH1");
    let part = format!("word/{target}");
    assert!(pkg.text(&part).unwrap().contains("Chapter one"), "{part}");
    assert!(pkg.text("[Content_Types].xml").unwrap().contains(&format!("/{part}")));
    // Reopened: the section's header comes back by its id
    let again = open(&saved).unwrap();
    assert_eq!(again.payload["stories"]["rIdDocsH1"]["content"][0]["content"][0]["text"], "Chapter one");
    // The final section's header is untouched
    assert!(Package::read(&saved).unwrap().text("word/header1.xml").unwrap().contains("Confidential"));
}

/// Target of a relationship id in a .rels part (test helper).
fn regex_like(rels: &str, id: &str) -> String {
    let at = rels.find(&format!("Id=\"{id}\"")).expect("relationship");
    let rest = &rels[at..];
    let t = rest.find("Target=\"").unwrap() + 8;
    rest[t..t + rest[t..].find('"').unwrap()].to_string()
}

#[test]
fn blank_document() {
    let opened = super::blank();
    assert_eq!(opened.payload["doc"]["content"].as_array().unwrap().len(), 1);
    assert_eq!(opened.payload["doc"]["attrs"]["page"]["pgSz"]["w"], "12240");
    let styles = opened.payload["styles"]["styles"].as_array().unwrap();
    assert!(styles.iter().any(|s| s["id"] == "Title" && s["qFormat"] == true));
    let doc = json!({ "type": "doc", "attrs": opened.payload["doc"]["attrs"].clone(), "content": [
        { "type": "paragraph", "attrs": { "style": "Title" }, "content": [ { "type": "text", "text": "Hello" } ] }
    ] });
    let out = save(&opened.state, &SaveInput { doc: &doc, headers: None, footers: None, stats: &json!({}), author: "T", core: None, comments: None, footnotes: None, endnotes: None, stories: None }).unwrap();
    let reopened = open(&out).unwrap();
    assert_eq!(reopened.payload["doc"]["content"][0]["content"][0]["text"], "Hello");
}

#[test]
fn rejects_non_documents() {
    assert!(open(b"not a zip").is_err());
}

/// Opens, saves and reopens every .docx in `$CORPUS_IN`, writing the saved
/// copies to `$CORPUS_OUT`. Run with `cargo test --lib corpus -- --ignored --nocapture`.
#[test]
#[ignore]
fn corpus_round_trip() {
    let (Ok(input), Ok(output)) = (std::env::var("CORPUS_IN"), std::env::var("CORPUS_OUT")) else {
        eprintln!("set CORPUS_IN and CORPUS_OUT");
        return;
    };
    let _ = std::fs::create_dir_all(&output);
    let mut names: Vec<_> = std::fs::read_dir(&input).unwrap().flatten().map(|e| e.path()).collect();
    names.sort();
    let mut failures = 0;
    for path in names {
        if path.extension().map(|e| e != "docx").unwrap_or(true) {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&path).unwrap();
        let result = std::panic::catch_unwind(|| -> Result<String, String> {
            let (first, saved) = resave(&bytes);
            std::fs::write(std::path::Path::new(&output).join(&name), &saved).map_err(|e| e.to_string())?;
            let (second, saved_again) = resave(&saved);
            if let Some(d) = first_diff(&without_field_xml(&first["doc"]), &without_field_xml(&second["doc"]), "doc") {
                return Err(format!("content drift: {}", d.chars().take(300).collect::<String>()));
            }
            if document_xml(&saved) != document_xml(&saved_again) {
                return Err("second save differs".into());
            }
            Ok(format!("{} blocks", first["doc"]["content"].as_array().map(|a| a.len()).unwrap_or(0)))
        });
        match result {
            Ok(Ok(info)) => eprintln!("ok    {name}: {info}"),
            Ok(Err(e)) => {
                failures += 1;
                eprintln!("FAIL  {name}: {e}");
            }
            Err(_) => {
                failures += 1;
                eprintln!("PANIC {name}");
            }
        }
    }
    eprintln!("{failures} failures");
}

#[test]
#[ignore]
fn one_file() {
    let Ok(path) = std::env::var("DOCX_FILE") else { return };
    let bytes = std::fs::read(path).unwrap();
    let t = std::time::Instant::now();
    let pkg = Package::read(&bytes).unwrap();
    eprintln!("zip {:?}", t.elapsed());
    let text = pkg.text("word/document.xml").unwrap();
    let doc = super::xml::parse(&text).unwrap();
    eprintln!("parsed {:?} {} nodes", t.elapsed(), doc.descendants().count());
    let opened = open(&bytes).unwrap();
    eprintln!("opened {:?}", t.elapsed());
    let (_, saved) = resave(&bytes);
    eprintln!("saved {:?} {} bytes", t.elapsed(), saved.len());
    drop(opened);
}

#[test]
#[ignore]
fn one_file_small_stack() {
    let Ok(path) = std::env::var("DOCX_FILE") else { return };
    let bytes = std::fs::read(path).unwrap();
    let run = |name: &'static str, f: Box<dyn FnOnce() + Send>| {
        let ok = std::thread::Builder::new().stack_size(2 << 20).spawn(f).unwrap().join().is_ok();
        eprintln!("{name}: {}", if ok { "ok" } else { "FAILED" });
    };
    let b = bytes.clone();
    run("parse", Box::new(move || {
        let pkg = Package::read(&b).unwrap();
        let text = pkg.text("word/document.xml").unwrap();
        let doc = super::xml::parse(&text).unwrap();
        eprintln!("  nodes {}", doc.descendants().count());
    }));
    let b = bytes.clone();
    run("open", Box::new(move || {
        let _ = open(&b).unwrap();
    }));
}
