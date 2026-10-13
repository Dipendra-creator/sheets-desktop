import { useState } from "react";
import { api, type RecentItem } from "../api";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { friendlyDate } from "../lib/formats";

function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (/\.(docx|docm|dotx|dotm|md|markdown)$/.test(n)) return "docx";
  if (/\.(csv|tsv|txt)$/.test(n)) return "csv";
  return "xlsx";
}

export function RecentList({ filter, limit, emptyText, query }: { filter?: "pinned"; limit?: number; emptyText?: string; query?: string }) {
  const app = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number; item: RecentItem } | null>(null);
  let items = app.recent;
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q) || i.folder.toLowerCase().includes(q));
  }
  if (filter === "pinned") items = items.filter((i) => i.pinned);
  else items = [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
  if (limit) items = items.slice(0, limit);

  const open = async (item: RecentItem) => {
    if (!item.exists) {
      const answer = await app.ask(
        app.info.name,
        `Sorry, we couldn't find ${item.path}. Is it possible it was moved, renamed or deleted?\n\nRemove it from the list?`,
        [
          { label: "Remove", value: "remove", primary: true },
          { label: "Cancel", value: "cancel" },
        ],
        "warning",
      );
      if (answer === "remove") app.setRecent(await api.removeRecent(item.path));
      return;
    }
    app.openPath(item.path);
  };

  const pin = async (item: RecentItem) => app.setRecent(await api.pinRecent(item.path, !item.pinned));

  if (!items.length) {
    return (
      <div className="recent-empty">
        {emptyText ??
          (filter === "pinned"
            ? "Pin files you want to easily find later. Click the pin icon that appears when you hover over a file."
            : "You haven't opened any files recently. Click Open to browse for a file.")}
      </div>
    );
  }

  return (
    <div className="recent-table">
      <div className="rt-head">
        <span className="rt-icon">
          <Icon name="file" />
        </span>
        <span className="rt-name">Name</span>
        <span className="rt-date">Date modified</span>
      </div>
      {items.map((item) => (
        <div
          key={item.path}
          className={`rt-row ${item.exists ? "" : "missing"}`}
          onClick={() => open(item)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, item });
          }}
          title={item.path}
        >
          <span className="rt-icon">
            <Icon name={iconFor(item.name)} size={24} />
          </span>
          <span className="rt-name">
            <span className="rt-file">{item.name}</span>
            <span className="rt-folder">{item.folder}</span>
          </span>
          <button
            className={`rt-pin ${item.pinned ? "pinned" : ""}`}
            title={item.pinned ? "Unpin from list" : "Pin to list"}
            onClick={(e) => {
              e.stopPropagation();
              pin(item);
            }}
          >
            <Icon name={item.pinned ? "pinFilled" : "pin"} />
          </button>
          <span className="rt-date">{friendlyDate(item.modified || item.lastOpened)}</span>
        </div>
      ))}
      {menu && (
        <Menu
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open", icon: "open", onClick: () => open(menu.item) },
            { label: "Open file location", icon: "open", disabled: !menu.item.exists, onClick: () => api.revealInFolder(menu.item.path).catch((e) => app.error(String(e))) },
            { label: "Copy path to clipboard", icon: "copy", onClick: () => navigator.clipboard.writeText(menu.item.path).catch(() => {}) },
            { separator: true },
            { label: menu.item.pinned ? "Unpin from list" : "Pin to list", icon: "pin", onClick: () => pin(menu.item) },
            { label: "Remove from list", icon: "x", onClick: async () => app.setRecent(await api.removeRecent(menu.item.path)) },
            { label: "Clear unpinned items", onClick: async () => app.setRecent(await api.clearRecent()) },
          ]}
        />
      )}
    </div>
  );
}
