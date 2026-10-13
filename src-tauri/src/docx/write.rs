//! Editor document (ProseMirror JSON) → WordprocessingML.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use super::{
    package::{image_content_type, relative, ContentTypes, Package, Rels, REL_HYPERLINK, REL_IMAGE},
    props::{ppr_xml, rpr_xml, tblpr_xml, tcpr_xml, trpr_xml},
    xml::{attrs_xml, esc, esc_text, local, ordered, KNOWN_NS, SECTPR_ORDER},
};

/// What a part being written needs from the document.
pub struct PartWriter<'a> {
    pub part: String,
    pub rels: Rels,
    pub pkg: &'a mut Package,
    pub ct: &'a mut ContentTypes,
    pub sdts: &'a Map<String, Value>,
    pub media: &'a BTreeMap<String, Vec<u8>>,
    pub used_styles: &'a mut BTreeSet<String>,
    pub doc_pr: &'a mut DocPrIds,
    /// Text width in twips (for tables without column widths).
    pub text_width: f64,
    /// Open fields and bookmarks (unbalanced ones are dropped).
    fields_open: usize,
}

/// `wp:docPr` ids must be unique in the document.
#[derive(Default)]
pub struct DocPrIds {
    used: BTreeSet<u64>,
    next: u64,
}

impl DocPrIds {
    /// An id already used by a part that isn't rewritten.
    pub fn register(&mut self, id: u64) {
        self.used.insert(id);
        self.next = self.next.max(id + 1);
    }

    fn take(&mut self, wanted: Option<u64>) -> u64 {
        if let Some(w) = wanted {
            if w > 0 && self.used.insert(w) {
                self.next = self.next.max(w + 1);
                return w;
            }
        }
        let mut id = self.next.max(1);
        while self.used.contains(&id) {
            id += 1;
        }
        self.used.insert(id);
        self.next = id + 1;
        id
    }
}

fn s<'v>(v: &'v Value, key: &str) -> Option<&'v str> {
    v.get(key).and_then(|x| x.as_str())
}

fn marks_of(node: &Value) -> &[Value] {
    node.get("marks").and_then(|m| m.as_array()).map(|v| v.as_slice()).unwrap_or(&[])
}

fn mark<'v>(node: &'v Value, kind: &str) -> Option<&'v Value> {
    marks_of(node).iter().find(|m| m["type"] == kind)
}

/// Wrapper elements around runs, outermost first.
#[derive(Clone, PartialEq, Debug)]
enum Wrap {
    Sdt(String),
    Link(Value),
    Ins(Value),
    Del(Value),
}

fn wraps(node: &Value) -> Vec<Wrap> {
    let mut out = Vec::new();
    if let Some(path) = mark(node, "sdt").and_then(|m| s(&m["attrs"], "id")) {
        for seg in path.split('/') {
            out.push(Wrap::Sdt(seg.to_string()));
        }
    }
    if let Some(l) = mark(node, "link") {
        let a = &l["attrs"];
        if s(a, "href").is_some() || s(a, "anchor").is_some() {
            out.push(Wrap::Link(a.clone()));
        }
    }
    if let Some(m) = mark(node, "ins") {
        out.push(Wrap::Ins(m["attrs"].clone()));
    }
    if let Some(m) = mark(node, "del") {
        out.push(Wrap::Del(m["attrs"].clone()));
    }
    out
}

fn change_attrs(a: &Value) -> String {
    let mut out = String::new();
    for key in ["id", "author", "date"] {
        if let Some(v) = s(a, key) {
            out.push_str(&format!(" w:{key}=\"{}\"", esc(v)));
        }
    }
    out
}

/// Replaces the value of `attr` inside the first tag whose name ends with `tag`.
fn patch_tag_attr(xml: &str, tag: &str, attr: &str, value: &str) -> String {
    let mut pos = 0;
    while let Some(i) = xml[pos..].find('<') {
        let start = pos + i;
        let name_end = xml[start + 1..].find(|c: char| c.is_whitespace() || c == '>' || c == '/').map(|e| start + 1 + e);
        let Some(name_end) = name_end else { break };
        let name = &xml[start + 1..name_end];
        if name.ends_with(tag) && (name.len() == tag.len() || name.as_bytes()[name.len() - tag.len() - 1] == b':') {
            let tag_end = xml[start..].find('>').map(|e| start + e).unwrap_or(xml.len());
            let head = &xml[start..tag_end];
            let needle = format!(" {attr}=\"");
            if let Some(a) = head.find(&needle) {
                let vstart = start + a + needle.len();
                if let Some(vlen) = xml[vstart..].find('"') {
                    return format!("{}{}{}", &xml[..vstart], esc(value), &xml[vstart + vlen..]);
                }
            }
            return xml.to_string();
        }
        pos = start + 1;
    }
    xml.to_string()
}

