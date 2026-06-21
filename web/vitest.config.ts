import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Unit tests for the PURE cores (mercator/path/notable/…) — no DOM, no React. Runs on the PC via
// `npm run check` (typecheck + test); the Pi `make pi` build never runs tests (test files are
// excluded from tsconfig and unreachable from the Vite entries), so this is purely a dev safety net.
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
