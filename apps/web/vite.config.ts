import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { releaseAssetsPlugin } from "../../scripts/release-assets.mjs";

export default defineConfig({
  plugins: [
    react(),
    releaseAssetsPlugin(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false, // We control SW registration via our exported React hook/bootstrap
      devOptions: {
        enabled: false, // Production SW disabled in ordinary dev
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json}"],
        globIgnores: [
          "**/api/**",
          "**/downloads/**",
          "**/resumes/**",
          "**/release*.json",
          "**/*.map",
        ],
      },
      manifest: {
        name: "Avari.Jobs — журнал откликов на вакансии",
        short_name: "Avari.Jobs",
        description: "Персональный журнал для поиска работы и трекинга откликов на вакансии",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0d111b",
        theme_color: "#0d111b",
        lang: "ru",
        icons: [
          {
            src: "/brand/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/brand/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Сегодня",
            short_name: "Сегодня",
            description: "План задач на сегодня",
            url: "/#today",
            icons: [
              {
                src: "/brand/shortcut-today.png",
                sizes: "96x96",
                type: "image/png",
              },
            ],
          },
          {
            name: "Календарь",
            short_name: "Календарь",
            description: "Календарь собеседований и событий",
            url: "/calendar",
            icons: [
              {
                src: "/brand/shortcut-calendar.png",
                sizes: "96x96",
                type: "image/png",
              },
            ],
          },
          {
            name: "Добавить вакансию",
            short_name: "Добавить",
            description: "Создать новый отклик на вакансию",
            url: "/#add-vacancy",
            icons: [
              {
                src: "/brand/shortcut-new.png",
                sizes: "96x96",
                type: "image/png",
              },
            ],
          },
        ],
        share_target: {
          action: "/share",
          method: "GET",
          params: {
            title: "title",
            text: "text",
            url: "url",
          },
        },
      },
    }),
  ],
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