/// Like `patch_tag_attr`, for every `tag` element.
fn patch_every_tag_attr(xml: &str, tag: &str, attr: &str, value: &str) -> String {
    let mut starts = vec![];
    let mut pos = 0;
    while let Some(i) = xml[pos..].find('<') {
        let start = pos + i;
        let Some(name_end) = xml[start + 1..].find(|c: char| c.is_whitespace() || c == '>' || c == '/').map(|e| start + 1 + e) else { break };
        let name = &xml[start + 1..name_end];
        if name.ends_with(tag) && (name.len() == tag.len() || name.as_bytes()[name.len() - tag.len() - 1] == b':') {
            starts.push(start);
        }
        pos = start + 1;
    }
    let mut out = xml.to_string();
    for start in starts.into_iter().rev() {
        let patched = patch_tag_attr(&out[start..], tag, attr, value);
        out.replace_range(start.., &patched);
    }
    out
}

/// An attribute of the first `tag` element of a fragment.
pub fn tag_attr_value<'x>(xml: &'x str, tag: &str, attr: &str) -> Option<&'x str> {
    tag_attr(xml, tag, attr)
}

/// Sets an attribute of the first `tag` element (adding it when missing).
pub fn set_tag_attr(xml: &str, tag: &str, attr: &str, value: &str) -> String {
    if tag_attr(xml, tag, attr).is_some() {
        return patch_tag_attr(xml, tag, attr, value);
    }
    let Some(start) = xml.find(&format!("<w:{tag}")) else { return xml.to_string() };
    let at = start + tag.len() + 3;
    format!("{} {attr}=\"{}\"{}", &xml[..at], esc(value), &xml[at..])
}

fn tag_attr<'x>(xml: &'x str, tag: &str, attr: &str) -> Option<&'x str> {
    let mut pos = 0;
    while let Some(i) = xml[pos..].find('<') {
        let start = pos + i;
        let name_end = xml[start + 1..].find(|c: char| c.is_whitespace() || c == '>' || c == '/').map(|e| start + 1 + e)?;
        let name = &xml[start + 1..name_end];
        if name.ends_with(tag) && (name.len() == tag.len() || name.as_bytes()[name.len() - tag.len() - 1] == b':') {
            let tag_end = xml[start..].find('>').map(|e| start + e)?;
            let head = &xml[start..tag_end];
            let needle = format!(" {attr}=\"");
            let a = head.find(&needle)?;
            let vstart = start + a + needle.len();
            let vlen = xml[vstart..].find('"')?;
            return Some(&xml[vstart..vstart + vlen]);
        }
        pos = start + 1;
    }
    None
}

