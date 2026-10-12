//! The OPC package: zip parts, relationships and content types.

use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
};

use super::xml::{decode, esc, parse};

pub const REL_OFFICE_DOCUMENT: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
pub const REL_STYLES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
pub const REL_NUMBERING: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
pub const REL_SETTINGS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";
pub const REL_THEME: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
pub const REL_HEADER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
pub const REL_FOOTER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
pub const REL_IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
pub const REL_HYPERLINK: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
pub const REL_FOOTNOTES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes";
pub const REL_ENDNOTES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes";
pub const REL_COMMENTS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
pub const REL_CORE: &str = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
pub const REL_APP: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";

pub const CT_DOCUMENT: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
pub const CT_TEMPLATE: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
pub const CT_MACRO_DOCUMENT: &str = "application/vnd.ms-word.document.macroEnabled.main+xml";
pub const CT_MACRO_TEMPLATE: &str = "application/vnd.ms-word.template.macroEnabledTemplate.main+xml";
pub const CT_HEADER: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
pub const CT_FOOTER: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
pub const CT_NUMBERING: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
pub const CT_STYLES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";
pub const CT_COMMENTS: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
pub const CT_FOOTNOTES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
pub const CT_ENDNOTES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml";
pub const CT_CORE: &str = "application/vnd.openxmlformats-package.core-properties+xml";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rel {
    pub id: String,
    pub kind: String,
    pub target: String,
    pub external: bool,
}

/// Relationships of one part (`_rels/<name>.rels`).
#[derive(Clone, Debug, Default)]
pub struct Rels {
    pub items: Vec<Rel>,
}

impl Rels {
    pub fn parse(bytes: &[u8]) -> Rels {
        let text = decode(bytes);
        let Ok(doc) = parse(&text) else { return Rels::default() };
        let items = doc
            .root_element()
            .children()
            .filter(|n| n.is_element() && n.tag_name().name() == "Relationship")
            .filter_map(|n| {
                Some(Rel {
                    id: n.attribute("Id")?.to_string(),
                    kind: n.attribute("Type").unwrap_or_default().to_string(),
                    target: n.attribute("Target").unwrap_or_default().to_string(),
                    external: n.attribute("TargetMode").map(|m| m.eq_ignore_ascii_case("External")).unwrap_or(false),
                })
            })
            .collect();
        Rels { items }
    }

    pub fn get(&self, id: &str) -> Option<&Rel> {
        self.items.iter().find(|r| r.id == id)
    }

    /// Adds a relationship and returns its new id.
    pub fn add(&mut self, kind: &str, target: &str, external: bool) -> String {
        let mut n = self.items.len() + 1;
        let id = loop {
            let id = format!("rId{n}");
            if self.get(&id).is_none() {
                break id;
            }
            n += 1;
        };
        self.items.push(Rel { id: id.clone(), kind: kind.into(), target: target.into(), external });
        id
    }

    /// Adds a relationship with a given id (one the editor chose).
    pub fn insert(&mut self, id: &str, kind: &str, target: &str, external: bool) {
        self.items.retain(|r| r.id != id);
        self.items.push(Rel { id: id.into(), kind: kind.into(), target: target.into(), external });
    }

    /// Id of an existing relationship to `target`, or a new one.
    pub fn ensure(&mut self, kind: &str, target: &str, external: bool) -> String {
        if let Some(r) = self.items.iter().find(|r| r.kind == kind && r.target == target && r.external == external) {
            return r.id.clone();
        }
        self.add(kind, target, external)
    }

    pub fn to_xml(&self) -> String {
        let mut out = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        );
        for r in &self.items {
            out.push_str(&format!(
                "<Relationship Id=\"{}\" Type=\"{}\" Target=\"{}\"{}/>",
                esc(&r.id),
                esc(&r.kind),
                esc(&r.target),
                if r.external { " TargetMode=\"External\"" } else { "" }
            ));
        }
        out.push_str("</Relationships>");
        out
    }
}

