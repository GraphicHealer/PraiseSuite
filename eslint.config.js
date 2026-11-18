import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/build/**", "**/coverage/**", "**/node_modules/**", "**/public/vendor/**"],
  },
  {
    // Plain-JS files (Electron main, configs) run in Node — TS files get
    // undefined-name checking from tsc instead of no-undef.
    files: ["**/*.{mjs,cjs,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Boundary applies to shipped source only — test files run in Node and may
    // read fixtures via node:fs even under the happy-dom environment.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      // packages/core is isomorphic: it must run in Node, browsers, and the
      // Android WebView. No Node builtins and no process/global Node APIs.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "packages/core is isomorphic — Node builtins are forbidden. Use an injected port from src/ports instead.",
            },
            {
              group: ["fs", "path", "os", "child_process", "crypto", "net", "http", "https", "url", "util", "stream", "zlib", "buffer", "events", "worker_threads"],
              message:
                "packages/core is isomorphic — Node builtins are forbidden. Use an injected port from src/ports instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "Node-only global. Inject what you need via ports." },
        { name: "Buffer", message: "Node-only global. Use Uint8Array + an injected port." },
        { name: "__dirname", message: "Node-only global." },
        { name: "__filename", message: "Node-only global." },
        { name: "global", message: "Node-only global. Use globalThis." },
      ],
    },
  },
);