impl<'a> PartWriter<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        part: &str,
        rels: Rels,
        pkg: &'a mut Package,
        ct: &'a mut ContentTypes,
        sdts: &'a Map<String, Value>,
        media: &'a BTreeMap<String, Vec<u8>>,
        used_styles: &'a mut BTreeSet<String>,
        doc_pr: &'a mut DocPrIds,
        text_width: f64,
    ) -> PartWriter<'a> {
        PartWriter { part: part.to_string(), rels, pkg, ct, sdts, media, used_styles, doc_pr, text_width, fields_open: 0 }
    }

    // ------------------------------------------------------------------
    // Blocks
    // ------------------------------------------------------------------

    /// Block content; `require_last_paragraph` for cells, headers and the body.
    pub fn blocks(&mut self, blocks: &[Value], require_last_paragraph: bool) -> String {
        let mut out = self.blocks_at(blocks, 0);
        let last_is_p = blocks.last().map(|b| b["type"] == "paragraph").unwrap_or(false);
        if require_last_paragraph && !last_is_p {
            out.push_str("<w:p/>");
        }
        out
    }

    fn sdt_seg(block: &Value, depth: usize) -> Option<String> {
        let path = s(&block["attrs"], "sdt")?;
        path.split('/').nth(depth).map(String::from)
    }

    fn blocks_at(&mut self, blocks: &[Value], depth: usize) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < blocks.len() {
            match Self::sdt_seg(&blocks[i], depth) {
                None => {
                    out.push_str(&self.block(&blocks[i]));
                    i += 1;
                }
                Some(seg) => {
                    let mut j = i;
                    while j < blocks.len() && Self::sdt_seg(&blocks[j], depth).as_deref() == Some(seg.as_str()) {
                        j += 1;
                    }
                    let inner = self.blocks_at(&blocks[i..j], depth + 1);
                    match self.sdts.get(&seg).and_then(|p| p.as_str()) {
                        Some(props) => {
                            out.push_str(&format!("<w:sdt>{props}<w:sdtContent>{inner}</w:sdtContent></w:sdt>"));
                        }
                        None => out.push_str(&inner),
                    }
                    i = j;
                }
            }
        }
        out
    }

    fn block(&mut self, b: &Value) -> String {
        match b["type"].as_str().unwrap_or("") {
            "paragraph" => self.paragraph(b),
            "table" => self.table(b),
            "opaque_block" => s(&b["attrs"], "xml").unwrap_or("").to_string(),
            _ => String::new(),
        }
    }

    fn note_styles(&mut self, attrs: &Value) {
        if let Some(st) = s(attrs, "style") {
            self.used_styles.insert(st.to_string());
        }
    }

    fn note_char_styles(&mut self, marks: &[Value]) {
        for m in marks {
            if m["type"] == "cstyle" {
                if let Some(id) = s(&m["attrs"], "id") {
                    self.used_styles.insert(id.to_string());
                }
            }
        }
    }

    fn paragraph(&mut self, p: &Value) -> String {
        let attrs = p.get("attrs").cloned().unwrap_or(Value::Null);
        self.note_styles(&attrs);
        if let Some(pm) = attrs.get("pm").and_then(|v| v.as_array()) {
            self.note_char_styles(pm);
        }
        let mut out = String::from("<w:p>");
        out.push_str(&ppr_xml(&attrs));
        let content = p.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
        out.push_str(&self.inline(&content));
        out.push_str("</w:p>");
        out
    }

    // ------------------------------------------------------------------
    // Inline content
    // ------------------------------------------------------------------

    fn inline(&mut self, nodes: &[Value]) -> String {
        let keyed: Vec<(Vec<Wrap>, &Value)> = nodes.iter().map(|n| (wraps(n), n)).collect();
        self.inline_at(&keyed, 0)
    }

    fn inline_at(&mut self, nodes: &[(Vec<Wrap>, &Value)], depth: usize) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < nodes.len() {
            match nodes[i].0.get(depth).cloned() {
                None => {
                    let in_del = nodes[i].0.iter().any(|w| matches!(w, Wrap::Del(_)));
                    out.push_str(&self.leaf(nodes[i].1, in_del));
                    i += 1;
                }
                Some(wrap) => {
                    let mut j = i;
                    while j < nodes.len() && nodes[j].0.get(depth) == Some(&wrap) {
                        j += 1;
                    }
                    let inner = self.inline_at(&nodes[i..j], depth + 1);
                    out.push_str(&self.wrap(&wrap, &inner));
                    i = j;
                }
            }
        }
        out
    }

    fn wrap(&mut self, wrap: &Wrap, inner: &str) -> String {
        match wrap {
            Wrap::Sdt(seg) => match self.sdts.get(seg).and_then(|p| p.as_str()) {
                Some(props) => format!("<w:sdt>{props}<w:sdtContent>{inner}</w:sdtContent></w:sdt>"),
                None => inner.to_string(),
            },
            Wrap::Link(a) => {
                let mut attrs = String::new();
                if let Some(href) = s(a, "href") {
                    let id = self.rels.ensure(REL_HYPERLINK, href, true);
                    attrs.push_str(&format!(" r:id=\"{}\"", esc(&id)));
                }
                for key in ["anchor", "tooltip", "tgtFrame", "docLocation", "history"] {
                    if let Some(v) = s(a, key) {
                        attrs.push_str(&format!(" w:{key}=\"{}\"", esc(v)));
                    }
                }
                format!("<w:hyperlink{attrs}>{inner}</w:hyperlink>")
            }
            Wrap::Ins(a) => {
                let tag = if a.get("move").and_then(|v| v.as_bool()).unwrap_or(false) { "moveTo" } else { "ins" };
                format!("<w:{tag}{}>{inner}</w:{tag}>", change_attrs(a))
            }
            Wrap::Del(a) => {
                let tag = if a.get("move").and_then(|v| v.as_bool()).unwrap_or(false) { "moveFrom" } else { "del" };
                format!("<w:{tag}{}>{inner}</w:{tag}>", change_attrs(a))
            }
        }
    }

    fn run(&mut self, marks: &[Value], content: &str) -> String {
        self.note_char_styles(marks);
        format!("<w:r>{}{content}</w:r>", rpr_xml(marks))
    }

    fn text_content(text: &str, in_del: bool) -> String {
        let tag = if in_del { "delText" } else { "t" };
        let mut out = String::new();
        let mut buf = String::new();
        let flush = |buf: &mut String, out: &mut String| {
            if !buf.is_empty() {
                out.push_str(&format!("<w:{tag} xml:space=\"preserve\">{}</w:{tag}>", esc_text(buf)));
                buf.clear();
            }
        };
        for c in text.chars() {
            match c {
                '\t' => {
                    flush(&mut buf, &mut out);
                    out.push_str("<w:tab/>");
                }
                '\n' | '\r' | '\u{2028}' => {
                    flush(&mut buf, &mut out);
                    out.push_str("<w:br/>");
                }
                '\u{2011}' => {
                    flush(&mut buf, &mut out);
                    out.push_str("<w:noBreakHyphen/>");
                }
                '\u{00AD}' => {
                    flush(&mut buf, &mut out);
                    out.push_str("<w:softHyphen/>");
                }
                c => buf.push(c),
            }
        }
        flush(&mut buf, &mut out);
        out
    }

    fn leaf(&mut self, n: &Value, in_del: bool) -> String {
        let marks = marks_of(n);
        let a = n.get("attrs").cloned().unwrap_or(Value::Null);
        match n["type"].as_str().unwrap_or("") {
            "text" => {
                let content = Self::text_content(n["text"].as_str().unwrap_or(""), in_del);
                self.run(marks, &content)
            }
            "tab" => match s(&a, "align") {
                Some(align) => {
                    let ptab = format!(
                        "<w:ptab w:relativeTo=\"{}\" w:alignment=\"{}\" w:leader=\"{}\"/>",
                        esc(s(&a, "relativeTo").unwrap_or("margin")),
                        esc(align),
                        esc(s(&a, "leader").unwrap_or("none"))
                    );
                    self.run(marks, &ptab)
                }
                None => self.run(marks, "<w:tab/>"),
            },
            "hard_break" => {
                let mut br = String::from("<w:br");
                match s(&a, "type") {
                    Some("page") => br.push_str(" w:type=\"page\""),
                    Some("column") => br.push_str(" w:type=\"column\""),
                    _ => {}
                }
                if let Some(c) = s(&a, "clear") {
                    br.push_str(&format!(" w:clear=\"{}\"", esc(c)));
                }
                br.push_str("/>");
                self.run(marks, &br)
            }
            "image" => self.image(&a, marks),
            "field_start" => {
                self.fields_open += 1;
                match s(&a, "xml").filter(|x| !x.is_empty()) {
                    Some(x) => x.to_string(),
                    None => {
                        let instr = s(&a, "instr").unwrap_or("");
                        let rpr = rpr_xml(marks);
                        format!(
                            "<w:r>{rpr}<w:fldChar w:fldCharType=\"begin\"/></w:r><w:r>{rpr}<w:instrText xml:space=\"preserve\"> {} </w:instrText></w:r><w:r>{rpr}<w:fldChar w:fldCharType=\"separate\"/></w:r>",
                            esc_text(instr)
                        )
                    }
                }
            }
            "field_end" => {
                if self.fields_open == 0 {
                    return String::new();
                }
                self.fields_open -= 1;
                match s(&a, "xml").filter(|x| !x.is_empty()) {
                    Some(x) => x.to_string(),
                    None => format!("<w:r>{}<w:fldChar w:fldCharType=\"end\"/></w:r>", rpr_xml(marks)),
                }
            }
            "opaque_inline" => s(&a, "xml").unwrap_or("").to_string(),
            _ => String::new(),
        }
    }

    /// Closes fields left open (their end was deleted) at the end of a story.
    pub fn close_open_fields(&mut self) -> String {
        let mut out = String::new();
        while self.fields_open > 0 {
            self.fields_open -= 1;
            out.push_str("<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>");
        }
        out
    }

    fn image(&mut self, a: &Value, marks: &[Value]) -> String {
        let external = a.get("external").and_then(|v| v.as_bool()).unwrap_or(false);
        let target = s(a, "target").unwrap_or("").to_string();
        let cx = a.get("cx").and_then(|v| v.as_i64()).unwrap_or(914_400).max(1);
        let cy = a.get("cy").and_then(|v| v.as_i64()).unwrap_or(914_400).max(1);
        let alt = s(a, "alt").unwrap_or("");

        // Make sure the picture is in the package and related to this part
        if !external && !target.is_empty() && !self.pkg.parts.contains_key(&target) {
            if let Some(bytes) = self.media.get(&target) {
                self.pkg.set(&target, bytes.clone());
                if let Some(ext) = target.rsplit('.').next() {
                    self.ct.ensure_default(ext, image_content_type(ext));
                }
            } else {
                return String::new();
            }
        }
        let rel_target = if external { target.clone() } else { relative(&self.part, &target) };
        let wanted_rid = s(a, "rid").filter(|rid| {
            self.rels.get(rid).map(|r| r.target == rel_target || crate::docx::package::resolve(&self.part, &r.target) == target).unwrap_or(false)
        });
        let rid = match wanted_rid {
            Some(r) => r.to_string(),
            None => self.rels.ensure(REL_IMAGE, &rel_target, external),
        };

        if let Some(raw) = s(a, "raw").filter(|r| !r.is_empty()) {
            // The original drawing (keeps wrapping, effects…), patched where it changed
            let mut x = raw.to_string();
            // A new picture: point every image of the drawing at it (a
            // drawing with a fallback image already names it, and stays)
            if tag_attr(&x, "blip", "r:embed").is_some() && !x.contains(&format!("r:embed=\"{rid}\"")) {
                x = patch_every_tag_attr(&x, "blip", "r:embed", &rid);
            }
            if tag_attr(&x, "extent", "cx").and_then(|v| v.parse::<i64>().ok()) != Some(cx)
                || tag_attr(&x, "extent", "cy").and_then(|v| v.parse::<i64>().ok()) != Some(cy)
            {
                x = patch_tag_attr(&x, "extent", "cx", &cx.to_string());
                x = patch_tag_attr(&x, "extent", "cy", &cy.to_string());
                x = patch_tag_attr(&x, "ext", "cx", &cx.to_string());
                x = patch_tag_attr(&x, "ext", "cy", &cy.to_string());
            }
            if tag_attr(&x, "docPr", "descr").unwrap_or("") != alt {
                if tag_attr(&x, "docPr", "descr").is_some() {
                    x = patch_tag_attr(&x, "docPr", "descr", alt);
                } else if let Some(i) = x.find("docPr ") {
                    x.insert_str(i + "docPr ".len(), &format!("descr=\"{}\" ", esc(alt)));
                }
            }
            let wanted = tag_attr(&x, "docPr", "id").and_then(|v| v.parse::<u64>().ok());
            let id = self.doc_pr.take(wanted);
            if Some(id) != wanted {
                x = patch_tag_attr(&x, "docPr", "id", &id.to_string());
            }
            return self.run(marks, &x);
        }

        let id = self.doc_pr.take(None);
        let file = target.rsplit('/').next().unwrap_or("image");
        let name = s(a, "name").filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| format!("Picture {id}"));
        let drawing = format!(
            concat!(
                "<w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">",
                "<wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>",
                "<wp:docPr id=\"{id}\" name=\"{name}\" descr=\"{alt}\"/>",
                "<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>",
                "<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
                "<a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">",
                "<pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">",
                "<pic:nvPicPr><pic:cNvPr id=\"0\" name=\"{file}\"/><pic:cNvPicPr/></pic:nvPicPr>",
                "<pic:blipFill><a:blip r:{link}=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>",
                "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>",
                "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>",
                "</a:graphicData></a:graphic></wp:inline></w:drawing>"
            ),
            cx = cx,
            cy = cy,
            id = id,
            name = esc(&name),
            alt = esc(alt),
            file = esc(file),
            link = if external { "link" } else { "embed" },
            rid = esc(&rid),
        );
        self.run(marks, &drawing)
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    fn table(&mut self, t: &Value) -> String {
        let attrs = t.get("attrs").cloned().unwrap_or(Value::Null);
        self.note_styles(&attrs);
        let rows: Vec<&Value> = t.get("content").and_then(|c| c.as_array()).map(|r| r.iter().collect()).unwrap_or_default();
        if rows.is_empty() {
            return String::new();
        }
        // Grid occupancy: (row, col) → (row of the cell, index of the cell)
        let cells_of = |row: &Value| -> Vec<Value> { row.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default() };
        let int = |v: &Value, k: &str| v.get("attrs").and_then(|a| a.get(k)).and_then(|x| x.as_u64()).unwrap_or(1).max(1) as usize;
        let mut occ: Vec<Vec<Option<(usize, usize)>>> = vec![Vec::new(); rows.len()];
        let mut ncols = 0;
        for (r, row) in rows.iter().enumerate() {
            let mut col = 0;
            for (idx, cell) in cells_of(row).iter().enumerate() {
                while occ[r].get(col).map(|c| c.is_some()).unwrap_or(false) {
                    col += 1;
                }
                let span = int(cell, "colspan");
                let rowspan = int(cell, "rowspan").min(rows.len() - r);
                for line in occ.iter_mut().skip(r).take(rowspan) {
                    if line.len() < col + span {
                        line.resize(col + span, None);
                    }
                    for slot in line.iter_mut().skip(col).take(span) {
                        *slot = Some((r, idx));
                    }
                }
                col += span;
            }
            ncols = ncols.max(occ[r].len());
        }
        for row in occ.iter_mut() {
            row.resize(ncols, None);
        }
        // Column widths: from the cells (px), else the stored grid, else equal
        let mut widths: Vec<Option<f64>> = vec![None; ncols];
        for (r, row) in rows.iter().enumerate() {
            let cells = cells_of(row);
            let mut c = 0;
            while c < ncols {
                match occ[r][c] {
                    Some((r0, idx)) if r0 == r => {
                        let cell = &cells[idx];
                        let span = int(cell, "colspan");
                        if let Some(cw) = cell.get("attrs").and_then(|a| a.get("colwidth")).and_then(|v| v.as_array()) {
                            for (k, w) in cw.iter().enumerate().take(span) {
                                if c + k < ncols && widths[c + k].is_none() {
                                    if let Some(px) = w.as_f64().filter(|p| *p > 0.0) {
                                        widths[c + k] = Some(px * 15.0);
                                    }
                                }
                            }
                        }
                        c += span;
                    }
                    _ => c += 1,
                }
            }
        }
        let stored: Vec<f64> = attrs.get("grid").and_then(|g| g.as_array()).map(|g| g.iter().filter_map(|w| w.as_f64()).collect()).unwrap_or_default();
        if stored.len() == ncols {
            for (i, w) in widths.iter_mut().enumerate() {
                if w.is_none() {
                    *w = Some(stored[i]);
                }
            }
        }
        let known: f64 = widths.iter().flatten().sum();
        let missing = widths.iter().filter(|w| w.is_none()).count();
        if missing > 0 {
            let each = ((self.text_width - known) / missing as f64).max(360.0);
            for w in widths.iter_mut() {
                if w.is_none() {
                    *w = Some(each);
                }
            }
        }
        let widths: Vec<i64> = widths.into_iter().map(|w| w.unwrap_or(1440.0).round() as i64).collect();

        let mut grid_xml = String::from("<w:tblGrid>");
        for w in &widths {
            grid_xml.push_str(&format!("<w:gridCol w:w=\"{w}\"/>"));
        }
        grid_xml.push_str("</w:tblGrid>");
        let mut row_xml: Vec<(Option<String>, String)> = Vec::new();
        for (r, row) in rows.iter().enumerate() {
            let row_attrs = row.get("attrs").cloned().unwrap_or(Value::Null);
            let mut out = String::new();
            out.push_str("<w:tr>");
            if let Some(ex) = s(&row_attrs, "ex") {
                out.push_str(ex);
            }
            out.push_str(&trpr_xml(&row_attrs));
            let mut cells_xml: Vec<(Option<String>, String)> = Vec::new();
            let mut c = 0;
            while c < ncols {
                match occ[r][c] {
                    // A short row (or w:gridBefore / w:gridAfter): no cell here
                    None => c += 1,
                    Some((r0, idx)) => {
                        let source_row = rows[r0];
                        let source_cells = cells_of(source_row);
                        let cell = &source_cells[idx];
                        let span = int(cell, "colspan").min(ncols - c);
                        let width: i64 = widths[c..c + span].iter().sum();
                        let cell_attrs = cell.get("attrs").cloned().unwrap_or(Value::Null);
                        // Keep the cell's own preferred width (percent, auto…) unless its columns changed
                        let resized = if stored.len() == ncols {
                            let before: f64 = stored[c..c + span].iter().sum();
                            (before - width as f64).abs() > 1.0
                        } else {
                            true
                        };
                        let own_width = cell_attrs.get("tcW").filter(|v| v.is_object()).is_some();
                        let width = if resized || !own_width { Some(width) } else { None };
                        let mut tc = String::new();
                        if r0 == r {
                            let rowspan = int(cell, "rowspan");
                            let vmerge = if rowspan > 1 { Some("restart") } else { None };
                            tc.push_str("<w:tc>");
                            tc.push_str(&tcpr_xml(&cell_attrs, span, vmerge, width));
                            let content = cell.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
                            let blocks = self.blocks(&content, true);
                            tc.push_str(&blocks);
                            tc.push_str("</w:tc>");
                        } else {
                            // Below a vertically merged cell
                            tc.push_str("<w:tc>");
                            tc.push_str(&tcpr_xml(&cell_attrs, span, Some("continue"), width));
                            tc.push_str("<w:p/></w:tc>");
                        }
                        let sdt = if r0 == r { s(&cell_attrs, "sdt").map(String::from) } else { None };
                        cells_xml.push((sdt, tc));
                        c += span;
                    }
                }
            }
            out.push_str(&self.group_sdt(cells_xml));
            out.push_str("</w:tr>");
            row_xml.push((s(&row_attrs, "sdt").map(String::from), out));
        }
        let mut out = String::from("<w:tbl>");
        out.push_str(&tblpr_xml(&attrs));
        out.push_str(&grid_xml);
        out.push_str(&self.group_sdt(row_xml));
        out.push_str("</w:tbl>");
        out
    }

    /// Wraps consecutive items carrying the same content control id.
    fn group_sdt(&self, items: Vec<(Option<String>, String)>) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < items.len() {
            let Some(id) = items[i].0.clone() else {
                out.push_str(&items[i].1);
                i += 1;
                continue;
            };
            let mut j = i;
            let mut inner = String::new();
            while j < items.len() && items[j].0.as_deref() == Some(id.as_str()) {
                inner.push_str(&items[j].1);
                j += 1;
            }
            // Nested controls: wrap from the innermost id outwards
            let mut wrapped = inner;
            for seg in id.split('/').collect::<Vec<_>>().into_iter().rev() {
                if let Some(props) = self.sdts.get(seg).and_then(|p| p.as_str()) {
                    wrapped = format!("<w:sdt>{props}<w:sdtContent>{wrapped}</w:sdtContent></w:sdt>");
                }
            }
            out.push_str(&wrapped);
            i = j;
        }
        out
    }
}

