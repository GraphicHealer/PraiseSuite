import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultSlideStyle,
  parseMainSettings,
  parsePresentSettings,
  parsePrintConfig,
  type IdGenerator,
} from "@praisesuite/core";
import { storeMedia, type SqliteStorage } from "@praisesuite/storage-sqlite";

/**
 * OpenSong ships "OpenSong Defaults" — 6 background images plus settings
 * files whose styles embed JPEG backgrounds — and installs them into the
 * user's data folder on first run. We mirror that: the files live under
 * `assets/opensong-defaults/` and seed media storage + style settings.
 */
function defaultsDir(): string {
  // Packaged desktop builds ship the defaults outside the bundle layout —
  // PRAISESUITE_ASSETS points at them; dev resolves them relative to src/.
  return (
    process.env["PRAISESUITE_ASSETS"] ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "opensong-defaults")
  );
}

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
};

/** Store every bundled Backgrounds image as media (content-addressed — idempotent). */
export async function seedDefaultMedia(storage: SqliteStorage, ids: IdGenerator): Promise<string[]> {
  const dir = join(defaultsDir(), "Backgrounds");
  const keys: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (!(ext in IMAGE_TYPES)) continue;
    const m = await storeMedia(storage, ids, {
      data: await readFile(join(dir, name)),
      mediaType: IMAGE_TYPES[ext]!,
      originalFilename: name,
    });
    keys.push(m.storageKey);
  }
  return keys;
}

/** Apply the bundled PresentSettings styles (media must already be seeded). */
export async function applyOpenSongDefaults(
  storage: SqliteStorage,
  ids: IdGenerator,
): Promise<{ media: string[] }> {
  const media = await seedDefaultMedia(storage, ids);
  const dir = join(defaultsDir(), "Settings");
  const parsed = parsePresentSettings(await readFile(join(dir, "PresentSettings"), "utf8"));

  const style = { ...defaultSlideStyle(), ...parsed.style, backgroundColor: "#000000" };
  if (parsed.backgroundData) {
    const m = await storeMedia(storage, ids, {
      data: Buffer.from(parsed.backgroundData, "base64"),
      mediaType: "image/jpeg",
      originalFilename: "SeaRocks.jpg",
    });
    style.backgroundKey = m.storageKey;
  }
  if (parsed.logoData) {
    const m = await storeMedia(storage, ids, {
      data: Buffer.from(parsed.logoData, "base64"),
      mediaType: "image/jpeg",
      originalFilename: "logo.jpg",
    });
    style.logoKey = m.storageKey;
  }
  storage.setSetting("style.present", JSON.stringify(style));
  storage.setSetting("style.options", JSON.stringify(parsed.options));
  storage.setSetting("style.songStylePreferred", String(parsed.songStylePreferred));

  if (parsed.scriptureStyle) {
    const sc = { ...parsed.scriptureStyle };
    if (parsed.scriptureBackgroundData) {
      const m = await storeMedia(storage, ids, {
        data: Buffer.from(parsed.scriptureBackgroundData, "base64"),
        mediaType: "image/jpeg",
        originalFilename: "Scripture.jpg",
      });
      sc.backgroundKey = m.storageKey;
    }
    storage.setSetting("style.scripture", JSON.stringify(sc));
  }

  try {
    const cfg = parsePrintConfig(await readFile(join(dir, "PrintSettings"), "utf8"));
    storage.setSetting("style.print", JSON.stringify(cfg));
  } catch { /* PrintSettings optional */ }
  try {
    const main = parseMainSettings(await readFile(join(dir, "MainSettings"), "utf8"));
    storage.setSetting("style.userFields", JSON.stringify(main.userFieldLabels));
  } catch { /* MainSettings optional */ }

  return { media };
}

/**
 * First-run seed — OpenSong installs its defaults once. Media always seeds
 * (idempotent); styles only where the user has none yet.
 */
export async function seedOpenSongDefaults(storage: SqliteStorage, ids: IdGenerator): Promise<void> {
  try {
    await seedDefaultMedia(storage, ids);
    if (storage.getSetting("style.present") === null) await applyOpenSongDefaults(storage, ids);
    else if (storage.getSetting("style.scripture") === null) {
      // Existing installs predate scripture seeding — add just that piece.
      const dir = join(defaultsDir(), "Settings");
      const parsed = parsePresentSettings(await readFile(join(dir, "PresentSettings"), "utf8"));
      if (parsed.scriptureStyle) {
        const sc = { ...parsed.scriptureStyle };
        if (parsed.scriptureBackgroundData) {
          const m = await storeMedia(storage, ids, {
            data: Buffer.from(parsed.scriptureBackgroundData, "base64"),
            mediaType: "image/jpeg",
            originalFilename: "Scripture.jpg",
          });
          sc.backgroundKey = m.storageKey;
        }
        storage.setSetting("style.scripture", JSON.stringify(sc));
      }
    }
  } catch {
    /* defaults seeding is best-effort — the app must still boot offline */
  }
}
