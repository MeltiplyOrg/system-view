/**
 * Playwright configuration for the built site.
 *
 * CI builds once in the quality job, downloads `dist`, and starts the Vite+
 * preview server here. Tests run against production output, not the dev
 * server, so bundling and asset paths are covered. Browser, trace, and video
 * artifacts are retained only on failure to keep CI storage bounded.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  // Never allow `.only` to silently shrink CI coverage.
  forbidOnly: Boolean(process.env.CI),
  // One retry policy for both CI and local runs would hide flakes locally, so
  // retries are CI-only while traces still capture the first failure.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "dark",
    // The app honors reduced motion; disabling transitions makes axe scans
    // and interaction assertions deterministic on slower runners.
    reducedMotion: "reduce",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Bind IPv4 explicitly: Vite+ preview defaults to localhost, which can
    // resolve to ::1 while Playwright polls 127.0.0.1.
    command: "bun run preview --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
