import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { releaseAssetsPlugin } from "../../scripts/release-assets.mjs";
export default defineConfig({
  plugins: [react(), releaseAssetsPlugin()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:47831",
        changeOrigin: true,
        headers: {
          Origin: "http://localhost:47831",
        },
      },
      "/healthz": {
        target: "http://127.0.0.1:47831",
        changeOrigin: true,
      },
    },
  },
});
