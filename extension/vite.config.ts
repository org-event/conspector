import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Extension pages must not depend on Vite's modulepreload polyfill path hacks.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(rootDir, "popup.html"),
        offscreen: resolve(rootDir, "offscreen.html"),
        "mic-permission": resolve(rootDir, "mic-permission.html"),
        background: resolve(rootDir, "background.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "offscreen") return "offscreen.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    {
      name: "conspector-extension-build",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        copyFileSync("manifest.json", "dist/manifest.json");
        cpSync("icons", "dist/icons", { recursive: true });
      },
    },
  ],
});
