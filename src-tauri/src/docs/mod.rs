//! Docs: the word processor's open documents.
//!
//! The editor (ProseMirror) owns the text while a document is open and
//! sends snapshots here: after changes (for AutoRecover) and when saving.
//! A session keeps the original package so saving writes back everything
//! the editor didn't change.

pub mod templates;

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    docx::{self, DocState, SaveInput},
    error::{AppError, AppResult},
    storage::decode_text,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocFormat {
    Docx,
    Txt,
    Md,
}

impl DocFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            DocFormat::Docx => "docx",
            DocFormat::Txt => "txt",
            DocFormat::Md => "md",
        }
    }

    /// Formats that keep only the text.
    pub fn is_lossy(&self) -> bool {
        !matches!(self, DocFormat::Docx)
    }
}

/// How a file opens: its format and whether saving may overwrite it.
pub fn format_of(path: &Path) -> AppResult<(DocFormat, bool)> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "docx" => Ok((DocFormat::Docx, true)),
        // Macro-enabled documents and templates are saved as new documents
        "docm" | "dotx" | "dotm" => Ok((DocFormat::Docx, false)),
        "txt" | "text" => Ok((DocFormat::Txt, true)),
        "md" | "markdown" => Ok((DocFormat::Md, true)),
        "doc" | "dot" => Err(AppError::Unsupported(
            "The legacy Word 97-2003 format (.doc) isn't supported. Open it in Word and save it as a Word Document (.docx) first.".into(),
        )),
        "rtf" | "odt" => Err(AppError::Unsupported(format!(
            "Docs can't open .{ext} files yet. Save the document as a Word Document (.docx) and open that."
        ))),
        _ => Err(AppError::Unsupported(format!("Files of type '.{ext}' are not supported."))),
    }
}

/// Formats Docs can write with "Save As".
pub fn save_format(path: &Path) -> AppResult<DocFormat> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "docx" => Ok(DocFormat::Docx),
        "txt" => Ok(DocFormat::Txt),
        "md" => Ok(DocFormat::Md),
        "docm" | "dotm" => Err(AppError::Unsupported(
            "Docs doesn't keep macros, so it can't save macro-enabled documents. Save it as a Word Document (.docx).".into(),
        )),
        _ => Err(AppError::Unsupported(format!("Docs can't save files of type '.{ext}'."))),
    }
}

#[derive(Clone, Debug)]
pub struct DocLocation {
    pub path: PathBuf,
    pub format: DocFormat,
}

impl DocLocation {
    pub fn display_name(&self) -> String {
        self.path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Document".to_string())
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub format: Option<String>,
    pub dirty: bool,
    pub untouched: bool,
    /// The file it came from when saving can't overwrite it (.docm, .dotx…).
    pub source_path: Option<String>,
}

pub struct DocSession {
    pub id: String,
    pub title: String,
    pub location: Option<DocLocation>,
    pub state: DocState,
    /// What the document looked like when opened (styles, numbering, theme…).
    pub opened: Value,
    /// The editor's latest content: `{doc, headers, footers, stats}`.
    pub snapshot: Option<Value>,
    pub dirty: bool,
    /// A new blank document nobody has typed into yet.
    pub untouched: bool,
    /// Bumped on every change; used by AutoRecover.
    pub edit_seq: u64,
    pub source_path: Option<String>,
}

impl DocSession {
    pub fn new(id: String, title: String, opened: docx::Opened, location: Option<DocLocation>) -> DocSession {
        DocSession {
            id,
            title,
            location,
            state: opened.state,
            opened: opened.payload,
            snapshot: None,
            dirty: false,
            untouched: false,
            edit_seq: 0,
            source_path: None,
        }
    }

    pub fn info(&self) -> DocInfo {
        DocInfo {
            id: self.id.clone(),
            title: self.title.clone(),
            path: self.location.as_ref().map(|l| l.path.to_string_lossy().to_string()),
            format: self.location.as_ref().map(|l| l.format.extension().to_string()),
            dirty: self.dirty,
            untouched: self.untouched,
            source_path: self.source_path.clone(),
        }
    }

