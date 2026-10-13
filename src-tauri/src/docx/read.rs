//! WordprocessingML → editor document (ProseMirror JSON).
//!
//! Block content: `paragraph`, `table` (`table_row` → `table_cell`) and
//! `opaque_block`. Inline content: `text` (with marks), `tab`,
//! `hard_break`, `image`, `field_start` / `field_end` and
//! `opaque_inline`. Whatever the editor can't show (equations, shapes,
//! bookmarks, comment anchors…) becomes an opaque node that carries its
//! original XML, so saving writes it back unchanged.

use roxmltree::Node;
use serde_json::{json, Map, Value};

use super::{
    package::{resolve, Rels},
    props::{ppr_attrs, rpr_marks, tblpr_attrs, tcpr_attrs, trpr_attrs},
    xml::{is_w, is_wns, local, raw, rattr, twips, wattr, wchild, A, M, MC, WP},
};

pub struct Ctx<'a> {
    pub src: &'a str,
    pub part: &'a str,
    pub rels: &'a Rels,
    /// Content control properties by id (`w:sdtPr` + `w:sdtEndPr`, raw).
    pub sdts: &'a mut Map<String, Value>,
    pub next_sdt: &'a mut usize,
    field: Field,
    /// Block-level markers (bookmarks…) waiting for a paragraph.
    pending: Vec<Value>,
    /// Tables inside tables; deeper nesting is kept as it is (opaque).
    table_depth: usize,
}

/// Tables nested deeper than this are kept unchanged instead of edited.
const MAX_TABLE_DEPTH: usize = 10;

#[derive(Default)]
struct Field {
    collecting: bool,
    depth: usize,
    xml: String,
    instr: String,
}

impl<'a> Ctx<'a> {
    pub fn new(src: &'a str, part: &'a str, rels: &'a Rels, sdts: &'a mut Map<String, Value>, next_sdt: &'a mut usize) -> Ctx<'a> {
        Ctx { src, part, rels, sdts, next_sdt, field: Field::default(), pending: Vec::new(), table_depth: 0 }
    }
}

fn sort_marks(marks: &mut [Value]) {
    marks.sort_by(|a, b| a["type"].as_str().unwrap_or("").cmp(b["type"].as_str().unwrap_or("")));
}

fn with_marks(mut node: Value, marks: &[Value]) -> Value {
    if !marks.is_empty() {
        node["marks"] = Value::Array(marks.to_vec());
    }
    node
}

/// Appends text, joining it to the previous text node when the marks match.
fn push_text(out: &mut Vec<Value>, text: &str, marks: &[Value]) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = out.last_mut() {
        if last["type"] == "text" {
            let same = match last.get("marks") {
                Some(Value::Array(m)) => m.as_slice() == marks,
                _ => marks.is_empty(),
            };
            if same {
                let joined = format!("{}{}", last["text"].as_str().unwrap_or(""), text);
                last["text"] = Value::String(joined);
                return;
            }
        }
    }
    out.push(with_marks(json!({ "type": "text", "text": text }), marks));
}

fn opaque(xml: &str, kind: &str, label: &str, text: &str, hidden: bool, wrappers: &[Value]) -> Value {
    with_marks(
        json!({
            "type": "opaque_inline",
            "attrs": { "xml": xml, "kind": kind, "label": label, "text": text, "hidden": hidden }
        }),
        wrappers,
    )
}

const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";

/// `xml:space="preserve"` on the element or an ancestor.
fn preserves_space(node: Node) -> bool {
    node.ancestors().find_map(|n| n.attribute((XML_NS, "space"))).map(|v| v == "preserve").unwrap_or(false)
}

/// All `w:t` / `m:t` text below a node (previews of text boxes, equations, notes).
pub fn plain_text(node: Node) -> String {
    let mut out = String::new();
    for d in node.descendants() {
        if d.is_element() && d.tag_name().name() == "t" {
            if let Some(t) = d.text() {
                out.push_str(t);
            }
        } else if is_w(d, "tab") {
            out.push('\t');
        } else if is_w(d, "p") && !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
    }
    out.trim().to_string()
}

