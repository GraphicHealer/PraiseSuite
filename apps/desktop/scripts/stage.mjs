/**
 * Stage the packaged app: builds a self-contained app dir electron-builder
 * can pack. The server runs as a child Node process (the renderer can't
 * take the data layer down), so staging ships:
 *   staging/main.mjs, preload.cjs, package.json  → app asar
 *   staging/runtime/node.exe                     → resources/runtime
 *   staging/server/app/server.mjs + node_modules → resources/server/app
 *   (nested one level — a top-level node_modules in an extraResources
 *   "from" dir is filtered out by electron-builder)
 *   staging/web/                                 → resources/web
 *   staging/assets/opensong-defaults/            → resources/assets
 * node.exe is copied from the running Node — same runtime + ABI as the
 * npm-installed better-sqlite3 prebuild, so nothing needs compiling.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(dir, "..");
const ROOT = path.resolve(DESKTOP, "..", "..");
const STAGE = path.join(DESKTOP, "staging");

// Invoke package managers through node + their CLI entrypoints — PATH shim
// resolution (.cmd) isn't reliable under execFileSync on Windows.
const nodeDir = path.dirname(process.execPath);
const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
const pnpmCli = process.env.npm_execpath; // set when run via `pnpm …`
const run = (tool, args, cwd = ROOT) => {
  const cli = tool === "npm" ? npmCli : pnpmCli;
  if (cli && existsSync(cli)) {
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: "inherit" });
  } else {
    execFileSync(tool, args, { cwd, stdio: "inherit", shell: true });
  }
};

// 1. Build inputs ----------------------------------------------------------
run("pnpm", ["--filter", "@praisesuite/web", "build"]);
run("pnpm", ["--filter", "@praisesuite/server", "build"]);

// 2. Clean + lay out staging ----------------------------------------------
rmSync(STAGE, { recursive: true, force: true });
for (const d of ["server/app", "runtime", "web", "assets"]) {
  mkdirSync(path.join(STAGE, d), { recursive: true });
}
copyFileSync(path.join(DESKTOP, "src", "main.mjs"), path.join(STAGE, "main.mjs"));
copyFileSync(path.join(DESKTOP, "src", "preload.cjs"), path.join(STAGE, "preload.cjs"));
copyFileSync(path.join(DESKTOP, "icon.ico"), path.join(STAGE, "icon.ico"));
copyFileSync(
  path.join(DESKTOP, "electron-builder.yml"),
  path.join(STAGE, "electron-builder.yml"),
);
copyFileSync(
  path.join(ROOT, "apps", "server", "dist", "server.mjs"),
  path.join(STAGE, "server", "app", "server.mjs"),
);
cpSync(path.join(ROOT, "apps", "web", "dist"), path.join(STAGE, "web"), { recursive: true });
cpSync(
  path.join(ROOT, "apps", "server", "assets"),
  path.join(STAGE, "assets"),
  { recursive: true },
);

// 3. Bundled Node runtime — the very binary running this script, so the
//    better-sqlite3 prebuild npm installs next will match its ABI.
copyFileSync(process.execPath, path.join(STAGE, "runtime", "node.exe"));

// 4. Server runtime deps — better-sqlite3 (native) resolved by the bundle
//    at runtime; install the same version the workspace uses.
const sqliteVer = JSON.parse(
  readFileSync(
    path.join(
      ROOT,
      "packages",
      "storage-sqlite",
      "node_modules",
      "better-sqlite3",
      "package.json",
    ),
    "utf8",
  ),
).version;
writeFileSync(path.join(STAGE, "server", "app", "package.json"), '{"type":"module"}\n');
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", `better-sqlite3@${sqliteVer}`], path.join(STAGE, "server", "app"));
// The prebuild is downloaded by an install script — if the npm
// environment blocked it (allow-scripts), fail loudly instead of
// shipping a package that can't open its database.
if (
  !existsSync(
    path.join(
      STAGE,
      "server",
      "app",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
  )
) {
  throw new Error(
    "better-sqlite3 native binary missing — npm blocked its install script. " +
      "Re-run with scripts allowed (npm approve-scripts) or install it manually.",
  );
}

// 5. App package.json — electron-builder reads name/version/main from it;
//    the electron devDep pins the runtime version without installing it.
const electronVer = JSON.parse(
  readFileSync(path.join(DESKTOP, "node_modules", "electron", "package.json"), "utf8"),
).version;
const desktopPkg = JSON.parse(readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
writeFileSync(
  path.join(STAGE, "package.json"),
  JSON.stringify(
    {
      name: "praisesuite",
      productName: "PraiseSuite",
      description: "OpenSong-compatible worship presentation (Electron desktop)",
      version: desktopPkg.version,
      private: true,
      main: "main.mjs",
      devDependencies: { electron: electronVer },
    },
    null,
    2,
  ) + "\n",
);

console.log(`staged → ${STAGE}`);

/**
 * electron-builder fetches winCodeSign (signtool/rcedit) on demand — its
 * archive contains macOS symlinks that need Developer Mode or admin to
 * extract. Pre-seed the cache excluding the unusable darwin/ subtree so
 * `pnpm dist` works on any Windows dev box.
 */
async function ensureWinCodeSign() {
  if (process.platform !== "win32") return;
  const ver = "winCodeSign-2.6.0"; // app-builder-bin's bundled version
  const dest = path.join(
    process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
    "electron-builder",
    "Cache",
    "winCodeSign",
    ver,
  );
  if (existsSync(dest)) return;
  const { path7za } = createRequire(import.meta.url)("7zip-bin");
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${ver}/${ver}.7z`;
  const archive = path.join(STAGE, `${ver}.7z`);
  writeFileSync(archive, Buffer.from(await (await fetch(url)).arrayBuffer()));
  mkdirSync(dest, { recursive: true });
  execFileSync(path7za, ["x", "-y", archive, `-o${dest}`, "-xr!darwin"], {
    stdio: "inherit",
  });
  rmSync(archive);
}

// --pack: run electron-builder on the staging dir. winCodeSign is needed
// regardless (signtool/rcedit resolve unconditionally), so the cache is
// pre-seeded above; CSC_IDENTITY_AUTO_DISCOVERY=false skips cert discovery
// (unsigned builds — no signing cert configured).
if (process.argv.includes("--pack")) {
  await ensureWinCodeSign();
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  const builderPkg = path.join(DESKTOP, "node_modules", "electron-builder", "package.json");
  const builderCli = path.join(path.dirname(builderPkg), "cli.js");
  execFileSync(
    process.execPath,
    [builderCli, "--projectDir", STAGE, "--win", "--publish", "never"],
    { stdio: "inherit" },
  );
}
