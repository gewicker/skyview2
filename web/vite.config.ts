import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// MPA entry points: the kiosk `display` app (index.html) and the v6 `airport` view
// (airport.html) — the graphically-heavier KSEA experience served to a PC/mobile client, kept a
// SEPARATE bundle so the always-on display bundle stays lean (rollup splits shared chunks). The
// control panel is an in-display drawer (Display.tsx), so there's no separate control page. Built
// into the Go server's embed directory so the binary is self-contained. Dev proxies /api + /ws.
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
        airport: resolve(__dirname, "airport.html"),
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
