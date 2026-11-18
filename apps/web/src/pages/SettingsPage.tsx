import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.js";
import { BUNDLED_FONTS } from "../fonts.js";
import type { SlideStyle, TextStyle } from "../slide-types.js";

const ROLES = ["title", "body", "subtitle"] as const;

function RoleEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TextStyle;
  onChange: (v: TextStyle) => void;
}) {
  const set = <K extends keyof TextStyle>(k: K, v: TextStyle[K]) => onChange({ ...value, [k]: v });
  const boolField = (k: "bold" | "italic" | "underline" | "border" | "shadow" | "fill" | "enabled" | "autoScale", label: string) => (
    <label key={k} className="flex items-center gap-1 text-xs">
      <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <fieldset className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium capitalize">{label}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <label className="col-span-2 flex items-center gap-2 text-xs">
          Font
          <select
            className="flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            value={value.font}
            onChange={(e) => set("font", e.target.value)}
          >
            {BUNDLED_FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            {!BUNDLED_FONTS.includes(value.font as (typeof BUNDLED_FONTS)[number]) && (
              <option value={value.font}>{value.font}</option>
            )}
          </select>
          <input
            type="number"
            className="w-16 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            value={value.size}
            onChange={(e) => set("size", Number(e.target.value))}
            title="Size (pt)"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          Color
          <input type="color" value={value.color} onChange={(e) => set("color", e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          Align
          <select
            className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
            value={value.align}
            onChange={(e) => set("align", e.target.value as TextStyle["align"])}
          >
            <option value="left">left</option>
            <option value="center">center</option>
            <option value="right">right</option>
          </select>
          <select
            className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
            value={value.valign}
            onChange={(e) => set("valign", e.target.value as TextStyle["valign"])}
          >
            <option value="top">top</option>
            <option value="middle">middle</option>
            <option value="bottom">bottom</option>
          </select>
        </label>
        <div className="col-span-2 flex flex-wrap gap-3">
          {boolField("bold", "Bold")}
          {boolField("italic", "Italic")}
          {boolField("underline", "Underline")}
          {boolField("border", "Border")}
          {boolField("shadow", "Shadow")}
          {boolField("fill", "Fill")}
          {boolField("enabled", "Enabled")}
          {boolField("autoScale", "Auto-scale")}
        </div>
      </div>
    </fieldset>
  );
}

/** Global presentation style editor + OpenSong settings import (M6). */
export function SettingsPage(): ReactNode {
  const [style, setStyle] = useState<SlideStyle | null>(null);
  const [bibles, setBibles] = useState<{ id: string; name: string; abbreviation: string; books: number }[]>([]);
  const [net, setNet] = useState<{ lanEnabled: boolean; addresses: string[] } | null>(null);
  const [syncAddr, setSyncAddr] = useState("");
  const [displayMode, setDisplayMode] = useState<string>("auto");
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void api.style().then(setStyle);
    void api.bibles().then(setBibles).catch(() => {});
    void api.network().then(setNet).catch(() => {});
    void api.setting<string>("present.displayMode").then((s) => setDisplayMode(s.value ?? "auto")).catch(() => {});
    void (window as { ps?: { displayCount?: () => Promise<number> } }).ps?.displayCount?.().then(setDisplayCount).catch(() => {});
  }, []);

  const importBible = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const text = await f.text();
      await api.importBibleXml(text);
    }
    setBibles(await api.bibles());
    setMsg("Bible imported.");
  };

  const save = async () => {
    if (!style) return;
    await api.saveStyle(style);
    await api.saveSetting("present.displayMode", displayMode).catch(() => {});
    setMsg("Saved.");
    setTimeout(() => setMsg(""), 2000);
  };

  const importSettings = async (files: FileList | null) => {
    if (!files) return;
    let present: string | undefined;
    let print: string | undefined;
    for (const f of Array.from(files)) {
      const text = await f.text();
      if (/present_settings/i.test(text)) present = text;
      else if (/print_settings/i.test(text)) print = text;
    }
    if (!present && !print) {
      setMsg("No PresentSettings/PrintSettings files found.");
      return;
    }
    const r = await api.importOpenSongSettings(present, print);
    setMsg(`Imported settings (${r.media.length} media assets, ${r.printRoles.length} print roles).`);
    setStyle(await api.style());
  };

  if (!style) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Presentation style</h2>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-emerald-600">{msg}</span>}
          <label className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Import OpenSong settings…
            <input type="file" multiple className="hidden" onChange={(e) => void importSettings(e.target.files)} />
          </label>
          <button onClick={() => void save()} className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            Save
          </button>
        </div>
      </div>
      {ROLES.map((role) => (
        <RoleEditor key={role} label={role} value={style[role]} onChange={(v) => setStyle({ ...style, [role]: v })} />
      ))}
      <fieldset className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Slide</legend>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            Background
            <input
              type="color"
              value={style.backgroundColor}
              onChange={(e) => setStyle({ ...style, backgroundColor: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            Margin
            <input
              type="number"
              className="w-16 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              value={style.margin}
              onChange={(e) => setStyle({ ...style, margin: Number(e.target.value) })}
            />
            px
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={style.transition}
              onChange={(e) => setStyle({ ...style, transition: e.target.checked })}
            />
            Fade transitions
          </label>
          <label className="flex items-center gap-2">
            Duration
            <input
              type="number"
              className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              value={style.transitionMs}
              onChange={(e) => setStyle({ ...style, transitionMs: Number(e.target.value) })}
            />
            ms
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={style.descriptiveSubtitles}
              onChange={(e) => setStyle({ ...style, descriptiveSubtitles: e.target.checked })}
            />
            Descriptive subtitles
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={style.highlightChorus}
              onChange={(e) => setStyle({ ...style, highlightChorus: e.target.checked })}
            />
            Highlight chorus
          </label>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {style.backgroundKey ? `Background image: ${style.backgroundKey}` : "No background image."}
          {style.logoKey ? ` Logo: ${style.logoKey}` : " No logo set."}
        </div>
      </fieldset>

      <fieldset className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Monitors</legend>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            Default Monitor Mode
            <select
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value)}
              className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="auto">Automatic</option>
              <option value="single">Single Screen</option>
              <option value="dual" disabled={displayCount !== null && displayCount < 2}>
                Dual Screen{displayCount !== null && displayCount < 2 ? " (no second display)" : ""}
              </option>
              <option value="preview">Dual-Screen Test</option>
              <option value="network">Network</option>
            </select>
          </label>
          <p className="text-zinc-500">
            Single shows a fullscreen output on this screen controlled by keys or a remote; dual puts
            the helper here and fullscreen output on a second display; dual-screen test previews both
            windows inline; network leaves the screen to a device on your LAN. Applies on next launch.
          </p>
          {displayMode === "network" && (
            <div className="w-full rounded border border-zinc-300 p-2 dark:border-zinc-700">
              <p className="font-medium">Network output</p>
              <p className="mt-1 text-zinc-500">
                On the remote device (projector PC, Chromecast browser, tablet), open:
              </p>
              {net?.lanEnabled && net.addresses.length > 0 ? (
                <ul className="mt-1 list-inside list-disc font-mono">
                  {net.addresses.map((a) => (
                    <li key={a}>http://{a}:{window.location.port || "7729"}/receiver</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 font-mono">http://&lt;this-machine-ip&gt;:{window.location.port || "7729"}/receiver</p>
              )}
              {!net?.lanEnabled && (
                <p className="mt-1 text-amber-600 dark:text-amber-400">
                  Enable &quot;Allow LAN access&quot; below so other devices can reach this machine.
                </p>
              )}
              <p className="mt-1 text-zinc-500">
                The receiver picks up the live session automatically — run the helper on this machine
                as usual.
              </p>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Sync &amp; remote access</legend>
        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={net?.lanEnabled ?? false}
              disabled={!net}
              onChange={(e) => void api.setNetwork(e.target.checked).then(setNet)}
            />
            Allow LAN access (receiver/stage on other devices)
          </label>
          <p className="text-zinc-500">
            {net?.lanEnabled
              ? `Listening on: ${net.addresses.join(", ")} — sign-in is required for remote devices.`
              : "Local only (127.0.0.1) — no sign-in needed. Enabling LAN access turns the login gate back on."}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <input
              className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              placeholder="Server address (e.g. host:7729)"
              value={syncAddr}
              onChange={(e) => setSyncAddr(e.target.value)}
            />
            <button
              className="rounded border border-zinc-300 px-3 py-1 opacity-50 dark:border-zinc-700"
              title="Server sync arrives in a later milestone"
              disabled
            >
              Connect to server
            </button>
            <span className="text-zinc-400">coming with server sync</span>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Bible translations</legend>
        <ul className="mb-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {bibles.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="font-medium">{b.abbreviation}</span>
              <span className="text-zinc-500">{b.name}</span>
              <span className="text-xs text-zinc-400">{b.books} books</span>
              <button
                className="ml-auto text-xs text-red-600 hover:underline"
                onClick={() => void api.deleteBible(b.id).then(() => api.bibles().then(setBibles))}
              >
                remove
              </button>
            </li>
          ))}
          {bibles.length === 0 && <li className="py-1 text-sm text-zinc-500">No translations installed.</li>}
        </ul>
        <label className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Import OpenSong/Zefania Bible XML…
          <input type="file" multiple className="hidden" onChange={(e) => void importBible(e.target.files)} />
        </label>
      </fieldset>
    </div>
  );
}