fn graphic_label(node: Node) -> (&'static str, &'static str) {
    for d in node.descendants() {
        if d.is_element() && d.tag_name().name() == "graphicData" {
            let uri = d.attribute("uri").unwrap_or("");
            return if uri.contains("/picture") {
                ("picture", "Picture")
            } else if uri.contains("/chart") {
                ("chart", "Chart")
            } else if uri.contains("/diagram") {
                ("smartart", "SmartArt")
            } else if uri.contains("wordprocessingShape") {
                if node.descendants().any(|n| n.tag_name().name() == "txbx") {
                    ("textbox", "Text box")
                } else {
                    ("shape", "Shape")
                }
            } else if uri.contains("wordprocessingGroup") {
                ("group", "Group")
            } else if uri.contains("wordprocessingCanvas") {
                ("canvas", "Drawing canvas")
            } else if uri.contains("ink") {
                ("ink", "Ink")
            } else {
                ("object", "Object")
            };
        }
    }
    ("object", "Object")
}

/// True for picture formats the editor can display.
fn drawable_image(target: &str) -> bool {
    let ext = target.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "jpe" | "gif" | "bmp" | "svg" | "webp" | "ico")
}

/// A `w:drawing` holding a picture → image attributes.
fn picture(ctx: &Ctx, drawing: Node) -> Option<Value> {
    let holder = drawing
        .children()
        .find(|c| c.is_element() && c.tag_name().namespace() == Some(WP) && matches!(local(*c), "inline" | "anchor"))?;
    let anchor = local(holder) == "anchor";
    let extent = holder.children().find(|c| c.is_element() && local(*c) == "extent")?;
    let cx: i64 = extent.attribute("cx")?.parse().ok()?;
    let cy: i64 = extent.attribute("cy")?.parse().ok()?;
    let doc_pr = holder.children().find(|c| c.is_element() && local(*c) == "docPr");
    // A picture can name several images (a Mac-only PDF with a PNG
    // fallback…): show the first one a browser can draw.
    let images: Vec<_> = holder
        .descendants()
        .filter(|d| d.is_element() && d.tag_name().namespace() == Some(A) && local(*d) == "blip")
        .filter_map(|blip| {
            let rid = rattr(blip, "embed").or_else(|| rattr(blip, "link"))?;
            Some((rid, ctx.rels.get(rid)?))
        })
        .collect();
    let (rid, rel) = images.iter().find(|(_, rel)| drawable_image(&rel.target)).or(images.first()).copied()?;
    let target = if rel.external { rel.target.clone() } else { resolve(ctx.part, &rel.target) };
    Some(json!({
        "rid": rid,
        "target": target,
        "external": rel.external,
        "cx": cx,
        "cy": cy,
        "alt": doc_pr.and_then(|d| d.attribute("descr")).unwrap_or(""),
        "title": doc_pr.and_then(|d| d.attribute("title")).unwrap_or(""),
        "name": doc_pr.and_then(|d| d.attribute("name")).unwrap_or(""),
        "anchor": anchor,
        "raw": raw(ctx.src, drawing),
    }))
}

