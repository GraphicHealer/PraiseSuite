import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { FileStore } from "@praisesuite/core";

const KEY_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * Filesystem-backed media store (TAS 9.6): opaque storage keys, never exposed
 * paths. Keys are validated against traversal before touching the disk.
 */
export class FilesystemFileStore implements FileStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    if (
      !KEY_RE.test(key) ||
      key.startsWith("/") ||
      key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
    ) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    const p = resolve(this.root, key);
    if (relative(this.root, p).startsWith("..") || !relative(this.root, p)) {
      throw new Error(`Storage key escapes root: ${JSON.stringify(key)}`);
    }
    return p;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.pathFor(key));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const s = await stat(this.pathFor(key));
      return s.isFile();
    } catch {
      return false;
    }
  }

  async listKeys(prefix = ""): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          const key = relative(this.root, p).split(sep).join("/");
          if (key.startsWith(prefix)) out.push(key);
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }
}
