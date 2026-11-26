import { describe, expect, it } from "vitest";
import { LANGUAGE_TABLES, MONACO_LANGUAGE_IDS, languageFor } from "./languages";

describe("languageFor", () => {
  it("special-cases dotfiles, which have no extension stem", () => {
    expect(languageFor(".gitignore")).toBe("ini");
    expect(languageFor(".editorconfig")).toBe("ini");
    expect(languageFor(".bashrc")).toBe("shell");
    expect(languageFor(".babelrc")).toBe("json");
    expect(languageFor(".env")).toBe("ini");
    // `.env.local` has a suffix, so the prefix family handles it.
    expect(languageFor(".env.local")).toBe("ini");
  });

  it("matches extensionless build files by name and prefix", () => {
    expect(languageFor("Makefile")).toBe("shell");
    expect(languageFor("docs/Dockerfile")).toBe("dockerfile");
    expect(languageFor("Dockerfile.dev")).toBe("dockerfile");
    expect(languageFor("docker-compose.yml")).toBe("yaml");
    expect(languageFor("go.mod")).toBe("go");
    expect(languageFor("Gemfile")).toBe("ruby");
  });

  it("is case-insensitive on both the name and the extension", () => {
    expect(languageFor("README.MD")).toBe("markdown");
    expect(languageFor("src/App.TSX")).toBe("typescript");
    expect(languageFor("MAKEFILE")).toBe("shell");
  });

  it("handles Windows separators", () => {
    expect(languageFor("src\\main\\go\\app.go")).toBe("go");
    expect(languageFor("C:\\repo\\Dockerfile")).toBe("dockerfile");
  });

  it("maps the languages the old table missed", () => {
    expect(languageFor("build.cmd")).toBe("bat");
    expect(languageFor("api.proto")).toBe("proto");
    expect(languageFor("Main.scala")).toBe("scala");
    expect(languageFor("x.tf")).toBe("hcl");
    expect(languageFor("f.fsx")).toBe("fsharp");
    expect(languageFor("q.cljs")).toBe("clojure");
    expect(languageFor("a.sv")).toBe("systemverilog");
    expect(languageFor("Project.csproj")).toBe("xml");
  });

  it("falls back to plaintext for unknown or stunted names", () => {
    expect(languageFor("notes.unknownext")).toBe("plaintext");
    expect(languageFor("trailing.")).toBe("plaintext");
    expect(languageFor("no-extension")).toBe("plaintext");
    expect(languageFor("")).toBe("plaintext");
  });
});

describe("language tables", () => {
  /**
   * The real failure mode this guards: an id Monaco does not know makes the
   * editor render monochrome text with no error, which reads as "highlighting
   * is broken for this file type" and is invisible to the type checker.
   */
  it("only ever returns ids Monaco registers", () => {
    const { BY_EXTENSION, BY_FILENAME, BY_PREFIX } = LANGUAGE_TABLES;
    const ids = [
      ...Object.entries(BY_EXTENSION),
      ...Object.entries(BY_FILENAME),
      ...BY_PREFIX.map(([prefix, id]) => [prefix, id] as const),
    ].map(([key, id]) => `${key} → ${id}`);
    const unknown = ids.filter((entry) => !MONACO_LANGUAGE_IDS.has(entry.split(" → ")[1]));

    expect(unknown).toEqual([]);
  });

  it("keeps table keys lower-case so lookups cannot miss", () => {
    const keys = [
      ...Object.keys(LANGUAGE_TABLES.BY_EXTENSION),
      ...Object.keys(LANGUAGE_TABLES.BY_FILENAME),
    ];
    expect(keys.filter((key) => key !== key.toLowerCase())).toEqual([]);
  });
});