/// Section properties with the page setup from the editor and the given
/// header/footer references.
pub fn sect_xml(original: Option<&str>, root_start: &str, page: &Value, title_pg: Option<bool>, refs: &[(String, String, String)]) -> String {
    let mut items: Vec<(String, bool, String)> = Vec::new();
    if let Some(raw) = original {
        if let Some(parsed) = fragment_items(root_start, raw) {
            items = parsed;
        }
    }
    let replace = |items: &mut Vec<(String, bool, String)>, name: &str, xml: Option<String>| {
        items.retain(|(n, w, _)| !(*w && n == name));
        if let Some(x) = xml {
            items.push((name.to_string(), true, x));
        }
    };
    if let Some(sz) = page.get("pgSz").filter(|v| v.is_object()) {
        replace(&mut items, "pgSz", Some(format!("<w:pgSz{}/>", attrs_xml(sz))));
    }
    if let Some(m) = page.get("pgMar").filter(|v| v.is_object()) {
        replace(&mut items, "pgMar", Some(format!("<w:pgMar{}/>", attrs_xml(m))));
    }
    if let Some(cols) = page.get("cols").filter(|v| v.is_object()) {
        replace(&mut items, "cols", Some(format!("<w:cols{}/>", attrs_xml(cols))));
    }
    // Page borders (Design > Page Borders); null removes them
    match page.get("pgBorders") {
        Some(b) if b.is_object() => {
            let own: serde_json::Map<String, Value> = b
                .as_object()
                .map(|o| o.iter().filter(|(_, v)| !v.is_object()).map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();
            let mut sides = String::new();
            for side in ["top", "left", "bottom", "right"] {
                if let Some(v) = b.get(side).filter(|v| v.is_object()) {
                    sides.push_str(&format!("<w:{side}{}/>", attrs_xml(v)));
                }
            }
            replace(&mut items, "pgBorders", Some(format!("<w:pgBorders{}>{sides}</w:pgBorders>", attrs_xml(&Value::Object(own)))));
        }
        Some(Value::Null) => replace(&mut items, "pgBorders", None),
        _ => {}
    }
    match title_pg {
        Some(true) => replace(&mut items, "titlePg", Some("<w:titlePg/>".into())),
        Some(false) => replace(&mut items, "titlePg", None),
        None => {}
    }
    if !refs.is_empty() {
        items.retain(|(n, w, _)| !(*w && (n == "headerReference" || n == "footerReference")));
        for (kind, ty, rid) in refs {
            let tag = if kind == "header" { "headerReference" } else { "footerReference" };
            items.push((tag.to_string(), true, format!("<w:{tag} w:type=\"{}\" r:id=\"{}\"/>", esc(ty), esc(rid))));
        }
    }
    if !items.iter().any(|(n, _, _)| n == "pgSz") {
        items.push(("pgSz".into(), true, "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>".into()));
    }
    if !items.iter().any(|(n, _, _)| n == "pgMar") {
        items.push((
            "pgMar".into(),
            true,
            "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>".into(),
        ));
    }
    format!("<w:sectPr>{}</w:sectPr>", ordered(items, SECTPR_ORDER))
}

/// A raw element wrapped in a root that declares the namespaces of the
/// part's root element (and the usual ones), so it can be parsed alone.
pub fn wrap_fragment(root_start: &str, raw: &str) -> String {
    let mut decls = String::new();
    // Declarations of the root element, then the usual ones it may lack
    let mut i = 0;
    while let Some(p) = root_start[i..].find("xmlns") {
        let start = i + p;
        let Some(eq) = root_start[start..].find('=').map(|e| e + start) else { break };
        let Some(quote) = root_start.as_bytes().get(eq + 1).map(|c| *c as char) else { break };
        let Some(end) = root_start[eq + 2..].find(quote).map(|e| e + eq + 2) else { break };
        decls.push(' ');
        decls.push_str(&root_start[start..=end]);
        i = end + 1;
    }
    for (p, uri) in KNOWN_NS {
        if !decls.contains(&format!("xmlns:{p}=")) {
            decls.push_str(&format!(" xmlns:{p}=\"{uri}\""));
        }
    }
    format!("<fragment{decls}>{raw}</fragment>")
}

/// Children of a raw element as `(name, is_w, xml)`.
pub fn fragment_items(root_start: &str, raw: &str) -> Option<Vec<(String, bool, String)>> {
    let wrapped = wrap_fragment(root_start, raw);
    let doc = roxmltree::Document::parse(&wrapped).ok()?;
    let el = doc.root_element().children().find(|c| c.is_element())?;
    Some(
        el.children()
            .filter(|c| c.is_element())
            .map(|c| (local(c).to_string(), crate::docx::xml::is_wns(c.tag_name().namespace()), wrapped[c.range()].to_string()))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patching_tags() {
        let x = r#"<w:drawing><wp:inline><wp:extent cx="100" cy="200"/><wp:docPr id="3" name="P"/></wp:inline></w:drawing>"#;
        let y = patch_tag_attr(x, "extent", "cx", "555");
        assert!(y.contains(r#"<wp:extent cx="555" cy="200"/>"#));
        assert_eq!(tag_attr(&y, "docPr", "id"), Some("3"));
        let mut ids = DocPrIds::default();
        assert_eq!(ids.take(Some(3)), 3);
        assert_eq!(ids.take(Some(3)), 4);
    }

    #[test]
    fn section_properties() {
        let root = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#;
        let raw = r#"<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>"#;
        let page = serde_json::json!({ "pgSz": { "w": "15840", "h": "12240", "orient": "landscape" } });
        let refs = vec![("footer".to_string(), "default".to_string(), "rId9".to_string())];
        let x = sect_xml(Some(raw), root, &page, Some(true), &refs);
        assert!(x.starts_with("<w:sectPr><w:footerReference w:type=\"default\" r:id=\"rId9\"/><w:pgSz"));
        assert!(x.contains("w:orient=\"landscape\""));
        assert!(x.contains("<w:titlePg/><w:docGrid"));
        assert!(!x.contains("headerReference"));
    }
}
