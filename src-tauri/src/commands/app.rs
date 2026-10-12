//! App-level commands: start screen data, settings, windows.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::{
    error::{AppError, AppResult},
    recent::RecentItem,
    settings::{initials, Settings},
    state::{AppKind, AppState},
    templates::{TemplateMeta, TemplatePreview},
};

pub const APP_NAME: &str = "Sheets";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// The app this window shows: "Sheets" or "Docs".
    pub name: String,
    /// "sheets" | "docs"
    pub app: String,
    pub version: String,
    pub user_name: String,
    pub initials: String,
    pub settings: Settings,
    pub startup_file: Option<String>,
    pub day_first: bool,
}

/// Set once a window asked for `app_info`, i.e. the UI can receive events.
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// The app a window shows.
pub fn window_app(state: &AppState, label: &str) -> AppKind {
    if label == "main" {
        *state.main_app.lock().unwrap()
    } else {
        AppKind::for_window(label, state.startup_app)
    }
}

/// Opens a file in the running app: sent to a window of the app that
/// opens it (the focused one first), or to a new window of that app.
/// Before any UI is up the file is kept for the first window.
pub fn deliver_open(app: &AppHandle, path: String) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let windows = app.webview_windows();
    if !FRONTEND_READY.load(Ordering::SeqCst) {
        let main_app = AppKind::for_path(&path, state.startup_app);
        *state.main_app.lock().unwrap() = main_app;
        *state.startup_file.lock().unwrap() = Some(path);
        return;
    }
    let focused = windows.values().find(|w| w.is_focused().unwrap_or(false));
    let text_app = focused.map(|w| window_app(&state, w.label())).unwrap_or(state.startup_app);
    let kind = AppKind::for_path(&path, text_app);
    let target = focused
        .filter(|w| window_app(&state, w.label()) == kind)
        .or_else(|| windows.values().find(|w| window_app(&state, w.label()) == kind));
    match target {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.set_focus();
            let _ = app.emit_to(w.label(), "open-file", path);
        }
        None => {
            let _ = open_start(app, &state, kind, Some(path));
        }
    }
}

/// A second launch without a file: show the app it was started for.
pub fn focus_or_open(app: &AppHandle, kind: AppKind) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let windows = app.webview_windows();
    let found = windows.values().find(|w| window_app(&state, w.label()) == kind);
    match found {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        None if windows.is_empty() => {}
        None => {
            let _ = open_start(app, &state, kind, None);
        }
    }
}

pub fn focus_any_window(app: &AppHandle) {
    if let Some(w) = app.webview_windows().values().next() {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Creates a top-level window with the app's frame (our own caption
/// buttons; native traffic lights on macOS).
fn build_window(app: &AppHandle, label: &str, title: &str) -> AppResult<()> {
    let offset = (app.webview_windows().len() as f64 % 8.0) * 26.0;
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1400.0, 880.0)
        .min_inner_size(760.0, 480.0)
        .background_color(tauri::window::Color(20, 20, 20, 255))
        .position(60.0 + offset, 40.0 + offset);
    // macOS keeps its native traffic-light buttons over our title bar;
    // Windows and Linux use the app's own caption buttons.
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 17.0));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    builder.build()?;
    Ok(())
}

