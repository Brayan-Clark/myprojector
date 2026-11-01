import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Tests : uniquement les modules PURS de `src/lib`.
  //
  // Pas d'environnement DOM à dessein. Les composants de cette application se
  // testeraient mal (il faudrait une fenêtre de projection, un second écran,
  // une base SQLite), alors que la logique qui casse pour de vrai — découpage
  // des diapos, références bibliques, carte audio, conversion des leçons — est
  // entièrement pure. On teste là où le rapport valeur/coût est le meilleur,
  // pas partout.
  test: {
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
    // Ces tests ne touchent ni au disque ni à un état global : un worker par
    // fichier ne protège de rien et coûte ~240 ms de démarrage chacun.
    isolate: false,
  },
}));
