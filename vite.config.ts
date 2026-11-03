import { defineConfig } from "vite";

export default defineConfig({
  // Chemins relatifs : le même build marche sur GitHub Pages, dans Capacitor et en local.
  base: "./",
  build: { target: "es2022", outDir: "dist" },
  server: { port: 5173 },
});
