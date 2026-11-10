import { defineConfig, devices } from "@playwright/test";

/**
 * Compatibility checks are separate from Chromium's verified FFmpeg suite.
 * Linux Firefox/Android and macOS WebKit/iPhone are browser emulations, not
 * claims of real Safari/iOS or Android hardware codec support.
 */
const allProjects = [
  { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
  { name: "android-chromium-emulated", use: { ...devices["Pixel 5"] } },
  { name: "webkit-desktop-macos", use: { ...devices["Desktop Safari"] } },
  { name: "iphone-webkit-emulated", use: { ...devices["iPhone 13"] } },
];
const selected = process.env.COMPAT_BROWSER;
const projects = allProjects.filter(({ name }) =>
  !selected || (selected === "firefox" && name.startsWith("firefox")) ||
  (selected === "chromium" && name.startsWith("android")) ||
  (selected === "webkit" && (name.startsWith("webkit") || name.startsWith("iphone"))),
);
if (projects.length === 0) throw new Error("Unknown COMPAT_BROWSER target");

export default defineConfig({
  testDir: "tests/compat",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report/compat" }]]
    : "list",
  outputDir: "test-results/compat",
  projects,
  use: {
    baseURL: "http://127.0.0.1:3000",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @any-convert/web start",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
