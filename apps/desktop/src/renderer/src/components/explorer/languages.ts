/**
 * Language detection for the read-only viewer.
 *
 * Kept out of `monaco-setup` on purpose: that module creates workers and defines
 * themes at import time, so a test that only wants to check the mapping would
 * have to boot Monaco. This file is pure data plus one function.
 *
 * Two rules the table has to obey:
 *
 * 1. **Only ids Monaco actually registers.** An unknown id does not raise — the
 *    editor silently renders monochrome text, which is exactly the "no
 *    highlighting" symptom this table exists to prevent. `MONACO_LANGUAGE_IDS`
 *    below is the registry (derived from
 *    `node_modules/monaco-editor/esm/vs/languages/definitions/*\/register.js`
 *    plus the four `languages/features/*\/register.js`), and a unit test asserts
 *    every mapping lands inside it.
 * 2. **Approximate rather than leave blank.** Monaco 0.58 has no Makefile,
 *    TOML, Groovy or ignore-file grammar. Those fall back to the closest
 *    registered grammar (Makefile→shell, TOML→ini, .gitignore→ini) because a
 *    near-miss colouring still helps a reader scan a file, while plaintext
 *    helps nobody. Cases where no sane approximation exists stay `plaintext`.
 */

/**
 * Every language id the `monaco-editor` package registers, plus `plaintext`
 * (Monaco's built-in null language, which is never listed by
 * `languages.getLanguages()`).
 */
const REGISTERED = [
  "abap",
  "aes",
  "apex",
  "azcli",
  "bat",
  "bicep",
  "c",
  "cameligo",
  "clojure",
  "coffeescript",
  "cpp",
  "csharp",
  "csp",
  "css",
  "cypher",
  "dart",
  "dockerfile",
  "ecl",
  "elixir",
  "flow9",
  "freemarker2",
  "fsharp",
  "go",
  "graphql",
  "handlebars",
  "hcl",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "less",
  "lexon",
  "liquid",
  "lua",
  "m3",
  "markdown",
  "mdx",
  "mips",
  "msdax",
  "mysql",
  "objective-c",
  "pascal",
  "pascaligo",
  "perl",
  "pgsql",
  "php",
  "pla",
  "postiats",
  "powerquery",
  "powershell",
  "proto",
  "pug",
  "python",
  "qsharp",
  "r",
  "razor",
  "redis",
  "redshift",
  "restructuredtext",
  "ruby",
  "rust",
  "sb",
  "scala",
  "scheme",
  "scss",
  "shell",
  "sol",
  "sparql",
  "sql",
  "st",
  "swift",
  "systemverilog",
  "tcl",
  "twig",
  "typescript",
  "typespec",
  "vb",
  "verilog",
  "wgsl",
  "xml",
  "yaml",
] as const;

export const MONACO_LANGUAGE_IDS: ReadonlySet<string> = new Set<string>([
  ...REGISTERED,
  "plaintext",
]);

/** Extension → language id. Keys are lower-case, without the dot. */
const BY_EXTENSION: Record<string, string> = {
  // --- JavaScript / TypeScript family ---
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  // --- data / config ---
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  ndjson: "json",
  geojson: "json",
  webmanifest: "json",
  ipynb: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",
  properties: "ini",
  service: "ini",
  desktop: "ini",
  inf: "ini",
  env: "ini",
  // --- web ---
  html: "html",
  htm: "html",
  xhtml: "html",
  vue: "html",
  svelte: "html",
  astro: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  // --- docs ---
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  rst: "restructuredtext",
  // --- systems languages ---
  c: "c",
  h: "c",
  cc: "cpp",
  cp: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  ipp: "cpp",
  cs: "csharp",
  csx: "csharp",
  go: "go",
  rs: "rust",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  java: "java",
  scala: "scala",
  sbt: "scala",
  groovy: "plaintext",
  gradle: "plaintext",
  // --- scripting ---
  py: "python",
  pyi: "python",
  pyw: "python",
  rb: "ruby",
  gemspec: "ruby",
  php: "php",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  jl: "julia",
  dart: "dart",
  vb: "vb",
  vbs: "vb",
  vba: "vb",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  scm: "scheme",
  ss: "scheme",
  coffee: "coffeescript",
  el: "plaintext",
  ex: "elixir",
  exs: "elixir",
  erl: "plaintext",
  hs: "plaintext",
  ml: "plaintext",
  mli: "plaintext",
  nim: "plaintext",
  nix: "plaintext",
  pas: "pascal",
  pp: "pascal",
  tcl: "tcl",
  qs: "qsharp",
  cy: "cypher",
  sol: "sol",
  // --- shells ---
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  awk: "shell",
  bat: "bat",
  cmd: "bat",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  psc1: "powershell",
  ps1xml: "xml",
  // --- query / proto ---
  sql: "sql",
  pgsql: "pgsql",
  mysql: "mysql",
  graphql: "graphql",
  gql: "graphql",
  graphqls: "graphql",
  proto: "proto",
  sparql: "sparql",
  rq: "sparql",
  // --- infra ---
  dockerfile: "dockerfile",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  nomad: "hcl",
  bicep: "bicep",
  azcli: "azcli",
  mk: "shell",
  cmake: "plaintext",
  // --- markup / metalanguages ---
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  xslt: "xml",
  svg: "xml",
  xaml: "xml",
  plist: "xml",
  xib: "xml",
  storyboard: "xml",
  csproj: "xml",
  vbproj: "xml",
  fsproj: "xml",
  vcxproj: "xml",
  props: "xml",
  targets: "xml",
  filters: "xml",
  resx: "xml",
  nuspec: "xml",
  hbs: "handlebars",
  mustache: "handlebars",
  twig: "twig",
  liquid: "liquid",
  pug: "pug",
  jade: "pug",
  razor: "razor",
  cshtml: "razor",
  // --- hardware ---
  v: "verilog",
  verilog: "verilog",
  sv: "systemverilog",
  svh: "systemverilog",
  vhd: "plaintext",
  vhdl: "plaintext",
  asm: "plaintext",
  s: "plaintext",
  // --- formats with no grammar ---
  diff: "plaintext",
  patch: "plaintext",
  csv: "plaintext",
  tsv: "plaintext",
  log: "plaintext",
  txt: "plaintext",
  tex: "plaintext",
  sty: "plaintext",
  http: "plaintext",
  rest: "plaintext",
  rego: "plaintext",
  tpl: "plaintext",
  lock: "plaintext",
};

