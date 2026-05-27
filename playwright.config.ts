import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      "User-Agent": "modelfusion-hermes-skill-e2e/0.1.0",
    },
  },
});