/// `[Content_Types].xml`.
#[derive(Clone, Debug, Default)]
pub struct ContentTypes {
    pub defaults: Vec<(String, String)>,
    pub overrides: Vec<(String, String)>,
}

impl ContentTypes {
    pub fn parse(bytes: &[u8]) -> ContentTypes {
        let text = decode(bytes);
        let Ok(doc) = parse(&text) else { return ContentTypes::default() };
        let mut ct = ContentTypes::default();
        for n in doc.root_element().children().filter(|n| n.is_element()) {
            match n.tag_name().name() {
                "Default" => {
                    if let (Some(e), Some(t)) = (n.attribute("Extension"), n.attribute("ContentType")) {
                        ct.defaults.push((e.to_ascii_lowercase(), t.to_string()));
                    }
                }
                "Override" => {
                    if let (Some(p), Some(t)) = (n.attribute("PartName"), n.attribute("ContentType")) {
                        ct.overrides.push((p.to_string(), t.to_string()));
                    }
                }
                _ => {}
            }
        }
        ct
    }

    pub fn of(&self, part: &str) -> Option<&str> {
        let name = format!("/{}", part.trim_start_matches('/'));
        if let Some((_, t)) = self.overrides.iter().find(|(p, _)| p.eq_ignore_ascii_case(&name)) {
            return Some(t);
        }
        let ext = part.rsplit('.').next()?.to_ascii_lowercase();
        self.defaults.iter().find(|(e, _)| *e == ext).map(|(_, t)| t.as_str())
    }

    pub fn ensure_default(&mut self, ext: &str, content_type: &str) {
        let ext = ext.to_ascii_lowercase();
        if !self.defaults.iter().any(|(e, _)| *e == ext) {
            self.defaults.push((ext, content_type.to_string()));
        }
    }

    pub fn set_override(&mut self, part: &str, content_type: &str) {
        let name = format!("/{}", part.trim_start_matches('/'));
        if let Some(o) = self.overrides.iter_mut().find(|(p, _)| p.eq_ignore_ascii_case(&name)) {
            o.1 = content_type.to_string();
        } else {
            self.overrides.push((name, content_type.to_string()));
        }
    }

    pub fn to_xml(&self) -> String {
        let mut out = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
        );
        for (e, t) in &self.defaults {
            out.push_str(&format!("<Default Extension=\"{}\" ContentType=\"{}\"/>", esc(e), esc(t)));
        }
        for (p, t) in &self.overrides {
            out.push_str(&format!("<Override PartName=\"{}\" ContentType=\"{}\"/>", esc(p), esc(t)));
        }
        out.push_str("</Types>");
        out
    }
}

/// All parts of a package, by name without a leading slash.
#[derive(Clone, Debug, Default)]
pub struct Package {
    pub parts: BTreeMap<String, Vec<u8>>,
}

pub fn image_content_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

