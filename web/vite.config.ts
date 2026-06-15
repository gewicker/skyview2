import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two entry points (kiosk display + phone control), built into the Go server's
// embed directory so the binary is self-contained. Dev proxies /api and /ws to the
// Go server on :3000.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/httpd/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        display: resolve(__dirname, "index.html"),
        control: resolve(__dirname, "control.html"),
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
