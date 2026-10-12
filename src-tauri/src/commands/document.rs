//! Docs: document lifecycle (new, open, save, export, close), pictures,
//! templates, AutoRecover and version history.
//!
//! The editor sends its content as a snapshot (`{doc, headers, footers,
//! stats, core}`) after changes and with every save; the session turns it
//! into a .docx (or text) file.

use std::{
    borrow::Cow,
    path::{Path, PathBuf},
};

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use tauri::{http, Manager, Runtime, State, UriSchemeContext};

use crate::{
    docs::{self, templates, DocFormat, DocInfo, DocLocation, DocSession},
    docx,
    error::{AppError, AppResult},
    recovery::{snapshot_meta, RecoveryItem},
    state::AppState,
    storage::write_atomic,
    templates::TemplateMeta,
};

use super::workbook::new_id;

/// Pictures larger than this are refused (Word's own limit is far higher,
/// but the editor keeps every picture in memory).
const MAX_PICTURE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocOpenResult {
    pub info: DocInfo,
    /// True when the file was already open (the frontend should focus it).
    pub already_open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[tauri::command(async)]
pub fn document_new(state: State<'_, AppState>, template: Option<String>) -> AppResult<DocInfo> {
    let (opened, untouched) = match template.as_deref() {
        None | Some("") | Some("blank") => (docx::blank(), true),
        Some(id) => {
            let t = templates::get(id).ok_or_else(|| AppError::Invalid("Template not found".into()))?;
            (docs::from_built(t.build()), false)
        }
    };
    let mut session = DocSession::new(new_id(), state.next_doc_title(), opened, None);
    session.untouched = untouched;
    let info = session.info();
    state.insert_doc(session);
    Ok(info)
}

#[tauri::command(async)]
pub fn document_open(state: State<'_, AppState>, path: String) -> AppResult<DocOpenResult> {
    if let Some(id) = state.find_doc_by_path(&path) {
        let info = state.read_doc(&id, |d| Ok(d.info()))?;
        state.recent.lock().unwrap().touch(&path);
        return Ok(DocOpenResult { info, already_open: true, warning: None });
    }
    let file = PathBuf::from(&path);
    let (opened, format, in_place) = docs::load(&file)?;
    let warning = (!opened.warnings.is_empty()).then(|| opened.warnings.join("\n"));
    let location = DocLocation { path: file, format };
    let title = location.display_name();
    // Macro-enabled documents and templates are never overwritten: the
    // first save asks for a new file.
    let session = if in_place {
        DocSession::new(new_id(), title, opened, Some(location))
    } else {
        let mut d = DocSession::new(new_id(), title, opened, None);
        d.source_path = Some(path.clone());
        d
    };
    let info = session.info();
    state.insert_doc(session);
    state.recent.lock().unwrap().touch(&path);
    Ok(DocOpenResult { info, already_open: false, warning })
}

#[tauri::command(async)]
pub fn document_info(state: State<'_, AppState>, doc: String) -> AppResult<DocInfo> {
    state.read_doc(&doc, |d| Ok(d.info()))
}

/// Everything the editor needs: content, styles, numbering, theme, settings,
/// notes, comments and document properties.
#[tauri::command(async)]
pub fn document_payload(state: State<'_, AppState>, doc: String) -> AppResult<Value> {
    state.read_doc(&doc, |d| Ok(d.payload()))
}

/// The editor's latest content (for AutoRecover). `changed` marks the
/// document as having unsaved changes.
#[tauri::command(async)]
pub fn document_update(state: State<'_, AppState>, doc: String, snapshot: Value, changed: bool) -> AppResult<DocInfo> {
    state.with_doc(&doc, |d| {
        d.snapshot = Some(snapshot);
        if changed {
            d.dirty = true;
            d.untouched = false;
            d.edit_seq += 1;
        }
        Ok(d.info())
    })
}

/// Keeps the file's previous content in the version history, then writes.
fn write_with_history(state: &AppState, path: &Path, bytes: &[u8]) -> AppResult<()> {
    let keep = state.settings.lock().unwrap().value.keep_versions as usize;
    state.versions.backup(path, keep);
    write_atomic(path, bytes)
}

fn bom(state: &AppState) -> bool {
    state.settings.lock().unwrap().value.csv_bom
}

#[tauri::command(async)]
pub fn document_save(state: State<'_, AppState>, doc: String, snapshot: Option<Value>) -> AppResult<DocInfo> {
    let author = state.author();
    let bom = bom(&state);
    let info = state.with_doc(&doc, |d| {
        if let Some(s) = snapshot {
            d.snapshot = Some(s);
        }
        let location = d.location.clone().ok_or_else(|| AppError::Invalid("NO_LOCATION".into()))?;
        let bytes = d.bytes_for(location.format, &author, bom)?;
        write_with_history(&state, &location.path, &bytes)?;
        d.dirty = false;
        d.untouched = false;
        Ok(d.info())
    })?;
    state.recovery.discard_live(&doc);
    if let Some(path) = &info.path {
        state.recent.lock().unwrap().touch(path);
    }
    Ok(info)
}

#[tauri::command(async)]
pub fn document_save_as(state: State<'_, AppState>, doc: String, path: String, snapshot: Option<Value>) -> AppResult<DocInfo> {
    let file = PathBuf::from(&path);
    let format = docs::save_format(&file)?;
    let author = state.author();
    let bom = bom(&state);
    let info = state.with_doc(&doc, |d| {
        if let Some(s) = snapshot {
            d.snapshot = Some(s);
        }
        let bytes = d.bytes_for(format, &author, bom)?;
        write_with_history(&state, &file, &bytes)?;
        let location = DocLocation { path: file.clone(), format };
        d.title = location.display_name();
        d.location = Some(location);
        d.source_path = None;
        d.dirty = false;
        d.untouched = false;
        Ok(d.info())
    })?;
    state.recovery.discard_live(&doc);
    state.recent.lock().unwrap().touch(&path);
    Ok(info)
}

/// Writes a copy (Word document, plain text or Markdown) without changing
/// where the document is saved.
#[tauri::command(async)]
pub fn document_export(state: State<'_, AppState>, doc: String, path: String, snapshot: Option<Value>) -> AppResult<()> {
    let file = PathBuf::from(&path);
    let format = docs::save_format(&file)?;
    let author = state.author();
    let bom = bom(&state);
    let bytes = state.with_doc(&doc, |d| {
        if let Some(s) = snapshot {
            d.snapshot = Some(s);
        }
        d.bytes_for(format, &author, bom)
    })?;
    write_atomic(&file, &bytes)
}

/// Writes a web page made by the editor (File > Export > Web Page).
#[tauri::command(async)]
pub fn document_write_html(path: String, html: String) -> AppResult<()> {
    let file = PathBuf::from(&path);
    let ext = file.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if ext != "html" && ext != "htm" {
        return Err(AppError::Unsupported("Web pages are saved as .html files.".into()));
    }
    write_atomic(&file, html.as_bytes())
}

#[tauri::command(async)]
pub fn document_close(state: State<'_, AppState>, doc: String) -> AppResult<()> {
    state.remove_doc(&doc);
    Ok(())
}

/// True when saving to `path` keeps only the text (.txt, .md).
#[tauri::command(async)]
pub fn document_format_lossy(path: String) -> AppResult<bool> {
    Ok(docs::save_format(Path::new(&path))?.is_lossy())
}

// ---------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------

/// Adds a picture file to the document; returns the image node's attributes.
#[tauri::command(async)]
pub fn document_add_image(state: State<'_, AppState>, doc: String, path: String) -> AppResult<Value> {
    let file = PathBuf::from(&path);
    let len = std::fs::metadata(&file)?.len() as usize;
    if len > MAX_PICTURE_BYTES {
        return Err(AppError::Invalid("This picture is too large to insert.".into()));
    }
    let bytes = std::fs::read(&file)?;
    let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    state.with_doc(&doc, |d| d.add_image(bytes, &name))
}

/// Adds a pasted or dropped picture (base64) to the document.
#[tauri::command(async)]
pub fn document_add_image_data(state: State<'_, AppState>, doc: String, data: String, name: String) -> AppResult<Value> {
    let data = data.split_once(',').filter(|(head, _)| head.starts_with("data:")).map(|(_, b)| b).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| AppError::Invalid("The picture couldn't be read.".into()))?;
    if bytes.len() > MAX_PICTURE_BYTES {
        return Err(AppError::Invalid("This picture is too large to insert.".into()));
    }
    state.with_doc(&doc, |d| d.add_image(bytes, &name))
}

