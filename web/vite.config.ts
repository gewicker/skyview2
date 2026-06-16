import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Single entry point: the display app. The control panel is now an in-display drawer
// (Display.tsx), so there's no separate control page. Built into the Go server's embed
// directory so the binary is self-contained. Dev proxies /api and /ws to :3000.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": resolve(__dirname, "src/shared") },
  },
  build: {
    outDir: "../internal/httpd/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        display: resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
