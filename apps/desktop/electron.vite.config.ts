import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { monacoWithoutLanguageServices } from "./electron.vite.monaco";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // `@electron-toolkit/preload` must be bundled INTO the preload script:
    // the renderer windows run with `sandbox: true`, and a sandboxed preload's
    // `require` can only load `electron` plus a couple of node builtins — an
    // externalized `require("@electron-toolkit/preload")` would throw and
    // every contextBridge API would vanish. electron-vite emits preload as a
    // single CJS bundle, which is exactly what the sandbox requires.
    plugins: [externalizeDepsPlugin({ exclude: ["@electron-toolkit/preload"] })],
  },
  renderer: {
    server: {
      // Allow parallel worktrees to run `pnpm dev:desktop` side-by-side
      // (e.g. Multica Canary alongside a primary checkout) by overriding
      // the renderer port via env. Falls back to 5173 for the common case.
      port: Number(process.env.DESKTOP_RENDERER_PORT) || 5173,
      strictPort: true,
    },
    plugins: [react(), tailwindcss(), monacoWithoutLanguageServices()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
      },
      dedupe: ["react", "react-dom", "@tanstack/react-query"],
    },
    // The plugin above only sees module ids Vite resolves itself, and a
    // pre-bundled dependency is opaque to it. Monaco has to stay unbundled for
    // the language services to be dropped from the dev graph as well as from
    // `build`; production output is unaffected either way.
    optimizeDeps: { exclude: ["monaco-editor"] },
  },
});
