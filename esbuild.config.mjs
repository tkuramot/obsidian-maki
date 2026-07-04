import esbuild from "esbuild";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The bundle inputs (entry point, alias, externals) are exported so the
// third-party-license generator can run its own metafile build over the exact
// same graph — see scripts/gen-third-party-licenses.mjs.
export const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  alias: {
    // foliate-js lives in a git submodule (tkuramot's patched fork). tsc
    // resolves the same specifier to src/types/foliate-js/ (tsconfig paths).
    "foliate-js": "./vendor/foliate-js",
  },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2022",
  treeShaking: true,
  outfile: "main.js",
};

// Only build when invoked directly (`node esbuild.config.mjs`); importing this
// module for its buildOptions must not kick off a build or watcher.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const production = process.argv[2] === "production";

  const context = await esbuild.context({
    ...buildOptions,
    logLevel: "info",
    sourcemap: production ? false : "inline",
  });

  if (production) {
    await context.rebuild();
    process.exit(0);
  } else {
    await context.watch();
  }
}