/**
 * Exact file names (lower-case) that have no useful extension. Checked before
 * the extension table because `.gitignore`'s "extension" is the whole name.
 */
const BY_FILENAME: Record<string, string> = {
  // Ignore/config dotfiles: key-or-pattern per line, `#` comments — ini reads
  // them correctly enough to make the structure scannable.
  ".gitignore": "ini",
  ".dockerignore": "ini",
  ".npmignore": "ini",
  ".eslintignore": "ini",
  ".prettierignore": "ini",
  ".vscodeignore": "ini",
  ".helmignore": "ini",
  ".gitattributes": "ini",
  ".gitmodules": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
  ".yarnrc": "ini",
  ".nvmrc": "plaintext",
  // These are JSON in disguise.
  ".babelrc": "json",
  ".prettierrc": "json",
  ".eslintrc": "json",
  ".stylelintrc": "json",
  ".swcrc": "json",
  ".clang-format": "yaml",
  ".clang-tidy": "yaml",
  // Shell startup files.
  ".bashrc": "shell",
  ".bash_profile": "shell",
  ".bash_aliases": "shell",
  ".profile": "shell",
  ".zshrc": "shell",
  ".zprofile": "shell",
  ".zshenv": "shell",
  ".zlogin": "shell",
  // Go modules: no dedicated grammar, but `go` highlights the keyword shape
  // (`module`, `require`, `replace`) better than nothing.
  "go.mod": "go",
  "go.sum": "go",
  "go.work": "go",
  // Ruby DSL files.
  gemfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
  brewfile: "ruby",
  podfile: "ruby",
  guardfile: "ruby",
  capfile: "ruby",
  // Build files Monaco has no grammar for.
  makefile: "shell",
  gnumakefile: "shell",
  bsdmakefile: "shell",
  "cmakelists.txt": "plaintext",
  jenkinsfile: "plaintext",
  // Lock files.
  pipfile: "ini",
  "pipfile.lock": "json",
  "poetry.lock": "ini",
  "cargo.lock": "ini",
  "gemfile.lock": "plaintext",
  "yarn.lock": "plaintext",
  "pnpm-lock.yaml": "yaml",
  // Prose with no extension.
  license: "plaintext",
  licence: "plaintext",
  notice: "plaintext",
  readme: "plaintext",
  changelog: "plaintext",
  authors: "plaintext",
  contributors: "plaintext",
  ".vimrc": "plaintext",
  ".htaccess": "plaintext",
  ".envrc": "shell",
};

/** Prefix rules, for families whose names carry a suffix (`Dockerfile.dev`). */
const BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["dockerfile", "dockerfile"],
  ["docker-compose", "yaml"],
  ["compose.", "yaml"],
  [".env", "ini"],
  ["makefile.", "shell"],
  ["tsconfig.", "json"],
  ["jsconfig.", "json"],
];

function baseNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * Language id for a path, always one Monaco knows.
 *
 * Resolution order: exact file name → prefix family → extension → plaintext.
 * Dotfiles reach the extension table with an empty stem (`.env` has
 * `lastIndexOf(".") === 0`), which is why they are matched by name first.
 */
export function languageFor(path: string): string {
  const base = baseNameOf(path).toLowerCase();
  if (!base) return "plaintext";

  const byName = BY_FILENAME[base];
  if (byName) return byName;

  for (const [prefix, id] of BY_PREFIX) {
    if (base.startsWith(prefix)) return id;
  }

  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "plaintext";
  const id = BY_EXTENSION[base.slice(dot + 1)];
  return id ?? "plaintext";
}

/** Test seam: the raw tables, so a test can assert every value is registered. */
export const LANGUAGE_TABLES = { BY_EXTENSION, BY_FILENAME, BY_PREFIX };
