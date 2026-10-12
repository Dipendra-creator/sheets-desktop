// A Docs window: the start page or a document.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, type AppInfo, type RecentItem, type Settings, type TemplateMeta } from "../api";
import { AppContext, type AppApi, type AskButton } from "../app/context";
import { OptionsDialog } from "../app/OptionsDialog";
import { TitleBar } from "../app/TitleBar";
import { MessageBox } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { initLocale } from "../lib/formats";
import { docsApi, isDocPath, type DocInfo, type DocPayload } from "./api";
import { DocsBackstage } from "./backstage/DocsBackstage";
import { DocsContext, type DocsAppApi } from "./context";
import { DocView, PICTURE_FILE } from "./view/DocView";
import "./view/icons";

interface Ask {
  title: string;
  message: string;
  buttons: AskButton[];
  icon?: string;
  resolve: (v: string) => void;
}

interface Shown {
  info: DocInfo;
  payload: DocPayload;
}

function applyTheme(theme: Settings["theme"]) {
  const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
  document.documentElement.dataset.theme = resolved;
}

/** Files Docs lists among recent files. */
const DOC_RECENT = /\.(docx|docm|dotx|dotm|md|markdown|txt)$/i;

export default function DocsApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recent, setRecentAll] = useState<RecentItem[]>([]);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [doc, setDoc] = useState<Shown | null>(null);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [options, setOptions] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const docRef = useRef<Shown | null>(null);
  docRef.current = doc;
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const setRecent = useCallback((list: RecentItem[]) => setRecentAll(list.filter((r) => DOC_RECENT.test(r.name))), []);

  const ask = useCallback(
    (title: string, message: string, buttons: AskButton[], icon?: string) => new Promise<string>((resolve) => setAsks((a) => [...a, { title, message, buttons, icon, resolve }])),
    [],
  );
  const error = useCallback((message: string) => void ask("Docs", message, [{ label: "OK", value: "ok", primary: true }], "errorCircle"), [ask]);

  const refreshRecent = useCallback(async () => {
    setRecent(await api.listRecent());
  }, [setRecent]);

  const load = useCallback(async (d: DocInfo) => {
    const payload = await docsApi.payload(d.id);
    setDoc({ info: d, payload });
  }, []);

  // Show a created/opened document here or in a new window (like Word)
  const show = useCallback(
    async (d: DocInfo, alreadyOpen: boolean) => {
      const current = docRef.current;
      if (alreadyOpen) {
        if (current?.info.id === d.id) return;
        if (await api.focusBook(d.id)) return;
      }
      if (!current) {
        await load(d);
        return;
      }
      const latest = await docsApi.info(current.info.id).catch(() => null);
      if (latest && latest.untouched && !latest.dirty) {
        await docsApi.close(current.info.id).catch(() => {});
        await load(d);
        return;
      }
      await docsApi.openDocWindow(d.id, d.title);
    },
    [load],
  );

  const newDocument = useCallback(
    async (template?: string) => {
      try {
        const d = await docsApi.create(template);
        await show(d, false);
      } catch (e) {
        error(errorMessage(e));
      }
    },
    [show, error],
  );

  const openPath = useCallback(
    async (path: string) => {
      // Workbooks open in Sheets
      if (!isDocPath(path) && !/\.(txt|text)$/i.test(path)) {
        await docsApi.openInApp(path).catch((e) => error(errorMessage(e)));
        return;
      }
      try {
        const res = await docsApi.open(path);
        await show(res.info, res.alreadyOpen);
        refreshRecent();
        if (res.warning) ask("Docs", res.warning, [{ label: "OK", value: "ok", primary: true }], "warning");
      } catch (e) {
        error(errorMessage(e));
        refreshRecent();
      }
    },
    [show, error, refreshRecent, ask],
  );
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  const browse = useCallback(async () => {
    const path = await openDialog({
      title: "Open",
      multiple: false,
      directory: false,
      filters: [
        { name: "All Word Documents", extensions: ["docx", "docm", "dotx", "dotm"] },
        { name: "Word Document", extensions: ["docx"] },
        { name: "Text and Markdown", extensions: ["txt", "md", "markdown"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") await openPath(path);
  }, [openPath]);

  const saveSettings = useCallback(
    async (s: Settings) => {
      try {
        const saved = await api.updateSettings(s);
        setSettings(saved);
        applyTheme(saved.theme);
        const fresh = await api.appInfo();
        setInfo((old) => (old ? { ...fresh, startupFile: null } : fresh));
        initLocale(fresh.dayFirst);
      } catch (e) {
        error(errorMessage(e));
      }
    },
    [error],
  );

  // Startup
  useEffect(() => {
    (async () => {
      try {
        const appInfo = await api.appInfo();
        applyTheme(appInfo.settings.theme);
        initLocale(appInfo.dayFirst);
        docsApi.templates().then(setTemplates).catch(() => {});
        refreshRecent().catch(() => {});
        const label = getCurrentWindow().label;
        const bound = await docsApi.windowDoc().catch(() => null);
        let initial: DocInfo | null = null;
        if (bound) initial = await docsApi.info(bound);
        else if (label.startsWith("doc-")) initial = await docsApi.info(label.slice(4));
        else if (appInfo.startupFile) {
          // A file that can't be opened leaves the start screen up
          try {
            const res = await docsApi.open(appInfo.startupFile);
            initial = res.info;
            if (res.warning) ask("Docs", res.warning, [{ label: "OK", value: "ok", primary: true }], "warning");
          } catch (e) {
            error(errorMessage(e));
          }
        } else if (!appInfo.settings.showStartScreen) initial = await docsApi.create();
        if (initial) await load(initial);
        setSettings(appInfo.settings);
        setInfo(appInfo);
      } catch (e) {
        setFatal(errorMessage(e));
      }
    })();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => settingsRef.current?.theme === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5" && !e.ctrlKey && !docRef.current) e.preventDefault();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "r") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Files dropped on the window
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        // Pictures dropped on a document are inserted into it (DocView)
        const files = event.payload.paths.filter((p) => !PICTURE_FILE.test(p));
        files.forEach((p) => openPathRef.current(p));
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Files opened from the OS while the app runs
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow()
      .listen<string>("open-file", (event) => openPathRef.current(event.payload))
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Tell the backend which document this window shows
  useEffect(() => {
    if (!info) return;
    api.bindWindow(doc?.info.id ?? null).catch(() => {});
    if (!doc) getCurrentWindow().setTitle("Docs").catch(() => {});
  }, [doc?.info.id, info === null]);

  const appCtx: AppApi | null = useMemo(
    () =>
      info && settings
        ? {
            info,
            settings,
            saveSettings,
            recent,
            refreshRecent,
            setRecent,
            templates,
            current: null,
            newWorkbook: (t?: string) => newDocument(t),
            showBook: async () => {},
            openPath,
            browse,
            ask,
            error,
            showStart: () => {
              setDoc(null);
              refreshRecent();
            },
            openOptions: () => setOptions(true),
          }
        : null,
    [info, settings, recent, templates, saveSettings, refreshRecent, setRecent, newDocument, openPath, browse, ask, error],
  );

  const docsCtx: DocsAppApi = useMemo(
    () => ({
      templates,
      current: doc?.info ?? null,
      newDocument,
      showDoc: (d: DocInfo) => show(d, false),
    }),
    [templates, doc, newDocument, show],
  );

  if (fatal) {
    return (
      <div className="fatal">
        <Icon name="errorCircle" size={32} />
        <p>{fatal}</p>
      </div>
    );
  }
  if (!appCtx) return <div className="app-loading" />;

  const top = asks[0];
  return (
    <AppContext.Provider value={appCtx}>
      <DocsContext.Provider value={docsCtx}>
        {doc ? (
          <DocView key={doc.info.id} info={doc.info} payload={doc.payload} />
        ) : (
          <div className="start-window docs-start">
            <TitleBar
              title="Docs"
              right={
                <button className="tb-icon" title="Help" onClick={() => ask("Docs", "Docs opens and saves Word documents (.docx), plain text and Markdown. Choose a template or Blank document to start.", [{ label: "OK", value: "ok", primary: true }], "infoCircle")}>
                  <Icon name="help" />
                </button>
              }
            />
            <DocsBackstage />
          </div>
        )}
        {options && <OptionsDialog settings={settings!} onSave={saveSettings} onClose={() => setOptions(false)} />}
        {top && (
          <MessageBox
            title={top.title}
            message={top.message.split("\n").map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            icon={top.icon}
            buttons={top.buttons}
            onClose={(value) => {
              top.resolve(value);
              setAsks((a) => a.slice(1));
            }}
          />
        )}
      </DocsContext.Provider>
    </AppContext.Provider>
  );
}