/// Opens a window showing the start page of `kind`, optionally opening a file.
fn open_start(app: &AppHandle, state: &AppState, kind: AppKind, file: Option<String>) -> AppResult<()> {
    let label = format!("start-{}-{}", kind.as_str(), state.next_window_number());
    if let Some(f) = file {
        state.window_files.lock().unwrap().insert(label.clone(), f);
    }
    build_window(app, &label, kind.name())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookWindow {
    pub label: String,
    pub book: String,
    pub title: String,
    pub dirty: bool,
}

/// Open workbook windows (View > Switch Windows).
#[tauri::command(async)]
pub fn list_book_windows(state: State<'_, AppState>) -> AppResult<Vec<BookWindow>> {
    let mut out = Vec::new();
    for (label, book) in state.bound_windows() {
        if let Ok((title, dirty)) = state.read(&book, |s| Ok((s.title.clone(), s.dirty))) {
            out.push(BookWindow { label, book, title, dirty });
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

#[tauri::command(async)]
pub fn app_info(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) -> AppResult<AppInfo> {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    let settings = state.settings.lock().unwrap().value.clone();
    let label = window.label();
    let startup_file = if label == "main" {
        let file = state.startup_file.lock().unwrap().take();
        if let Some(f) = &file {
            // The first window shows the app that opens the file
            let kind = AppKind::for_path(f, state.startup_app);
            *state.main_app.lock().unwrap() = kind;
        }
        file
    } else {
        state.window_files.lock().unwrap().remove(label)
    };
    let kind = window_app(&state, label);
    Ok(AppInfo {
        name: kind.name().to_string(),
        app: kind.as_str().to_string(),
        version: app.package_info().version.to_string(),
        user_name: settings.user_name.clone(),
        initials: initials(&settings.user_name),
        settings,
        startup_file,
        day_first: state.config().day_first,
    })
}

#[tauri::command(async)]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let mut store = state.settings.lock().unwrap();
    let size = settings.default_font_size.clamp(1, 409);
    store.value = Settings {
        default_font_size: size,
        sheets_in_new_workbook: settings.sheets_in_new_workbook.clamp(1, 255),
        autorecover_seconds: settings.autorecover_seconds.min(3600),
        keep_versions: settings.keep_versions.min(200),
        ..settings
    };
    store.save();
    state.update_prefs(&store.value);
    Ok(store.value.clone())
}

#[tauri::command(async)]
pub fn list_recent(state: State<'_, AppState>) -> AppResult<Vec<RecentItem>> {
    Ok(state.recent.lock().unwrap().list())
}

#[tauri::command(async)]
pub fn pin_recent(state: State<'_, AppState>, path: String, pinned: bool) -> AppResult<Vec<RecentItem>> {
    let mut recent = state.recent.lock().unwrap();
    recent.set_pinned(&path, pinned);
    Ok(recent.list())
}

#[tauri::command(async)]
pub fn remove_recent(state: State<'_, AppState>, path: String) -> AppResult<Vec<RecentItem>> {
    let mut recent = state.recent.lock().unwrap();
    recent.remove(&path);
    Ok(recent.list())
}

#[tauri::command(async)]
pub fn clear_recent(state: State<'_, AppState>) -> AppResult<Vec<RecentItem>> {
    let mut recent = state.recent.lock().unwrap();
    recent.clear_unpinned();
    Ok(recent.list())
}

#[tauri::command(async)]
pub fn list_templates(state: State<'_, AppState>) -> AppResult<Vec<TemplateMeta>> {
    Ok(state.templates.list())
}

#[tauri::command(async)]
pub fn template_preview(state: State<'_, AppState>, id: String) -> AppResult<Option<TemplatePreview>> {
    let config = state.config();
    state.templates.preview(&id, &config)
}

#[tauri::command(async)]
pub fn reveal_in_folder(app: AppHandle, path: String) -> AppResult<()> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Associates the calling window with a workbook (None when it shows the start screen).
#[tauri::command(async)]
pub fn bind_window(window: WebviewWindow, state: State<'_, AppState>, book: Option<String>) -> AppResult<()> {
    state.bind_window(window.label(), book);
    Ok(())
}

/// Workbook currently bound to the calling window (restores it after a reload).
#[tauri::command(async)]
pub fn window_book(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state.book_of_window(window.label()))
}

/// The app the calling window shows ("sheets" or "docs"). Doesn't take the
/// startup file: `app_info` does that.
#[tauri::command(async)]
pub fn window_kind(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<String> {
    let label = window.label();
    if label == "main" {
        if let Some(f) = state.startup_file.lock().unwrap().as_ref() {
            return Ok(AppKind::for_path(f, state.startup_app).as_str().to_string());
        }
    }
    Ok(window_app(&state, label).as_str().to_string())
}

/// Document currently bound to the calling window (restores it after a reload).
#[tauri::command(async)]
pub fn window_doc(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state.doc_of_window(window.label()))
}

/// Brings the window showing `book` to the front. Returns false if none.
#[tauri::command(async)]
pub fn focus_book(app: AppHandle, state: State<'_, AppState>, book: String) -> AppResult<bool> {
    if let Some(label) = state.window_of(&book) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            window.set_focus()?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Opens a new top-level window for an already created workbook session.
#[tauri::command]
pub async fn open_book_window(app: AppHandle, state: State<'_, AppState>, book: String, title: String) -> AppResult<()> {
    let label = format!("book-{book}");
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus()?;
        return Ok(());
    }
    state.bind_window(&label, Some(book));
    build_window(&app, &label, &format!("{title} - {APP_NAME}"))
}

/// Opens a new top-level window for an already created document session.
#[tauri::command]
pub async fn open_doc_window(app: AppHandle, state: State<'_, AppState>, doc: String, title: String) -> AppResult<()> {
    let label = format!("doc-{doc}");
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus()?;
        return Ok(());
    }
    state.bind_window(&label, Some(doc));
    build_window(&app, &label, &format!("{title} - Docs"))
}

/// Opens the start page of an app ("sheets" or "docs") in a new window, or
/// a file in the app that opens it.
#[tauri::command]
pub async fn open_app_window(app: AppHandle, state: State<'_, AppState>, kind: String, file: Option<String>) -> AppResult<()> {
    let kind = AppKind::parse(&kind).ok_or_else(|| AppError::Invalid("Unknown app".into()))?;
    open_start(&app, &state, kind, file)
}

/// Opens a file in the app that opens it (e.g. a .docx dropped on Sheets).
#[tauri::command]
pub async fn open_in_app(app: AppHandle, path: String) -> AppResult<()> {
    deliver_open(&app, path);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocWindow {
    pub label: String,
    pub doc: String,
    pub title: String,
    pub dirty: bool,
}

/// Open document windows (View > Switch Windows in Docs).
#[tauri::command(async)]
pub fn list_doc_windows(state: State<'_, AppState>) -> AppResult<Vec<DocWindow>> {
    let mut out = Vec::new();
    for (label, doc) in state.doc_windows() {
        if let Ok((title, dirty)) = state.read_doc(&doc, |d| Ok((d.title.clone(), d.dirty))) {
            out.push(DocWindow { label, doc, title, dirty });
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}