    /// Everything the editor needs to show the document (the latest
    /// snapshot over what was opened).
    pub fn payload(&self) -> Value {
        let mut p = self.opened.clone();
        if let Some(s) = &self.snapshot {
            if let Some(v) = s.get("doc").filter(|v| !v.is_null()) {
                p["doc"] = v.clone();
            }
            // Headers, footers and notes come back one by one (only the edited ones)
            for key in ["headers", "footers", "footnotes", "endnotes", "stories"] {
                let Some(over) = s.get(key).and_then(|v| v.as_object()) else { continue };
                if !p[key].is_object() {
                    p[key] = json!({});
                }
                if let Some(base) = p[key].as_object_mut() {
                    for (k, v) in over {
                        base.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        p
    }

    /// The document as .docx bytes.
    pub fn docx_bytes(&self, author: &str) -> AppResult<Vec<u8>> {
        let p = self.payload();
        let empty = json!({});
        let snapshot = self.snapshot.as_ref();
        let stats = snapshot.and_then(|s| s.get("stats")).unwrap_or(&empty);
        docx::save(
            &self.state,
            &SaveInput {
                doc: &p["doc"],
                headers: p.get("headers").filter(|h| h.is_object()),
                footers: p.get("footers").filter(|h| h.is_object()),
                stats,
                author,
                core: snapshot.and_then(|s| s.get("core")).filter(|c| c.is_object()),
                comments: snapshot.and_then(|s| s.get("comments")).filter(|c| c.is_object()),
                footnotes: snapshot.and_then(|s| s.get("footnotes")).filter(|c| c.is_object()),
                endnotes: snapshot.and_then(|s| s.get("endnotes")).filter(|c| c.is_object()),
                stories: snapshot.and_then(|s| s.get("stories")).filter(|c| c.is_object()),
            },
        )
        .map_err(AppError::Io)
    }

    /// Bytes for a file of `format`.
    pub fn bytes_for(&self, format: DocFormat, author: &str, bom: bool) -> AppResult<Vec<u8>> {
        let p = self.payload();
        match format {
            DocFormat::Docx => self.docx_bytes(author),
            DocFormat::Txt => {
                let mut out = if bom { vec![0xEF, 0xBB, 0xBF] } else { vec![] };
                out.extend_from_slice(docx::text::to_plain_text(&p["doc"]).as_bytes());
                Ok(out)
            }
            DocFormat::Md => Ok(docx::text::to_markdown(&p["doc"], &p["styles"], &p["numbering"]).into_bytes()),
        }
    }

    /// Adds a picture to the document's media; returns the image node's
    /// attributes (part name and natural size in EMU).
    pub fn add_image(&mut self, bytes: Vec<u8>, name: &str) -> AppResult<Value> {
        let ext = image_ext(&bytes).ok_or_else(|| {
            AppError::Unsupported("Docs can insert PNG, JPEG, GIF and BMP pictures.".into())
        })?;
        let (w, h) = image_size(&bytes).unwrap_or((96, 96));
        let mut n = 1;
        let target = loop {
            let candidate = format!("word/media/image{n}.{ext}");
            if !self.state.pkg.parts.contains_key(&candidate) && !self.state.media.contains_key(&candidate) {
                break candidate;
            }
            n += 1;
        };
        self.state.media.insert(target.clone(), bytes);
        Ok(json!({
            "target": target,
            "cx": w as i64 * EMU_PER_PX,
            "cy": h as i64 * EMU_PER_PX,
            "name": name,
        }))
    }

    /// A picture of the package or one added in this session.
    pub fn media(&self, part: &str) -> Option<&[u8]> {
        self.state.media.get(part).map(|b| b.as_slice()).or_else(|| self.state.pkg.get(part))
    }
}

/// EMUs per pixel at 96 dpi.
pub const EMU_PER_PX: i64 = 9525;

/// The file extension of a picture Word can show, from its first bytes.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else if bytes.starts_with(b"BM") && bytes.len() > 26 {
        Some("bmp")
    } else {
        None
    }
}

/// Pixel size of a PNG, JPEG, GIF or BMP picture.
pub fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    let be32 = |i: usize| -> Option<u32> { Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?)) };
    let be16 = |i: usize| -> Option<u32> { Some(u16::from_be_bytes(b.get(i..i + 2)?.try_into().ok()?) as u32) };
    let le16 = |i: usize| -> Option<u32> { Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?) as u32) };
    let le32 = |i: usize| -> Option<i32> { Some(i32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?)) };
    match image_ext(b)? {
        "png" => Some((be32(16)?, be32(20)?)),
        "gif" => Some((le16(6)?, le16(8)?)),
        "bmp" => Some((le32(18)?.unsigned_abs(), le32(22)?.unsigned_abs())),
        "jpeg" => {
            let mut i = 2;
            while i + 9 < b.len() {
                if b[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marker = b[i + 1];
                if marker == 0xFF {
                    i += 1;
                    continue;
                }
                if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
                    i += 2;
                    continue;
                }
                let len = be16(i + 2)? as usize;
                // SOF markers carry the size (not DHT C4, JPG C8, DAC CC)
                if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
                    return Some((be16(i + 7)?, be16(i + 5)?));
                }
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

/// Opens a file: the parsed document and any warning to show.
pub fn load(path: &Path) -> AppResult<(docx::Opened, DocFormat, bool)> {
    let (format, in_place) = format_of(path)?;
    let bytes = std::fs::read(path)?;
    let opened = match format {
        DocFormat::Docx => docx::open(&bytes).map_err(AppError::Io)?,
        DocFormat::Txt | DocFormat::Md => {
            let text = decode_text(&bytes);
            let content = if format == DocFormat::Txt {
                docx::text::from_plain_text(&text)
            } else {
                docx::text::from_markdown(&text)
            };
            from_content(content)
        }
    };
    Ok((opened, format, in_place))
}

/// A new document holding `content` (a doc node with optional attrs).
pub fn from_content(content: Value) -> docx::Opened {
    let mut opened = docx::blank();
    let attrs = opened.payload["doc"]["attrs"].clone();
    let mut doc = content;
    let mut merged = attrs;
    if let Some(extra) = doc.get("attrs").and_then(|a| a.as_object()) {
        for (k, v) in extra {
            merged[k] = v.clone();
        }
    }
    doc["attrs"] = merged;
    opened.payload["doc"] = doc;
    opened
}

/// A new document made from a template.
pub fn from_built(built: templates::Built) -> docx::Opened {
    let mut opened = from_content(built.doc);
    opened.payload["headers"] = built.headers;
    opened.payload["footers"] = built.footers;
    opened
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        assert_eq!(format_of(Path::new("a.docx")).unwrap(), (DocFormat::Docx, true));
        assert_eq!(format_of(Path::new("a.DOCM")).unwrap(), (DocFormat::Docx, false));
        assert!(format_of(Path::new("a.doc")).is_err());
        assert!(save_format(Path::new("a.docm")).is_err());
        let opened = from_content(docx::text::from_markdown("# Hi\n- a\n"));
        assert_eq!(opened.payload["doc"]["attrs"]["page"]["pgSz"]["w"], "12240");
        assert_eq!(opened.payload["doc"]["attrs"]["numAdded"].as_array().unwrap().len(), 4);
        let s = DocSession::new("x".into(), "Doc".into(), opened, None);
        let bytes = s.docx_bytes("me").unwrap();
        let again = docx::open(&bytes).unwrap();
        assert_eq!(again.payload["doc"]["content"][0]["attrs"]["style"], "Heading1");
        assert!(again.payload["numbering"]["nums"]["9001"].is_object());
        let s2 = DocSession::new("y".into(), "Doc".into(), again, None);
        let md = String::from_utf8(s2.bytes_for(DocFormat::Md, "me", false).unwrap()).unwrap();
        assert_eq!(md, "# Hi\n\n- a\n");
    }

    #[test]
    fn pictures() {
        let png = crate::docx::tests::PNG;
        assert_eq!(image_ext(png), Some("png"));
        assert_eq!(image_size(png), Some((1, 1)));
        // a minimal JPEG header: SOI, APP0, SOF0 (height 20, width 30)
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x14, 0x00, 0x1E, 0x01, 0x01, 0x11, 0x00,
        ];
        assert_eq!(image_size(&jpeg), Some((30, 20)));
        let mut s = DocSession::new("z".into(), "Doc".into(), docx::blank(), None);
        let a = s.add_image(png.to_vec(), "dot.png").unwrap();
        assert_eq!(a["target"], "word/media/image1.png");
        assert_eq!(a["cx"], EMU_PER_PX);
        let b = s.add_image(png.to_vec(), "dot.png").unwrap();
        assert_eq!(b["target"], "word/media/image2.png");
        assert!(s.media("word/media/image2.png").is_some());
        assert!(s.add_image(b"not a picture".to_vec(), "x").is_err());
    }
}
