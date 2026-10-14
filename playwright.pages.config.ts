import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/pages",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4188",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 4188 --bind 127.0.0.1 --directory website",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: false,
  },
});
