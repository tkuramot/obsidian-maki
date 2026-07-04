import { readFileSync, writeFileSync } from "node:fs";

// Bump the version in manifest.json, versions.json and package.json.
// Usage: node scripts/bump.mjs <major|minor|patch|x.y.z>

const arg = process.argv[2];

const write = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const [major, minor, patch] = manifest.version.split(".").map(Number);

let next;
switch (arg) {
  case "major":
    next = `${major + 1}.0.0`;
    break;
  case "minor":
    next = `${major}.${minor + 1}.0`;
    break;
  case "patch":
    next = `${major}.${minor}.${patch + 1}`;
    break;
  default:
    if (/^\d+\.\d+\.\d+$/.test(arg ?? "")) {
      next = arg;
    } else {
      console.error(
        `Usage: node scripts/bump.mjs <major|minor|patch|x.y.z>\nCurrent version: ${manifest.version}`,
      );
      process.exit(1);
    }
}

manifest.version = next;
write("manifest.json", manifest);

// versions.json maps each plugin version to the minAppVersion it requires, so
// Obsidian can offer the newest compatible release to older apps.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[next] = manifest.minAppVersion;
write("versions.json", versions);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = next;
write("package.json", pkg);

// Last stdout line is the new version, for CI to capture.
console.log(next);
