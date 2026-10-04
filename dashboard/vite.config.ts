import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base ensures GitHub Pages serves assets properly regardless of subpath
  base: "./",
  server: {
    port: 5173,
    host: true,
  },
});
