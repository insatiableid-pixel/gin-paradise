import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: `./test-e2e-${port}.sqlite`,
      COORDINATOR_MODE: "memory",
      NODE_ENV: "development",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
