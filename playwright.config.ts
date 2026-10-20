import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.AVARI_E2E_OUTPUT_DIR || "test-results",
  grep: process.env.AVARI_E2E_GREP ? new RegExp(process.env.AVARI_E2E_GREP) : undefined,
  timeout: 45000,
  expect: { timeout: 8000 },
  workers: 1,
  use: {
    reducedMotion: "reduce",
    baseURL: process.env.AVARI_TEST_URL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
