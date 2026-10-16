import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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
