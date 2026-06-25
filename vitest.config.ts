import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Astro's `astro:env/server` is a build-time virtual module with no
      // standalone existence under Vitest; point it at a static stub so units
      // that read server env (e.g. src/lib/log.ts) resolve.
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
  test: {
    // Global environment stays node (the implicit default); component specs opt
    // into jsdom per-file via a `// @vitest-environment jsdom` docblock —
    // environmentMatchGlobs was removed in Vitest 4. setupFiles only registers
    // jest-dom matchers + cleanup, so node-environment tests are unaffected.
    include: [
      "test/**/*.test.ts",
      "test/**/*.test.tsx",
      // Colocated unit tests for standalone tooling (e.g. scripts/git-brief/).
      "scripts/**/*.test.ts",
    ],
    setupFiles: ["./test/setup-dom.ts"],
  },
});
