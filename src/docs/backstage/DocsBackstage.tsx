// The File menu and start page of Docs: Home, New, Open, Info, Save As,
// Print, Export, Close, Account, Options.

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorMessage, type RecoveryItem, type VersionItem } from "../../api";
import { useApp } from "../../app/context";
import { updates, useUpdateStatus } from "../../app/updates";
import { RecentList } from "../../backstage/RecentList";
import { Icon } from "../../components/Icon";
import { friendlyDate, greeting } from "../../lib/formats";
import { docsApi } from "../api";
import type { DocController } from "../editor/controller";
import { documentHtml } from "../editor/export";
import { useDocsApp } from "../context";
import { BlankThumb, TemplateThumb } from "./DocThumb";

export type DocsPage = "home" | "new" | "open" | "info" | "print" | "export" | "account";

export interface DocActions {
  ctl: DocController;
  back: () => void;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  close: () => Promise<void>;
  print: () => Promise<void>;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function RecoveryPanel({ kind }: { kind: "crashed" | "unsaved" }) {
  const app = useApp();
  const docs = useDocsApp();
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const matches = (i: RecoveryItem) => i.app === "docs" && (i.kind === kind || (kind === "crashed" && i.kind === "updated"));
  useEffect(() => {
    api
      .recoveryList()
      .then((list) => setItems(list.filter(matches)))
      .catch(() => {});
  }, [kind]);
  if (!items.length) return kind === "unsaved" ? <div className="recent-empty">No unsaved documents from the last 7 days.</div> : null;
  const updated = items.every((i) => i.kind === "updated");
  return (
    <div className="recovery-panel">
      <h2>
        <Icon name="recover" /> {kind === "unsaved" ? "Recover Unsaved Documents" : "Document Recovery"}
      </h2>
      <p className="muted small">
        {kind === "unsaved"
          ? "Documents you closed without saving are kept here for 7 days."
          : updated
            ? "Docs restarted to install an update. These documents had unsaved changes: open them to continue where you left off, then save them."
            : "Docs closed unexpectedly. These documents were recovered from the last AutoRecover snapshot. Open them and save the versions you want to keep."}
      </p>
      {items.map((item) => (
        <div key={item.file} className="recovery-row">
          <Icon name="docx" size={24} />
          <div className="rr-name">
            <b title={item.originalPath ?? item.title}>{item.title}</b>
            <span className="muted small">
              {friendlyDate(item.savedAt)} · {fileSize(item.size)}
              {item.originalPath ? ` · ${item.originalPath}` : " · never saved"}
            </span>
          </div>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                const info = await docsApi.recoveryOpen(item.file);
                setItems((list) => list.filter((i) => i.file !== item.file));
                await docs.showDoc(info);
              } catch (e) {
                app.error(errorMessage(e));
              }
            }}
          >
            Open
          </button>
          <button
            className="btn"
            onClick={async () => {
              const answer = await app.ask("Docs", `Delete the recovered copy of '${item.title}'? This can't be undone.`, [
                { label: "Delete", value: "delete", primary: true },
                { label: "Cancel", value: "cancel" },
              ]);
              if (answer !== "delete") return;
              const list = await api.recoveryDiscard(item.file);
              setItems(list.filter(matches));
            }}
          >
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}

function Tile({ id, name, onOpen, blank, banner }: { id?: string; name: string; onOpen: () => void; blank?: boolean; banner?: [string, string] }) {
  return (
    <button className={`template-tile doc-tile ${blank ? "selected" : ""}`} onClick={onOpen} title={name}>
      <div className="tile-thumb">
        {blank ? (
          <BlankThumb />
        ) : banner ? (
          <div className="doc-thumb tutorial">
            <div className="tt-small">{banner[0]}</div>
            <div className="tt-big">{banner[1]}</div>
            <div className="tt-band">
              <span className="tt-badge">
                <Icon name="arrowRight" size={14} />
              </span>
            </div>
          </div>
        ) : (
          <TemplateThumb id={id!} />
        )}
      </div>
      <div className="tile-label">{name}</div>
    </button>
  );
}

function HomePage({ onMore }: { onMore: () => void }) {
  const docs = useDocsApp();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<"recent" | "pinned">("recent");
  const [q, setQ] = useState("");
  return (
    <div className="bs-page home-page">
      <h1 className="bs-greeting">{greeting()}</h1>
      <RecoveryPanel kind="crashed" />
      <button className="bs-section-toggle" onClick={() => setCollapsed(!collapsed)}>
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} />
        <span>New</span>
      </button>
      {!collapsed && (
        <>
          <div className="tile-row">
            <Tile blank name="Blank document" onOpen={() => docs.newDocument()} />
            {docs.templates.slice(0, 6).map((t) => (
              <Tile key={t.id} id={t.id} name={t.name} banner={t.banner} onOpen={() => docs.newDocument(t.id)} />
            ))}
          </div>
          <div className="more-templates">
            <button className="link-btn" onClick={onMore}>
              More templates <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </>
      )}
      <div className="bs-tabs-row">
        <div className="bs-tabs">
          <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
            Recent
          </button>
          <button className={tab === "pinned" ? "active" : ""} onClick={() => setTab("pinned")}>
            Pinned
          </button>
        </div>
        <div className="bs-search small">
          <Icon name="search" />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <RecentList filter={tab === "pinned" ? "pinned" : undefined} query={q} />
    </div>
  );
}

function NewPage() {
  const docs = useDocsApp();
  const [q, setQ] = useState("");
  const list = docs.templates.filter((t) => !q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="bs-page">
      <h1 className="bs-title">New</h1>
      <div className="bs-search">
        <Icon name="search" />
        <input placeholder="Search for templates" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tile-row wrap">
        {!q && <Tile blank name="Blank document" onOpen={() => docs.newDocument()} />}
        {list.map((t) => (
          <Tile key={t.id} id={t.id} name={t.name} banner={t.banner} onOpen={() => docs.newDocument(t.id)} />
        ))}
        {list.length === 0 && <div className="recent-empty">No templates match your search.</div>}
      </div>
    </div>
  );
}

function OpenPage() {
  const app = useApp();
  const [source, setSource] = useState<"recent" | "unsaved">("recent");
  return (
    <div className="bs-page">
      <h1 className="bs-title">Open</h1>
      <div className="open-layout">
        <div className="open-sources">
          <button className={`open-source ${source === "recent" ? "active" : ""}`} onClick={() => setSource("recent")}>
            <Icon name="clock" size={20} />
            <span>Recent</span>
          </button>
          <button className="open-source" onClick={() => app.browse()}>
            <Icon name="open" size={20} />
            <span>Browse</span>
          </button>
          <button className={`open-source ${source === "unsaved" ? "active" : ""}`} onClick={() => setSource("unsaved")}>
            <Icon name="recover" size={20} />
            <span>Recover Unsaved Documents</span>
          </button>
        </div>
        <div className="open-list">{source === "recent" ? <RecentList /> : <RecoveryPanel kind="unsaved" />}</div>
      </div>
    </div>
  );
}

function PropertyField({ ctl, name, label }: { ctl: DocController; name: string; label: string }) {
  const initial = ctl.coreEdits[name] ?? ctl.payload.core?.[name] ?? "";
  const [value, setValue] = useState(initial);
  return (
    <div>
      <span>{label}</span>
      <input
        className="plain-input prop-input"
        value={value}
        placeholder={`Add ${label.toLowerCase()}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== initial) {
            ctl.coreEdits[name] = value;
            if (ctl.payload.core) ctl.payload.core[name] = value;
            ctl.markChanged();
          }
        }}
      />
    </div>
  );
}

function VersionHistory({ doc }: { doc: DocActions }) {
  const app = useApp();
  const docs = useDocsApp();
  const path = doc.ctl.info.path;
  const [items, setItems] = useState<VersionItem[] | null>(null);
  useEffect(() => {
    if (path) api.versions(path).then(setItems).catch(() => setItems([]));
  }, [path]);
  if (!path) return null;
  return (
    <>
      <h2 className="bs-subtitle">Version History</h2>
      {!items?.length ? (
        <p className="muted">No previous versions yet. Each time you save, the previous version of the file is kept here.</p>
      ) : (
        <div className="recent-table version-list">
          {items.map((v) => (
            <div
              key={v.file}
              className="rt-row"
              title="Open this version as a new document"
              onClick={async () => {
                try {
                  const stamp = new Date(v.savedAt).toLocaleString();
                  const info = await docsApi.versionOpen(v.file, `${doc.ctl.info.title} (version ${stamp})`);
                  await docs.showDoc(info);
                } catch (e) {
                  app.error(errorMessage(e));
                }
              }}
            >
              <span className="rt-icon">
                <Icon name="history" size={20} />
              </span>
              <span className="rt-name">
                <span className="rt-file">{new Date(v.savedAt).toLocaleString()}</span>
                <span className="rt-folder">{fileSize(v.size)}</span>
              </span>
              <span className="rt-date">{friendlyDate(v.savedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function InfoPage({ doc }: { doc: DocActions }) {
  const app = useApp();
  const ctl = doc.ctl;
  const info = ctl.info;
  ctl.recount();
  const core = ctl.payload.core ?? {};
  const date = (s: string | undefined) => (s ? new Date(s).toLocaleString() : "—");
  return (
    <div className="bs-page">
      <h1 className="bs-title">Info</h1>
      <div className="info-name">
        <Icon name="docx" size={32} />
        <div>
          <div className="info-title">{info.title}</div>
          <div className="muted">{info.path ?? (info.sourcePath ? `Opened from ${info.sourcePath}` : "Not saved yet")}</div>
        </div>
      </div>
      <div className="info-columns">
        <div>
          <div className="info-actions">
            <button className="info-card" disabled={!info.path} onClick={() => info.path && api.revealInFolder(info.path).catch((e) => app.error(String(e)))}>
              <Icon name="open" size={24} />
              <span>Open File Location</span>
            </button>
            <button className="info-card" onClick={() => doc.saveAs()}>
              <Icon name="saveAs" size={24} />
              <span>Save a Copy / Save As</span>
            </button>
            <button
              className="info-card"
              onClick={() => {
                doc.back();
                ctl.openDialog("accessibility");
              }}
            >
              <Icon name="accessibility" size={24} />
              <span>Check Accessibility</span>
            </button>
          </div>
          <VersionHistory doc={doc} />
        </div>
        <div>
          <h2 className="bs-subtitle">Properties</h2>
          <div className="props">
            <div>
              <span>Pages</span>
              <span>{ctl.pages.length}</span>
            </div>
            <div>
              <span>Words</span>
              <span>{ctl.stats.words.toLocaleString()}</span>
            </div>
            <PropertyField ctl={ctl} name="title" label="Title" />
            <PropertyField ctl={ctl} name="keywords" label="Tags" />
            <PropertyField ctl={ctl} name="description" label="Comments" />
            <PropertyField ctl={ctl} name="subject" label="Subject" />
            <PropertyField ctl={ctl} name="category" label="Categories" />
          </div>
          <h2 className="bs-subtitle">Related Dates</h2>
          <div className="props">
            <div>
              <span>Last Modified</span>
              <span>{date(core.modified)}</span>
            </div>
            <div>
              <span>Created</span>
              <span>{date(core.created)}</span>
            </div>
          </div>
          <h2 className="bs-subtitle">Related People</h2>
          <div className="props">
            <PropertyField ctl={ctl} name="creator" label="Author" />
            <div>
              <span>Last Modified By</span>
              <span>{core.lastModifiedBy || "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrintPage({ doc }: { doc: DocActions }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="bs-page">
      <h1 className="bs-title">Print</h1>
      <div className="print-options">
        <button
          className="btn primary big"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              doc.back();
              await doc.print();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="print" /> {busy ? "Preparing…" : "Print / Save as PDF"}
        </button>
        <p className="muted small">The pages print exactly as they appear in Print Layout. Choose "Save as PDF" (Windows: Microsoft Print to PDF) in the print dialog to create a PDF.</p>
        <p className="muted small">
          {doc.ctl.pages.length} page{doc.ctl.pages.length === 1 ? "" : "s"} ·{" "}
          {(() => {
            const g = doc.ctl.state.doc.attrs.page as Record<string, Record<string, string>> | null;
            const w = Number(g?.pgSz?.w ?? 12240) / 1440;
            const h = Number(g?.pgSz?.h ?? 15840) / 1440;
            return `${w.toFixed(2)}" × ${h.toFixed(2)}"`;
          })()}
        </p>
        <button className="btn" onClick={() => (doc.back(), doc.ctl.openDialog("pageSetup", { tab: "margins" }))}>
          Page Setup…
        </button>
      </div>
    </div>
  );
}

function ExportPage({ doc }: { doc: DocActions }) {
  const app = useApp();
  const exportAs = async (ext: "docx" | "txt" | "md" | "html") => {
    const names: Record<string, string> = { docx: "Word Document", txt: "Plain Text", md: "Markdown", html: "Web Page" };
    const path = await saveDialog({ title: "Export", defaultPath: `${doc.ctl.info.title}.${ext}`, filters: [{ name: names[ext], extensions: [ext] }] });
    if (!path) return;
    try {
      if (ext === "html") await docsApi.writeHtml(path, await documentHtml(doc.ctl));
      else await doc.ctl.exportTo(path);
      doc.back();
    } catch (e) {
      app.error(errorMessage(e));
    }
  };
  const items: { key: "pdf" | "docx" | "txt" | "md" | "html"; icon: string; title: string; desc: string }[] = [
    { key: "pdf", icon: "print", title: "Create PDF Document", desc: "Preserves layout and formatting. Opens the print dialog: choose Save as PDF." },
    { key: "docx", icon: "docx", title: "Word Document (*.docx)", desc: "Save a copy that opens in Microsoft Word, LibreOffice and Google Docs." },
    { key: "txt", icon: "file", title: "Plain Text (*.txt)", desc: "Only the text, without formatting." },
    { key: "md", icon: "file", title: "Markdown (*.md)", desc: "Headings, lists, emphasis, links and tables as Markdown." },
    { key: "html", icon: "webLayout", title: "Web Page (*.html)", desc: "A single web page with the styles and pictures included." },
  ];
  return (
    <div className="bs-page">
      <h1 className="bs-title">Export</h1>
      <div className="export-list">
        {items.map((i) => (
          <button
            key={i.key}
            className="export-item"
            onClick={() => {
              if (i.key === "pdf") {
                doc.back();
                doc.print();
              } else exportAs(i.key);
            }}
          >
            <Icon name={i.icon} size={32} />
            <div>
              <b>{i.title}</b>
              <div className="muted">{i.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountPage() {
  const app = useApp();
  const status = useUpdateStatus();
  const [name, setName] = useState(app.settings.userName);
  const [checking, setChecking] = useState(false);
  return (
    <div className="bs-page">
      <h1 className="bs-title">Account</h1>
      <div className="account-grid">
        <div>
          <h2 className="bs-subtitle">User Information</h2>
          <div className="user-card">
            <div className="avatar big">{app.info.initials}</div>
            <div>
              <input
                className="plain-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== app.settings.userName && app.saveSettings({ ...app.settings, userName: name.trim() })}
              />
              <div className="muted small">Your name is used as the author of documents, comments and tracked changes.</div>
            </div>
          </div>
          <h2 className="bs-subtitle">Office Theme</h2>
          <select className="bs-select" value={app.settings.theme} onChange={(e) => app.saveSettings({ ...app.settings, theme: e.target.value as "dark" })}>
            <option value="dark">Black</option>
            <option value="light">White</option>
            <option value="system">Use system setting</option>
          </select>
        </div>
        <div>
          <h2 className="bs-subtitle">Product Information</h2>
          <div className="product">
            <Icon name="docsLogo" size={40} />
            <div>
              <b>Docs</b>
              <div className="muted">Version {app.info.version}</div>
              <div className="muted small">Part of the Sheets app · Editor: ProseMirror · Shell: Tauri 2</div>
            </div>
          </div>
          <h2 className="bs-subtitle">Updates</h2>
          <p className="muted small">
            {status?.phase === "available" || status?.phase === "ready" ? `Version ${status.version} is available — use the button in the title bar.` : status?.phase === "upToDate" ? "You're up to date." : "Updates are checked automatically."}
          </p>
          <button
            className="btn"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await updates.checkInteractive(app.ask);
              } finally {
                setChecking(false);
              }
            }}
          >
            <Icon name="update" size={14} /> {checking ? "Checking…" : "Check for Updates"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocsBackstage({ initial, doc }: { initial?: DocsPage; doc?: DocActions }) {
  const app = useApp();
  const [page, setPage] = useState<DocsPage>(initial ?? "home");
  useEffect(() => {
    if (initial) setPage(initial);
  }, [initial]);
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".dialog-backdrop")) {
        e.preventDefault();
        doc.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc]);
  const item = (p: DocsPage, icon: string, label: string) => (
    <button className={`bs-nav ${page === p ? "active" : ""}`} onClick={() => setPage(p)}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className={`backstage docs-backstage ${doc ? "in-book" : ""}`}>
      <nav className="bs-sidebar">
        {doc && (
          <button className="bs-back" title="Back" onClick={doc.back}>
            <Icon name="back" size={28} />
          </button>
        )}
        {item("home", "home", "Home")}
        {item("new", "newDoc", "New")}
        {item("open", "open", "Open")}
        {doc && (
          <>
            <div className="bs-divider" />
            <button className={`bs-nav text ${page === "info" ? "active" : ""}`} onClick={() => setPage("info")}>
              Info
            </button>
            <button className="bs-nav text" onClick={() => doc.save().then((ok) => ok && doc.back())}>
              Save
            </button>
            <button className="bs-nav text" onClick={() => doc.saveAs().then((ok) => ok && doc.back())}>
              Save As
            </button>
            <button className={`bs-nav text ${page === "print" ? "active" : ""}`} onClick={() => setPage("print")}>
              Print
            </button>
            <button className={`bs-nav text ${page === "export" ? "active" : ""}`} onClick={() => setPage("export")}>
              Export
            </button>
            <button className="bs-nav text" onClick={() => doc.close()}>
              Close
            </button>
          </>
        )}
        <div className="bs-spacer" />
        <div className="bs-divider" />
        <button className={`bs-nav text ${page === "account" ? "active" : ""}`} onClick={() => setPage("account")}>
          Account
        </button>
        <button className="bs-nav text" onClick={() => app.openOptions()}>
          Options
        </button>
      </nav>
      <main className="bs-main">
        {page === "home" && <HomePage onMore={() => setPage("new")} />}
        {page === "new" && <NewPage />}
        {page === "open" && <OpenPage />}
        {page === "info" && doc && <InfoPage doc={doc} />}
        {page === "print" && doc && <PrintPage doc={doc} />}
        {page === "export" && doc && <ExportPage doc={doc} />}
        {page === "account" && <AccountPage />}
      </main>
    </div>
  );
}
