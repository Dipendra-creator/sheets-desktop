import { invoke } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setAppName } from "./app/context";
import "./styles/base.css";
import "./styles/titlebar.css";
import "./styles/backstage.css";
import "./styles/ribbon.css";
import "./styles/workbook.css";
import "./styles/menus.css";
import "./styles/dialogs.css";
import "./styles/features.css";

// Disable the WebView context menu outside inputs (the app provides its own menus)
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement) && !t.closest?.("[contenteditable]")) {
    e.preventDefault();
  }
});

// One binary runs both apps: each window asks which one it shows
async function start() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  const kind = await invoke<string>("window_kind").catch(() => "sheets");
  if (kind === "docs") {
    setAppName("Docs");
    document.title = "Docs";
    document.documentElement.dataset.app = "docs";
    const [{ default: DocsApp }] = await Promise.all([import("./docs/DocsApp"), import("./styles/docs.css")]);
    root.render(<DocsApp />);
  } else {
    root.render(<App />);
  }
}

start();
