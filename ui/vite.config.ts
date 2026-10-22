import { defineConfig } from "vite";

// Tauri sert la webview depuis ce serveur en dev (port fixe, voir tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2022", outDir: "dist" },
});