fn decode_percent(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() && bytes[i + 1].is_ascii_hexdigit() && bytes[i + 2].is_ascii_hexdigit() {
            let hex = |b: u8| (b as char).to_digit(16).unwrap_or(0) as u8;
            out.push(hex(bytes[i + 1]) * 16 + hex(bytes[i + 2]));
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn media_type(part: &str) -> &'static str {
    match part.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("tif") | Some("tiff") => "image/tiff",
        Some("webp") => "image/webp",
        Some("emf") => "image/x-emf",
        Some("wmf") => "image/x-wmf",
        _ => "application/octet-stream",
    }
}

/// `docmedia://localhost/<document id>/<part name>`: pictures of open
/// documents for the editor.
pub fn media_protocol<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: http::Request<Vec<u8>>) -> http::Response<Cow<'static, [u8]>> {
    let not_found = || {
        http::Response::builder()
            .status(http::StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&[][..]))
            .unwrap()
    };
    let path = decode_percent(request.uri().path().trim_start_matches('/'));
    let Some((doc, part)) = path.split_once('/') else { return not_found() };
    let Some(state) = ctx.app_handle().try_state::<AppState>() else { return not_found() };
    let bytes = state.read_doc(doc, |d| Ok(d.media(part).map(|b| b.to_vec()))).ok().flatten();
    match bytes {
        Some(b) => http::Response::builder()
            .header(http::header::CONTENT_TYPE, media_type(part))
            .header(http::header::CACHE_CONTROL, "max-age=3600")
            .header("Access-Control-Allow-Origin", "*")
            .body(Cow::Owned(b))
            .unwrap(),
        None => not_found(),
    }
}

