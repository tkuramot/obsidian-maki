import esbuild from "esbuild";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { buildOptions } from "../esbuild.config.mjs";

// Regenerate THIRD_PARTY_LICENSES from the packages esbuild actually pulls into
// main.js. The list is derived from the bundle's metafile inputs, not a
// hand-maintained set, so new (and transitive) runtime dependencies get picked
// up automatically and dropped dependencies disappear. externals (obsidian,
// codemirror) never appear in the graph, so they are excluded for free.
//
//   node scripts/gen-third-party-licenses.mjs           # write the file
//   node scripts/gen-third-party-licenses.mjs --check    # fail if stale

const OUT = "THIRD_PARTY_LICENSES";
const check = process.argv.includes("--check");

// Canonical text for licenses that some packages ship without a LICENSE file
// (e.g. monkey-around declares "ISC" but bundles no file). Only the copyright
// holder varies, so we fill it from the package's `author`. An SPDX id that is
// neither found on disk nor listed here is a hard error — that is the whole
// point: a new dependency under an unhandled license breaks the build instead
// of silently shipping without attribution.
const templates = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
};

const NODE_MODULES = "node_modules/";
const FOLIATE_DIR = "vendor/foliate-js";

// Map a bundle input file to the root directory of the package that owns it.
// Returns null for our own sources (src/...), which need no attribution.
function owningPackageDir(file) {
  const path = file.split("\\").join("/");
  const nm = path.lastIndexOf(NODE_MODULES);
  if (nm !== -1) {
    const rest = path.slice(nm + NODE_MODULES.length).split("/");
    const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
    return path.slice(0, nm + NODE_MODULES.length) + name;
  }
  if (path.includes(FOLIATE_DIR)) {
    return path.slice(0, path.indexOf(FOLIATE_DIR) + FOLIATE_DIR.length);
  }
  return null;
}

function authorName(author) {
  if (!author) return "the authors";
  if (typeof author === "string") return author.replace(/\s*<[^>]*>.*/, "").trim();
  return author.name ?? "the authors";
}

// A LICENSE / LICENCE / COPYING file in the package root, if any.
function findLicenseFile(dir) {
  const entries = readdirSync(dir);
  const match = entries.find((e) => /^(licen[cs]e|copying)(\.|$)/i.test(e));
  return match ? readFileSync(join(dir, match), "utf8").trim() : null;
}

function collect() {
  return esbuild.build({
    ...buildOptions,
    write: false,
    metafile: true,
    sourcemap: false,
    logLevel: "silent",
  });
}

function licenseText(dir, pkg) {
  const onDisk = findLicenseFile(dir);
  if (onDisk) return onDisk;

  const spdx = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  const template = spdx && templates[spdx];
  if (template) return template(authorName(pkg.author));

  throw new Error(
    `${pkg.name}@${pkg.version}: no LICENSE file and no template for "${spdx ?? "unknown"}".\n` +
      `Add the SPDX id to the templates map in scripts/gen-third-party-licenses.mjs, ` +
      `or vendor the license text into ${dir}.`,
  );
}

function render(sections) {
  const header = `Third-party licenses
====================

Maki bundles the following third-party code into main.js. This file is
generated by scripts/gen-third-party-licenses.mjs from the packages esbuild
resolves into the bundle; do not edit it by hand — run \`pnpm licenses\`.

`;
  const body = sections
    .map(
      (
        s,
      ) => `--------------------------------------------------------------------------------
${s.name}@${s.version} — ${s.spdx}
--------------------------------------------------------------------------------

${s.text}`,
    )
    .join("\n\n");
  return `${header}${body}\n`;
}

const result = await collect();

const dirs = new Set();
for (const file of Object.keys(result.metafile.inputs)) {
  const dir = owningPackageDir(file);
  if (dir) dirs.add(dir);
}

const sections = [...dirs]
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const spdx =
      (typeof pkg.license === "string" ? pkg.license : pkg.license?.type) ?? "UNKNOWN";
    return { name: pkg.name, version: pkg.version, spdx, text: licenseText(dir, pkg) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const content = render(sections);
const list = sections.map((s) => `  - ${s.name}@${s.version} (${s.spdx})`).join("\n");

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (current !== content) {
    console.error(`${OUT} is out of date. Run \`pnpm licenses\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${sections.length} packages).`);
} else {
  writeFileSync(OUT, content);
  console.log(`Wrote ${OUT} with ${sections.length} bundled packages:\n${list}`);
}
