import { useEffect, useState, type ReactNode } from "react";
import type { PluginMenuItem } from "@praisesuite/core";
import { api } from "../api.js";

interface PsBridge {
  displayCount?: () => Promise<number>;
}

export interface ModeChoice {
  /** Display mode applied via ps:set-display-mode ("plugin:*" = plugin supplies output). */
  mode: string;
  /** Optional plugin command to invoke on pick. */
  plugin?: { pluginId: string; command: string };
}

interface Option {
  id: string;
  label: string;
  desc: string;
  mode: string;
  plugin?: { pluginId: string; command: string };
}

/**
 * Presentation-mode popup (OpenSong "Monitor Mode" chooser, per-launch):
 * Single, Dual (2+ displays only), Dual-Screen Test (1 display only),
 * Network — plus any plugin-contributed outputs (e.g. a future OBS mode).
 */
export function PresentModeMenu({
  onPick,
  onCancel,
}: {
  onPick: (choice: ModeChoice) => void;
  onCancel: () => void;
}): ReactNode {
  const [displays, setDisplays] = useState(1);
  const [net, setNet] = useState<{ lanEnabled: boolean; addresses: string[] } | null>(null);
  const [pluginItems, setPluginItems] = useState<(PluginMenuItem & { pluginId: string; pluginName: string })[]>([]);

  useEffect(() => {
    const ps = (window as unknown as { ps?: PsBridge }).ps;
    void ps?.displayCount?.().then(setDisplays).catch(() => {});
    api.network().then(setNet).catch(() => {});
    api.plugins()
      .then((manifests) => {
        const items = manifests.flatMap((m) =>
          (m.contributes?.menus?.["present.mode"] ?? []).map((it) => ({
            ...it,
            pluginId: m.id,
            pluginName: m.name,
          })),
        );
        items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setPluginItems(items);
      })
      .catch(() => {});
  }, []);

  const port = window.location.port;
  const options: Option[] = [
    {
      id: "single",
      label: "Single Screen",
      desc: "Fullscreen output on this display; control it with the keyboard or a remote.",
      mode: "single",
    },
  ];
  if (displays >= 2) {
    options.push({
      id: "dual",
      label: "Dual Screen",
      desc: "Presentation helper here, fullscreen output on the second display.",
      mode: "dual",
    });
  }
  if (displays <= 1) {
    options.push({
      id: "preview",
      label: "Dual-Screen Test",
      desc: "Dual-screen controls with the output previewed inside the helper.",
      mode: "preview",
    });
  }
  options.push({
    id: "network",
    label: "Network",
    desc: net?.lanEnabled
      ? `Remote displays open ${net.addresses.filter((a) => a !== "127.0.0.1").map((a) => `http://${a}:${port}/receiver`).join("  or  ") || "the receiver URL"} — a browser, projector PC, or cast device.`
      : "Remote displays over the network (enable LAN access in Settings first).",
    mode: "network",
  });
  for (const it of pluginItems) {
    options.push({
      id: `plugin:${it.pluginId}:${it.id}`,
      label: it.label,
      desc: `${it.description ?? "Plugin-provided output"} — ${it.pluginName}`,
      mode: it.mode ?? `plugin:${it.pluginId}:${it.id}`,
      ...(it.command !== undefined ? { plugin: { pluginId: it.pluginId, command: it.command } } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose presentation mode"
      >
        <h2 className="mb-3 text-sm font-semibold">Present using…</h2>
        <div className="flex flex-col gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              autoFocus={o.id === "single"}
              onClick={() => onPick({ mode: o.mode, ...(o.plugin !== undefined ? { plugin: o.plugin } : {}) })}
              className="rounded border border-zinc-300 px-3 py-2 text-left hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:border-indigo-600 dark:hover:bg-indigo-950"
            >
              <div className="text-sm font-medium">{o.label}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{o.desc}</div>
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="mt-3 w-full rounded px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