// ---------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------

#[tauri::command(async)]
pub fn document_templates() -> AppResult<Vec<TemplateMeta>> {
    Ok(templates::list())
}

/// A template's content, for its thumbnail on the New page.
#[tauri::command(async)]
pub fn document_template_preview(id: String) -> AppResult<Option<Value>> {
    Ok(templates::get(&id).map(|t| {
        let built = t.build();
        let opened = docs::from_built(built);
        serde_json::json!({ "doc": opened.payload["doc"], "styles": opened.payload["styles"], "numbering": opened.payload["numbering"] })
    }))
}

// ---------------------------------------------------------------------
// AutoRecover & version history
// ---------------------------------------------------------------------

/// A recovered or earlier copy, opened as a new document with unsaved changes.
fn open_snapshot(file: &Path, title: String) -> AppResult<DocSession> {
    let bytes = std::fs::read(file)?;
    let opened = docx::open(&bytes).map_err(AppError::Io)?;
    let mut session = DocSession::new(new_id(), title, opened, None);
    session.dirty = true;
    session.edit_seq = 1;
    Ok(session)
}

/// Opens a recovered document as a new, unsaved document.
#[tauri::command(async)]
pub fn document_recovery_open(state: State<'_, AppState>, file: String) -> AppResult<DocInfo> {
    let path = PathBuf::from(&file);
    if !state.recovery.owns(&path) {
        return Err(AppError::Invalid("This file is not a recovered document.".into()));
    }
    let item: RecoveryItem = state
        .recovery
        .list()
        .into_iter()
        .find(|i| i.file == file)
        .ok_or_else(|| AppError::Invalid("The recovered document no longer exists.".into()))?;
    let title = format!("{} (Recovered)", item.title.trim_end_matches(" (Recovered)"));
    let session = open_snapshot(&path, title.clone())?;
    let id = session.id.clone();
    let info = session.info();
    state.insert_doc(session);
    // The snapshot becomes this document's live AutoRecover file until saved.
    state.recovery.adopt(&path, &id, 1, &snapshot_meta(&title, item.original_path))?;
    Ok(info)
}

/// Opens a previous version of a file as a new, unsaved document.
#[tauri::command(async)]
pub fn document_version_open(state: State<'_, AppState>, file: String, title: String) -> AppResult<DocInfo> {
    let path = PathBuf::from(&file);
    if !state.versions.owns(&path) {
        return Err(AppError::Invalid("This file is not a saved version.".into()));
    }
    let format = docs::format_of(&path)?.0;
    let session = if format == DocFormat::Docx {
        open_snapshot(&path, title)?
    } else {
        let (opened, _, _) = docs::load(&path)?;
        let mut s = DocSession::new(new_id(), title, opened, None);
        s.dirty = true;
        s.edit_seq = 1;
        s
    };
    let info = session.info();
    state.insert_doc(session);
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding() {
        assert_eq!(decode_percent("abc/word/media/image%201.png"), "abc/word/media/image 1.png");
        assert_eq!(decode_percent("%E2%82%AC"), "€");
        assert_eq!(decode_percent("100%"), "100%");
        assert_eq!(decode_percent("%é%zz"), "%é%zz");
        assert_eq!(media_type("word/media/a.JPG"), "image/jpeg");
    }
}
