import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The core is framework-free (no DOM, no Obsidian), so plain node suffices.
    environment: "node",
  },
});
