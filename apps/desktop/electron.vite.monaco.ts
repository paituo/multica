import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Keeps Monaco's four language services out of the bundle.
 *
 * `monaco-editor`'s barrel (`esm/vs/index.js`, the `"."` export) pulls in a
 * TypeScript, JSON, CSS and HTML service alongside the grammars. Each one
 * registers its providers once a model of that language exists, and every
 * provider then talks to a *language* worker — a worker the explorer does not
 * have and must not have:
 *
 * - The viewer is read-only and reads one file at a time over IPC. There is no
 *   project to type-check against, so diagnostics, hover, completion and
 *   go-to-definition could not be answered even with the workers present.
 * - The TypeScript worker alone is 6.8 MB of `typescriptServices.js`, plus
 *   1.1 MB CSS, 0.76 MB HTML and 0.46 MB JSON — measured in the harness build
 *   output, and all of it dead weight in a shipped app.
 *
 * Handing those providers the editor worker instead (the shape of the bug) is
 * what produced, in order: `Missing requestHandler or method:
 * provideInlayHints`, then `getSyntacticDiagnostics`, then `resetSchema`.
 * `setModeConfiguration({})` did not stop it either — `resetSchema` is sent
 * while the JSON mode sets up, before any provider runs — so the services have
 * to leave the module graph.
 *
 * The grammars live in `languages/definitions/*` and are untouched: syntax
 * colouring keeps working, which is the only language feature a reader of a
 * single file needs.
 */
const SERVICE_REGISTER = /(?:^|[\\/])languages[\\/]features[\\/](css|html|json|typescript)[\\/]register\.js$/;

const SERVICE_IDS = ["css", "html", "json", "typescript"] as const;

const EMPTY_MODULE = "\0multica:monaco-language-service-removed";

/**
 * Fails the build if the barrel no longer imports the services.
 *
 * Without this, a Monaco upgrade that changes the internal layout would make
 * the `resolveId` hook below match nothing — and the bug would come back as
 * worker errors at runtime instead of a build error.
 */
function assertBarrelStillPullsServicesIn(): void {
  const require = createRequire(import.meta.url);
  // `require.resolve("monaco-editor")` picks the CJS build (`min/vs/index.js`),
  // which is already bundled and contains no import statements left to look
  // for. The editor entry resolves through the same `exports` map Vite uses,
  // and the barrel is its sibling one level up (`esm/vs/index.js`).
  const editorApi = require.resolve("monaco-editor/editor/editor.api.js");
  const barrel = readFileSync(resolve(dirname(editorApi), "..", "index.js"), "utf8");
  const missing = SERVICE_IDS.filter((id) => !barrel.includes(`languages/features/${id}/register.js`));
  if (missing.length > 0) {
    throw new Error(
      `[monaco] the barrel no longer imports ${missing.join(", ")}; ` +
        "re-check that no language service reaches the explorer bundle, then update this plugin.",
    );
  }
}

export function monacoWithoutLanguageServices(): Plugin {
  let checked = false;
  return {
    name: "multica:monaco-without-language-services",
    // Ahead of Vite's own resolution, so the bare barrel import is intercepted
    // while the service specifiers are still relative strings.
    enforce: "pre",
    buildStart() {
      if (checked) return;
      checked = true;
      assertBarrelStillPullsServicesIn();
    },
    resolveId(source, importer) {
      if (!importer?.includes("monaco-editor")) return null;
      return SERVICE_REGISTER.test(source) ? EMPTY_MODULE : null;
    },
    load(id) {
      return id === EMPTY_MODULE ? "export {};" : null;
    },
  };
}
