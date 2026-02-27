import { defineConfig } from "@playwright/test";

const PORT = 3101;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const canBootLocalNextServer = Number.parseInt(process.versions.node.split(".")[0] || "0", 10) >= 20;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: "output/playwright",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer:
    process.env.PLAYWRIGHT_BASE_URL || !canBootLocalNextServer
      ? undefined
      : {
        command: `sh -lc 'pnpm exec next build --webpack && pnpm exec next start --port ${PORT}'`,
        url: `http://127.0.0.1:${PORT}/chat`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