impl<'a> Ctx<'a> {
    /// Block content of a body, cell, header, footer or content control.
    pub fn blocks(&mut self, parent: Node, sdt: Option<&str>, out: &mut Vec<Value>) {
        for c in parent.children().filter(|c| c.is_element()) {
            let ns = c.tag_name().namespace();
            if is_wns(ns) {
                match local(c) {
                    "p" => {
                        let p = self.paragraph(c, sdt);
                        out.push(p);
                    }
                    "tbl" => {
                        let t = self.table(c, sdt);
                        out.push(t);
                    }
                    "sdt" => self.block_sdt(c, sdt, out),
                    "customXml" | "smartTag" => {
                        if let Some(content) = wchild(c, "customXmlContent") {
                            self.blocks(content, sdt, out);
                        } else {
                            self.blocks(c, sdt, out);
                        }
                    }
                    "sectPr" | "tcPr" | "pPr" | "tblPr" | "trPr" | "proofErr" => {}
                    "bookmarkStart" | "bookmarkEnd" | "commentRangeStart" | "commentRangeEnd" | "permStart" | "permEnd"
                    | "moveFromRangeStart" | "moveFromRangeEnd" | "moveToRangeStart" | "moveToRangeEnd"
                    | "customXmlInsRangeStart" | "customXmlInsRangeEnd" | "customXmlDelRangeStart"
                    | "customXmlDelRangeEnd" => {
                        let marker = opaque(raw(self.src, c), "marker", local(c), "", true, &[]);
                        self.attach_marker(out, marker);
                    }
                    _ => out.push(self.opaque_block(c, sdt)),
                }
            } else {
                out.push(self.opaque_block(c, sdt));
            }
        }
        // Markers after the last paragraph stay with it
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            if let Some(last) = out.iter_mut().rev().find(|b| b["type"] == "paragraph") {
                let content = last.as_object_mut().unwrap().entry("content").or_insert_with(|| json!([]));
                if let Some(arr) = content.as_array_mut() {
                    arr.extend(pending);
                }
            } else {
                let mut p = json!({ "type": "paragraph", "content": pending });
                if let Some(s) = sdt {
                    p["attrs"] = json!({ "sdt": s });
                }
                out.push(p);
            }
        }
    }

    fn attach_marker(&mut self, out: &mut [Value], marker: Value) {
        // A marker after a paragraph belongs at its end (bookmark ends,
        // comment range ends); otherwise it waits for the next paragraph.
        let is_end = marker["attrs"]["label"].as_str().map(|l| l.ends_with("End")).unwrap_or(false);
        if is_end {
            if let Some(last) = out.last_mut().filter(|b| b["type"] == "paragraph") {
                let content = last.as_object_mut().unwrap().entry("content").or_insert_with(|| json!([]));
                if let Some(arr) = content.as_array_mut() {
                    arr.push(marker);
                    return;
                }
            }
        }
        self.pending.push(marker);
    }

    fn opaque_block(&mut self, node: Node, sdt: Option<&str>) -> Value {
        let (kind, label) = match local(node) {
            "altChunk" => ("altChunk", "Imported content"),
            "oMathPara" | "oMath" => ("math", "Equation"),
            _ => ("block", "Content"),
        };
        let mut attrs = json!({ "xml": raw(self.src, node), "kind": kind, "label": label, "text": plain_text(node) });
        if let Some(s) = sdt {
            attrs["sdt"] = json!(s);
        }
        json!({ "type": "opaque_block", "attrs": attrs })
    }

    fn new_sdt(&mut self, sdt: Node, parent: Option<&str>) -> String {
        *self.next_sdt += 1;
        let own = format!("s{}", self.next_sdt);
        let props: String = sdt
            .children()
            .filter(|c| is_w(*c, "sdtPr") || is_w(*c, "sdtEndPr"))
            .map(|c| raw(self.src, c).to_string())
            .collect();
        self.sdts.insert(own.clone(), Value::String(props));
        match parent {
            Some(p) => format!("{p}/{own}"),
            None => own,
        }
    }

    fn block_sdt(&mut self, sdt: Node, parent: Option<&str>, out: &mut Vec<Value>) {
        let id = self.new_sdt(sdt, parent);
        if let Some(content) = wchild(sdt, "sdtContent") {
            let before = out.len();
            self.blocks(content, Some(&id), out);
            if out.len() == before {
                // An empty control: keep it as an empty paragraph inside it
                out.push(json!({ "type": "paragraph", "attrs": { "sdt": id } }));
            }
        }
    }

    pub fn paragraph(&mut self, p: Node, sdt: Option<&str>) -> Value {
        let mut attrs = match wchild(p, "pPr") {
            Some(ppr) => ppr_attrs(self.src, ppr),
            None => Map::new(),
        };
        if let Some(s) = sdt {
            attrs.insert("sdt".into(), json!(s));
        }
        let mut content: Vec<Value> = std::mem::take(&mut self.pending);
        self.inline_children(p, &[], &mut content);
        // A field instruction left open at the end of the paragraph
        if self.field.collecting && !self.field.xml.is_empty() {
            let xml = std::mem::take(&mut self.field.xml);
            content.push(opaque(&xml, "fieldPart", "Field", "", true, &[]));
        }
        let mut node = json!({ "type": "paragraph" });
        if !attrs.is_empty() {
            node["attrs"] = Value::Object(attrs);
        }
        if !content.is_empty() {
            node["content"] = Value::Array(content);
        }
        node
    }

    fn wrapped(&self, wrappers: &[Value], extra: Value) -> Vec<Value> {
        let mut w = wrappers.to_vec();
        let kind = extra["type"].clone();
        w.retain(|m| m["type"] != kind);
        w.push(extra);
        sort_marks(&mut w);
        w
    }

    /// Children of a paragraph or of an inline wrapper (hyperlink, ins…).
    fn inline_children(&mut self, parent: Node, wrappers: &[Value], out: &mut Vec<Value>) {
        for c in parent.children().filter(|c| c.is_element()) {
            self.inline(c, wrappers, out);
        }
    }

    fn inline(&mut self, c: Node, wrappers: &[Value], out: &mut Vec<Value>) {
        let ns = c.tag_name().namespace();
        if ns == Some(M) {
            let text = plain_text(c);
            out.push(opaque(raw(self.src, c), "math", "Equation", &text, false, wrappers));
            return;
        }
        if ns == Some(MC) {
            let (kind, label) = graphic_label(c);
            out.push(opaque(raw(self.src, c), kind, label, &plain_text(c), false, wrappers));
            return;
        }
        if !is_wns(ns) {
            out.push(opaque(raw(self.src, c), "unknown", local(c), "", true, wrappers));
            return;
        }
        match local(c) {
            "pPr" | "proofErr" => {}
            "r" => self.run(c, wrappers, out),
            "hyperlink" => {
                let href = rattr(c, "id")
                    .and_then(|id| self.rels.get(id))
                    .map(|r| r.target.clone());
                let link = json!({
                    "type": "link",
                    "attrs": {
                        "href": href,
                        "anchor": wattr(c, "anchor"),
                        "tooltip": wattr(c, "tooltip"),
                        "tgtFrame": wattr(c, "tgtFrame"),
                        "docLocation": wattr(c, "docLocation"),
                        "history": wattr(c, "history"),
                    }
                });
                let w = self.wrapped(wrappers, link);
                self.inline_children(c, &w, out);
            }
            "ins" | "moveTo" | "del" | "moveFrom" => {
                let kind = if matches!(local(c), "ins" | "moveTo") { "ins" } else { "del" };
                let m = json!({
                    "type": kind,
                    "attrs": {
                        "id": wattr(c, "id"),
                        "author": wattr(c, "author"),
                        "date": wattr(c, "date"),
                        "move": matches!(local(c), "moveTo" | "moveFrom"),
                    }
                });
                let w = self.wrapped(wrappers, m);
                self.inline_children(c, &w, out);
            }
            "sdt" => {
                let parent = wrappers.iter().find(|m| m["type"] == "sdt").and_then(|m| m["attrs"]["id"].as_str()).map(String::from);
                let id = self.new_sdt(c, parent.as_deref());
                let m = json!({ "type": "sdt", "attrs": { "id": id } });
                let w = self.wrapped(wrappers, m);
                if let Some(content) = wchild(c, "sdtContent") {
                    self.inline_children(content, &w, out);
                }
            }
            "smartTag" | "customXml" | "dir" | "bdo" => self.inline_children(c, wrappers, out),
            "fldSimple" => {
                let instr = wattr(c, "instr").unwrap_or("").trim().to_string();
                out.push(with_marks(
                    json!({ "type": "field_start", "attrs": { "instr": instr, "xml": "" } }),
                    wrappers,
                ));
                self.inline_children(c, wrappers, out);
                out.push(with_marks(json!({ "type": "field_end", "attrs": { "xml": "" } }), wrappers));
            }
            name => {
                let hidden = name.ends_with("Start") || name.ends_with("End");
                out.push(opaque(raw(self.src, c), if hidden { "marker" } else { "unknown" }, name, "", hidden, wrappers));
            }
        }
    }

    fn run(&mut self, r: Node, wrappers: &[Value], out: &mut Vec<Value>) {
        let rpr = wchild(r, "rPr");
        let rpr_raw = rpr.map(|n| raw(self.src, n)).unwrap_or("");
        let mut marks = rpr.map(|n| rpr_marks(self.src, n)).unwrap_or_default();
        marks.extend(wrappers.iter().cloned());
        sort_marks(&mut marks);
        let as_run = |child: &str| format!("<w:r>{rpr_raw}{child}</w:r>");
        for c in r.children().filter(|c| c.is_element()) {
            if is_w(c, "rPr") {
                continue;
            }
            let name = local(c);
            let wns = is_wns(c.tag_name().namespace());
            if self.field.collecting {
                let kind = if wns && name == "fldChar" { wattr(c, "fldCharType").unwrap_or("") } else { "" };
                match kind {
                    "begin" => {
                        self.field.depth += 1;
                        self.field.xml.push_str(&as_run(raw(self.src, c)));
                    }
                    "separate" if self.field.depth == 1 => {
                        self.field.xml.push_str(&as_run(raw(self.src, c)));
                        self.finish_field(wrappers, out);
                    }
                    "end" if self.field.depth == 1 => {
                        // A field without a result
                        self.finish_field(wrappers, out);
                        out.push(with_marks(
                            json!({ "type": "field_end", "attrs": { "xml": as_run(raw(self.src, c)) } }),
                            wrappers,
                        ));
                    }
                    "end" => {
                        self.field.depth -= 1;
                        self.field.xml.push_str(&as_run(raw(self.src, c)));
                    }
                    _ => {
                        if wns && name == "instrText" && self.field.depth == 1 {
                            self.field.instr.push_str(c.text().unwrap_or(""));
                        }
                        self.field.xml.push_str(&as_run(raw(self.src, c)));
                    }
                }
                continue;
            }
            if !wns {
                let (kind, label) = graphic_label(c);
                out.push(opaque(&as_run(raw(self.src, c)), kind, label, &plain_text(c), false, wrappers));
                continue;
            }
            match name {
                "t" | "delText" => {
                    let text = c.text().unwrap_or("");
                    if preserves_space(c) {
                        push_text(out, text, &marks);
                    } else {
                        // Without xml:space="preserve", Word drops the spaces around the text
                        let trimmed = text.trim_matches(|ch: char| ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r');
                        push_text(out, &trimmed.replace(['\r', '\n'], " "), &marks);
                    }
                }
                "tab" => out.push(with_marks(json!({ "type": "tab" }), &marks)),
                // An alignment tab (headers and footers: centre, right)
                "ptab" => out.push(with_marks(
                    json!({ "type": "tab", "attrs": {
                        "align": wattr(c, "alignment").unwrap_or("left"),
                        "relativeTo": wattr(c, "relativeTo").unwrap_or("margin"),
                        "leader": wattr(c, "leader").unwrap_or("none"),
                    } }),
                    &marks,
                )),
                "br" => {
                    let kind = match wattr(c, "type") {
                        Some("page") => "page",
                        Some("column") => "column",
                        _ => "line",
                    };
                    out.push(with_marks(
                        json!({ "type": "hard_break", "attrs": { "type": kind, "clear": wattr(c, "clear") } }),
                        &marks,
                    ));
                }
                "cr" => out.push(with_marks(json!({ "type": "hard_break", "attrs": { "type": "line" } }), &marks)),
                "noBreakHyphen" => push_text(out, "\u{2011}", &marks),
                "softHyphen" => push_text(out, "\u{00AD}", &marks),
                "lastRenderedPageBreak" => {}
                "fldChar" => match wattr(c, "fldCharType") {
                    Some("begin") => {
                        self.field = Field { collecting: true, depth: 1, xml: as_run(raw(self.src, c)), instr: String::new() };
                    }
                    Some("end") => out.push(with_marks(
                        json!({ "type": "field_end", "attrs": { "xml": as_run(raw(self.src, c)) } }),
                        wrappers,
                    )),
                    _ => out.push(opaque(&as_run(raw(self.src, c)), "fieldPart", "Field", "", true, wrappers)),
                },
                "drawing" => match picture(self, c) {
                    Some(attrs) => out.push(with_marks(json!({ "type": "image", "attrs": attrs }), &marks)),
                    None => {
                        let (kind, label) = graphic_label(c);
                        out.push(opaque(&as_run(raw(self.src, c)), kind, label, &plain_text(c), false, wrappers));
                    }
                },
                "pict" | "object" => {
                    let is_box = c.descendants().any(|d| d.tag_name().name() == "textbox");
                    let (kind, label) = if name == "object" {
                        ("object", "Embedded object")
                    } else if is_box {
                        ("textbox", "Text box")
                    } else {
                        ("shape", "Shape")
                    };
                    out.push(opaque(&as_run(raw(self.src, c)), kind, label, &plain_text(c), false, wrappers));
                }
                "footnoteReference" | "endnoteReference" => {
                    let kind = if name == "footnoteReference" { "footnote" } else { "endnote" };
                    let mut node = opaque(&as_run(raw(self.src, c)), kind, kind, "", false, wrappers);
                    node["attrs"]["noteId"] = json!(wattr(c, "id"));
                    out.push(node);
                }
                "commentReference" => {
                    let mut node = opaque(&as_run(raw(self.src, c)), "comment", "Comment", "", false, wrappers);
                    node["attrs"]["noteId"] = json!(wattr(c, "id"));
                    out.push(node);
                }
                "sym" => {
                    let ch = wattr(c, "char")
                        .and_then(|h| u32::from_str_radix(h, 16).ok())
                        .map(|code| if code >= 0xF000 { code - 0xF000 } else { code })
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                        .unwrap_or_default();
                    out.push(opaque(&as_run(raw(self.src, c)), "sym", wattr(c, "font").unwrap_or("Symbol"), &ch, false, wrappers));
                }
                // The note's own number, at the start of a footnote or endnote
                "footnoteRef" | "endnoteRef" => {
                    let kind = if name == "footnoteRef" { "footnote" } else { "endnote" };
                    out.push(opaque(&as_run(raw(self.src, c)), "noteRef", kind, "", false, wrappers));
                }
                "instrText" | "delInstrText" => {
                    out.push(opaque(&as_run(raw(self.src, c)), "fieldPart", "Field", "", true, wrappers));
                }
                other => {
                    out.push(opaque(&as_run(raw(self.src, c)), "run", other, "", true, wrappers));
                }
            }
        }
    }

    /// Rows of a table / cells of a row, looking through content controls
    /// (kept as an id on the row or cell) and custom XML.
    fn collect<'n, 'i>(&mut self, node: Node<'n, 'i>, name: &str, sdt: Option<&str>, out: &mut Vec<(Node<'n, 'i>, Option<String>)>) {
        for c in node.children().filter(|c| c.is_element()) {
            if is_w(c, name) {
                out.push((c, sdt.map(String::from)));
            } else if is_w(c, "sdt") {
                let id = self.new_sdt(c, sdt);
                if let Some(content) = wchild(c, "sdtContent") {
                    self.collect(content, name, Some(&id), out);
                }
            } else if is_w(c, "customXml") {
                self.collect(c, name, sdt, out);
            }
        }
    }

    fn finish_field(&mut self, wrappers: &[Value], out: &mut Vec<Value>) {
        let field = std::mem::take(&mut self.field);
        out.push(with_marks(
            json!({ "type": "field_start", "attrs": { "instr": field.instr.trim(), "xml": field.xml } }),
            wrappers,
        ));
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    fn table(&mut self, tbl: Node, sdt: Option<&str>) -> Value {
        if self.table_depth >= MAX_TABLE_DEPTH {
            return self.opaque_block(tbl, sdt);
        }
        self.table_depth += 1;
        let value = self.table_inner(tbl, sdt);
        self.table_depth -= 1;
        value
    }

    fn table_inner(&mut self, tbl: Node, sdt: Option<&str>) -> Value {
        let mut attrs = match wchild(tbl, "tblPr") {
            Some(p) => tblpr_attrs(self.src, p),
            None => Map::new(),
        };
        let grid: Vec<f64> = wchild(tbl, "tblGrid")
            .map(|g| {
                g.children()
                    .filter(|c| is_w(*c, "gridCol"))
                    .map(|c| wattr(c, "w").and_then(twips).unwrap_or(0.0))
                    .collect()
            })
            .unwrap_or_default();
        attrs.insert("grid".into(), json!(grid));
        if let Some(s) = sdt {
            attrs.insert("sdt".into(), json!(s));
        }

        // Rows, including rows wrapped in content controls / custom XML
        let mut tr_nodes = Vec::new();
        self.collect(tbl, "tr", None, &mut tr_nodes);

        struct Cell {
            attrs: Map<String, Value>,
            content: Vec<Value>,
            col: usize,
            span: usize,
            rowspan: usize,
            vmerge: Option<String>,
        }
        let mut rows: Vec<(Map<String, Value>, Vec<Cell>)> = Vec::new();
        for (tr, row_sdt) in tr_nodes {
            let mut row_attrs = match wchild(tr, "trPr") {
                Some(p) => trpr_attrs(self.src, p),
                None => Map::new(),
            };
            if let Some(id) = row_sdt {
                row_attrs.insert("sdt".into(), json!(id));
            }
            if let Some(ex) = wchild(tr, "tblPrEx") {
                row_attrs.insert("ex".into(), json!(raw(self.src, ex)));
            }
            let mut col = wchild(tr, "trPr")
                .and_then(|p| wchild(p, "gridBefore"))
                .and_then(|g| wattr(g, "val"))
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(0);
            let mut cells = Vec::new();
            let mut tcs = Vec::new();
            self.collect(tr, "tc", None, &mut tcs);
            for (tc, cell_sdt) in tcs {
                let (mut cell_attrs, span, vmerge) = match wchild(tc, "tcPr") {
                    Some(p) => tcpr_attrs(self.src, p),
                    None => (Map::new(), 1, None),
                };
                if let Some(id) = cell_sdt {
                    cell_attrs.insert("sdt".into(), json!(id));
                }
                let mut content = Vec::new();
                self.blocks(tc, None, &mut content);
                if content.is_empty() {
                    content.push(json!({ "type": "paragraph" }));
                }
                cells.push(Cell { attrs: cell_attrs, content, col, span, rowspan: 1, vmerge });
                col += span;
            }
            rows.push((row_attrs, cells));
        }

        // Vertical merges: a "restart" cell grows over the "continue" cells below it
        for r in 0..rows.len() {
            for i in 0..rows[r].1.len() {
                if rows[r].1[i].vmerge.as_deref() != Some("restart") {
                    continue;
                }
                let col = rows[r].1[i].col;
                let mut span = 1;
                for below in rows.iter().skip(r + 1) {
                    let cont = below.1.iter().any(|c| c.col == col && c.vmerge.as_deref().map(|v| v != "restart").unwrap_or(false));
                    if !cont {
                        break;
                    }
                    span += 1;
                }
                rows[r].1[i].rowspan = span;
            }
        }
        // Fractional pixels, so widths come back exactly when untouched
        let px = |tw: f64| ((tw / 15.0) * 1000.0).round() / 1000.0;
        let mut row_values = Vec::new();
        for (row_attrs, cells) in rows {
            let mut cell_values = Vec::new();
            for cell in cells {
                // continuation cells are covered by the cell above
                if cell.vmerge.as_deref().map(|v| v != "restart").unwrap_or(false) {
                    continue;
                }
                let colwidth: Option<Vec<f64>> = if grid.len() >= cell.col + cell.span {
                    Some(grid[cell.col..cell.col + cell.span].iter().map(|w| px(*w)).collect())
                } else {
                    cell.attrs
                        .get("tcW")
                        .and_then(|w| if w.get("type").and_then(|t| t.as_str()).unwrap_or("dxa") == "dxa" { w.get("w") } else { None })
                        .and_then(|w| w.as_str())
                        .and_then(twips)
                        .map(|w| vec![px(w / cell.span as f64); cell.span])
                };
                let mut attrs = cell.attrs;
                attrs.insert("colspan".into(), json!(cell.span));
                attrs.insert("rowspan".into(), json!(cell.rowspan));
                attrs.insert("colwidth".into(), json!(colwidth));
                cell_values.push(json!({ "type": "table_cell", "attrs": attrs, "content": cell.content }));
            }
            if cell_values.is_empty() {
                continue;
            }
            let mut row = json!({ "type": "table_row", "content": cell_values });
            if !row_attrs.is_empty() {
                row["attrs"] = Value::Object(row_attrs);
            }
            row_values.push(row);
        }
        if row_values.is_empty() {
            // A table without rows can't be edited: keep it as it is
            return self.opaque_block(tbl, sdt);
        }
        json!({ "type": "table", "attrs": attrs, "content": row_values })
    }
}