impl Package {
    pub fn read(bytes: &[u8]) -> Result<Package, String> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| {
            "This isn't a Word document (.docx), or the file is damaged.".to_string()
        })?;
        let mut parts = BTreeMap::new();
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| format!("The document is damaged ({e})."))?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().trim_start_matches('/').to_string();
            let mut data = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut data).map_err(|e| format!("The document is damaged ({e})."))?;
            parts.insert(name, data);
        }
        if !parts.contains_key("[Content_Types].xml") {
            return Err("This isn't a Word document (.docx), or the file is damaged.".into());
        }
        Ok(Package { parts })
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.parts.get(name.trim_start_matches('/')).map(|v| v.as_slice())
    }

    pub fn text(&self, name: &str) -> Option<String> {
        self.get(name).map(decode)
    }

    pub fn set(&mut self, name: &str, data: impl Into<Vec<u8>>) {
        self.parts.insert(name.trim_start_matches('/').to_string(), data.into());
    }

    pub fn content_types(&self) -> ContentTypes {
        self.get("[Content_Types].xml").map(ContentTypes::parse).unwrap_or_default()
    }

    /// Relationships of `part` (empty when it has none).
    pub fn rels_of(&self, part: &str) -> Rels {
        self.get(&rels_name(part)).map(Rels::parse).unwrap_or_default()
    }

    /// The main document part (normally `word/document.xml`).
    pub fn main_part(&self) -> String {
        let root = self.rels_of("");
        root.items
            .iter()
            .find(|r| r.kind == REL_OFFICE_DOCUMENT || r.kind.ends_with("/officeDocument"))
            .map(|r| r.target.trim_start_matches('/').to_string())
            .unwrap_or_else(|| "word/document.xml".to_string())
    }

    /// A name for a new part in `dir` (e.g. "word/media/image3.png").
    pub fn free_name(&self, dir: &str, stem: &str, ext: &str) -> String {
        let mut n = 1;
        loop {
            let name = format!("{dir}/{stem}{n}.{ext}");
            if !self.parts.contains_key(&name) {
                return name;
            }
            n += 1;
        }
    }

    /// Serialises the package. `[Content_Types].xml` goes first, like Office writes it.
    pub fn write(&self) -> Result<Vec<u8>, String> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut names: Vec<&String> = self.parts.keys().collect();
        names.sort_by_key(|n| match n.as_str() {
            "[Content_Types].xml" => 0,
            "_rels/.rels" => 1,
            n if n.starts_with("word/document.xml") => 2,
            _ => 3,
        });
        for name in names {
            zip.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            zip.write_all(&self.parts[name]).map_err(|e| e.to_string())?;
        }
        let cursor = zip.finish().map_err(|e| e.to_string())?;
        Ok(cursor.into_inner())
    }
}

/// `word/document.xml` → `word/_rels/document.xml.rels`; "" → `_rels/.rels`.
pub fn rels_name(part: &str) -> String {
    let part = part.trim_start_matches('/');
    match part.rfind('/') {
        Some(i) => format!("{}/_rels/{}.rels", &part[..i], &part[i + 1..]),
        None => format!("_rels/{part}.rels"),
    }
}

/// Resolves a relationship target against the folder of `part`.
pub fn resolve(part: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let base = part.trim_start_matches('/');
    let dir = base.rfind('/').map(|i| &base[..i]).unwrap_or("");
    let mut segs: Vec<&str> = if dir.is_empty() { vec![] } else { dir.split('/').collect() };
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    segs.join("/")
}

/// Target of `part_name` relative to the folder of `from` (for new relationships).
pub fn relative(from: &str, part_name: &str) -> String {
    let from_dir = from.rfind('/').map(|i| &from[..i]).unwrap_or("");
    if !from_dir.is_empty() {
        if let Some(rest) = part_name.strip_prefix(&format!("{from_dir}/")) {
            return rest.to_string();
        }
    }
    format!("/{part_name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_targets() {
        assert_eq!(rels_name("word/document.xml"), "word/_rels/document.xml.rels");
        assert_eq!(rels_name(""), "_rels/.rels");
        assert_eq!(resolve("word/document.xml", "media/image1.png"), "word/media/image1.png");
        assert_eq!(resolve("word/document.xml", "../customXml/item1.xml"), "customXml/item1.xml");
        assert_eq!(resolve("word/document.xml", "/word/styles.xml"), "word/styles.xml");
        assert_eq!(relative("word/document.xml", "word/media/image2.png"), "media/image2.png");
        let mut rels = Rels::default();
        let a = rels.add(REL_IMAGE, "media/a.png", false);
        let b = rels.ensure(REL_IMAGE, "media/a.png", false);
        assert_eq!(a, b);
        assert!(rels.to_xml().contains("Target=\"media/a.png\""));
    }
}
