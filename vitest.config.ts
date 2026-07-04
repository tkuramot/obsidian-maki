import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same resolution as the esbuild bundle: the foliate-js submodule.
      // (tsc instead resolves the specifier to src/types/foliate-js/.)
      "foliate-js": fileURLToPath(new URL("./vendor/foliate-js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The core is framework-free (no DOM, no Obsidian), so plain node
    // suffices. DOM-dependent backend tests opt into jsdom per file via a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
  },
});
